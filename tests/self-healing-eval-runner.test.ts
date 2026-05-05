/**
 * End-to-end runner test with all upstream calls mocked.
 *
 * Verifies a complete in-process run of the full pipeline:
 *   - smoke probes resolve health/job/webhook
 *   - demo agent is called for every selected question
 *   - LLM judge is called for every successful agent reply
 *   - report is finalized with summaries, recommendations, and a
 *     Copilot prompt
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  _resetEvalRunnerForTests,
  startEvalRun,
} from '../server/self-healing-eval/runner'
import {
  _resetEvalStorageForTests,
  getLatest,
} from '../server/self-healing-eval/storage'
import { _resetSmokeStateForTests } from '../server/smoke'
import type { EvalConfig } from '../server/self-healing-eval/config'

const noopSleep = async () => {}

function fullCfg(): EvalConfig {
  return {
    enabled: true,
    llm: {
      provider: 'openai',
      model: 'gpt-4o-mini',
      apiKey: 'sk-test',
      baseUrl: null,
    },
    demoAgent: {
      url: 'https://demo.example/agent',
      apiKey: 'agent-secret',
      bodyFormat: 'default',
      persona: 'statewave-support',
    },
    webhookConfigured: false,
    storagePath: null,
    statewaveApiUrl: 'https://upstream.example',
    statewaveApiKey: 'k',
    docsSubjectId: 'statewave-support-docs',
  }
}

function smokeFetch() {
  return async (url: string, init: RequestInit) => {
    const method = (init.method ?? 'GET').toUpperCase()
    if (url.endsWith('/readyz')) {
      return new Response(JSON.stringify({ status: 'ready' }), { status: 200 })
    }
    if (url.endsWith('/admin/dashboard')) {
      return new Response(JSON.stringify({ readiness: { status: 'ok' } }), { status: 200 })
    }
    if (url.endsWith('/admin/webhooks/stats')) {
      return new Response(JSON.stringify({ total: 0 }), { status: 200 })
    }
    if (url.endsWith('/v1/episodes') && method === 'POST') {
      return new Response(JSON.stringify({ id: 'ep-1' }), { status: 201 })
    }
    if (url.endsWith('/v1/memories/compile') && method === 'POST') {
      return new Response(
        JSON.stringify({ job_id: 'j', status: 'pending', subject_id: 'statewave-demo:first-admin-run' }),
        { status: 202 },
      )
    }
    if (url.endsWith('/v1/memories/compile/j') && method === 'GET') {
      return new Response(
        JSON.stringify({ job_id: 'j', status: 'completed', subject_id: 's', memories_created: 1 }),
        { status: 200 },
      )
    }
    if (url.includes('/admin/subjects/')) {
      return new Response(
        JSON.stringify({ subject_id: 's', summary: { episode_count: 1 } }),
        { status: 200 },
      )
    }
    return new Response(JSON.stringify({}), { status: 404 })
  }
}

function agentFetch() {
  return async () =>
    new Response(JSON.stringify({ message: 'Statewave is a memory runtime for AI agents.' }), {
      status: 200,
    })
}

function judgeFetch() {
  return async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                correctness_score: 0.9,
                grounding_score: 0.9,
                completeness_score: 0.9,
                clarity_score: 1,
                safety_score: 1,
                overall_score: 0.9,
                verdict: 'pass',
                reason: 'good',
                missing_points: [],
                hallucination_risks: [],
                recommended_fix: 'none',
                likely_root_cause: [],
              }),
            },
          },
        ],
      }),
      { status: 200 },
    )
}

let savedEnv: NodeJS.ProcessEnv

beforeEach(() => {
  savedEnv = { ...process.env }
  process.env = {
    NODE_ENV: 'test',
    STATEWAVE_API_URL: 'https://upstream.example',
    STATEWAVE_API_KEY: 'k',
  } as NodeJS.ProcessEnv
  _resetEvalRunnerForTests()
  _resetEvalStorageForTests()
  _resetSmokeStateForTests()
  vi.restoreAllMocks()
})
afterEach(() => {
  process.env = savedEnv
})

describe('runner — full pipeline', () => {
  it('runs smoke mode end-to-end and persists a report', async () => {
    const start = await startEvalRun(
      { mode: 'smoke', max_questions: 3 },
      {
        config: fullCfg(),
        smokeFetch: smokeFetch(),
        smokeSleep: noopSleep,
        agentFetch: agentFetch(),
        judgeFetch: judgeFetch(),
      },
    )
    expect(start.ok).toBe(true)
    expect(start.run_id).toBeTruthy()
    expect(start.estimated_llm_calls).toBeGreaterThan(0)
    // The runner runs in the background. Wait up to a couple of seconds
    // for it to finish — it's all synchronous mocks underneath, so this
    // resolves on the next macrotask in practice.
    for (let i = 0; i < 50; i += 1) {
      const r = await getLatest(null)
      if (r && r.finished_at) break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    const report = await getLatest(null)
    expect(report).toBeTruthy()
    expect(report!.finished_at).toBeTruthy()
    expect(['pass', 'partial']).toContain(report!.status)
    expect(report!.health.status).toBe('pass')
    expect(report!.demo_job.status).toBe('pass')
    expect(report!.conversation.length).toBeGreaterThan(0)
    expect(report!.copilot_prompt.length).toBeGreaterThan(0)
    // Stored report has redacted secrets — agent_id metadata should not
    // contain the API key from the config.
    expect(JSON.stringify(report)).not.toContain('agent-secret')
  })

  it('marks turns failed with admin-diagnostics root cause when the demo agent fails', async () => {
    const start = await startEvalRun(
      { mode: 'smoke', max_questions: 2 },
      {
        config: fullCfg(),
        smokeFetch: smokeFetch(),
        smokeSleep: noopSleep,
        agentFetch: async () => new Response('boom', { status: 500 }),
        judgeFetch: judgeFetch(),
      },
    )
    expect(start.ok).toBe(true)
    for (let i = 0; i < 50; i += 1) {
      const r = await getLatest(null)
      if (r && r.finished_at) break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    const report = await getLatest(null)
    expect(report).toBeTruthy()
    for (const t of report!.conversation) {
      expect(t.evaluation.verdict).toBe('fail')
      expect(t.evaluation.likely_root_cause).toContain('admin-diagnostics')
    }
  })

  it('uses override_questions verbatim and falls back to the static bank when none are given', async () => {
    const overrideBank = [
      {
        id: 'override-l0-id',
        level: 0 as const,
        category: 'identity',
        question: 'Override question — what is X?',
        expected_behavior: 'should describe X.',
        must_include: ['X'],
        must_not_claim: [],
        requires_code: false,
        requires_docs_grounding: true,
        topic_drift: false,
        false_premise: false,
        weight: 1,
      },
    ]
    const askedQuestions: string[] = []
    const start = await startEvalRun(
      { mode: 'smoke', max_questions: 1, override_questions: overrideBank },
      {
        config: fullCfg(),
        smokeFetch: smokeFetch(),
        smokeSleep: noopSleep,
        agentFetch: async (_url, init) => {
          const body = JSON.parse(init.body as string)
          const last = body.messages[body.messages.length - 1].content
          askedQuestions.push(last)
          return new Response(JSON.stringify({ message: 'ok' }), { status: 200 })
        },
        judgeFetch: judgeFetch(),
      },
    )
    expect(start.ok).toBe(true)
    for (let i = 0; i < 50; i += 1) {
      const r = await getLatest(null)
      if (r && r.finished_at) break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    const r = await getLatest(null)
    expect(r).toBeTruthy()
    // The runner asked the override question, not any built-in L0 one.
    expect(askedQuestions[0]).toMatch(/Override question/)
    expect(r!.conversation[0].question_id).toBe('override-l0-id')
  })

  it('passes subject_id through to the demo agent body for default format', async () => {
    let capturedBody: unknown = null
    const start = await startEvalRun(
      { mode: 'smoke', max_questions: 1, subject_id: 'customer-imported-x' },
      {
        config: fullCfg(),
        smokeFetch: smokeFetch(),
        smokeSleep: noopSleep,
        agentFetch: async (_url, init) => {
          capturedBody = JSON.parse(init.body as string)
          return new Response(JSON.stringify({ message: 'ok' }), { status: 200 })
        },
        judgeFetch: judgeFetch(),
      },
    )
    expect(start.ok).toBe(true)
    for (let i = 0; i < 50; i += 1) {
      const r = await getLatest(null)
      if (r && r.finished_at) break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(capturedBody).toMatchObject({ subject_id: 'customer-imported-x' })
  })

  it('passes subject_id as the persona for the statewave-web body format', async () => {
    let capturedBody: unknown = null
    const webCfg = fullCfg()
    webCfg.demoAgent.bodyFormat = 'statewave-web'
    webCfg.demoAgent.persona = 'fallback-persona'
    const start = await startEvalRun(
      { mode: 'smoke', max_questions: 1, subject_id: 'demo-coding-assistant' },
      {
        config: webCfg,
        smokeFetch: smokeFetch(),
        smokeSleep: noopSleep,
        agentFetch: async (_url, init) => {
          capturedBody = JSON.parse(init.body as string)
          return new Response(JSON.stringify({ message: 'ok' }), { status: 200 })
        },
        judgeFetch: judgeFetch(),
      },
    )
    expect(start.ok).toBe(true)
    for (let i = 0; i < 50; i += 1) {
      const r = await getLatest(null)
      if (r && r.finished_at) break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    // statewave-web shape uses persona, NOT subject_id; the subject_id
    // override is mapped onto persona under the demo-personas-equal-
    // subject-ids convention. Default persona is overridden.
    expect(capturedBody).toMatchObject({
      mode: 'statewave',
      persona: 'demo-coding-assistant',
    })
    expect((capturedBody as Record<string, unknown>).subject_id).toBeUndefined()
  })

  it('falls back to a built-in demo subject when no subject_id is given', async () => {
    let capturedBody: unknown = null
    const start = await startEvalRun(
      { mode: 'smoke', max_questions: 1 },
      {
        config: fullCfg(),
        smokeFetch: smokeFetch(),
        smokeSleep: noopSleep,
        agentFetch: async (_url, init) => {
          capturedBody = JSON.parse(init.body as string)
          return new Response(JSON.stringify({ message: 'ok' }), { status: 200 })
        },
        judgeFetch: judgeFetch(),
      },
    )
    expect(start.ok).toBe(true)
    for (let i = 0; i < 50; i += 1) {
      const r = await getLatest(null)
      if (r && r.finished_at) break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect((capturedBody as { subject_id: string }).subject_id).toBe(
      'admin-self-healing-eval-demo',
    )
  })

  it('attaches retrieved_context to docs-grounded turns and feeds it to the judge', async () => {
    const probeCalls: string[] = []
    const judgeCalls: Array<{ retrievedContextEmbedded: boolean }> = []
    const probeFetch = async (url: string, init: RequestInit) => {
      probeCalls.push(url)
      const body = JSON.parse(init.body as string)
      return new Response(
        JSON.stringify({
          subject_id: body.subject_id,
          task: body.task,
          facts: [
            {
              id: 'f1',
              summary: 'Episodes in Statewave are immutable.',
              metadata: { source_path: 'concepts/episodes.md' },
            },
          ],
          procedures: [],
          episodes: [],
        }),
        { status: 200 },
      )
    }
    const probingJudge = async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string)
      const userMsg = body.messages[1].content
      judgeCalls.push({
        retrievedContextEmbedded: /retrieved_context/.test(userMsg),
      })
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  correctness_score: 0.9,
                  grounding_score: 0.9,
                  completeness_score: 0.9,
                  clarity_score: 0.9,
                  safety_score: 1,
                  overall_score: 0.9,
                  verdict: 'pass',
                  reason: 'ok',
                  missing_points: [],
                  hallucination_risks: [],
                  recommended_fix: 'none',
                  likely_root_cause: [],
                }),
              },
            },
          ],
        }),
        { status: 200 },
      )
    }

    const start = await startEvalRun(
      { mode: 'smoke', max_questions: 2 },
      {
        config: fullCfg(),
        smokeFetch: smokeFetch(),
        smokeSleep: noopSleep,
        agentFetch: agentFetch(),
        judgeFetch: probingJudge,
        probeFetch: probeFetch,
      },
    )
    expect(start.ok).toBe(true)
    for (let i = 0; i < 50; i += 1) {
      const r = await getLatest(null)
      if (r && r.finished_at) break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    const r = await getLatest(null)
    expect(r).toBeTruthy()
    // Probe ran for each docs-grounded turn.
    expect(probeCalls.length).toBeGreaterThan(0)
    for (const url of probeCalls) {
      expect(url).toContain('/v1/context')
    }
    // Each turn carries the probe result.
    for (const t of r!.conversation) {
      expect(t.retrieved_context).toBeTruthy()
      expect(t.retrieved_context!.status).toBe('pass')
    }
    // The judge prompt embedded the probe result on every call.
    for (const j of judgeCalls) {
      expect(j.retrievedContextEmbedded).toBe(true)
    }
  })

  it('does not fail the run when the context probe itself errors', async () => {
    // Probe always 5xxs — judge still runs, turns still complete.
    const flakyProbe = async () => new Response('boom', { status: 500 })
    const start = await startEvalRun(
      { mode: 'smoke', max_questions: 2 },
      {
        config: fullCfg(),
        smokeFetch: smokeFetch(),
        smokeSleep: noopSleep,
        agentFetch: agentFetch(),
        judgeFetch: judgeFetch(),
        probeFetch: flakyProbe,
      },
    )
    expect(start.ok).toBe(true)
    for (let i = 0; i < 50; i += 1) {
      const r = await getLatest(null)
      if (r && r.finished_at) break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    const r = await getLatest(null)
    expect(r).toBeTruthy()
    expect(r!.finished_at).toBeTruthy()
    // Probe failure surfaces on the turn but doesn't crash the run.
    for (const t of r!.conversation) {
      expect(t.retrieved_context?.status).toBe('fail')
    }
  })

  it('records agent_prompt_override metadata when override is supplied', async () => {
    let capturedBody: unknown = null
    const start = await startEvalRun(
      {
        mode: 'smoke',
        max_questions: 1,
        system_prompt_override: 'Lead with retrieved facts.',
      },
      {
        config: fullCfg(),
        smokeFetch: smokeFetch(),
        smokeSleep: noopSleep,
        agentFetch: async (_url, init) => {
          capturedBody = JSON.parse(init.body as string)
          return new Response(
            JSON.stringify({
              message: 'ok',
              system_prompt_override_applied: true,
            }),
            { status: 200 },
          )
        },
        judgeFetch: judgeFetch(),
      },
    )
    expect(start.ok).toBe(true)
    for (let i = 0; i < 50; i += 1) {
      const r = await getLatest(null)
      if (r && r.finished_at) break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    const r = await getLatest(null)
    expect(r).toBeTruthy()
    // Override forwarded to the agent.
    expect((capturedBody as Record<string, string>).system_prompt_override).toBe(
      'Lead with retrieved facts.',
    )
    // Metadata captured on the report; raw text NOT stored — only
    // length, hash, preview.
    const ov = r!.config.agent_prompt_override
    expect(ov.used).toBe(true)
    // Confirmation marker → delivery should promote to "confirmed".
    expect(ov.delivery).toBe('confirmed')
    expect(ov.length).toBeGreaterThan(0)
    expect(ov.hash.length).toBe(64)
    // Stored report does not contain the raw override beyond the preview cap.
    expect(ov.preview.length).toBeLessThanOrEqual(300)
  })

  it('attaches a comparison block when baseline_run_id is provided', async () => {
    // First run — call it the baseline.
    await startEvalRun(
      { mode: 'smoke', max_questions: 1 },
      {
        config: fullCfg(),
        smokeFetch: smokeFetch(),
        smokeSleep: noopSleep,
        agentFetch: agentFetch(),
        judgeFetch: judgeFetch(),
      },
    )
    for (let i = 0; i < 50; i += 1) {
      const r = await getLatest(null)
      if (r && r.finished_at) break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    const baseline = await getLatest(null)
    expect(baseline).toBeTruthy()

    // Second run with baseline pinned.
    await startEvalRun(
      { mode: 'smoke', max_questions: 1, baseline_run_id: baseline!.run_id },
      {
        config: fullCfg(),
        smokeFetch: smokeFetch(),
        smokeSleep: noopSleep,
        agentFetch: agentFetch(),
        judgeFetch: judgeFetch(),
      },
    )
    for (let i = 0; i < 50; i += 1) {
      const r = await getLatest(null)
      if (r && r.finished_at && r.run_id !== baseline!.run_id) break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    const candidate = await getLatest(null)
    expect(candidate).toBeTruthy()
    expect(candidate!.run_id).not.toBe(baseline!.run_id)
    expect(candidate!.comparison).toBeTruthy()
    expect(candidate!.comparison!.baseline_run_id).toBe(baseline!.run_id)
    expect(candidate!.comparison!.candidate_run_id).toBe(candidate!.run_id)
    expect(typeof candidate!.comparison!.score_delta).toBe('number')
  })

  it('refuses to start a second run while one is in flight', async () => {
    const inflightFetch: () => Promise<Response> = () =>
      new Promise((resolve) => {
        setTimeout(
          () =>
            resolve(
              new Response(JSON.stringify({ message: 'slow answer' }), { status: 200 }),
            ),
          200,
        )
      })
    const first = await startEvalRun(
      { mode: 'smoke', max_questions: 2 },
      {
        config: fullCfg(),
        smokeFetch: smokeFetch(),
        smokeSleep: noopSleep,
        agentFetch: inflightFetch,
        judgeFetch: judgeFetch(),
      },
    )
    expect(first.ok).toBe(true)
    const second = await startEvalRun(
      { mode: 'smoke', max_questions: 2 },
      {
        config: fullCfg(),
        smokeFetch: smokeFetch(),
        smokeSleep: noopSleep,
        agentFetch: inflightFetch,
        judgeFetch: judgeFetch(),
      },
    )
    expect(second.ok).toBe(false)
    expect(second.status).toBe('running')
  })
})
