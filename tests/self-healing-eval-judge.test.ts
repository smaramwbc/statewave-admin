/**
 * LLM judge tests.
 *
 * Pins:
 *   - parses a strict-JSON response shape
 *   - tolerates ```json fences
 *   - clamps scores to [0,1]
 *   - degrades to a `fail` evaluation on invalid JSON / empty body /
 *     missing config (NEVER returns a heuristic score, per spec)
 *   - dispatches to OpenAI vs Anthropic according to config.provider
 */
import { describe, it, expect, vi } from 'vitest'
import { judge, parseJudgeResponse, type JudgeFetch } from '../server/self-healing-eval/llmJudge'
import type { EvalQuestion } from '../server/self-healing-eval/types'
import type { EvalConfig } from '../server/self-healing-eval/config'

const SAMPLE_Q: EvalQuestion = {
  id: 'l0-what-is-statewave',
  level: 0,
  category: 'identity',
  question: 'What is Statewave?',
  expected_behavior: 'Should describe Statewave as a memory runtime.',
  must_include: ['memory'],
  must_not_claim: ['Statewave is a chatbot'],
  requires_code: false,
  requires_docs_grounding: true,
  topic_drift: false,
  false_premise: false,
  weight: 1,
}

function cfg(overrides: Partial<EvalConfig['llm']> = {}): EvalConfig {
  return {
    enabled: true,
    llm: {
      provider: 'openai',
      model: 'gpt-4o-mini',
      apiKey: 'sk-test',
      baseUrl: null,
      ...overrides,
    },
    demoAgent: {
      url: 'https://demo.example/agent',
      apiKey: null,
      bodyFormat: 'default',
      persona: 'statewave-support',
    },
    webhookConfigured: false,
    storagePath: null,
    statewaveApiUrl: 'https://upstream.example',
    statewaveApiKey: 'k',
  }
}

describe('parseJudgeResponse', () => {
  it('parses a clean JSON judge response', () => {
    const text = JSON.stringify({
      correctness_score: 0.9,
      grounding_score: 0.8,
      completeness_score: 0.7,
      clarity_score: 1,
      safety_score: 1,
      overall_score: 0.85,
      verdict: 'pass',
      reason: 'good',
      missing_points: [],
      hallucination_risks: [],
      recommended_fix: 'none',
      likely_root_cause: [],
    })
    const out = parseJudgeResponse(text)
    expect(out.ok).toBe(true)
    expect(out.evaluation.verdict).toBe('pass')
    expect(out.evaluation.overall_score).toBe(0.85)
  })

  it('strips ```json fences', () => {
    const text = '```json\n{"verdict":"partial","overall_score":0.5}\n```'
    const out = parseJudgeResponse(text)
    expect(out.ok).toBe(true)
    expect(out.evaluation.verdict).toBe('partial')
  })

  it('clamps scores to [0,1]', () => {
    const text = JSON.stringify({
      correctness_score: 1.5,
      grounding_score: -0.2,
      completeness_score: 'NaN',
      clarity_score: 0.5,
      safety_score: 0.5,
      overall_score: 2,
      verdict: 'pass',
    })
    const out = parseJudgeResponse(text)
    expect(out.evaluation.correctness_score).toBe(1)
    expect(out.evaluation.grounding_score).toBe(0)
    expect(out.evaluation.completeness_score).toBe(0)
    expect(out.evaluation.overall_score).toBe(1)
  })

  it('returns a fail evaluation on invalid JSON', () => {
    const out = parseJudgeResponse('this is not json')
    expect(out.ok).toBe(false)
    expect(out.evaluation.verdict).toBe('fail')
    expect(out.error).toBe('invalid_json')
  })

  it('drops unknown root-cause values', () => {
    const text = JSON.stringify({
      verdict: 'fail',
      overall_score: 0,
      likely_root_cause: ['missing-docs', 'made-up-cause', 'retrieval-miss'],
    })
    const out = parseJudgeResponse(text)
    expect(out.evaluation.likely_root_cause).toEqual(['missing-docs', 'retrieval-miss'])
  })
})

describe('applyMustIncludeCorrection — deterministic post-judge', () => {
  // Mirror the failure mode from run eval-4a151c0f9cb1: the judge
  // sometimes defaults to retrieved-context-ignored when the probe
  // returned items but those items don't actually contain the
  // question's must_include terms. The corrector should flip such
  // calls to retrieval-miss based on hard substring evidence.
  function loadCorrector() {
    return import('../server/self-healing-eval/llmJudge').then(
      (m) => m.applyMustIncludeCorrection,
    )
  }

  const baseEval = {
    correctness_score: 0.5,
    grounding_score: 0.5,
    completeness_score: 0.5,
    clarity_score: 0.7,
    safety_score: 1,
    overall_score: 0.5,
    verdict: 'partial' as const,
    reason: 'agent ignored docs',
    missing_points: [],
    hallucination_risks: [],
    recommended_fix: 'tighten agent prompt',
    likely_root_cause: ['retrieved-context-ignored' as const],
  }

  it('flips retrieved-context-ignored → retrieval-miss when must_include not in any retrieved text', async () => {
    const correct = await loadCorrector()
    const out = correct(
      baseEval,
      { ...SAMPLE_Q, must_include: ['memory', 'agent'] },
      {
        status: 'pass',
        subject_id: 'docs',
        query: 'q',
        results: [
          { text: 'Alembic is used for managing database migrations.' },
          { text: 'Statewave uses app-layer tenant isolation.' },
        ],
      },
    )
    expect(out.likely_root_cause[0]).toBe('retrieval-miss')
    expect(out.likely_root_cause).not.toContain('retrieved-context-ignored')
    expect(out.reason).toMatch(/deterministic correction/)
    expect(out.recommended_fix).toMatch(/Tune retrieval/i)
  })

  it('leaves the verdict unchanged when at least one must_include term IS in retrieved text', async () => {
    const correct = await loadCorrector()
    const out = correct(
      baseEval,
      { ...SAMPLE_Q, must_include: ['memory', 'agent'] },
      {
        status: 'pass',
        subject_id: 'docs',
        query: 'q',
        results: [{ text: 'Statewave is a memory runtime for AI agents.' }],
      },
    )
    expect(out.likely_root_cause[0]).toBe('retrieved-context-ignored')
    expect(out.reason).not.toMatch(/deterministic correction/)
  })

  it('does not fire when must_include is empty (judge had nothing concrete to check)', async () => {
    const correct = await loadCorrector()
    const out = correct(
      baseEval,
      { ...SAMPLE_Q, must_include: [] },
      {
        status: 'pass',
        subject_id: 'docs',
        query: 'q',
        results: [{ text: 'irrelevant text' }],
      },
    )
    expect(out).toBe(baseEval) // unchanged reference
  })

  it('does not fire when the judge already classified retrieval-miss / missing-docs', async () => {
    const correct = await loadCorrector()
    const missEval = {
      ...baseEval,
      likely_root_cause: ['retrieval-miss' as const],
    }
    const out = correct(
      missEval,
      { ...SAMPLE_Q, must_include: ['memory', 'agent'] },
      {
        status: 'pass',
        subject_id: 'docs',
        query: 'q',
        results: [{ text: 'irrelevant' }],
      },
    )
    expect(out).toBe(missEval) // not double-flipped
  })

  it('does not fire when the probe failed to run', async () => {
    const correct = await loadCorrector()
    const out = correct(
      baseEval,
      { ...SAMPLE_Q, must_include: ['memory', 'agent'] },
      { status: 'fail', subject_id: 'docs', query: 'q', results: [] },
    )
    expect(out).toBe(baseEval)
  })

  it('matches case-insensitively', async () => {
    const correct = await loadCorrector()
    const out = correct(
      baseEval,
      { ...SAMPLE_Q, must_include: ['MEMORY'] },
      {
        status: 'pass',
        subject_id: 'docs',
        query: 'q',
        results: [{ text: 'Statewave is a memory runtime.' }],
      },
    )
    // 'MEMORY' is in 'memory runtime' (case-insensitive) — judge
    // call stands; not flipped to retrieval-miss.
    expect(out.likely_root_cause).toContain('retrieved-context-ignored')
  })

  it('does NOT flip when token-match (paraphrase) hits — l0-backup-methods regression', async () => {
    // Reproduces the production case where exact-substring failed but
    // the relevant fact was clearly retrieved. With the new matcher,
    // the corrector must leave retrieved-context-ignored intact.
    const correct = await loadCorrector()
    const out = correct(
      baseEval,
      {
        ...SAMPLE_Q,
        must_include: ['subject-level backups', 'full database backups'],
      },
      {
        status: 'pass',
        subject_id: 'docs',
        query: 'q',
        results: [
          {
            text: 'Statewave offers two backup methods: subject-level and full database backup.',
          },
        ],
      },
    )
    expect(out.likely_root_cause).toContain('retrieved-context-ignored')
    expect(out.likely_root_cause).not.toContain('retrieval-miss')
  })

  it('does NOT flip when at least one term matches via paraphrase (partial evidence is enough)', async () => {
    // l1-architecture-comparison: app-layer tenant isolation absent,
    // but "no GPU requirements" paraphrase-matches "without GPU
    // requirements". Partial evidence the agent had access to part
    // of the answer, so we don't claim total retrieval-miss.
    const correct = await loadCorrector()
    const out = correct(
      baseEval,
      {
        ...SAMPLE_Q,
        must_include: ['app-layer tenant isolation', 'no GPU requirements'],
      },
      {
        status: 'pass',
        subject_id: 'docs',
        query: 'q',
        results: [
          { text: "Statewave's API is designed to run on CPU without GPU requirements." },
        ],
      },
    )
    expect(out.likely_root_cause).toContain('retrieved-context-ignored')
  })

  it('still flips when NO term matches even by token (l0-database-architecture stays retrieval-miss)', async () => {
    const correct = await loadCorrector()
    const out = correct(
      baseEval,
      {
        ...SAMPLE_Q,
        must_include: ['FastAPI', 'PostgreSQL 16', 'pgvector'],
      },
      {
        status: 'pass',
        subject_id: 'docs',
        query: 'q',
        results: [
          { text: 'Alembic is used for managing Statewave database migrations.' },
          { text: 'Statewave offers two backup methods: subject-level and full database backup.' },
        ],
      },
    )
    expect(out.likely_root_cause[0]).toBe('retrieval-miss')
    expect(out.reason).toMatch(/deterministic correction/)
  })
})

describe('judge — provider dispatch', () => {
  it('returns fail when LLM is not configured', async () => {
    const out = await judge(cfg({ apiKey: null }), SAMPLE_Q, 'answer')
    expect(out.ok).toBe(false)
    expect(out.error).toBe('llm_not_configured')
    expect(out.evaluation.verdict).toBe('fail')
  })

  it('hits OpenAI chat completions endpoint when provider=openai', async () => {
    const seen: string[] = []
    const fetchImpl: JudgeFetch = vi.fn(async (url) => {
      seen.push(url)
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  verdict: 'pass',
                  overall_score: 0.9,
                  correctness_score: 0.9,
                }),
              },
            },
          ],
        }),
        { status: 200 },
      )
    })
    const out = await judge(cfg(), SAMPLE_Q, 'memory runtime', { fetchImpl })
    expect(out.ok).toBe(true)
    expect(seen[0]).toContain('/v1/chat/completions')
    expect(out.evaluation.verdict).toBe('pass')
  })

  it('hits Anthropic /v1/messages when provider=anthropic', async () => {
    const seen: string[] = []
    const fetchImpl: JudgeFetch = vi.fn(async (url) => {
      seen.push(url)
      return new Response(
        JSON.stringify({
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                verdict: 'partial',
                overall_score: 0.5,
              }),
            },
          ],
        }),
        { status: 200 },
      )
    })
    const out = await judge(cfg({ provider: 'anthropic' }), SAMPLE_Q, 'a', { fetchImpl })
    expect(out.ok).toBe(true)
    expect(seen[0]).toContain('/v1/messages')
    expect(out.evaluation.verdict).toBe('partial')
  })

  it('returns a fail evaluation with structured error on transport failure', async () => {
    const fetchImpl: JudgeFetch = async () => {
      throw new Error('connection refused')
    }
    const out = await judge(cfg(), SAMPLE_Q, 'a', { fetchImpl })
    expect(out.ok).toBe(false)
    expect(out.evaluation.verdict).toBe('fail')
    expect(out.evaluation.reason).toMatch(/connection refused/)
  })
})
