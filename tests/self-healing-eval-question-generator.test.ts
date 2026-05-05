/**
 * Question generator + cache + override safety filter tests.
 *
 * Pins:
 *   - rejects missing/short topic + grounding before any LLM call
 *   - schema-invalid LLM output is rejected cleanly with warnings
 *   - clean LLM output is parsed into validated EvalQuestion[]
 *   - cache key changes when (topic | grounding | mode | max_level) changes
 *   - cache hit short-circuits the LLM call
 *   - override safety filter caps level + drops opt-outs + prunes
 *     orphan follow-ups
 *   - secrets in grounding are redacted before they reach the LLM
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GROUNDING_MAX_BYTES,
  QuestionGenerationError,
  _resetQuestionGeneratorForTests,
  applyOverrideSafetyFilter,
  generateQuestionBank,
  validateGeneratedBank,
} from '../server/self-healing-eval/questionGenerator'
import type { EvalConfig } from '../server/self-healing-eval/config'
import type { EvalQuestion } from '../server/self-healing-eval/types'

const FAKE_VALID_BANK = {
  questions: [
    {
      id: 'l0-identity',
      level: 0,
      category: 'identity',
      question: 'What is the system?',
      expected_behavior: 'Should describe it grounded in docs.',
      must_include: ['memory'],
      must_not_claim: ['it is a chatbot'],
      requires_code: false,
      requires_docs_grounding: true,
      topic_drift: false,
      false_premise: false,
      weight: 1,
    },
    {
      id: 'l1-vs-x',
      level: 1,
      category: 'comparison',
      question: 'How is it different from X?',
      expected_behavior: 'Should differentiate.',
      must_include: [],
      must_not_claim: [],
      requires_code: false,
      requires_docs_grounding: true,
      topic_drift: false,
      false_premise: false,
      weight: 1,
    },
  ],
}

function cfg(over: Partial<EvalConfig['llm']> = {}): EvalConfig {
  return {
    enabled: true,
    llm: {
      provider: 'openai',
      model: 'gpt-4o-mini',
      apiKey: 'sk-test-1234567890',
      baseUrl: null,
      ...over,
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

function fakeFetch(payload: unknown, status = 200) {
  return async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(payload) } }],
      }),
      { status },
    )
}

beforeEach(() => {
  _resetQuestionGeneratorForTests()
  vi.restoreAllMocks()
})
afterEach(() => {
  _resetQuestionGeneratorForTests()
})

// ─── Input validation ─────────────────────────────────────────────────────

describe('generateQuestionBank — request validation', () => {
  it('throws when LLM is not configured', async () => {
    const fetchImpl = vi.fn()
    await expect(
      generateQuestionBank(
        cfg({ apiKey: null }),
        { topic: 'Statewave', grounding: 'a'.repeat(50), mode: 'smoke' },
        { fetchImpl },
      ),
    ).rejects.toBeInstanceOf(QuestionGenerationError)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('throws when topic is missing or empty', async () => {
    const fetchImpl = vi.fn()
    await expect(
      generateQuestionBank(
        cfg(),
        { topic: '   ', grounding: 'a'.repeat(50), mode: 'smoke' },
        { fetchImpl },
      ),
    ).rejects.toThrow(/topic/)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('throws when grounding is missing or too short', async () => {
    const fetchImpl = vi.fn()
    for (const grounding of ['', '   ', 'too short']) {
      await expect(
        generateQuestionBank(
          cfg(),
          { topic: 'Statewave', grounding, mode: 'smoke' },
          { fetchImpl },
        ),
      ).rejects.toThrow(/grounding/)
    }
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

// ─── Schema validation ────────────────────────────────────────────────────

describe('validateGeneratedBank', () => {
  it('accepts a clean bank', () => {
    const r = validateGeneratedBank(FAKE_VALID_BANK)
    expect(r.valid).toHaveLength(2)
    expect(r.warnings).toEqual([])
  })

  it('drops invalid questions and reports warnings', () => {
    const r = validateGeneratedBank({
      questions: [
        FAKE_VALID_BANK.questions[0],
        { id: 'bad-1', level: 99, category: 'x', question: 'q', expected_behavior: '', must_include: [], must_not_claim: [], requires_code: false, requires_docs_grounding: true, topic_drift: false, false_premise: false, weight: 1 },
        { id: 'bad-2', level: 'one', category: 'x', question: 'q', expected_behavior: '', must_include: [], must_not_claim: [], requires_code: false, requires_docs_grounding: true, topic_drift: false, false_premise: false, weight: 1 },
        { id: 'l0-identity', level: 0, category: 'dup', question: 'q', expected_behavior: '', must_include: [], must_not_claim: [], requires_code: false, requires_docs_grounding: true, topic_drift: false, false_premise: false, weight: 1 },
      ],
    })
    expect(r.valid).toHaveLength(1)
    expect(r.warnings.length).toBeGreaterThanOrEqual(2)
  })

  it('rejects when the response is not an array or wrapper object', () => {
    const r = validateGeneratedBank('hello')
    expect(r.valid).toHaveLength(0)
    expect(r.warnings.length).toBeGreaterThan(0)
  })

  it('drops orphan follow-ups whose parent failed validation', () => {
    const r = validateGeneratedBank({
      questions: [
        FAKE_VALID_BANK.questions[0],
        {
          id: 'l0-orphan',
          level: 0,
          category: 'identity',
          question: 'q',
          expected_behavior: '',
          must_include: [],
          must_not_claim: [],
          requires_code: false,
          requires_docs_grounding: true,
          topic_drift: false,
          false_premise: false,
          weight: 1,
          follow_up_of: 'no-such-parent',
        },
      ],
    })
    expect(r.valid.map((q) => q.id)).toEqual(['l0-identity'])
    expect(r.warnings.some((w) => /orphan/.test(w))).toBe(true)
  })
})

// ─── End-to-end happy path + cache ────────────────────────────────────────

describe('generateQuestionBank — happy path + cache', () => {
  it('returns validated questions and warns on level overrun', async () => {
    const noisyBank = {
      questions: [
        FAKE_VALID_BANK.questions[0],
        FAKE_VALID_BANK.questions[1],
        // L7 question above smoke ceiling — must be dropped with a warning
        {
          id: 'l7-architecture',
          level: 7,
          category: 'architecture',
          question: 'arch q',
          expected_behavior: '',
          must_include: [],
          must_not_claim: [],
          requires_code: false,
          requires_docs_grounding: true,
          topic_drift: false,
          false_premise: false,
          weight: 2,
        },
      ],
    }
    const fetchImpl = vi.fn(fakeFetch(noisyBank))
    const result = await generateQuestionBank(
      cfg(),
      { topic: 'Statewave', grounding: 'memory runtime, episodes, compiled memories', mode: 'smoke' },
      { fetchImpl },
    )
    expect(result.questions.map((q) => q.id)).toEqual(['l0-identity', 'l1-vs-x'])
    expect(result.warnings.some((w) => /max_level/.test(w))).toBe(true)
    expect(typeof result.cache_key).toBe('string')
    expect(result.cache_key.length).toBeGreaterThan(8)
  })

  it('caches by (topic, grounding, mode, max_level) — different inputs → different keys', async () => {
    const fetchImpl = vi.fn(fakeFetch(FAKE_VALID_BANK))
    const r1 = await generateQuestionBank(
      cfg(),
      { topic: 'Statewave', grounding: 'a memory runtime for AI agents', mode: 'smoke' },
      { fetchImpl },
    )
    const r2 = await generateQuestionBank(
      cfg(),
      { topic: 'Statewave', grounding: 'a memory runtime for AI agents CHANGED', mode: 'smoke' },
      { fetchImpl },
    )
    const r3 = await generateQuestionBank(
      cfg(),
      { topic: 'Statewave', grounding: 'a memory runtime for AI agents', mode: 'developer' },
      { fetchImpl },
    )
    expect(r1.cache_key).not.toBe(r2.cache_key)
    expect(r1.cache_key).not.toBe(r3.cache_key)
    // Three distinct (topic, grounding, mode) tuples → three LLM calls.
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('cache hit: same inputs → no second LLM call', async () => {
    const fetchImpl = vi.fn(fakeFetch(FAKE_VALID_BANK))
    const r1 = await generateQuestionBank(
      cfg(),
      { topic: 'Statewave', grounding: 'a memory runtime for AI agents', mode: 'smoke' },
      { fetchImpl },
    )
    const r2 = await generateQuestionBank(
      cfg(),
      { topic: 'Statewave', grounding: 'a memory runtime for AI agents', mode: 'smoke' },
      { fetchImpl },
    )
    expect(r1.cache_key).toBe(r2.cache_key)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(r2.warnings.some((w) => /cache hit/i.test(w))).toBe(true)
  })

  it('rejects when LLM returns invalid JSON', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: 'not json at all' } }] }),
        { status: 200 },
      ),
    )
    await expect(
      generateQuestionBank(
        cfg(),
        { topic: 'Statewave', grounding: 'a'.repeat(60), mode: 'smoke' },
        { fetchImpl },
      ),
    ).rejects.toThrow(/non-JSON/)
  })

  it('rejects when the bank is empty after validation', async () => {
    const fetchImpl = vi.fn(fakeFetch({ questions: [] }))
    await expect(
      generateQuestionBank(
        cfg(),
        { topic: 'Statewave', grounding: 'a'.repeat(60), mode: 'smoke' },
        { fetchImpl },
      ),
    ).rejects.toBeInstanceOf(QuestionGenerationError)
  })
})

// ─── Secret redaction ─────────────────────────────────────────────────────

describe('generateQuestionBank — grounding secrets are redacted', () => {
  it('replaces sk-... keys before sending to the LLM', async () => {
    let capturedBody: unknown = null
    const fetchImpl = async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string)
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(FAKE_VALID_BANK) } }],
        }),
        { status: 200 },
      )
    }
    await generateQuestionBank(
      cfg(),
      {
        topic: 'My system',
        grounding:
          'API key: sk-projABCDEFGH1234567890abcdef and password=topsecretvalue123',
        mode: 'smoke',
      },
      { fetchImpl },
    )
    const userMsg = (
      capturedBody as { messages: Array<{ content: string }> }
    ).messages[1].content
    expect(userMsg).not.toContain('sk-projABCDEFGH1234567890abcdef')
    expect(userMsg).toContain('[REDACTED]')
  })

  it('caps grounding at GROUNDING_MAX_BYTES and warns', async () => {
    let capturedBody: unknown = null
    const fetchImpl = async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string)
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(FAKE_VALID_BANK) } }],
        }),
        { status: 200 },
      )
    }
    const huge = 'x'.repeat(GROUNDING_MAX_BYTES + 5_000)
    const r = await generateQuestionBank(
      cfg(),
      { topic: 'Big', grounding: huge, mode: 'smoke' },
      { fetchImpl },
    )
    const userMsg = (
      capturedBody as { messages: Array<{ content: string }> }
    ).messages[1].content
    // The grounding block in the user message must be at most cap-bytes
    // plus the surrounding scaffolding, but never the original 37k.
    const groundingBlock = userMsg.match(/"""([\s\S]*?)"""/)
    expect(groundingBlock).toBeTruthy()
    expect(groundingBlock![1].length).toBeLessThanOrEqual(GROUNDING_MAX_BYTES + 50)
    expect(r.warnings.some((w) => /truncated/i.test(w))).toBe(true)
  })
})

// ─── Override safety filter ──────────────────────────────────────────────

describe('applyOverrideSafetyFilter', () => {
  const sample: EvalQuestion[] = [
    { ...FAKE_VALID_BANK.questions[0] },
    { ...FAKE_VALID_BANK.questions[1] },
    {
      id: 'l5-code',
      level: 5,
      category: 'developer-usage',
      question: 'code q',
      expected_behavior: '',
      must_include: [],
      must_not_claim: [],
      requires_code: true,
      requires_docs_grounding: true,
      topic_drift: false,
      false_premise: false,
      weight: 2,
    },
    {
      id: 'l9-drift',
      level: 9,
      category: 'topic-drift',
      question: 'drift q',
      expected_behavior: '',
      must_include: [],
      must_not_claim: [],
      requires_code: false,
      requires_docs_grounding: true,
      topic_drift: true,
      false_premise: false,
      weight: 2,
    },
    {
      id: 'l9-orphan-followup',
      level: 9,
      category: 'topic-drift',
      question: 'follow q',
      expected_behavior: '',
      must_include: [],
      must_not_claim: [],
      requires_code: false,
      requires_docs_grounding: true,
      topic_drift: true,
      false_premise: false,
      weight: 1,
      follow_up_of: 'no-such-parent-after-filter',
    },
  ]

  it('caps level at the mode ceiling', () => {
    const r = applyOverrideSafetyFilter(sample, 'smoke', undefined, true, true)
    for (const q of r.questions) expect(q.level).toBeLessThanOrEqual(1)
    expect(r.warnings.some((w) => /level 1/.test(w))).toBe(true)
  })

  it('drops requires_code questions when include_code=false', () => {
    const r = applyOverrideSafetyFilter(sample, 'developer', undefined, false, true)
    for (const q of r.questions) expect(q.requires_code).toBe(false)
  })

  it('drops topic_drift questions when include_topic_drift=false', () => {
    const r = applyOverrideSafetyFilter(sample, 'full', undefined, true, false)
    for (const q of r.questions) expect(q.topic_drift).toBe(false)
  })

  it('drops orphan follow-ups whose parent fell out of the filter', () => {
    const r = applyOverrideSafetyFilter(sample, 'full', undefined, true, true)
    expect(r.questions.find((q) => q.id === 'l9-orphan-followup')).toBeUndefined()
  })
})
