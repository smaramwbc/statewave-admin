/**
 * Server-side auth + proxy tests.
 *
 * Tests cover the acceptance criteria from the secure-by-default spec:
 *   - missing ADMIN_PASSWORD in production blocks access
 *   - missing ADMIN_SESSION_SECRET in production blocks access
 *   - successful login sets HttpOnly cookie
 *   - wrong password returns 401
 *   - logout clears cookie
 *   - /api/proxy rejects unauthenticated requests
 *   - /api/proxy accepts valid session cookie
 *   - gateway header is ignored unless ADMIN_TRUST_GATEWAY_HEADERS=true
 *   - gateway email allowlist works
 *   - ADMIN_AUTH_DISABLED=true bypasses auth only when explicitly set
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  getAuthConfig,
  authConfigError,
  loginResult,
  logoutResult,
  sessionResult,
  checkRequestAuth,
  signSession,
  COOKIE_NAME,
} from '../server/auth'
import {
  isAllowedAdminPath,
  proxyAdminRequest,
  getProxyConfig,
} from '../server/proxy'

const PROD = { NODE_ENV: 'production' } as const
const DEV = { NODE_ENV: 'development' } as const

function envWith(extra: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return { ...DEV, ...extra } as NodeJS.ProcessEnv
}

function prodEnv(extra: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return { ...PROD, ...extra } as NodeJS.ProcessEnv
}

describe('authConfigError', () => {
  it('blocks production deploys with missing ADMIN_PASSWORD', () => {
    const cfg = getAuthConfig(prodEnv({ ADMIN_SESSION_SECRET: 'x'.repeat(32) }))
    expect(authConfigError(cfg)).toMatch(/ADMIN_PASSWORD/)
  })

  it('blocks production deploys with missing ADMIN_SESSION_SECRET', () => {
    const cfg = getAuthConfig(prodEnv({ ADMIN_PASSWORD: 'pw' }))
    expect(authConfigError(cfg)).toMatch(/ADMIN_SESSION_SECRET/)
  })

  it('passes in production when both vars are set', () => {
    const cfg = getAuthConfig(
      prodEnv({ ADMIN_PASSWORD: 'pw', ADMIN_SESSION_SECRET: 's'.repeat(32) }),
    )
    expect(authConfigError(cfg)).toBeNull()
  })

  it('ADMIN_AUTH_DISABLED=true short-circuits the production check', () => {
    const cfg = getAuthConfig(prodEnv({ ADMIN_AUTH_DISABLED: 'true' }))
    expect(authConfigError(cfg)).toBeNull()
    expect(cfg.authDisabled).toBe(true)
  })

  it('only "true" disables auth — not "1", not "yes", not " true "', () => {
    for (const v of ['1', 'yes', 'TRUE', ' true ', '']) {
      const cfg = getAuthConfig(prodEnv({ ADMIN_AUTH_DISABLED: v }))
      expect(cfg.authDisabled).toBe(false)
    }
  })
})

describe('loginResult', () => {
  it('rejects when production is misconfigured', () => {
    const cfg = getAuthConfig(prodEnv({}))
    const r = loginResult('whatever', cfg)
    expect(r.status).toBe(503)
    expect(r.body).toEqual({ error: 'auth_not_configured' })
    expect(r.setCookie).toBeUndefined()
  })

  it('returns ok+authDisabled when ADMIN_AUTH_DISABLED=true', () => {
    const cfg = getAuthConfig(envWith({ ADMIN_AUTH_DISABLED: 'true' }))
    const r = loginResult('anything', cfg)
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ ok: true, authDisabled: true })
    expect(r.setCookie).toBeUndefined()
  })

  it('rejects wrong password with 401 and a generic error', () => {
    const cfg = getAuthConfig(
      prodEnv({ ADMIN_PASSWORD: 'right', ADMIN_SESSION_SECRET: 's'.repeat(32) }),
    )
    const r = loginResult('wrong', cfg)
    expect(r.status).toBe(401)
    expect(r.body).toEqual({ error: 'invalid_credentials' })
    expect(r.setCookie).toBeUndefined()
  })

  it('rejects empty password', () => {
    const cfg = getAuthConfig(
      prodEnv({ ADMIN_PASSWORD: 'right', ADMIN_SESSION_SECRET: 's'.repeat(32) }),
    )
    const r = loginResult('', cfg)
    expect(r.status).toBe(401)
  })

  it('rejects non-string password', () => {
    const cfg = getAuthConfig(
      prodEnv({ ADMIN_PASSWORD: 'right', ADMIN_SESSION_SECRET: 's'.repeat(32) }),
    )
    const r = loginResult(undefined, cfg)
    expect(r.status).toBe(401)
  })

  it('on success sets a HttpOnly Secure SameSite=Lax cookie in production', () => {
    const cfg = getAuthConfig(
      prodEnv({ ADMIN_PASSWORD: 'right', ADMIN_SESSION_SECRET: 's'.repeat(32) }),
    )
    const r = loginResult('right', cfg)
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ ok: true })
    expect(r.setCookie).toBeDefined()
    expect(r.setCookie).toContain(`${COOKIE_NAME}=`)
    expect(r.setCookie).toContain('HttpOnly')
    expect(r.setCookie).toContain('Secure')
    expect(r.setCookie).toContain('SameSite=Lax')
    expect(r.setCookie).toContain('Path=/')
  })

  it('cookie omits Secure outside production (so dev over http still works)', () => {
    const cfg = getAuthConfig(
      envWith({ ADMIN_PASSWORD: 'right', ADMIN_SESSION_SECRET: 's'.repeat(32) }),
    )
    const r = loginResult('right', cfg)
    expect(r.setCookie).toBeDefined()
    expect(r.setCookie).not.toContain('Secure')
  })
})

describe('logoutResult', () => {
  it('always returns ok and a Max-Age=0 clear cookie', () => {
    const cfg = getAuthConfig(envWith({}))
    const r = logoutResult(cfg)
    expect(r.status).toBe(200)
    expect(r.setCookie).toContain(`${COOKIE_NAME}=`)
    expect(r.setCookie).toContain('Max-Age=0')
    expect(r.setCookie).toContain('HttpOnly')
  })
})

describe('sessionResult', () => {
  it('reports authenticated=false when no cookie is present', () => {
    const cfg = getAuthConfig(
      envWith({ ADMIN_PASSWORD: 'pw', ADMIN_SESSION_SECRET: 's'.repeat(32) }),
    )
    const r = sessionResult({ headers: {} }, cfg)
    expect(r.body).toMatchObject({ authenticated: false, authDisabled: false })
  })

  it('reports authenticated=true with a valid cookie', () => {
    const secret = 's'.repeat(32)
    const cfg = getAuthConfig(
      envWith({ ADMIN_PASSWORD: 'pw', ADMIN_SESSION_SECRET: secret }),
    )
    const token = signSession(
      { exp: Math.floor(Date.now() / 1000) + 3600, v: 1 },
      secret,
    )
    const r = sessionResult({ headers: { cookie: `${COOKIE_NAME}=${token}` } }, cfg)
    expect(r.body).toMatchObject({ authenticated: true, source: 'session' })
  })

  it('reports configError in production when secrets are missing', () => {
    const cfg = getAuthConfig(prodEnv({}))
    const r = sessionResult({ headers: {} }, cfg)
    expect(r.body.configError).toMatch(/Admin is not configured/)
    expect(r.body.authenticated).toBe(false)
  })

  it('reports authDisabled=true when ADMIN_AUTH_DISABLED=true', () => {
    const cfg = getAuthConfig(envWith({ ADMIN_AUTH_DISABLED: 'true' }))
    const r = sessionResult({ headers: {} }, cfg)
    expect(r.body).toMatchObject({
      authenticated: true,
      authDisabled: true,
      source: 'disabled',
    })
  })

  it('never returns secrets in the body', () => {
    const cfg = getAuthConfig(
      prodEnv({ ADMIN_PASSWORD: 'super-secret', ADMIN_SESSION_SECRET: 's'.repeat(32) }),
    )
    const r = sessionResult({ headers: {} }, cfg)
    const json = JSON.stringify(r.body)
    expect(json).not.toContain('super-secret')
    expect(json).not.toContain('ssssssss')
  })
})

describe('checkRequestAuth — gateway header behavior', () => {
  const baseEnv = {
    ADMIN_PASSWORD: 'pw',
    ADMIN_SESSION_SECRET: 's'.repeat(32),
  } as const

  it('ignores gateway headers unless ADMIN_TRUST_GATEWAY_HEADERS=true', () => {
    const cfg = getAuthConfig(envWith({ ...baseEnv }))
    const r = checkRequestAuth(
      {
        headers: { 'cf-access-authenticated-user-email': 'alice@example.com' },
      },
      cfg,
    )
    expect(r.ok).toBe(false)
    expect(r.status).toBe(401)
  })

  it('accepts Cf-Access-Authenticated-User-Email when trust is enabled', () => {
    const cfg = getAuthConfig(
      envWith({ ...baseEnv, ADMIN_TRUST_GATEWAY_HEADERS: 'true' }),
    )
    const r = checkRequestAuth(
      {
        headers: { 'cf-access-authenticated-user-email': 'alice@example.com' },
      },
      cfg,
    )
    expect(r.ok).toBe(true)
    expect(r.source).toBe('gateway')
    expect(r.email).toBe('alice@example.com')
  })

  it('accepts X-Forwarded-User and X-Admin-Email too', () => {
    const cfg = getAuthConfig(
      envWith({ ...baseEnv, ADMIN_TRUST_GATEWAY_HEADERS: 'true' }),
    )
    expect(
      checkRequestAuth({ headers: { 'x-forwarded-user': 'b@x.com' } }, cfg).ok,
    ).toBe(true)
    expect(
      checkRequestAuth({ headers: { 'x-admin-email': 'c@x.com' } }, cfg).ok,
    ).toBe(true)
  })

  it('rejects with 403 when the email is not on the allowlist', () => {
    const cfg = getAuthConfig(
      envWith({
        ...baseEnv,
        ADMIN_TRUST_GATEWAY_HEADERS: 'true',
        ADMIN_ALLOWED_EMAILS: 'alice@example.com,bob@example.com',
      }),
    )
    const r = checkRequestAuth(
      { headers: { 'x-forwarded-user': 'eve@example.com' } },
      cfg,
    )
    expect(r.ok).toBe(false)
    expect(r.status).toBe(403)
  })

  it('accepts when the email is on the allowlist (case-insensitive)', () => {
    const cfg = getAuthConfig(
      envWith({
        ...baseEnv,
        ADMIN_TRUST_GATEWAY_HEADERS: 'true',
        ADMIN_ALLOWED_EMAILS: 'alice@example.com',
      }),
    )
    const r = checkRequestAuth(
      { headers: { 'x-forwarded-user': 'ALICE@EXAMPLE.COM' } },
      cfg,
    )
    expect(r.ok).toBe(true)
  })

  it('ADMIN_AUTH_DISABLED bypasses every check', () => {
    const cfg = getAuthConfig(envWith({ ADMIN_AUTH_DISABLED: 'true' }))
    const r = checkRequestAuth({ headers: {} }, cfg)
    expect(r.ok).toBe(true)
    expect(r.source).toBe('disabled')
  })

  it('blocks when production is misconfigured (no auth disabled fallback)', () => {
    const cfg = getAuthConfig(prodEnv({}))
    const r = checkRequestAuth({ headers: {} }, cfg)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('misconfigured')
  })
})

describe('signSession + checkRequestAuth round-trip', () => {
  const secret = 'a'.repeat(32)

  it('accepts a freshly-signed cookie', () => {
    const cfg = getAuthConfig(
      envWith({ ADMIN_PASSWORD: 'pw', ADMIN_SESSION_SECRET: secret }),
    )
    const token = signSession(
      { exp: Math.floor(Date.now() / 1000) + 3600, v: 1 },
      secret,
    )
    const r = checkRequestAuth(
      { headers: { cookie: `${COOKIE_NAME}=${token}` } },
      cfg,
    )
    expect(r.ok).toBe(true)
    expect(r.source).toBe('session')
  })

  it('rejects an expired cookie', () => {
    const cfg = getAuthConfig(
      envWith({ ADMIN_PASSWORD: 'pw', ADMIN_SESSION_SECRET: secret }),
    )
    const token = signSession(
      { exp: Math.floor(Date.now() / 1000) - 1, v: 1 },
      secret,
    )
    const r = checkRequestAuth(
      { headers: { cookie: `${COOKIE_NAME}=${token}` } },
      cfg,
    )
    expect(r.ok).toBe(false)
  })

  it('rejects a cookie signed with a different secret', () => {
    const cfg = getAuthConfig(
      envWith({ ADMIN_PASSWORD: 'pw', ADMIN_SESSION_SECRET: secret }),
    )
    const token = signSession(
      { exp: Math.floor(Date.now() / 1000) + 3600, v: 1 },
      'b'.repeat(32),
    )
    const r = checkRequestAuth(
      { headers: { cookie: `${COOKIE_NAME}=${token}` } },
      cfg,
    )
    expect(r.ok).toBe(false)
  })

  it('rejects a malformed cookie', () => {
    const cfg = getAuthConfig(
      envWith({ ADMIN_PASSWORD: 'pw', ADMIN_SESSION_SECRET: secret }),
    )
    for (const t of ['', 'nope', 'a.b', 'aaa.bbb', '....']) {
      const r = checkRequestAuth(
        { headers: { cookie: `${COOKIE_NAME}=${t}` } },
        cfg,
      )
      expect(r.ok).toBe(false)
    }
  })
})

describe('proxy.isAllowedAdminPath', () => {
  it('only allows /admin paths', () => {
    expect(isAllowedAdminPath('/admin')).toBe(true)
    expect(isAllowedAdminPath('/admin/dashboard')).toBe(true)
    expect(isAllowedAdminPath('/admin/subjects?limit=10')).toBe(true)
    expect(isAllowedAdminPath('/api/keys')).toBe(false)
    expect(isAllowedAdminPath('/admin../etc')).toBe(false)
    expect(isAllowedAdminPath('')).toBe(false)
    expect(isAllowedAdminPath('/')).toBe(false)
  })
})

describe('proxyAdminRequest', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 500 when STATEWAVE_API_URL is not set', async () => {
    const r = await proxyAdminRequest(
      { method: 'GET', path: '/admin/dashboard', body: null },
      { apiUrl: null, apiKey: null },
    )
    expect(r.status).toBe(500)
    expect(r.body).toContain('upstream_not_configured')
  })

  it('rejects non-admin paths', async () => {
    const r = await proxyAdminRequest(
      { method: 'GET', path: '/users/secrets', body: null },
      { apiUrl: 'https://upstream', apiKey: null },
    )
    expect(r.status).toBe(400)
  })

  it('forwards X-API-Key when configured', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{"ok":true}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const r = await proxyAdminRequest(
      { method: 'GET', path: '/admin/dashboard', body: null },
      { apiUrl: 'https://upstream', apiKey: 'secret-api-key' },
    )
    expect(r.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledOnce()
    const init = fetchSpy.mock.calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>)['X-API-Key']).toBe(
      'secret-api-key',
    )
  })

  it('returns 502 (no upstream details) when fetch throws', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('connection refused'))
    const r = await proxyAdminRequest(
      { method: 'GET', path: '/admin/dashboard', body: null },
      { apiUrl: 'https://upstream', apiKey: null },
    )
    expect(r.status).toBe(502)
    expect(r.body).toBe(JSON.stringify({ error: 'upstream_unreachable' }))
    expect(r.body).not.toContain('connection refused')
  })

  it('does not echo upstream secrets back', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('upstream body', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      }),
    )
    const r = await proxyAdminRequest(
      { method: 'GET', path: '/admin/dashboard', body: null },
      { apiUrl: 'https://upstream', apiKey: 'should-not-leak' },
    )
    expect(r.body).toBe('upstream body')
    expect(r.body).not.toContain('should-not-leak')
  })
})

describe('getProxyConfig', () => {
  it('reads STATEWAVE_API_URL and STATEWAVE_API_KEY from env', () => {
    const cfg = getProxyConfig({
      STATEWAVE_API_URL: 'https://x',
      STATEWAVE_API_KEY: 'k',
    } as NodeJS.ProcessEnv)
    expect(cfg.apiUrl).toBe('https://x')
    expect(cfg.apiKey).toBe('k')
  })
})
