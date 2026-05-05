/**
 * Self-Healing Eval runner.
 *
 * Orchestrates one full eval run end-to-end:
 *   1. Reuse the existing smoke check for system probes
 *      (health + demo job + webhook), mapped onto the eval report shape.
 *   2. Walk the question bank in deterministic order.
 *   3. For each question call the demo agent (preserving conversation
 *      context for follow-ups), then the LLM judge.
 *   4. After all turns, build summaries, recommendations and the
 *      deterministic Copilot prompt; persist via storage.ts.
 *
 * The runner is single-flighted: a second call while one is in flight
 * returns the same in-progress promise. Long-running by nature — admins
 * kick it off via POST and poll status via GET.
 *
 * No retries by design (an MVP keeps cost predictable). Failed agent or
 * judge calls degrade the affected turn to a `fail` verdict with a
 * specific `admin-diagnostics` root cause so the operator sees what
 * went wrong.
 */
import { runSmoke, type UpstreamFetch as SmokeFetch } from '../smoke.js'
import { getProxyConfig } from '../proxy.js'
import { callDemoAgent, type AgentFetch, type AgentMessage } from './agentClient.js'
import { getEvalConfig, getAvailability, type EvalConfig } from './config.js'
import {
  probeContextForQuestion,
  type ProbeFetch,
} from './contextProbe.js'
import {
  applyMustIncludeCorrection,
  judge,
  type JudgeFetch,
} from './llmJudge.js'
import {
  getDefaultQuestionCount,
  getMaxLevelForMode,
  selectQuestions,
} from './questionBank.js'
import { applyOverrideSafetyFilter } from './questionGenerator.js'
import { compareReports } from './comparison.js'
import { preparePromptOverride } from './promptOverride.js'
import {
  buildCopilotPrompt,
  buildRecommendations,
  summarize,
} from './reportFormat.js'
import {
  finalizeReport,
  getById,
  getCurrent,
  getLatest,
  isRunning,
  setCurrentRunningReport,
  updateCurrentRunningReport,
} from './storage.js'
import type {
  AgentPromptOverrideMetadata,
  ConversationTurn,
  DemoJobResult,
  EvalLevel,
  EvalMode,
  EvalReport,
  EvalRunOptions,
  EvalStatus,
  HealthResult,
  RunStatus,
  Verdict,
  WebhookResult,
} from './types.js'

// ─── Shared state ────────────────────────────────────────────────────────

interface RunnerState {
  inFlight: Promise<EvalReport> | null
}
const state: RunnerState = { inFlight: null }

export function _resetEvalRunnerForTests(): void {
  state.inFlight = null
}

// ─── Public surface ──────────────────────────────────────────────────────

export interface RunnerInjections {
  judgeFetch?: JudgeFetch
  agentFetch?: AgentFetch
  smokeFetch?: SmokeFetch
  /** Per-turn /v1/context probe used to ground the judge. Tests inject. */
  probeFetch?: ProbeFetch
  /** Allow tests to skip the polling sleep inside runSmoke. */
  smokeSleep?: (ms: number) => Promise<void>
  /** Stable run id for tests; otherwise generated. */
  runId?: string
  /** Override config for unit tests instead of reading process.env. */
  config?: EvalConfig
}

export async function getEvalStatus(
  injections: RunnerInjections = {},
): Promise<EvalStatus> {
  const cfg = injections.config ?? getEvalConfig()
  const availability = getAvailability(cfg)
  const latest = await getLatest(cfg.storagePath)
  const current = await getCurrent(cfg.storagePath)
  return {
    availability,
    is_running: isRunning(),
    current_run_id: current?.run_id ?? null,
    latest: latest
      ? {
          run_id: latest.run_id,
          status: latest.status,
          finished_at: latest.finished_at,
          overall_score: latest.summary.overall_score,
          mode: latest.mode,
        }
      : null,
    progress: current ? current.progress : null,
    config_summary: {
      statewave_api_url_set: !!cfg.statewaveApiUrl,
      llm_provider: cfg.llm.provider,
      llm_model: cfg.llm.model,
      demo_agent_url_set: !!cfg.demoAgent.url,
      webhook_url_set: cfg.webhookConfigured,
      storage_path_set: !!cfg.storagePath,
    },
  }
}

export interface RunResponse {
  ok: boolean
  run_id: string | null
  status: RunStatus
  estimated_llm_calls: number | null
  error: string | null
}

/**
 * Kick off a run if one is not already in flight. Returns immediately —
 * the actual execution continues in the background. Poll status via
 * `getEvalStatus()` and read the finished report via `getLatest()`.
 */
export async function startEvalRun(
  options: EvalRunOptions = {},
  injections: RunnerInjections = {},
): Promise<RunResponse> {
  const cfg = injections.config ?? getEvalConfig()
  const availability = getAvailability(cfg)
  if (!availability.available) {
    return {
      ok: false,
      run_id: null,
      status: 'error',
      estimated_llm_calls: null,
      error: availability.reasons.join(' '),
    }
  }
  if (state.inFlight) {
    const current = await getCurrent(cfg.storagePath)
    return {
      ok: false,
      run_id: current?.run_id ?? null,
      status: 'running',
      estimated_llm_calls: null,
      error: 'a run is already in progress',
    }
  }
  const mode: EvalMode = options.mode ?? 'smoke'
  const maxLevel: EvalLevel = options.max_level ?? getMaxLevelForMode(mode)
  // Override bank path: when the operator pre-generated a bank via the
  // /questions/generate endpoint we use it as-is, but we still apply
  // the same safety net (level ceiling, code / topic-drift opt-outs,
  // orphan follow-up pruning) the static bank gets — so a generated
  // bank can't smuggle L9 questions into a smoke run.
  let questions: ReturnType<typeof selectQuestions>
  if (options.override_questions && options.override_questions.length > 0) {
    const { questions: filtered } = applyOverrideSafetyFilter(
      options.override_questions,
      mode,
      options.max_level,
      options.include_code !== false,
      options.include_topic_drift !== false,
    )
    const cap =
      options.max_questions !== undefined && options.max_questions > 0
        ? options.max_questions
        : getDefaultQuestionCount(mode)
    questions = filtered.slice(0, cap)
  } else {
    questions = selectQuestions({
      mode,
      max_level: maxLevel,
      max_questions: options.max_questions ?? getDefaultQuestionCount(mode),
      include_code: options.include_code,
      include_topic_drift: options.include_topic_drift,
    })
  }
  const runId = injections.runId ?? generateRunId()
  const startedAt = new Date().toISOString()
  // Sanitise + meta the eval-only agent prompt override before any
  // network call. The redacted+capped text is what travels to the
  // demo agent; only the metadata (length / hash / preview) goes
  // into the stored report.
  const prepared = preparePromptOverride(options.system_prompt_override)
  const seedReport = makeInitialReport(
    runId,
    startedAt,
    mode,
    maxLevel,
    cfg,
    questions.length,
    prepared.metadata,
  )
  await setCurrentRunningReport(cfg.storagePath, seedReport)

  // Each question costs one demo-agent call + one judge call. Keeping
  // this on the response so the UI can show "this run will cost N LLM
  // calls" and the operator can decide.
  const estimated = questions.length * 2

  const promise = (async () => {
    try {
      return await executeRun(seedReport, questions, cfg, injections, {
        subject_id: options.subject_id,
        system_prompt_override_text: prepared.text,
        baseline_run_id: options.baseline_run_id,
      })
    } finally {
      state.inFlight = null
    }
  })()
  state.inFlight = promise

  return {
    ok: true,
    run_id: runId,
    status: 'running',
    estimated_llm_calls: estimated,
    error: null,
  }
}

// ─── Implementation ──────────────────────────────────────────────────────

function generateRunId(): string {
  // 12 hex chars — small but collision-resistant for an admin tool.
  const rand = Math.random().toString(16).slice(2, 14).padStart(12, '0')
  return `eval-${rand}`
}

function makeInitialReport(
  runId: string,
  startedAt: string,
  mode: EvalMode,
  maxLevel: EvalLevel,
  cfg: EvalConfig,
  totalQuestions: number,
  overrideMetadata: AgentPromptOverrideMetadata,
): EvalReport {
  return {
    run_id: runId,
    started_at: startedAt,
    finished_at: null,
    status: 'running',
    mode,
    max_level: maxLevel,
    config: {
      statewave_api_url: cfg.statewaveApiUrl ?? '',
      llm_provider: cfg.llm.provider ?? '',
      llm_model: cfg.llm.model ?? '',
      demo_agent_configured: !!cfg.demoAgent.url,
      webhook_configured: cfg.webhookConfigured,
      agent_prompt_override: overrideMetadata,
    },
    health: { status: 'fail', details: { state: 'pending' } },
    webhook: {
      status: cfg.webhookConfigured ? 'fail' : 'not_configured',
      trigger_attempted: false,
      delivery_observed: false,
      details: { state: 'pending' },
      recommended_fix: cfg.webhookConfigured
        ? ''
        : 'Set ADMIN_DEMO_WEBHOOK_URL or STATEWAVE_WEBHOOK_URL to validate webhook delivery end-to-end.',
    },
    demo_job: { status: 'fail', details: { state: 'pending' } },
    conversation: [],
    summary: {
      turns_total: 0,
      passes: 0,
      partials: 0,
      fails: 0,
      overall_score: 0,
    },
    summary_by_level: {},
    summary_by_category: {},
    summary_by_root_cause: {},
    recommendations: [],
    copilot_prompt: '',
    progress: { completed: 0, total: totalQuestions, current_question_id: null },
    error: null,
  }
}

async function executeRun(
  report: EvalReport,
  questions: ReturnType<typeof selectQuestions>,
  cfg: EvalConfig,
  injections: RunnerInjections,
  conversationOptions: {
    subject_id?: string
    /** Already redacted + capped by preparePromptOverride. */
    system_prompt_override_text?: string
    baseline_run_id?: string
  },
): Promise<EvalReport> {
  // ── 1. System probes via the existing smoke check ──
  const smokeFetch =
    injections.smokeFetch ?? ((url, init) => fetch(url, init))
  const proxyCfg = getProxyConfig()
  const smokeCfg = {
    apiUrl: proxyCfg.apiUrl,
    apiKey: proxyCfg.apiKey,
    disabled: false,
    stateDir: null,
  }
  const smokeResult = await runSmoke(smokeCfg, {
    fetchImpl: smokeFetch,
    sleep: injections.smokeSleep,
  })
  report.health = mapHealth(smokeResult)
  report.demo_job = mapDemoJob(smokeResult)
  report.webhook = mapWebhook(smokeResult, cfg)
  await updateCurrentRunningReport({ ...report })

  // ── 2. Conversation phase ──
  const conversationContexts = new Map<string, AgentMessage[]>()
  const completed: ConversationTurn[] = []

  for (let i = 0; i < questions.length; i += 1) {
    const q = questions[i]
    report.progress = {
      completed: i,
      total: questions.length,
      current_question_id: q.id,
    }
    await updateCurrentRunningReport({ ...report })

    const parentMessages = q.follow_up_of
      ? conversationContexts.get(q.follow_up_of) ?? []
      : []
    const messagesForCall: AgentMessage[] = [
      ...parentMessages,
      { role: 'user', content: q.question },
    ]

    // Probe Statewave's /v1/context for what the agent COULD have
    // retrieved against the docs subject. Only docs-grounded turns —
    // L9 topic-drift, L8 false-premise that don't require docs, and
    // any code-only L5 turn that doesn't expect docs grounding skip
    // the probe (status='skipped' instead of pass/fail) so the judge
    // doesn't get noisy retrieval data for questions that aren't
    // about docs in the first place. Probe failures NEVER fail the
    // run — they downgrade to 'fail' on the turn so the operator
    // can see eval-judge-context-blindness in the report.
    const retrievedContext = q.requires_docs_grounding
      ? await probeContextForQuestion(
          cfg,
          {
            subject_id: cfg.docsSubjectId,
            query: q.question,
          },
          { fetchImpl: injections.probeFetch },
        )
      : ({
          status: 'skipped' as const,
          subject_id: cfg.docsSubjectId,
          query: q.question,
          results: [],
        })
    // The conversation phase can run against an operator-selected
    // subject (set via the diagnostics subject picker) so the demo
    // agent answers FROM that subject's compiled memory. When no
    // override is given we fall back to a dedicated demo subject so
    // we never accidentally hammer questions at a real customer
    // subject. Smoke probes upstream are independent — they always
    // use their own `statewave-demo:first-admin-run` subject.
    const subjectId = (
      conversationOptions.subject_id?.trim() || 'admin-self-healing-eval-demo'
    )
    const sessionId = `admin-self-healing-eval-run-${report.run_id}`

    const agentResult = await callDemoAgent(
      cfg,
      {
        subject_id: subjectId,
        session_id: sessionId,
        agent_id: 'demo-support-agent',
        messages: messagesForCall,
      },
      {
        fetchImpl: injections.agentFetch,
        // For the statewave-web body format, the persona is the lever
        // that selects which subject the agent answers from. When the
        // operator has explicitly picked a subject via the runtime
        // override we pass it as the persona too — under the
        // convention that demo personas are 1:1 with their backing
        // subject ids. Falls back to the env-configured persona
        // (default `statewave-support`) when no override is given.
        personaOverride: conversationOptions.subject_id?.trim() || undefined,
        // Eval-only system prompt override. Already redacted + capped
        // by preparePromptOverride() — the agent gets the sanitised
        // version, not the operator's raw paste.
        systemPromptOverride: conversationOptions.system_prompt_override_text,
      },
    )
    // Promote override delivery status when the demo agent confirmed
    // it honored the override. We track this once (any confirming
    // turn flips the report's delivery to "confirmed"). Demo agents
    // that ignore the field stay at "sent_unconfirmed".
    if (
      report.config.agent_prompt_override.used &&
      agentResult.override_confirmed &&
      report.config.agent_prompt_override.delivery !== 'confirmed'
    ) {
      report.config.agent_prompt_override.delivery = 'confirmed'
    }

    const answer = agentResult.ok ? agentResult.answer : ''
    // Preserve the conversation context for any follow-ups of THIS turn.
    conversationContexts.set(q.id, [
      ...messagesForCall,
      { role: 'assistant', content: answer },
    ])

    let evaluation
    if (!agentResult.ok) {
      evaluation = {
        correctness_score: 0,
        grounding_score: 0,
        completeness_score: 0,
        clarity_score: 0,
        safety_score: 0,
        overall_score: 0,
        verdict: 'fail' as Verdict,
        reason: `Demo agent call failed: ${agentResult.error ?? 'unreachable'}.`,
        missing_points: [],
        hallucination_risks: [],
        recommended_fix:
          'Verify ADMIN_DEMO_AGENT_URL is reachable and the agent accepts the documented request shape.',
        likely_root_cause: ['admin-diagnostics' as const],
      }
    } else {
      // The judge sees the same retrieved context the agent would
      // have had. That's what lets it tell apart missing-docs
      // (probe found nothing) from retrieval-miss (probe found
      // items, none useful) from retrieved-context-ignored
      // (probe found the expected fact, agent didn't surface it).
      const judgeOutcome = await judge(cfg, q, answer, {
        fetchImpl: injections.judgeFetch,
        retrievedContext: retrievedContext,
      })
      // Deterministic post-correction: if the judge said
      // "retrieved-context-ignored" but none of the question's
      // must_include terms actually appear in the retrieved text,
      // flip to "retrieval-miss". Hard substring evidence beats the
      // judge's soft heuristic — see applyMustIncludeCorrection().
      evaluation = applyMustIncludeCorrection(
        judgeOutcome.evaluation,
        q,
        retrievedContext,
      )
    }

    const turn: ConversationTurn = {
      turn_id: `${report.run_id}:${q.id}`,
      question_id: q.id,
      level: q.level,
      category: q.category,
      retrieved_context: retrievedContext,
      question: q.question,
      answer,
      follow_up_of: q.follow_up_of,
      metadata: {
        requires_code: q.requires_code,
        requires_docs_grounding: q.requires_docs_grounding,
        topic_drift: q.topic_drift,
        false_premise: q.false_premise,
        // Carried so the markdown report can show the EXACT terms
        // the deterministic substring check looked for. Empty array
        // is preserved so "must_include checked: <none>" can render.
        must_include: q.must_include,
      },
      evaluation,
    }
    completed.push(turn)
    report.conversation = [...completed]
    await updateCurrentRunningReport({ ...report })
  }

  // ── 3. Summaries + recommendations + Copilot prompt ──
  const sums = summarize(completed)
  report.summary = sums.summary
  report.summary_by_level = sums.byLevel
  report.summary_by_category = sums.byCategory
  report.summary_by_root_cause = sums.byRootCause
  report.recommendations = buildRecommendations(sums.byRootCause, sums.byLevel)
  report.progress = {
    completed: questions.length,
    total: questions.length,
    current_question_id: null,
  }
  report.finished_at = new Date().toISOString()
  report.status = computeOverallStatus(report)

  // Promote override delivery: if the operator supplied an override but
  // no turn returned a confirmation marker, the report ends with
  // delivery="sent_unconfirmed" (the seed value). If at least one turn
  // confirmed, it was already promoted to "confirmed" in the loop.
  // Either way the report's override metadata is now stable.

  // Optional baseline comparison — pulled from storage by run id and
  // attached BEFORE the Copilot prompt is built so the prompt can
  // incorporate score-delta language.
  if (conversationOptions.baseline_run_id) {
    const baseline = await getById(
      cfg.storagePath,
      conversationOptions.baseline_run_id,
    )
    if (baseline && baseline.run_id !== report.run_id) {
      report.comparison = compareReports(baseline, report)
    }
  }

  report.copilot_prompt = buildCopilotPrompt(report)

  await finalizeReport(cfg.storagePath, report)
  return report
}

function mapHealth(smoke: Awaited<ReturnType<typeof runSmoke>>): HealthResult {
  return {
    status: smoke.backend.status === 'ok' ? 'pass' : 'fail',
    details: {
      detail: smoke.backend.detail,
      readiness: smoke.backend.readiness ?? null,
    },
  }
}

function mapDemoJob(smoke: Awaited<ReturnType<typeof runSmoke>>): DemoJobResult {
  if (smoke.demo_job.status === 'ok') {
    return {
      status: 'pass',
      details: {
        subject_id: smoke.demo_job.subject_id,
        episode_id: smoke.demo_job.episode_id,
        job_id: smoke.demo_job.job_id,
        memories_created: smoke.demo_job.memories_created,
      },
    }
  }
  return {
    status: smoke.demo_job.status === 'skipped' ? 'partial' : 'fail',
    details: {
      detail: smoke.demo_job.detail,
      subject_id: smoke.demo_job.subject_id,
      job_id: smoke.demo_job.job_id,
    },
  }
}

function mapWebhook(
  smoke: Awaited<ReturnType<typeof runSmoke>>,
  cfg: EvalConfig,
): WebhookResult {
  const dw = smoke.demo_webhook
  if (dw.state === 'not_configured') {
    return {
      status: 'not_configured',
      trigger_attempted: true,
      delivery_observed: false,
      details: {
        total_before: dw.total_before,
        total_after: dw.total_after,
      },
      recommended_fix: cfg.webhookConfigured
        ? 'ADMIN_DEMO_WEBHOOK_URL is set on the admin but the Statewave server is not configured with STATEWAVE_WEBHOOK_URL. Set both and restart the backend.'
        : 'Set STATEWAVE_WEBHOOK_URL on the Statewave server (e.g. https://webhook.site/<id>) and rerun.',
    }
  }
  if (dw.state === 'configured_delivered') {
    return {
      status: 'pass',
      trigger_attempted: true,
      delivery_observed: true,
      details: { sample: dw.sample },
      recommended_fix: '',
    }
  }
  if (dw.state === 'configured_pending') {
    return {
      status: 'partial',
      trigger_attempted: true,
      delivery_observed: false,
      details: { sample: dw.sample },
      recommended_fix:
        'Webhook event was queued but delivery was not observed within the smoke window. Check the worker logs.',
    }
  }
  if (dw.state === 'configured_failed') {
    return {
      status: 'fail',
      trigger_attempted: true,
      delivery_observed: false,
      details: { sample: dw.sample },
      recommended_fix:
        'Webhook delivery is failing — inspect /webhooks for the dead_letter row and the destination endpoint.',
    }
  }
  return {
    status: 'fail',
    trigger_attempted: false,
    delivery_observed: false,
    details: { detail: dw.detail },
    recommended_fix:
      'Could not determine webhook state. Check ADMIN_DEMO_WEBHOOK_URL and the Statewave webhook worker.',
  }
}

function computeOverallStatus(report: EvalReport): RunStatus {
  if (report.health.status !== 'pass') return 'fail'
  if (report.summary.fails > 0) {
    return report.summary.passes >= report.summary.fails ? 'partial' : 'fail'
  }
  if (report.summary.partials > 0) return 'partial'
  return 'pass'
}
