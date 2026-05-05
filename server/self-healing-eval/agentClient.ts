/**
 * Demo agent HTTP client.
 *
 * Calls a configured demo support agent at ADMIN_DEMO_AGENT_URL. The
 * agent is expected to use Statewave for memory and answer the user's
 * question — the admin just forwards messages and reads the reply.
 *
 * Two request body formats are supported, gated by
 * ADMIN_DEMO_AGENT_BODY_FORMAT:
 *
 *   "default"        (default — eval-native shape):
 *     POST <url>
 *       { subject_id, session_id, agent_id, messages: [{role,content},...] }
 *
 *   "statewave-web"  (matches the existing /api/widget-chat endpoint
 *                     in statewave-web — useful for local testing
 *                     without writing a separate demo agent):
 *     POST <url>
 *       { messages, mode: "statewave", persona: "<persona id>" }
 *     Defaults: persona = "statewave-support" (docs-grounded persona).
 *     subject_id is ignored — widget-chat derives it from a visitor
 *     cookie. Single conversation per admin browser session.
 *
 * Response parsing is lenient in either mode — accepts:
 *   { message } | { answer } | { text } | { reply } |
 *   { choices: [{ message: { content } }, ...] }   (OpenAI-compat)
 */
import type { EvalConfig } from './config.js'
import type { AgentBodyFormat } from './config.js'

export type AgentFetch = (url: string, init: RequestInit) => Promise<Response>

export interface AgentMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface AgentCallInput {
  subject_id: string
  session_id: string
  agent_id: string
  messages: AgentMessage[]
}

export interface AgentCallResult {
  ok: boolean
  answer: string
  status: number
  error: string | null
  /**
   * Whether the demo agent confirmed it applied an eval-only system
   * prompt override. The agent is expected to echo
   * `system_prompt_override_applied: true` in its JSON response when
   * it honored the override. Absence is treated as "sent_unconfirmed"
   * by the runner — we don't fail the run, we just record uncertainty.
   */
  override_confirmed: boolean
}

export interface AgentCallOptions {
  fetchImpl?: AgentFetch
  timeoutMs?: number
}

interface PossibleAgentResponse {
  message?: string
  answer?: string
  text?: string
  reply?: string
  choices?: Array<{ message?: { content?: string } }>
  /** Optional opt-in marker the demo agent can return to confirm it
   *  honored an eval-only system_prompt_override. Absence means
   *  unconfirmed, not failure. */
  system_prompt_override_applied?: boolean
}

function extractAnswer(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null
  const obj = data as PossibleAgentResponse
  if (typeof obj.message === 'string' && obj.message) return obj.message
  if (typeof obj.answer === 'string' && obj.answer) return obj.answer
  if (typeof obj.text === 'string' && obj.text) return obj.text
  if (typeof obj.reply === 'string' && obj.reply) return obj.reply
  const c = obj.choices?.[0]?.message?.content
  if (typeof c === 'string' && c) return c
  return null
}

/**
 * Build the request body in the format the configured demo agent expects.
 *
 * The `default` shape is the eval's native contract. The `statewave-web`
 * shape exists so the local statewave-web `/api/widget-chat` endpoint
 * can be used as the demo agent without any changes on the web side —
 * we just translate to its `{messages, mode, persona}` request body.
 *
 * Persona for the statewave-web shape defaults to `statewave-support`,
 * the docs-grounded persona id from statewave-web's
 * DOCS_SHARED_PERSONAS map.
 */
function buildRequestBody(
  input: AgentCallInput,
  format: AgentBodyFormat,
  persona: string,
  systemPromptOverride: string | undefined,
): Record<string, unknown> {
  // Eval-only override: forwarded to the agent in BOTH body shapes so
  // either contract can opt in. Demo agents that ignore the field
  // simply behave normally — see runner: delivery=sent_unconfirmed.
  const overrideField =
    typeof systemPromptOverride === 'string' && systemPromptOverride.length > 0
      ? { system_prompt_override: systemPromptOverride }
      : {}
  if (format === 'statewave-web') {
    return {
      messages: input.messages,
      mode: 'statewave',
      persona,
      ...overrideField,
    }
  }
  return {
    subject_id: input.subject_id,
    session_id: input.session_id,
    agent_id: input.agent_id,
    messages: input.messages,
    ...overrideField,
  }
}

export interface AgentCallExtras {
  /**
   * Per-call persona override for the `statewave-web` body format.
   * Used when the operator picks a subject in the diagnostics UI — the
   * eval should ask the demo agent to answer from THAT subject's
   * persona, not the env-configured default. Ignored for the
   * `default` body format (which already gets subject_id directly).
   */
  personaOverride?: string
  /**
   * Eval-only system prompt override forwarded to the demo agent in
   * the request body as `system_prompt_override`. Already redacted +
   * capped by the runner before reaching here. Demo agents that don't
   * honor the field still work — the eval falls back to delivery
   * status `sent_unconfirmed`.
   */
  systemPromptOverride?: string
}

export async function callDemoAgent(
  cfg: EvalConfig,
  input: AgentCallInput,
  opts: AgentCallOptions & AgentCallExtras = {},
): Promise<AgentCallResult> {
  if (!cfg.demoAgent.url) {
    return {
      ok: false,
      answer: '',
      status: 0,
      error: 'demo agent not configured',
      override_confirmed: false,
    }
  }
  const fetchImpl: AgentFetch = opts.fetchImpl ?? ((url, init) => fetch(url, init))
  const timeoutMs = opts.timeoutMs ?? 60_000
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  if (cfg.demoAgent.apiKey) {
    headers.Authorization = `Bearer ${cfg.demoAgent.apiKey}`
  }
  const body = buildRequestBody(
    input,
    cfg.demoAgent.bodyFormat,
    opts.personaOverride?.trim() || cfg.demoAgent.persona,
    opts.systemPromptOverride,
  )
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetchImpl(cfg.demoAgent.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const text = await res.text()
    if (!res.ok) {
      return {
        ok: false,
        answer: '',
        status: res.status,
        error: `HTTP ${res.status}: ${text.slice(0, 200)}`,
        override_confirmed: false,
      }
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      // Some demo agents reply with plain text — that's fine.
      return {
        ok: true,
        answer: text.trim(),
        status: res.status,
        error: null,
        override_confirmed: false,
      }
    }
    const answer = extractAnswer(parsed)
    if (answer === null) {
      return {
        ok: false,
        answer: '',
        status: res.status,
        error: 'agent response missing message/answer/text/reply/choices field',
        override_confirmed: false,
      }
    }
    const overrideConfirmed =
      typeof (parsed as PossibleAgentResponse).system_prompt_override_applied ===
        'boolean' &&
      !!(parsed as PossibleAgentResponse).system_prompt_override_applied
    return {
      ok: true,
      answer,
      status: res.status,
      error: null,
      override_confirmed: overrideConfirmed,
    }
  } catch (e) {
    return {
      ok: false,
      answer: '',
      status: 0,
      error: e instanceof Error ? e.message : 'unreachable',
      override_confirmed: false,
    }
  } finally {
    clearTimeout(timer)
  }
}
