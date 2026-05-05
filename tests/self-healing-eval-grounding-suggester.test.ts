/**
 * Subject-driven grounding suggester tests.
 *
 * Pins:
 *   - 503 / throws when LLM is not configured
 *   - 400 / throws when subject_id is missing
 *   - upstream "subject not found" → 404 error
 *   - empty memories → 422 error (don't ask the LLM with nothing)
 *   - secrets in memories are redacted before reaching the LLM
 *   - happy path returns { topic, grounding, source } and sources are
 *     listed by the memories actually pulled
 *   - malformed LLM JSON is rejected with a structured error
 */
import { describe, expect, it, vi } from 'vitest'
import {
  GroundingSuggestionError,
  suggestGrounding,
} from '../server/self-healing-eval/groundingSuggester'
import type { EvalConfig } from '../server/self-healing-eval/config'

function cfg(over: Partial<EvalConfig['llm']> = {}): EvalConfig {
  return {
    enabled: true,
    llm: {
      provider: 'openai',
      model: 'gpt-4o-mini',
      apiKey: 'sk-test',
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

function memoryListResponse(memories: Array<{ id?: string; summary?: string; content?: string }>) {
  return new Response(JSON.stringify({ memories }), { status: 200 })
}

function llmJsonResponse(payload: unknown) {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(payload) } }],
    }),
    { status: 200 },
  )
}

describe('suggestGrounding — input validation', () => {
  it('throws 503 when LLM is not configured', async () => {
    await expect(
      suggestGrounding(cfg({ apiKey: null }), { subject_id: 's' }),
    ).rejects.toMatchObject({ status: 503 })
  })

  it('throws 400 when subject_id is missing', async () => {
    await expect(
      suggestGrounding(cfg(), { subject_id: '   ' }),
    ).rejects.toMatchObject({ status: 400 })
  })
})

describe('suggestGrounding — upstream behaviour', () => {
  it('maps a 404 from /admin/subjects/<id>/memories to a 404 error', async () => {
    const upstreamFetch = vi.fn(async () => new Response('', { status: 404 }))
    const llmFetch = vi.fn()
    await expect(
      suggestGrounding(
        cfg(),
        { subject_id: 'unknown' },
        { upstreamFetch, llmFetch },
      ),
    ).rejects.toMatchObject({ status: 404 })
    expect(llmFetch).not.toHaveBeenCalled()
  })

  it('refuses to ask the LLM when the subject has no compiled memories', async () => {
    const upstreamFetch = vi.fn(async () => memoryListResponse([]))
    const llmFetch = vi.fn()
    await expect(
      suggestGrounding(
        cfg(),
        { subject_id: 'empty' },
        { upstreamFetch, llmFetch },
      ),
    ).rejects.toMatchObject({ status: 422 })
    expect(llmFetch).not.toHaveBeenCalled()
  })

  it('redacts secrets in memory content before sending to the LLM', async () => {
    let capturedUserMessage = ''
    const upstreamFetch = vi.fn(async () =>
      memoryListResponse([
        {
          id: 'm-1',
          summary:
            'API key: sk-projABCDEFGH1234567890abcdef and a password=topsecretvalue123 here.',
        },
      ]),
    )
    const llmFetch = async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string)
      capturedUserMessage = body.messages[1].content
      return llmJsonResponse({
        topic: 'Test subject',
        grounding:
          'A sufficiently long grounding paragraph that meets the minimum length requirement.',
      })
    }
    await suggestGrounding(
      cfg(),
      { subject_id: 'redact-me' },
      { upstreamFetch, llmFetch },
    )
    expect(capturedUserMessage).not.toContain('sk-projABCDEFGH1234567890abcdef')
    expect(capturedUserMessage).toContain('[REDACTED]')
  })
})

describe('suggestGrounding — happy path', () => {
  it('returns { topic, grounding, source } and lists sampled memory ids', async () => {
    const upstreamFetch = vi.fn(async () =>
      memoryListResponse([
        { id: 'm-1', summary: 'Statewave is a memory runtime for AI agents.' },
        { id: 'm-2', summary: 'Episodes are immutable, append-only inputs.' },
      ]),
    )
    const llmFetch = async () =>
      llmJsonResponse({
        topic: 'Statewave memory runtime',
        grounding:
          'Statewave is a memory runtime for AI agents. It ingests episodes and compiles memories.',
      })
    const r = await suggestGrounding(
      cfg(),
      { subject_id: 'statewave-support-docs' },
      { upstreamFetch, llmFetch },
    )
    expect(r.topic).toBe('Statewave memory runtime')
    expect(r.grounding.length).toBeGreaterThan(20)
    expect(r.source.subject_id).toBe('statewave-support-docs')
    expect(r.source.memory_count).toBe(2)
    expect(r.source.sampled_memory_ids).toEqual(['m-1', 'm-2'])
  })

  it('rejects malformed LLM JSON with a structured error', async () => {
    const upstreamFetch = vi.fn(async () =>
      memoryListResponse([
        { id: 'm-1', summary: 'A long enough piece of subject knowledge here.' },
      ]),
    )
    const llmFetch = async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: 'not json' } }] }),
        { status: 200 },
      )
    await expect(
      suggestGrounding(
        cfg(),
        { subject_id: 's' },
        { upstreamFetch, llmFetch },
      ),
    ).rejects.toBeInstanceOf(GroundingSuggestionError)
  })
})
