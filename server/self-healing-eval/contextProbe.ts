/**
 * Statewave context probe — grounds the LLM judge in actual retrieval.
 *
 * For every docs-grounded eval turn the runner asks Statewave's
 * /v1/context endpoint for what the agent COULD have retrieved against
 * the docs subject. We feed that result into the judge prompt so the
 * classifier can tell apart:
 *
 *   - missing-docs                 (probe returned nothing relevant)
 *   - retrieval-miss               (probe returned items, none with the
 *                                   expected fact)
 *   - retrieved-context-ignored    (probe returned the expected fact;
 *                                   agent answered without using it)
 *   - eval-judge-context-blindness (probe failed to run; classification
 *                                   not trustworthy for this turn)
 *
 * The probe is best-effort. A failed probe degrades the turn's
 * `retrieved_context.status` to `fail` and records the error — it never
 * fails the whole eval run, because diagnosis without the probe is
 * still strictly better than the previous baseline.
 *
 * All retrieved text is run through the secret redactor and per-item
 * capped before being stored on the report.
 */
import type { EvalConfig } from './config.js'
import { redactString } from './redact.js'
import type {
  RetrievedContextItem,
  RetrievedContextResult,
} from './types.js'

/** Pluggable upstream fetch — same shape as the smoke check / suggester use. */
export type ProbeFetch = (url: string, init: RequestInit) => Promise<Response>

/** Per-item character cap to keep stored reports + judge prompts small. */
export const PROBE_TEXT_CAP_PER_ITEM = 1_000
/** Hard ceiling on items kept after capping — top N by score/order. */
export const PROBE_MAX_ITEMS = 5

interface UpstreamMemory {
  id?: string
  content?: string
  summary?: string
  metadata?: Record<string, unknown>
  score?: number
}

interface UpstreamEpisode {
  id?: string
  payload?: Record<string, unknown>
  metadata?: Record<string, unknown>
  source?: string
  type?: string
}

interface UpstreamContextResponse {
  subject_id?: string
  task?: string
  facts?: UpstreamMemory[]
  procedures?: UpstreamMemory[]
  episodes?: UpstreamEpisode[]
  assembled_context?: string
  token_estimate?: number
}

export interface ProbeInput {
  subject_id: string
  query: string
  /** Soft cap on items the upstream call should target. Some shapes
   *  ignore it; we always re-cap client-side to PROBE_MAX_ITEMS. */
  max_tokens?: number
}

export interface ProbeOptions {
  fetchImpl?: ProbeFetch
  timeoutMs?: number
}

/**
 * Pull the most useful display text out of a memory or episode row.
 * Memories: prefer summary then content. Episodes: payload.text >
 * payload.message > stringified payload (short).
 */
function memoryText(m: UpstreamMemory): string {
  const s = (m.summary && m.summary.trim()) || ''
  if (s) return s
  return (m.content && m.content.trim()) || ''
}

function episodeText(e: UpstreamEpisode): string {
  const p = e.payload ?? {}
  const text =
    (typeof p.text === 'string' && p.text) ||
    (typeof p.message === 'string' && p.message) ||
    (typeof p.content === 'string' && p.content) ||
    ''
  if (text) return text
  // Fall back to a compact JSON rendering if no obvious text field.
  try {
    return JSON.stringify(p).slice(0, PROBE_TEXT_CAP_PER_ITEM)
  } catch {
    return ''
  }
}

function pickSourcePath(metadata: Record<string, unknown> | undefined): string | undefined {
  if (!metadata) return undefined
  for (const key of [
    'source_path',
    'source',
    'path',
    'doc_path',
    'docs_path',
    'file',
  ]) {
    const v = metadata[key]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return undefined
}

function clipText(s: string): string {
  const redacted = redactString(s)
  if (redacted.length <= PROBE_TEXT_CAP_PER_ITEM) return redacted
  return redacted.slice(0, PROBE_TEXT_CAP_PER_ITEM)
}

/**
 * Normalize the upstream `/v1/context` response into a flat, capped,
 * redacted list the runner can attach to a turn and the judge can read.
 */
export function normalizeContextResponse(
  data: UpstreamContextResponse,
): RetrievedContextItem[] {
  const out: RetrievedContextItem[] = []
  for (const f of data.facts ?? []) {
    const text = memoryText(f)
    if (!text) continue
    out.push({
      text: clipText(text),
      score: typeof f.score === 'number' ? f.score : undefined,
      source_path: pickSourcePath(f.metadata),
      memory_id: f.id,
      kind: 'fact',
      metadata: f.metadata,
    })
  }
  for (const p of data.procedures ?? []) {
    const text = memoryText(p)
    if (!text) continue
    out.push({
      text: clipText(text),
      score: typeof p.score === 'number' ? p.score : undefined,
      source_path: pickSourcePath(p.metadata),
      memory_id: p.id,
      kind: 'procedure',
      metadata: p.metadata,
    })
  }
  for (const e of data.episodes ?? []) {
    const text = episodeText(e)
    if (!text) continue
    out.push({
      text: clipText(text),
      source_path: pickSourcePath(e.metadata),
      episode_id: e.id,
      kind: 'episode',
      metadata: e.metadata,
    })
  }
  return out.slice(0, PROBE_MAX_ITEMS)
}

/**
 * Probe Statewave's /v1/context for a single eval question. Returns a
 * structured result the judge can read — never throws on transport
 * errors; failures are surfaced via status='fail'.
 */
export async function probeContextForQuestion(
  cfg: EvalConfig,
  input: ProbeInput,
  opts: ProbeOptions = {},
): Promise<RetrievedContextResult> {
  if (!cfg.statewaveApiUrl) {
    return {
      status: 'not_configured',
      subject_id: input.subject_id,
      query: input.query,
      results: [],
      error: 'STATEWAVE_API_URL not set',
    }
  }
  const fetchImpl: ProbeFetch =
    opts.fetchImpl ?? ((url, init) => fetch(url, init))
  const timeoutMs = opts.timeoutMs ?? 20_000
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  if (cfg.statewaveApiKey) headers['X-API-Key'] = cfg.statewaveApiKey
  const url = `${cfg.statewaveApiUrl.replace(/\/+$/, '')}/v1/context`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        subject_id: input.subject_id,
        task: input.query,
        max_tokens: input.max_tokens ?? 2_000,
      }),
      signal: controller.signal,
    })
    if (!res.ok) {
      return {
        status: 'fail',
        subject_id: input.subject_id,
        query: input.query,
        results: [],
        error: `HTTP ${res.status}`,
      }
    }
    const data = (await res.json()) as UpstreamContextResponse
    const items = normalizeContextResponse(data)
    const noRelevant = items.length === 0
    return {
      status: 'pass',
      subject_id: input.subject_id,
      query: input.query,
      results: items,
      no_relevant_results: noRelevant,
    }
  } catch (e) {
    return {
      status: 'fail',
      subject_id: input.subject_id,
      query: input.query,
      results: [],
      error: e instanceof Error ? e.message : 'unreachable',
    }
  } finally {
    clearTimeout(timer)
  }
}
