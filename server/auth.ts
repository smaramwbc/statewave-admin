/**
 * Server-side auth utilities for statewave-admin.
 *
 * Runs in the Vercel Node serverless runtime AND in the Vite dev middleware.
 * Never imported from the client bundle — uses node:crypto and reads server-only
 * environment variables (ADMIN_PASSWORD, ADMIN_SESSION_SECRET, etc.).
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

export const COOKIE_NAME = 'sw_admin_session'

export interface AuthConfig {
  password: string | null
  sessionSecret: string | null
  authDisabled: boolean
  sessionTtlHours: number
  trustGatewayHeaders: boolean
  allowedEmails: Set<string>
  isProduction: boolean
}

export interface RequestLike {
  headers: Record<string, string | string[] | undefined>
}

export interface AuthCheckResult {
  ok: boolean
  status: number
  source: 'session' | 'gateway' | 'disabled' | 'none'
  reason?: 'no_session' | 'misconfigured' | 'invalid_session' | 'gateway_not_allowed'
  email?: string
}

export function getAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const isProduction =
    env.NODE_ENV === 'production' || env.VERCEL_ENV === 'production'
  const ttl = Number.parseInt(env.ADMIN_SESSION_TTL_HOURS ?? '12', 10)
  const allowed = (env.ADMIN_ALLOWED_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  return {
    password: env.ADMIN_PASSWORD ? env.ADMIN_PASSWORD : null,
    sessionSecret: env.ADMIN_SESSION_SECRET ? env.ADMIN_SESSION_SECRET : null,
    authDisabled: env.ADMIN_AUTH_DISABLED === 'true',
    sessionTtlHours: Number.isFinite(ttl) && ttl > 0 ? ttl : 12,
    trustGatewayHeaders: env.ADMIN_TRUST_GATEWAY_HEADERS === 'true',
    allowedEmails: new Set(allowed),
    isProduction,
  }
}

/**
 * Returns a configuration error string when the deployment cannot safely serve
 * the admin UI, otherwise null. ADMIN_AUTH_DISABLED=true short-circuits this
 * check (intended for local/dev/testing only).
 */
export function authConfigError(cfg: AuthConfig): string | null {
  if (cfg.authDisabled) return null
  if (!cfg.isProduction) {
    if (!cfg.password || !cfg.sessionSecret) {
      return 'ADMIN_PASSWORD and ADMIN_SESSION_SECRET are required (or set ADMIN_AUTH_DISABLED=true for local dev).'
    }
    return null
  }
  if (!cfg.password) {
    return 'Admin is not configured. Set ADMIN_PASSWORD and ADMIN_SESSION_SECRET.'
  }
  if (!cfg.sessionSecret) {
    return 'Admin is not configured. Set ADMIN_PASSWORD and ADMIN_SESSION_SECRET.'
  }
  return null
}

function b64urlEncode(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function b64urlDecode(s: string): Buffer {
  let out = s.replace(/-/g, '+').replace(/_/g, '/')
  while (out.length % 4) out += '='
  return Buffer.from(out, 'base64')
}

export interface SessionPayload {
  exp: number
  v: number
}

export function signSession(payload: SessionPayload, secret: string): string {
  const body = b64urlEncode(Buffer.from(JSON.stringify(payload), 'utf8'))
  const sig = createHmac('sha256', secret).update(body).digest()
  return `${body}.${b64urlEncode(sig)}`
}

export function verifySession(
  token: string | null | undefined,
  secret: string,
): SessionPayload | null {
  if (!token) return null
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [body, sig] = parts
  const expectedSig = createHmac('sha256', secret).update(body).digest()
  let providedSig: Buffer
  try {
    providedSig = b64urlDecode(sig)
  } catch {
    return null
  }
  if (expectedSig.length !== providedSig.length) return null
  if (!timingSafeEqual(expectedSig, providedSig)) return null
  let payload: unknown
  try {
    payload = JSON.parse(b64urlDecode(body).toString('utf8'))
  } catch {
    return null
  }
  if (
    !payload ||
    typeof payload !== 'object' ||
    typeof (payload as SessionPayload).exp !== 'number'
  ) {
    return null
  }
  const sp = payload as SessionPayload
  if (Math.floor(Date.now() / 1000) > sp.exp) return null
  return sp
}

/**
 * Constant-time password comparison. Always runs the comparison even on length
 * mismatch so attackers cannot probe length via timing.
 */
export function comparePassword(provided: string, expected: string): boolean {
  const a = Buffer.from(provided ?? '', 'utf8')
  const b = Buffer.from(expected ?? '', 'utf8')
  if (a.length !== b.length) {
    timingSafeEqual(a, a)
    return false
  }
  return timingSafeEqual(a, b)
}

export function makeSessionCookie(
  value: string,
  cfg: AuthConfig,
  expires: Date,
): string {
  const parts = [
    `${COOKIE_NAME}=${value}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    `Expires=${expires.toUTCString()}`,
  ]
  if (cfg.isProduction) parts.push('Secure')
  return parts.join('; ')
}

export function makeClearCookie(cfg: AuthConfig): string {
  const parts = [
    `${COOKIE_NAME}=`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    'Max-Age=0',
  ]
  if (cfg.isProduction) parts.push('Secure')
  return parts.join('; ')
}

export function readCookie(
  req: RequestLike,
  name: string,
): string | null {
  const header = pickHeader(req, 'cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    const k = part.slice(0, eq).trim()
    const v = part.slice(eq + 1).trim()
    if (k === name) return v
  }
  return null
}

function pickHeader(req: RequestLike, name: string): string | null {
  const v = req.headers[name.toLowerCase()]
  if (Array.isArray(v)) return v[0] ?? null
  return v ?? null
}

const GATEWAY_HEADERS = [
  'cf-access-authenticated-user-email',
  'x-forwarded-user',
  'x-admin-email',
] as const

/**
 * Authoritative per-request auth check. Used by the proxy and any other
 * privileged endpoint. Returns ok=true with a session OR a trusted gateway
 * identity. ADMIN_AUTH_DISABLED short-circuits (dev only — never in prod).
 */
export function checkRequestAuth(
  req: RequestLike,
  cfg: AuthConfig,
): AuthCheckResult {
  if (cfg.authDisabled) {
    return { ok: true, status: 200, source: 'disabled' }
  }
  if (authConfigError(cfg)) {
    return {
      ok: false,
      status: 503,
      source: 'none',
      reason: 'misconfigured',
    }
  }

  if (cfg.sessionSecret) {
    const cookie = readCookie(req, COOKIE_NAME)
    if (cookie) {
      const payload = verifySession(cookie, cfg.sessionSecret)
      if (payload) {
        return { ok: true, status: 200, source: 'session' }
      }
    }
  }

  if (cfg.trustGatewayHeaders) {
    for (const h of GATEWAY_HEADERS) {
      const raw = pickHeader(req, h)
      if (!raw) continue
      const email = raw.trim().toLowerCase()
      if (cfg.allowedEmails.size > 0 && !cfg.allowedEmails.has(email)) {
        return {
          ok: false,
          status: 403,
          source: 'gateway',
          reason: 'gateway_not_allowed',
        }
      }
      return { ok: true, status: 200, source: 'gateway', email }
    }
  }

  return { ok: false, status: 401, source: 'none', reason: 'no_session' }
}

// ─── Handler-shaped helpers ─────────────────────────────────────────────────
//
// These return a serializable shape so they can be reused from a Vercel
// handler OR a Vite dev middleware without coupling to either runtime.

export interface HandlerResult {
  status: number
  body: Record<string, unknown>
  setCookie?: string
}

export function loginResult(
  password: unknown,
  cfg: AuthConfig,
): HandlerResult {
  if (cfg.authDisabled) {
    return { status: 200, body: { ok: true, authDisabled: true } }
  }
  const cfgErr = authConfigError(cfg)
  if (cfgErr) {
    return { status: 503, body: { error: 'auth_not_configured' } }
  }
  if (!cfg.password || !cfg.sessionSecret) {
    return { status: 503, body: { error: 'auth_not_configured' } }
  }
  const provided = typeof password === 'string' ? password : ''
  if (!provided || !comparePassword(provided, cfg.password)) {
    return { status: 401, body: { error: 'invalid_credentials' } }
  }
  const expSeconds = Math.floor(Date.now() / 1000) + cfg.sessionTtlHours * 3600
  const token = signSession({ exp: expSeconds, v: 1 }, cfg.sessionSecret)
  const expires = new Date(expSeconds * 1000)
  return {
    status: 200,
    body: { ok: true },
    setCookie: makeSessionCookie(token, cfg, expires),
  }
}

export function logoutResult(cfg: AuthConfig): HandlerResult {
  return {
    status: 200,
    body: { ok: true },
    setCookie: makeClearCookie(cfg),
  }
}

export function sessionResult(
  req: RequestLike,
  cfg: AuthConfig,
): HandlerResult {
  const configError = authConfigError(cfg)
  const auth = checkRequestAuth(req, cfg)
  return {
    status: 200,
    body: {
      authenticated: auth.ok,
      authDisabled: cfg.authDisabled,
      configError,
      source: auth.source,
    },
  }
}
