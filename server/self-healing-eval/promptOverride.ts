/**
 * Eval-only agent system prompt override — sanitisation + metadata.
 *
 * Operators can paste a candidate system prompt into the diagnostics
 * card to test it without touching production agent code. We treat
 * that input the same way we treat any other operator-provided text:
 *
 *   1. Hard cap byte length so a runaway paste can't blow up the LLM
 *      request body or the stored report.
 *   2. Run through the secret redactor BEFORE forwarding to the demo
 *      agent — eval is for diagnostics, not for handing real
 *      credentials to a downstream service.
 *   3. Hash (SHA-256) the redacted text so the report can identify
 *      the same prompt across runs without storing its contents.
 *   4. Keep only a short redacted preview on the report. The full
 *      raw prompt is never persisted by default.
 */
import { createHash } from 'node:crypto'
import { redactString } from './redact.js'
import type { AgentPromptOverrideMetadata } from './types.js'

/** Hard cap on the override text we forward to the demo agent. */
export const PROMPT_OVERRIDE_MAX_BYTES = 8_000

/** Length of the redacted preview we keep on the stored report. */
const PREVIEW_CHARS = 300

export interface PreparedPromptOverride {
  /** Redacted + capped text actually sent to the demo agent. */
  text: string
  metadata: AgentPromptOverrideMetadata
}

/**
 * Produce the (text, metadata) pair the runner uses. Returns metadata
 * with delivery="not_used" when the operator didn't supply an
 * override; the agent client will skip the body field accordingly.
 */
export function preparePromptOverride(
  raw: string | undefined,
): PreparedPromptOverride {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return {
      text: '',
      metadata: {
        used: false,
        delivery: 'not_used',
        length: 0,
        hash: '',
        preview: '',
      },
    }
  }
  // Redact secrets BEFORE the wire crosses to the demo agent. We
  // never want to forward operator-pasted credentials downstream.
  const redacted = redactString(raw)
  const capped = redacted.slice(0, PROMPT_OVERRIDE_MAX_BYTES)
  const hash = createHash('sha256').update(capped).digest('hex')
  const preview = capped.slice(0, PREVIEW_CHARS)
  return {
    text: capped,
    metadata: {
      used: true,
      // Initial state — runner promotes this to confirmed/sent_unconfirmed
      // based on agent response.
      delivery: 'sent_unconfirmed',
      length: capped.length,
      hash,
      preview,
    },
  }
}
