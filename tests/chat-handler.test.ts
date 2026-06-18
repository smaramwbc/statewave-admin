/**
 * "Chat with Memory" handler — generation-path selection.
 *
 * Verifies the two ways a reply is produced:
 *   1. Backend delegation (default) — no ADMIN_EVAL_LLM_*; the handler POSTs
 *      to the backend's /v1/llm/complete and surfaces its reply + usage + model.
 *   2. Direct-provider override — ADMIN_EVAL_LLM_* set; the handler calls the
 *      provider directly and never touches /v1/llm/complete.
 * Plus the unified `llm_not_configured` error when neither is available.
 *
 * fetch is stubbed and routed by URL so the tests stay provider- and
 * backend-free.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { handleAdminChat } from '../server/chat-handler'

interface CapturedResponse {
  status: number
  body: string
}

function makeReq(body: unknown): IncomingMessage {
  const socket = new Socket()
  const req = new IncomingMessage(socket)
  req.method = 'POST'
  req.url = '/api/admin-chat'
  req.headers = { host: 'localhost' }
  req.push(JSON.stringify(body))
  req.push(null)
  return req
}

function makeRes(): { res: ServerResponse; captured: CapturedResponse } {
  const captured: CapturedResponse = { status: 0, body: '' }
  const socket = new Socket()
  const res = new ServerResponse(new IncomingMessage(socket))
  res.end = ((chunk?: string | Buffer) => {
    if (chunk !== undefined) captured.body = chunk.toString()
    captured.status = res.statusCode
    return res
  }) as typeof res.end
  return { res, captured }
}

/** A context bundle the /v1/context stub returns for every subject. */
const CONTEXT_BODY = {
  facts: [{ id: 'm1', content: 'Acme is on the Enterprise plan.', score: 0.9 }],
  procedures: [],
  episodes: [],
}

let savedEnv: NodeJS.ProcessEnv

beforeEach(() => {
  savedEnv = { ...process.env }
  process.env = {} as NodeJS.ProcessEnv
  process.env.STATEWAVE_API_URL = 'https://backend.example'
  process.env.STATEWAVE_API_KEY = 'sw-key'
  vi.restoreAllMocks()
})

afterEach(() => {
  process.env = savedEnv
})

describe('handleAdminChat generation paths', () => {
  it('delegates to the backend /v1/llm/complete when no ADMIN_EVAL_LLM_* is set', async () => {
    const calls: string[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      calls.push(url)
      if (url.endsWith('/v1/context')) {
        return new Response(JSON.stringify(CONTEXT_BODY), { status: 200 })
      }
      if (url.endsWith('/v1/llm/complete')) {
        // The backend must be given the X-API-Key and only messages+max_tokens.
        const headers = new Headers(init?.headers as HeadersInit)
        expect(headers.get('X-API-Key')).toBe('sw-key')
        const sent = JSON.parse(String(init?.body))
        expect('model' in sent).toBe(false)
        expect(Array.isArray(sent.messages)).toBe(true)
        return new Response(
          JSON.stringify({
            reply: 'Acme is on Enterprise [S1].',
            usage: { prompt_tokens: 120, completion_tokens: 12, total_tokens: 132 },
            model: 'gpt-4o-mini',
          }),
          { status: 200 },
        )
      }
      throw new Error(`unexpected fetch: ${url}`)
    })

    const { res, captured } = makeRes()
    await handleAdminChat(
      makeReq({ subjects: ['acme'], messages: [{ role: 'user', content: 'what plan?' }] }),
      res,
    )

    expect(captured.status).toBe(200)
    const data = JSON.parse(captured.body)
    expect(data.reply).toBe('Acme is on Enterprise [S1].')
    expect(data.stats.llm_usage).toEqual({ prompt_tokens: 120, completion_tokens: 12, total_tokens: 132 })
    expect(data.stats.model).toBe('gpt-4o-mini')
    // It must have hit the backend completion endpoint, not a provider.
    expect(calls.some((u) => u.endsWith('/v1/llm/complete'))).toBe(true)
    expect(calls.some((u) => u.includes('openai.com') || u.includes('anthropic.com'))).toBe(false)
  })

  it('uses the direct provider when ADMIN_EVAL_LLM_* is set, never the backend completion route', async () => {
    process.env.ADMIN_EVAL_LLM_PROVIDER = 'openai'
    process.env.ADMIN_EVAL_LLM_MODEL = 'gpt-4o-mini'
    process.env.ADMIN_EVAL_LLM_API_KEY = 'sk-test'

    const calls: string[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      calls.push(url)
      if (url.endsWith('/v1/context')) {
        return new Response(JSON.stringify(CONTEXT_BODY), { status: 200 })
      }
      if (url.includes('openai.com')) {
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: 'Direct reply.' } }],
            usage: { prompt_tokens: 50, completion_tokens: 5, total_tokens: 55 },
          }),
          { status: 200 },
        )
      }
      throw new Error(`unexpected fetch: ${url}`)
    })

    const { res, captured } = makeRes()
    await handleAdminChat(
      makeReq({ subjects: ['acme'], messages: [{ role: 'user', content: 'what plan?' }] }),
      res,
    )

    expect(captured.status).toBe(200)
    const data = JSON.parse(captured.body)
    expect(data.reply).toBe('Direct reply.')
    expect(data.stats.model).toBe('gpt-4o-mini')
    expect(calls.some((u) => u.includes('openai.com'))).toBe(true)
    expect(calls.some((u) => u.endsWith('/v1/llm/complete'))).toBe(false)
  })

  it('surfaces llm_not_configured (503) when the backend has no LLM and no override is set', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/v1/context')) {
        return new Response(JSON.stringify(CONTEXT_BODY), { status: 200 })
      }
      if (url.endsWith('/v1/llm/complete')) {
        return new Response(JSON.stringify({ error: { code: 'llm_not_configured' } }), { status: 503 })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })

    const { res, captured } = makeRes()
    await handleAdminChat(
      makeReq({ subjects: ['acme'], messages: [{ role: 'user', content: 'what plan?' }] }),
      res,
    )

    expect(captured.status).toBe(503)
    expect(JSON.parse(captured.body).error).toBe('llm_not_configured')
  })

  it('keeps reply with usage:null when the backend omits token usage', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/v1/context')) {
        return new Response(JSON.stringify(CONTEXT_BODY), { status: 200 })
      }
      if (url.endsWith('/v1/llm/complete')) {
        return new Response(
          JSON.stringify({ reply: 'Local model reply.', usage: null, model: 'ollama/llama3' }),
          { status: 200 },
        )
      }
      throw new Error(`unexpected fetch: ${url}`)
    })

    const { res, captured } = makeRes()
    await handleAdminChat(
      makeReq({ subjects: ['acme'], messages: [{ role: 'user', content: 'what plan?' }] }),
      res,
    )

    expect(captured.status).toBe(200)
    const data = JSON.parse(captured.body)
    expect(data.reply).toBe('Local model reply.')
    expect(data.stats.llm_usage).toBeNull()
    expect(data.stats.model).toBe('ollama/llama3')
  })
})
