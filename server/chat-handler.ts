/**
 * Admin "Chat with Memory" handler.
 *
 * POST /api/admin-chat
 * Body: { subjects: string[], messages: [{role, content}][] }
 *
 * For each selected subject, retrieves the top context items from the
 * Statewave /v1/context endpoint (same API the eval runner uses), assembles
 * them into a grounded system prompt, and generates a reply.
 *
 * Two ways the reply is generated, in precedence order:
 *   1. If ADMIN_EVAL_LLM_* is configured, the admin calls that provider
 *      directly (lets an operator point chat at a different / cheaper model).
 *   2. Otherwise it DELEGATES to the backend's POST /v1/llm/complete, which
 *      generates the reply using the backend's own STATEWAVE_LITELLM_* config
 *      — the same LLM already configured for memory compilation. This means
 *      "Chat with Memory" works out of the box once the backend LLM is set,
 *      with zero admin-side LLM credentials, and works identically on Docker,
 *      desktop, and serverless (Vercel) since there's no admin-side secret.
 *
 * The API key is never exposed to the browser — all secrets stay server-side.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { getEvalConfig } from './self-healing-eval/config.js'

export interface AdminChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface ContextItem {
  id: string
  text: string
  subject: string
  kind: 'fact' | 'procedure' | 'episode'
  score?: number
  token_count: number
}

interface LLMUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

/** Unified result shape for both the direct-provider and backend-delegated
 * generation paths, so the handler can treat them interchangeably. */
interface LLMCallResult {
  reply: string
  error: string | null
  usage: LLMUsage | null
  duration_ms: number
  /** Model actually used. Empty string when unknown (e.g. an error before
   * the backend reported which model it picked). */
  model: string
}

interface AdminChatStats {
  retrieval_ms: number
  llm_ms: number
  total_ms: number
  context_tokens_est: number
  llm_usage: LLMUsage | null
  model: string
  subject_counts: Record<string, number>
}

interface AdminChatResponse {
  reply: string
  context_items: ContextItem[]
  subjects_queried: string[]
  stats: AdminChatStats
  error?: string
}

interface UpstreamMemory {
  id?: string
  content?: string
  summary?: string
  score?: number
  metadata?: Record<string, unknown>
}

interface UpstreamEpisode {
  id?: string
  payload?: Record<string, unknown>
  metadata?: Record<string, unknown>
}

interface UpstreamContextResponse {
  facts?: UpstreamMemory[]
  procedures?: UpstreamMemory[]
  episodes?: UpstreamEpisode[]
}

function memoryText(m: UpstreamMemory): string {
  return (m.content ?? m.summary ?? '').trim()
}

function episodeText(e: UpstreamEpisode): string {
  const p = e.payload ?? {}
  return (
    (typeof p.text === 'string' ? p.text : '') ||
    (typeof p.content === 'string' ? p.content : '') ||
    (typeof p.summary === 'string' ? p.summary : '')
  ).trim()
}

async function retrieveContext(
  apiUrl: string,
  apiKey: string | null,
  subjectId: string,
  task: string,
  maxTokens: number,
): Promise<ContextItem[]> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  if (apiKey) headers['X-API-Key'] = apiKey

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000)
  try {
    const res = await fetch(`${apiUrl.replace(/\/+$/, '')}/v1/context`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ subject_id: subjectId, task, max_tokens: maxTokens }),
      signal: controller.signal,
    })
    if (!res.ok) return []
    const data = (await res.json()) as UpstreamContextResponse
    const items: ContextItem[] = []
    let seq = 1
    for (const f of data.facts ?? []) {
      const text = memoryText(f)
      if (text) items.push({ id: `S${seq++}`, text, subject: subjectId, kind: 'fact', score: f.score, token_count: Math.ceil(text.length / 4) })
    }
    for (const p of data.procedures ?? []) {
      const text = memoryText(p)
      if (text) items.push({ id: `S${seq++}`, text, subject: subjectId, kind: 'procedure', score: p.score, token_count: Math.ceil(text.length / 4) })
    }
    for (const e of data.episodes ?? []) {
      const text = episodeText(e)
      if (text) items.push({ id: `S${seq++}`, text, subject: subjectId, kind: 'episode', token_count: Math.ceil(text.length / 4) })
    }
    return items.slice(0, 8)
  } catch {
    return []
  } finally {
    clearTimeout(timer)
  }
}

function buildSystemPrompt(contextItems: ContextItem[], subjects: string[]): string {
  const subjectList = subjects.join(', ')
  if (contextItems.length === 0) {
    return [
      `You are an admin assistant for the Statewave memory system.`,
      `You are inspecting subject(s): ${subjectList}.`,
      `No memory context was retrieved for this query. Answer based on general knowledge and note that no grounded context is available.`,
    ].join('\n')
  }

  const contextBlock = contextItems
    .map((item) => `[${item.id}] (${item.subject} · ${item.kind})\n${item.text}`)
    .join('\n\n')

  return [
    `You are an admin assistant for the Statewave memory system.`,
    `You are inspecting subject(s): ${subjectList}.`,
    ``,
    `The following context items were retrieved from memory:`,
    ``,
    contextBlock,
    ``,
    `Answer the user's question using the retrieved context above. Cite items by their ID (e.g. [S1]) when relevant. If the context does not contain enough information, say so clearly.`,
  ].join('\n')
}

async function callLLM(
  cfg: ReturnType<typeof getEvalConfig>,
  messages: Array<{ role: string; content: string }>,
): Promise<LLMCallResult> {
  const { llm } = cfg
  if (!llm.provider || !llm.model || !llm.apiKey) {
    return { reply: '', error: 'llm_not_configured', usage: null, duration_ms: 0, model: '' }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30_000)
  const t0 = Date.now()

  try {
    if (llm.provider === 'anthropic') {
      const baseUrl = llm.baseUrl ?? 'https://api.anthropic.com'
      const url = `${baseUrl.replace(/\/+$/, '')}/v1/messages`
      const system = messages.find((m) => m.role === 'system')?.content ?? ''
      const rest = messages.filter((m) => m.role !== 'system')
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': llm.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({ model: llm.model, max_tokens: 1024, system, messages: rest }),
        signal: controller.signal,
      })
      if (!res.ok) return { reply: '', error: `HTTP ${res.status}`, usage: null, duration_ms: Date.now() - t0, model: llm.model }
      const data = (await res.json()) as {
        content?: Array<{ type?: string; text?: string }>
        usage?: { input_tokens?: number; output_tokens?: number }
      }
      const reply = data.content?.find((b) => b.type === 'text')?.text ?? ''
      const inp = data.usage?.input_tokens ?? 0
      const out = data.usage?.output_tokens ?? 0
      return { reply, error: null, usage: { prompt_tokens: inp, completion_tokens: out, total_tokens: inp + out }, duration_ms: Date.now() - t0, model: llm.model }
    }

    // OpenAI / openai-compatible
    const baseUrl = llm.baseUrl ?? 'https://api.openai.com'
    const url = `${baseUrl.replace(/\/+$/, '')}/v1/chat/completions`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${llm.apiKey}`,
      },
      body: JSON.stringify({ model: llm.model, messages }),
      signal: controller.signal,
    })
    if (!res.ok) return { reply: '', error: `HTTP ${res.status}`, usage: null, duration_ms: Date.now() - t0, model: llm.model }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
    }
    const reply = data.choices?.[0]?.message?.content ?? ''
    const usage: LLMUsage = {
      prompt_tokens: data.usage?.prompt_tokens ?? 0,
      completion_tokens: data.usage?.completion_tokens ?? 0,
      total_tokens: data.usage?.total_tokens ?? 0,
    }
    return { reply, error: null, usage, duration_ms: Date.now() - t0, model: llm.model }
  } catch (e) {
    return { reply: '', error: e instanceof Error ? e.message : 'unknown', usage: null, duration_ms: Date.now() - t0, model: llm.model }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Delegate generation to the backend's POST /v1/llm/complete. The backend
 * picks the model + provider from its own STATEWAVE_LITELLM_* config and
 * returns { reply, usage?, model? }. Used when no ADMIN_EVAL_LLM_* override
 * is set — so the admin never needs its own LLM credential, and the same
 * works on Vercel where there's no durable admin-side secret store.
 */
async function callBackendLLM(
  apiUrl: string,
  apiKey: string | null,
  messages: Array<{ role: string; content: string }>,
): Promise<LLMCallResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30_000)
  const t0 = Date.now()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  if (apiKey) headers['X-API-Key'] = apiKey
  try {
    // The backend caps messages at 50 and max_tokens at 4096; our turns stay
    // well under both. It rejects a `model` field (provider choice is a
    // server concern), so we send only messages + max_tokens.
    const res = await fetch(`${apiUrl.replace(/\/+$/, '')}/v1/llm/complete`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ messages, max_tokens: 1024 }),
      signal: controller.signal,
    })
    if (!res.ok) {
      // Backend 503 = its own LLM isn't configured (no STATEWAVE_LITELLM_MODEL).
      // Map it to the SAME `llm_not_configured` code the direct path uses, so
      // the UI shows one unified "no LLM configured" message regardless of path.
      const error = res.status === 503 ? 'llm_not_configured' : `HTTP ${res.status}`
      return { reply: '', error, usage: null, duration_ms: Date.now() - t0, model: '' }
    }
    const data = (await res.json()) as {
      reply?: string
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null
      model?: string | null
    }
    const usage: LLMUsage | null = data.usage
      ? {
          prompt_tokens: data.usage.prompt_tokens ?? 0,
          completion_tokens: data.usage.completion_tokens ?? 0,
          total_tokens: data.usage.total_tokens ?? 0,
        }
      : null
    return {
      reply: data.reply ?? '',
      error: null,
      usage,
      duration_ms: Date.now() - t0,
      model: data.model ?? '',
    }
  } catch (e) {
    return { reply: '', error: e instanceof Error ? e.message : 'unknown', usage: null, duration_ms: Date.now() - t0, model: '' }
  } finally {
    clearTimeout(timer)
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk: Buffer) => { body += chunk.toString() })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data)
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(body)
}

export async function handleAdminChat(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'method_not_allowed' })
    return
  }

  let body: { subjects?: unknown; messages?: unknown }
  try {
    body = JSON.parse(await readBody(req))
  } catch {
    sendJson(res, 400, { error: 'invalid_json' })
    return
  }

  const subjects = Array.isArray(body.subjects)
    ? (body.subjects as unknown[]).filter((s): s is string => typeof s === 'string').slice(0, 10)
    : []
  const messages = Array.isArray(body.messages)
    ? (body.messages as unknown[]).filter(
        (m): m is AdminChatMessage =>
          typeof m === 'object' &&
          m !== null &&
          (('role' in m && (m as AdminChatMessage).role === 'user') ||
            (m as AdminChatMessage).role === 'assistant') &&
          typeof (m as AdminChatMessage).content === 'string',
      )
    : []

  if (subjects.length === 0) {
    sendJson(res, 400, { error: 'subjects_required' })
    return
  }

  const lastUser = [...messages].reverse().find((m) => m.role === 'user')
  if (!lastUser) {
    sendJson(res, 400, { error: 'user_message_required' })
    return
  }

  const cfg = getEvalConfig()
  const apiUrl = process.env.STATEWAVE_API_URL ?? cfg.statewaveApiUrl ?? ''
  const apiKey = process.env.STATEWAVE_API_KEY ?? null

  if (!apiUrl) {
    sendJson(res, 503, { error: 'statewave_not_configured' })
    return
  }

  const t0 = Date.now()

  // Retrieve context from all subjects in parallel (budget split evenly)
  const perSubjectTokens = Math.floor(2000 / subjects.length)
  const contextArrays = await Promise.all(
    subjects.map((s) => retrieveContext(apiUrl, apiKey, s, lastUser.content, perSubjectTokens)),
  )
  const retrieval_ms = Date.now() - t0
  const contextItems = contextArrays.flat()

  const systemPrompt = buildSystemPrompt(contextItems, subjects)
  const llmMessages: Array<{ role: string; content: string }> = [
    { role: 'system', content: systemPrompt },
    ...messages,
  ]

  // Precedence: an explicit ADMIN_EVAL_LLM_* override wins (operator can point
  // chat at a different model + keep direct-provider token stats); otherwise
  // delegate to the backend's configured LLM so chat works with zero admin-side
  // credentials.
  const adminLlmConfigured = Boolean(cfg.llm.provider && cfg.llm.model && cfg.llm.apiKey)
  const { reply, error, usage: llmUsage, duration_ms: llm_ms, model } = adminLlmConfigured
    ? await callLLM(cfg, llmMessages)
    : await callBackendLLM(apiUrl, apiKey, llmMessages)

  if (error) {
    const status = error === 'llm_not_configured' ? 503 : 502
    sendJson(res, status, { error })
    return
  }

  const subjectCounts: Record<string, number> = {}
  for (const item of contextItems) {
    subjectCounts[item.subject] = (subjectCounts[item.subject] ?? 0) + 1
  }

  const response: AdminChatResponse = {
    reply,
    context_items: contextItems,
    subjects_queried: subjects,
    stats: {
      retrieval_ms,
      llm_ms,
      total_ms: Date.now() - t0,
      context_tokens_est: contextItems.reduce((s, i) => s + i.token_count, 0),
      llm_usage: llmUsage,
      model,
      subject_counts: subjectCounts,
    },
  }
  sendJson(res, 200, response)
}
