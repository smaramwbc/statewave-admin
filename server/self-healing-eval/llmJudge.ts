/**
 * LLM judge — scores a (question, answer) pair and returns strict JSON.
 *
 * Provider-agnostic: speaks OpenAI's `chat/completions` shape and
 * Anthropic's `/v1/messages` shape directly via fetch. No SDK dep.
 *
 * The judge prompt is deliberately strict:
 *   - higher levels are graded harder
 *   - L5 npm/code questions REWARD honest "I don't see this in docs"
 *     over an invented package name
 *   - L8 false-premise questions FAIL silently going along with the
 *     premise even if the surrounding answer sounds plausible
 *
 * The judge response is JSON only. We try to parse the model's reply
 * as JSON; if the model wraps it in ```json fences we strip those.
 * If parsing still fails, the call surfaces a structured error so the
 * runner can fall back to a `fail` verdict with a useful reason — never
 * a heuristic-only score, which the spec explicitly forbids.
 */
import type { EvalConfig } from './config.js'
import { anyMustIncludeFound } from './mustIncludeMatcher.js'
import type {
  EvalQuestion,
  JudgeEvaluation,
  RetrievedContextResult,
  RootCause,
  Verdict,
} from './types.js'

export type JudgeFetch = (url: string, init: RequestInit) => Promise<Response>

export interface JudgeOptions {
  fetchImpl?: JudgeFetch
  timeoutMs?: number
  /**
   * Result of /v1/context probe for the same question, run by the
   * runner. The judge prompt embeds this so classification can
   * distinguish missing-docs from retrieval-miss from
   * retrieved-context-ignored. Optional — without it the judge
   * still works but can't disambiguate.
   */
  retrievedContext?: RetrievedContextResult
}

export interface JudgeOutcome {
  ok: boolean
  evaluation: JudgeEvaluation
  raw: string
  error: string | null
}

const SYSTEM_PROMPT = `You are an evaluator for an LLM-graded eval framework.

You score a single (question, answer) turn from a multi-turn diagnostic
conversation. You do NOT generate the answer; you only judge it.

Output rules:
- Reply with a single JSON object. No prose, no markdown fences.
- All five sub-scores and overall_score are numbers in [0, 1].
- verdict ∈ {"pass", "partial", "fail"}.
- likely_root_cause is an array drawn from this exact set: missing-docs,
  weak-docs-memory-pack, retrieval-miss, retrieved-context-ignored,
  eval-judge-context-blindness, demo-agent-prompt,
  hallucinated-code-or-api, unsupported-npm-sdk-claim,
  weak-topic-drift-handling, false-premise-not-corrected, webhook-config,
  statewave-api-health, admin-diagnostics, unclear-user-question, unknown.
- missing_points and hallucination_risks are arrays of short strings.
- recommended_fix is one short paragraph.

Grading guidelines:
- Levels 0–2: be moderately strict on factual basics.
- Levels 3–4: penalise invented endpoints, env var names, and config.
- Level 5 (developer/npm/code): REWARD honest uncertainty when the docs
  don't confirm a package name. Penalise inventing 'npm install statewave',
  'StatewaveClient' classes, or fake SDK imports.
- Level 6: reward structured diagnostic checklists; penalise vague advice.
- Level 7: reward separation of concerns (core API vs admin console).
- Level 8 (false premise): FAIL answers that go along with an incorrect
  assumption. Reward polite, accurate corrections.
- Level 9 (topic drift): reward staying scoped on the relevant part and
  explicitly naming out-of-scope parts.

Root-cause classification — IMPORTANT, READ CAREFULLY:

The runner attaches a "retrieved_context" block to docs-grounded turns.
This is what the agent COULD have seen by querying the docs subject for
this question. Use it to disambiguate root cause:

- If retrieved_context.status is "pass" AND its results contain the
  expected_behavior facts (or the must_include terms) — but the answer
  did NOT use them — root cause is "retrieved-context-ignored".
  Often co-occurs with "demo-agent-prompt".
  DO NOT classify this as "missing-docs". The docs are present; the
  agent failed to surface them.

- If retrieved_context.status is "pass" but its results do NOT contain
  the expected facts — root cause is "retrieval-miss" (and possibly
  "weak-docs-memory-pack" if the relevant doc seems to exist but the
  retrieval query missed it). DO NOT classify as "missing-docs" unless
  you have positive evidence the docs corpus genuinely lacks the topic.

- If retrieved_context.status is "fail" or "not_configured" — record
  "eval-judge-context-blindness" alongside whichever other root cause
  best fits the answer's quality. Your classification this turn is less
  trustworthy because you couldn't see what the docs would have
  returned.

- Only use "missing-docs" when retrieved_context shows a relevant doc
  was searched and the doc itself clearly lacks the expected fact, OR
  when no retrieval is plausible (no docs subject, no grounding).

Never invent grounding the agent didn't cite. If the answer made up an
npm package, list it under hallucination_risks and set
unsupported-npm-sdk-claim or hallucinated-code-or-api in
likely_root_cause.`

const RESPONSE_TEMPLATE = `{
  "correctness_score": <0..1>,
  "grounding_score": <0..1>,
  "completeness_score": <0..1>,
  "clarity_score": <0..1>,
  "safety_score": <0..1>,
  "overall_score": <0..1>,
  "verdict": "pass|partial|fail",
  "reason": "<one short paragraph>",
  "missing_points": ["..."],
  "hallucination_risks": ["..."],
  "recommended_fix": "<one short paragraph>",
  "likely_root_cause": ["<root-cause>"]
}`

function buildUserPrompt(
  q: EvalQuestion,
  answer: string,
  retrievedContext: RetrievedContextResult | undefined,
): string {
  const lines: string[] = [
    `Question metadata:`,
    JSON.stringify(
      {
        id: q.id,
        level: q.level,
        category: q.category,
        requires_code: q.requires_code,
        requires_docs_grounding: q.requires_docs_grounding,
        topic_drift: q.topic_drift,
        false_premise: q.false_premise,
        weight: q.weight,
        must_include: q.must_include,
        must_not_claim: q.must_not_claim,
      },
      null,
      2,
    ),
    ``,
    `Expected behavior:`,
    q.expected_behavior,
    ``,
    `User question:`,
    q.question,
    ``,
    `Agent answer:`,
    answer || '<empty>',
    ``,
  ]
  // Embed the retrieved-context probe so the judge can disambiguate
  // missing-docs vs retrieval-miss vs retrieved-context-ignored. The
  // probe items have already been redacted + capped by contextProbe.ts.
  if (retrievedContext) {
    lines.push(`retrieved_context (what the agent could have seen):`)
    lines.push(
      JSON.stringify(
        {
          status: retrievedContext.status,
          subject_id: retrievedContext.subject_id,
          query: retrievedContext.query,
          no_relevant_results: retrievedContext.no_relevant_results,
          error: retrievedContext.error,
          results: retrievedContext.results.map((r) => ({
            kind: r.kind,
            source_path: r.source_path,
            score: r.score,
            text: r.text,
          })),
        },
        null,
        2,
      ),
    )
    lines.push(``)
  }
  lines.push(`Respond with JSON in this exact shape:`)
  lines.push(RESPONSE_TEMPLATE)
  return lines.join('\n')
}

const VERDICTS = new Set<Verdict>(['pass', 'partial', 'fail'])
const ROOT_CAUSES = new Set<RootCause>([
  'missing-docs',
  'weak-docs-memory-pack',
  'retrieval-miss',
  'retrieved-context-ignored',
  'eval-judge-context-blindness',
  'demo-agent-prompt',
  'hallucinated-code-or-api',
  'unsupported-npm-sdk-claim',
  'weak-topic-drift-handling',
  'false-premise-not-corrected',
  'webhook-config',
  'statewave-api-health',
  'admin-diagnostics',
  'unclear-user-question',
  'unknown',
])

function clamp01(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return 0
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.map((x) => String(x)).filter((s) => s.length > 0)
}

function failedEvaluation(reason: string): JudgeEvaluation {
  return {
    correctness_score: 0,
    grounding_score: 0,
    completeness_score: 0,
    clarity_score: 0,
    safety_score: 0,
    overall_score: 0,
    verdict: 'fail',
    reason,
    missing_points: [],
    hallucination_risks: [],
    recommended_fix: 'Re-run the eval after addressing the LLM judge configuration or upstream issue.',
    likely_root_cause: ['admin-diagnostics'],
  }
}

/**
 * Parse the judge's text response. Tolerates markdown ```json``` fences
 * and a single trailing/leading newline. Anything else returns a fail
 * evaluation rather than throwing — the runner needs a deterministic
 * shape to assemble the report.
 */
export function parseJudgeResponse(text: string): JudgeOutcome {
  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/i, '')
    .trim()
  let raw: unknown
  try {
    raw = JSON.parse(stripped)
  } catch {
    return {
      ok: false,
      evaluation: failedEvaluation(
        `LLM judge returned non-JSON: ${stripped.slice(0, 120)}`,
      ),
      raw: text,
      error: 'invalid_json',
    }
  }
  if (!raw || typeof raw !== 'object') {
    return {
      ok: false,
      evaluation: failedEvaluation('LLM judge returned a non-object response.'),
      raw: text,
      error: 'invalid_shape',
    }
  }
  const obj = raw as Record<string, unknown>
  const verdictRaw = String(obj.verdict ?? '').toLowerCase() as Verdict
  const verdict: Verdict = VERDICTS.has(verdictRaw) ? verdictRaw : 'fail'
  const causes = asStringArray(obj.likely_root_cause).filter((c): c is RootCause =>
    ROOT_CAUSES.has(c as RootCause),
  ) as RootCause[]
  const evaluation: JudgeEvaluation = {
    correctness_score: clamp01(obj.correctness_score),
    grounding_score: clamp01(obj.grounding_score),
    completeness_score: clamp01(obj.completeness_score),
    clarity_score: clamp01(obj.clarity_score),
    safety_score: clamp01(obj.safety_score),
    overall_score: clamp01(obj.overall_score),
    verdict,
    reason: String(obj.reason ?? '').slice(0, 4000),
    missing_points: asStringArray(obj.missing_points),
    hallucination_risks: asStringArray(obj.hallucination_risks),
    recommended_fix: String(obj.recommended_fix ?? '').slice(0, 2000),
    likely_root_cause: causes.length > 0 ? causes : (verdict === 'pass' ? [] : ['unknown']),
  }
  return { ok: true, evaluation, raw: text, error: null }
}

interface OpenAIChatChoice {
  message?: { content?: string }
}
interface OpenAIChatResponse {
  choices?: OpenAIChatChoice[]
}

interface AnthropicResponse {
  content?: Array<{ type?: string; text?: string }>
}

async function callOpenAI(
  cfg: EvalConfig,
  systemPrompt: string,
  userPrompt: string,
  opts: { fetchImpl: JudgeFetch; timeoutMs: number },
): Promise<{ text: string; error: string | null }> {
  const baseUrl = cfg.llm.baseUrl ?? 'https://api.openai.com'
  const url = `${baseUrl.replace(/\/+$/, '')}/v1/chat/completions`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs)
  try {
    const res = await opts.fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.llm.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.llm.model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
      signal: controller.signal,
    })
    if (!res.ok) {
      return { text: '', error: `HTTP ${res.status}` }
    }
    const data = (await res.json()) as OpenAIChatResponse
    const text = data.choices?.[0]?.message?.content ?? ''
    return { text, error: null }
  } catch (e) {
    return { text: '', error: e instanceof Error ? e.message : 'unreachable' }
  } finally {
    clearTimeout(timer)
  }
}

async function callAnthropic(
  cfg: EvalConfig,
  systemPrompt: string,
  userPrompt: string,
  opts: { fetchImpl: JudgeFetch; timeoutMs: number },
): Promise<{ text: string; error: string | null }> {
  const baseUrl = cfg.llm.baseUrl ?? 'https://api.anthropic.com'
  const url = `${baseUrl.replace(/\/+$/, '')}/v1/messages`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs)
  try {
    const res = await opts.fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': cfg.llm.apiKey ?? '',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: cfg.llm.model,
        max_tokens: 2048,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
      signal: controller.signal,
    })
    if (!res.ok) {
      return { text: '', error: `HTTP ${res.status}` }
    }
    const data = (await res.json()) as AnthropicResponse
    const text = (data.content ?? [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('\n')
    return { text, error: null }
  } catch (e) {
    return { text: '', error: e instanceof Error ? e.message : 'unreachable' }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Deterministic post-judge correction.
 *
 * The LLM judge sometimes defaults to `retrieved-context-ignored` when
 * it sees "probe returned items + answer is bad", even if those items
 * obviously don't contain the question's must_include terms. This is
 * the failure mode that misled the Copilot prompt in run
 * eval-4a151c0f9cb1 — the probe surfaced infrastructure facts (Alembic,
 * tenant isolation, GPU/CPU) for "What is Statewave?" but none of the
 * must_include terms ("memory", "agent") were in any retrieved text.
 *
 * This corrector trusts hard substring evidence over the judge's soft
 * conclusion. If:
 *   - the question has must_include terms
 *   - the probe ran successfully and returned items
 *   - the judge said `retrieved-context-ignored`
 *   - none of the must_include terms appear in any retrieved text
 *
 * we flip the root cause to `retrieval-miss` and replace the
 * recommended_fix with retrieval-tuning guidance instead of
 * agent-prompt guidance. The judge's reason is annotated so the
 * report can show that a correction was applied.
 *
 * Conservative on purpose: only fires when there's positive evidence
 * the judge was wrong. Never overrides a judge that already said
 * `retrieval-miss` or `missing-docs`.
 */
export function applyMustIncludeCorrection(
  evaluation: JudgeEvaluation,
  question: EvalQuestion,
  retrievedContext: RetrievedContextResult | undefined,
): JudgeEvaluation {
  if (!question.must_include || question.must_include.length === 0) return evaluation
  if (!retrievedContext || retrievedContext.status !== 'pass') return evaluation
  if (retrievedContext.results.length === 0) return evaluation
  if (!evaluation.likely_root_cause.includes('retrieved-context-ignored')) {
    return evaluation
  }
  const haystack = retrievedContext.results
    .map((r) => r.text ?? '')
    .join(' ')
  // Paraphrase-tolerant: exact substring first, token match (with
  // light plural normalization + stopword filtering) as fallback.
  // See mustIncludeMatcher.ts for the rules.
  if (anyMustIncludeFound(question.must_include, haystack)) {
    return evaluation // judge was right — at least one term is there
  }

  // Hard evidence the judge was wrong: probe returned items but ZERO
  // must_include terms appear in their text. Flip to retrieval-miss.
  const otherCauses = evaluation.likely_root_cause.filter(
    (c) => c !== 'retrieved-context-ignored',
  )
  return {
    ...evaluation,
    likely_root_cause: ['retrieval-miss', ...otherCauses],
    reason: `[deterministic correction: must_include terms (${question.must_include.join(', ')}) not found in retrieved text — judge said retrieved-context-ignored, evidence says retrieval-miss] ${evaluation.reason}`,
    recommended_fix: `The retrieval probe surfaced ${retrievedContext.results.length} memories but none contain any of the question's must_include terms (${question.must_include.join(', ')}). Tune retrieval — query expansion, alias memories for this concept, or better chunk titles in the docs memory pack. Agent-prompt changes will not help here.`,
  }
}

export async function judge(
  cfg: EvalConfig,
  question: EvalQuestion,
  answer: string,
  opts: JudgeOptions = {},
): Promise<JudgeOutcome> {
  if (!cfg.llm.provider || !cfg.llm.model || !cfg.llm.apiKey) {
    return {
      ok: false,
      evaluation: failedEvaluation('LLM judge is not configured.'),
      raw: '',
      error: 'llm_not_configured',
    }
  }
  const fetchImpl: JudgeFetch =
    opts.fetchImpl ?? ((url, init) => fetch(url, init))
  const timeoutMs = opts.timeoutMs ?? 60_000
  const userPrompt = buildUserPrompt(question, answer, opts.retrievedContext)
  const callOpts = { fetchImpl, timeoutMs }
  const result =
    cfg.llm.provider === 'anthropic'
      ? await callAnthropic(cfg, SYSTEM_PROMPT, userPrompt, callOpts)
      : await callOpenAI(cfg, SYSTEM_PROMPT, userPrompt, callOpts)
  if (result.error) {
    return {
      ok: false,
      evaluation: failedEvaluation(`LLM judge call failed: ${result.error}.`),
      raw: '',
      error: result.error,
    }
  }
  if (!result.text) {
    return {
      ok: false,
      evaluation: failedEvaluation('LLM judge returned an empty response.'),
      raw: '',
      error: 'empty_response',
    }
  }
  return parseJudgeResponse(result.text)
}
