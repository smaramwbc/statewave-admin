/**
 * Subject-driven grounding suggester.
 *
 * The diagnostics UI lets the operator pick a subject from the connected
 * Statewave backend. This module turns that subject's compiled memories
 * into a `{ topic, grounding }` pair that fills the question generator's
 * inputs — so the LLM produces questions calibrated to whatever subject
 * the operator wants to evaluate, not just hardcoded Statewave content.
 *
 * Flow:
 *   1. Pull active compiled memories from the upstream
 *      `/admin/subjects/<id>/memories?status=active&limit=N` endpoint
 *      using the same STATEWAVE_API_URL + STATEWAVE_API_KEY pattern the
 *      smoke check already uses.
 *   2. Join `summary || content` for each memory into a single string,
 *      capped at GROUNDING_MAX_BYTES.
 *   3. Run the joined string through the secret redactor BEFORE it
 *      crosses the network to the LLM judge.
 *   4. Ask the LLM to produce a strict-JSON `{ topic, grounding }`.
 *      Topic is a short label, grounding is a 2–4 paragraph distillation
 *      of the canonical knowledge in those memories.
 *
 * The redaction rationale matches the question generator: customer-
 * imported subjects via `.swmem` could contain anything, including
 * stray credentials. We never log raw memories and never round-trip
 * them to disk.
 */
import type { EvalConfig } from './config.js'
import type { JudgeFetch } from './llmJudge.js'
import { GROUNDING_MAX_BYTES } from './questionGenerator.js'
import { redactString } from './redact.js'

interface MemoryRow {
  id?: string
  summary?: string
  content?: string
}

interface MemoryListResponseShape {
  memories?: MemoryRow[]
}

export interface GroundingSuggestionInput {
  subject_id: string
  /** Max number of memories to pull from upstream. Default 50. */
  max_memories?: number
}

export interface GroundingSuggestionResult {
  topic: string
  grounding: string
  source: {
    subject_id: string
    memory_count: number
    sampled_memory_ids: string[]
    grounding_truncated: boolean
  }
}

export interface SuggestOptions {
  fetchImpl?: JudgeFetch
  timeoutMs?: number
}

export class GroundingSuggestionError extends Error {
  status: number
  constructor(message: string, status = 422) {
    super(message)
    this.name = 'GroundingSuggestionError'
    this.status = status
  }
}

const SYSTEM_PROMPT = `You produce a topic label and a grounding text from
a subject's compiled memories. The compiled memories are produced by
Statewave — they are the canonical knowledge a downstream agent retrieves
when answering questions about this subject.

Output rules:
- Reply with a SINGLE JSON object: { "topic": string, "grounding": string }.
- topic: a short human-readable label for the subject (e.g.
  "Statewave memory runtime", "DevOps demo agent",
  "Customer X imported support docs"). 2–8 words.
- grounding: 2–4 short paragraphs distilling the canonical knowledge in
  the supplied memories. Use only facts present in the memories — do
  NOT invent endpoints, package names, configuration, or claims that
  aren't in the supplied text.
- Do NOT include API keys, URLs with credentials, or anything that looks
  like a secret. The supplied memories have already had obvious
  credential patterns redacted; if anything secret-shaped slips
  through, omit it.
- Do NOT prefix or suffix the JSON with any prose, markdown fences, or
  commentary.`

interface OpenAIResponse {
  choices?: Array<{ message?: { content?: string } }>
}
interface AnthropicResponse {
  content?: Array<{ type?: string; text?: string }>
}

async function callLLM(
  cfg: EvalConfig,
  systemPrompt: string,
  userPrompt: string,
  fetchImpl: JudgeFetch,
  timeoutMs: number,
): Promise<{ text: string; error: string | null }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    if (cfg.llm.provider === 'anthropic') {
      const baseUrl = cfg.llm.baseUrl ?? 'https://api.anthropic.com'
      const url = `${baseUrl.replace(/\/+$/, '')}/v1/messages`
      const res = await fetchImpl(url, {
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
      if (!res.ok) return { text: '', error: `HTTP ${res.status}` }
      const data = (await res.json()) as AnthropicResponse
      const text = (data.content ?? [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text ?? '')
        .join('\n')
      return { text, error: null }
    }
    const baseUrl = cfg.llm.baseUrl ?? 'https://api.openai.com'
    const url = `${baseUrl.replace(/\/+$/, '')}/v1/chat/completions`
    const res = await fetchImpl(url, {
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
    if (!res.ok) return { text: '', error: `HTTP ${res.status}` }
    const data = (await res.json()) as OpenAIResponse
    return { text: data.choices?.[0]?.message?.content ?? '', error: null }
  } catch (e) {
    return { text: '', error: e instanceof Error ? e.message : 'unreachable' }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Pluggable upstream fetch — same shape as the smoke check's. Tests
 * inject a mock; production uses global fetch.
 */
export type UpstreamFetch = (url: string, init: RequestInit) => Promise<Response>

async function fetchSubjectMemoriesFromUpstream(
  cfg: EvalConfig,
  subjectId: string,
  limit: number,
  fetchImpl: UpstreamFetch,
  timeoutMs: number,
): Promise<{ memories: MemoryRow[]; error: string | null }> {
  if (!cfg.statewaveApiUrl) {
    return { memories: [], error: 'STATEWAVE_API_URL is not configured' }
  }
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  if (cfg.statewaveApiKey) headers['X-API-Key'] = cfg.statewaveApiKey
  const path = `/admin/subjects/${encodeURIComponent(subjectId)}/memories?status=active&limit=${encodeURIComponent(String(limit))}&offset=0`
  const url = `${cfg.statewaveApiUrl}${path}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetchImpl(url, { method: 'GET', headers, signal: controller.signal })
    if (res.status === 404) {
      return { memories: [], error: `subject "${subjectId}" not found upstream` }
    }
    if (!res.ok) return { memories: [], error: `HTTP ${res.status}` }
    const data = (await res.json()) as MemoryListResponseShape
    return { memories: data.memories ?? [], error: null }
  } catch (e) {
    return { memories: [], error: e instanceof Error ? e.message : 'unreachable' }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Build the grounding text the LLM sees from the raw memories. Each
 * memory contributes one bullet: prefer summary (shorter, denser);
 * fall back to content. The whole thing is then run through the secret
 * redactor and capped at GROUNDING_MAX_BYTES.
 */
function buildGroundingFromMemories(memories: MemoryRow[]): {
  redacted: string
  truncated: boolean
} {
  const lines: string[] = []
  for (const m of memories) {
    const text = (m.summary && m.summary.trim()) || (m.content && m.content.trim())
    if (!text) continue
    lines.push(`- ${text}`)
  }
  const joined = lines.join('\n')
  const redactedFull = redactString(joined)
  const capped = redactedFull.slice(0, GROUNDING_MAX_BYTES)
  return { redacted: capped, truncated: capped.length < redactedFull.length }
}

function parseSuggestion(raw: string): { topic: string; grounding: string } | null {
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/i, '')
    .trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(stripped)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const obj = parsed as { topic?: unknown; grounding?: unknown }
  const topic = typeof obj.topic === 'string' ? obj.topic.trim() : ''
  const grounding = typeof obj.grounding === 'string' ? obj.grounding.trim() : ''
  if (!topic || !grounding || grounding.length < 20) return null
  return { topic, grounding }
}

export interface SuggestInjections {
  /** Upstream fetch for the memory-list call (tests inject a mock). */
  upstreamFetch?: UpstreamFetch
  /** Fetch for the LLM call (tests inject a mock). */
  llmFetch?: JudgeFetch
  timeoutMs?: number
}

/**
 * End-to-end grounding suggestion. Throws GroundingSuggestionError on
 * any failure — the handler maps to a structured HTTP response.
 */
export async function suggestGrounding(
  cfg: EvalConfig,
  input: GroundingSuggestionInput,
  injections: SuggestInjections = {},
): Promise<GroundingSuggestionResult> {
  if (!cfg.llm.provider || !cfg.llm.model || !cfg.llm.apiKey) {
    throw new GroundingSuggestionError('LLM judge is not configured.', 503)
  }
  const subjectId = (input.subject_id ?? '').trim()
  if (!subjectId) throw new GroundingSuggestionError('subject_id is required', 400)
  const maxMemories = Math.max(1, Math.min(input.max_memories ?? 50, 200))
  const upstreamFetch =
    injections.upstreamFetch ?? ((url, init) => fetch(url, init))
  const llmFetch = injections.llmFetch ?? ((url, init) => fetch(url, init))
  const timeoutMs = injections.timeoutMs ?? 60_000

  const upstream = await fetchSubjectMemoriesFromUpstream(
    cfg,
    subjectId,
    maxMemories,
    upstreamFetch,
    timeoutMs,
  )
  if (upstream.error) {
    const status = /not found/i.test(upstream.error) ? 404 : 502
    throw new GroundingSuggestionError(upstream.error, status)
  }
  if (upstream.memories.length === 0) {
    throw new GroundingSuggestionError(
      `Subject "${subjectId}" has no active compiled memories — generate them first or pick a populated subject.`,
      422,
    )
  }
  const sampledIds = upstream.memories
    .map((m) => m.id ?? '')
    .filter(Boolean)
    .slice(0, 20)
  const { redacted, truncated } = buildGroundingFromMemories(upstream.memories)
  if (redacted.trim().length < 40) {
    throw new GroundingSuggestionError(
      'Compiled memories were empty or too thin to ground a question bank.',
      422,
    )
  }

  const userPrompt = [
    `subject_id: ${subjectId}`,
    `memory_count: ${upstream.memories.length}`,
    ``,
    `compiled memories (one per bullet, secrets redacted, joined and capped at ${GROUNDING_MAX_BYTES} bytes):`,
    `"""`,
    redacted,
    `"""`,
    ``,
    `Produce: {"topic": "...", "grounding": "..."}`,
  ].join('\n')

  const llm = await callLLM(cfg, SYSTEM_PROMPT, userPrompt, llmFetch, timeoutMs)
  if (llm.error) {
    throw new GroundingSuggestionError(`LLM call failed: ${llm.error}`, 502)
  }
  if (!llm.text) {
    throw new GroundingSuggestionError('LLM returned an empty response', 502)
  }
  const parsed = parseSuggestion(llm.text)
  if (!parsed) {
    throw new GroundingSuggestionError('LLM returned malformed suggestion JSON', 502)
  }

  return {
    topic: parsed.topic,
    grounding: parsed.grounding,
    source: {
      subject_id: subjectId,
      memory_count: upstream.memories.length,
      sampled_memory_ids: sampledIds,
      grounding_truncated: truncated,
    },
  }
}
