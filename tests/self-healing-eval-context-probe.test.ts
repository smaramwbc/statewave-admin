/**
 * Context probe tests.
 *
 * Pins:
 *   - normalizes a /v1/context response into capped, redacted items
 *   - upstream HTTP failure / network drop returns status='fail' (no throw)
 *   - missing STATEWAVE_API_URL returns status='not_configured' (no throw)
 *   - secrets in retrieved memory text are redacted before storage
 *   - per-item character cap is enforced
 *   - results are limited to PROBE_MAX_ITEMS
 */
import { describe, expect, it, vi } from 'vitest'
import {
  PROBE_MAX_ITEMS,
  PROBE_TEXT_CAP_PER_ITEM,
  normalizeContextResponse,
  probeContextForQuestion,
  type ProbeFetch,
} from '../server/self-healing-eval/contextProbe'
import type { EvalConfig } from '../server/self-healing-eval/config'

function cfg(over: Partial<EvalConfig> = {}): EvalConfig {
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
      apiKey: null,
      bodyFormat: 'default',
      persona: 'statewave-support',
    },
    webhookConfigured: false,
    storagePath: null,
    statewaveApiUrl: 'https://upstream.example',
    statewaveApiKey: 'k',
    docsSubjectId: 'statewave-support-docs',
    ...over,
  }
}

describe('normalizeContextResponse', () => {
  it('flattens facts + procedures + episodes into a capped result list', () => {
    const items = normalizeContextResponse({
      facts: [
        { id: 'f1', summary: 'Episodes are immutable.', metadata: { source_path: 'concepts/episodes.md' } },
      ],
      procedures: [
        { id: 'p1', content: 'How to compile memories.' },
      ],
      episodes: [
        { id: 'e1', payload: { text: 'A raw event.' } },
        // Extras that should be dropped by the PROBE_MAX_ITEMS cap.
        ...Array.from({ length: 20 }, (_, i) => ({
          id: `e-extra-${i}`,
          payload: { text: 'noise' },
        })),
      ],
    })
    expect(items.length).toBeLessThanOrEqual(PROBE_MAX_ITEMS)
    expect(items[0]).toMatchObject({ kind: 'fact', source_path: 'concepts/episodes.md' })
    expect(items.find((r) => r.memory_id === 'p1')?.kind).toBe('procedure')
    expect(items.find((r) => r.episode_id === 'e1')?.kind).toBe('episode')
  })

  it('redacts secrets in retrieved text', () => {
    const items = normalizeContextResponse({
      facts: [
        {
          id: 'f1',
          summary:
            'Here is a leaked sk-projABCDEFGHIJKLMNOP1234567 key in the docs.',
        },
      ],
    })
    expect(items[0].text).not.toContain('sk-projABCDEFGHIJKLMNOP1234567')
    expect(items[0].text).toContain('[REDACTED]')
  })

  it('caps item text at PROBE_TEXT_CAP_PER_ITEM', () => {
    const items = normalizeContextResponse({
      facts: [{ id: 'f1', summary: 'x'.repeat(PROBE_TEXT_CAP_PER_ITEM + 500) }],
    })
    expect(items[0].text.length).toBe(PROBE_TEXT_CAP_PER_ITEM)
  })
})

describe('probeContextForQuestion', () => {
  it('returns status="not_configured" when STATEWAVE_API_URL is unset', async () => {
    const r = await probeContextForQuestion(
      cfg({ statewaveApiUrl: null }),
      { subject_id: 's', query: 'q' },
    )
    expect(r.status).toBe('not_configured')
    expect(r.error).toMatch(/STATEWAVE_API_URL/)
    expect(r.results).toEqual([])
  })

  it('returns status="fail" with a structured error on transport drop — never throws', async () => {
    const fetchImpl: ProbeFetch = async () => {
      throw new Error('ECONNREFUSED')
    }
    const r = await probeContextForQuestion(
      cfg(),
      { subject_id: 's', query: 'q' },
      { fetchImpl },
    )
    expect(r.status).toBe('fail')
    expect(r.error).toMatch(/ECONNREFUSED/)
  })

  it('returns status="fail" when upstream responds non-2xx — never throws', async () => {
    const fetchImpl: ProbeFetch = vi.fn(async () => new Response('', { status: 503 }))
    const r = await probeContextForQuestion(
      cfg(),
      { subject_id: 's', query: 'q' },
      { fetchImpl },
    )
    expect(r.status).toBe('fail')
    expect(r.error).toMatch(/HTTP 503/)
  })

  it('returns status="pass" with normalized results on a successful upstream call', async () => {
    const fetchImpl: ProbeFetch = async () =>
      new Response(
        JSON.stringify({
          subject_id: 's',
          task: 'q',
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
    const r = await probeContextForQuestion(
      cfg(),
      { subject_id: 'statewave-support-docs', query: 'what are episodes?' },
      { fetchImpl },
    )
    expect(r.status).toBe('pass')
    expect(r.results).toHaveLength(1)
    expect(r.results[0].source_path).toBe('concepts/episodes.md')
    expect(r.no_relevant_results).toBe(false)
  })

  it('flags no_relevant_results=true when the upstream returns no items', async () => {
    const fetchImpl: ProbeFetch = async () =>
      new Response(
        JSON.stringify({
          subject_id: 's',
          task: 'q',
          facts: [],
          procedures: [],
          episodes: [],
        }),
        { status: 200 },
      )
    const r = await probeContextForQuestion(
      cfg(),
      { subject_id: 's', query: 'obscure' },
      { fetchImpl },
    )
    expect(r.status).toBe('pass')
    expect(r.results).toHaveLength(0)
    expect(r.no_relevant_results).toBe(true)
  })
})
