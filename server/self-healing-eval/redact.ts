/**
 * Secret redaction for stored reports + Copilot prompts.
 *
 * Run on every string that crosses the persistence or wire boundary.
 * Conservative — better to over-redact in a stored audit artifact than
 * leak an API key into a `.json` file or a clipboard prompt.
 */

const REDACTED = '[REDACTED]'

const KEY_PATTERNS: Array<{ name: string; re: RegExp }> = [
  // Authorization header values: `Authorization: Bearer abc...`
  { name: 'authorization', re: /(authorization\s*[:=]\s*['"]?(?:bearer\s+)?)[\w.+/=-]+/gi },
  // Generic Bearer tokens
  { name: 'bearer', re: /\bBearer\s+[A-Za-z0-9._+/=-]{12,}/g },
  // OpenAI/Anthropic-style keys
  { name: 'openai', re: /\bsk-[A-Za-z0-9_-]{20,}/g },
  { name: 'anthropic', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  // Generic api_key=... or "api_key": "..."
  { name: 'api_key', re: /(api[_-]?key\s*['"]?\s*[:=]\s*['"]?)[A-Za-z0-9._-]{12,}/gi },
  // x-api-key header value
  { name: 'x-api-key', re: /(x[-_]api[-_]key\s*[:=]\s*['"]?)[A-Za-z0-9._-]{12,}/gi },
  // postgres / mysql URLs with embedded credentials
  { name: 'db-url', re: /\b(postgres(?:ql)?|mysql|mongodb|redis):\/\/[^\s:@]+:[^\s:@]+@/gi },
  // webhook.site secret-style URLs we shouldn't be persisting raw with query strings
  { name: 'webhook-secret-qs', re: /(\?|&)([a-z_-]*(?:secret|token|key))=[^&\s]+/gi },
]

const REDACTED_HEADER_NAMES = new Set([
  'authorization',
  'x-api-key',
  'x-statewave-api-key',
  'cookie',
  'set-cookie',
])

export function redactString(input: string): string {
  let out = input
  for (const { re } of KEY_PATTERNS) {
    out = out.replace(re, (match, prefix?: string) => {
      // For prefixed patterns (api_key=, authorization:), keep the
      // identifier so the operator can see WHERE the secret was, just
      // not what it was.
      if (typeof prefix === 'string' && prefix.length > 0) {
        return `${prefix}${REDACTED}`
      }
      return match.replace(/[A-Za-z0-9._+/=-]{12,}/, REDACTED)
    })
  }
  return out
}

/** Redact a header bag in place (case-insensitive name match). */
export function redactHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string | string[] | undefined> {
  const out: Record<string, string | string[] | undefined> = {}
  for (const [k, v] of Object.entries(headers)) {
    if (REDACTED_HEADER_NAMES.has(k.toLowerCase())) {
      out[k] = REDACTED
      continue
    }
    if (typeof v === 'string') {
      out[k] = redactString(v)
    } else if (Array.isArray(v)) {
      out[k] = v.map((vv) => redactString(vv))
    } else {
      out[k] = v
    }
  }
  return out
}

/**
 * Deep-redact a JSON-serialisable value. Strings are run through the
 * pattern matcher; keys whose name suggests "secret" get their string
 * values replaced wholesale.
 */
const SECRET_KEY_HINTS = [
  'api_key',
  'apikey',
  'authorization',
  'auth_token',
  'bearer',
  'password',
  'secret',
  'token',
  'webhook_secret',
  'cookie',
]

export function redactValue<T>(value: T): T {
  if (value === null || value === undefined) return value
  if (typeof value === 'string') {
    return redactString(value) as T
  }
  if (Array.isArray(value)) {
    return value.map((v) => redactValue(v)) as unknown as T
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const lc = k.toLowerCase()
      if (SECRET_KEY_HINTS.some((hint) => lc.includes(hint))) {
        out[k] = typeof v === 'string' && v.length > 0 ? REDACTED : v
        continue
      }
      out[k] = redactValue(v)
    }
    return out as unknown as T
  }
  return value
}
