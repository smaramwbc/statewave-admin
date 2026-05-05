/**
 * Auth gating + dispatch wiring for the smoke endpoints.
 *
 * The smoke flow writes to the connected backend (it ingests a demo
 * episode and triggers a compile), so the endpoints MUST sit behind the
 * same session/gateway auth gate as `/api/proxy`. These tests pin that
 * contract — an unauthenticated browser cannot trigger demo writes, and a
 * misconfigured admin returns 503 instead of leaking auth bypass.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { dispatch, ROUTES } from '../server/handlers'
import { COOKIE_NAME, signSession } from '../server/auth'
import { _resetSmokeStateForTests } from '../server/smoke'

interface CapturedResponse {
  status: number
  body: string
  contentType: string
}

function makeReq(method: string, url: string, headers: Record<string, string> = {}): IncomingMessage {
  const socket = new Socket()
  const req = new IncomingMessage(socket)
  req.method = method
  req.url = url
  req.headers = { host: 'localhost', ...headers }
  return req
}

function makeRes(): { res: ServerResponse; captured: CapturedResponse } {
  const captured: CapturedResponse = { status: 0, body: '', contentType: '' }
  const socket = new Socket()
  const res = new ServerResponse(new IncomingMessage(socket))
  const realSetHeader = res.setHeader.bind(res)
  res.setHeader = ((name: string, value: string | number | readonly string[]) => {
    if (name.toLowerCase() === 'content-type') {
      captured.contentType = String(value)
    }
    return realSetHeader(name, value)
  }) as typeof res.setHeader
  res.end = ((chunk?: string | Buffer) => {
    if (chunk !== undefined) captured.body = chunk.toString()
    captured.status = res.statusCode
    return res
  }) as typeof res.end
  return { res, captured }
}

const PROD_ENV = {
  NODE_ENV: 'production',
  ADMIN_PASSWORD: 'pw',
  ADMIN_SESSION_SECRET: 's'.repeat(32),
  STATEWAVE_API_URL: 'https://upstream.example',
  STATEWAVE_API_KEY: 'k',
}

let savedEnv: NodeJS.ProcessEnv

beforeEach(() => {
  savedEnv = { ...process.env }
  for (const [k, v] of Object.entries(PROD_ENV)) {
    process.env[k] = v
  }
  _resetSmokeStateForTests()
  vi.restoreAllMocks()
})

afterEach(() => {
  process.env = savedEnv
})

describe('smoke endpoints — auth gating', () => {
  it('GET /api/admin/smoke/status returns 401 without a session cookie', async () => {
    const req = makeReq('GET', ROUTES.smokeStatus)
    const { res, captured } = makeRes()
    const handled = await dispatch(req, res)
    expect(handled).toBe(true)
    expect(captured.status).toBe(401)
    expect(captured.body).toContain('unauthorized')
  })

  it('POST /api/admin/smoke/run returns 401 without a session cookie', async () => {
    const req = makeReq('POST', ROUTES.smokeRun)
    const { res, captured } = makeRes()
    const handled = await dispatch(req, res)
    expect(handled).toBe(true)
    expect(captured.status).toBe(401)
    expect(captured.body).toContain('unauthorized')
  })

  it('returns 503 auth_not_configured when production secrets are missing', async () => {
    process.env = {
      NODE_ENV: 'production',
      STATEWAVE_API_URL: 'https://x',
    } as NodeJS.ProcessEnv
    const req = makeReq('GET', ROUTES.smokeStatus)
    const { res, captured } = makeRes()
    await dispatch(req, res)
    expect(captured.status).toBe(503)
    expect(captured.body).toContain('auth_not_configured')
  })

  it('rejects POST on the status route and GET on the run route', async () => {
    const token = signSession(
      { exp: Math.floor(Date.now() / 1000) + 3600, v: 1 },
      PROD_ENV.ADMIN_SESSION_SECRET,
    )
    const cookie = `${COOKIE_NAME}=${token}`

    {
      const req = makeReq('POST', ROUTES.smokeStatus, { cookie })
      const { res, captured } = makeRes()
      await dispatch(req, res)
      expect(captured.status).toBe(405)
    }
    {
      const req = makeReq('GET', ROUTES.smokeRun, { cookie })
      const { res, captured } = makeRes()
      await dispatch(req, res)
      expect(captured.status).toBe(405)
    }
  })

  it('GET /api/admin/smoke/status returns has_run=false on a fresh deploy with a valid session', async () => {
    const token = signSession(
      { exp: Math.floor(Date.now() / 1000) + 3600, v: 1 },
      PROD_ENV.ADMIN_SESSION_SECRET,
    )
    const cookie = `${COOKIE_NAME}=${token}`
    const req = makeReq('GET', ROUTES.smokeStatus, { cookie })
    const { res, captured } = makeRes()
    await dispatch(req, res)
    expect(captured.status).toBe(200)
    const body = JSON.parse(captured.body) as {
      enabled: boolean
      has_run: boolean
      subject_id: string
    }
    expect(body.enabled).toBe(true)
    expect(body.has_run).toBe(false)
    expect(body.subject_id).toBe('statewave-demo:first-admin-run')
  })
})
