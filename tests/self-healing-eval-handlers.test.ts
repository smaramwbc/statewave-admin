/**
 * Auth + dispatch + availability gating for the Self-Healing Eval API.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { dispatch, ROUTES } from '../server/handlers'
import { COOKIE_NAME, signSession } from '../server/auth'
import { _resetEvalRunnerForTests } from '../server/self-healing-eval/runner'
import { _resetEvalStorageForTests } from '../server/self-healing-eval/storage'
import { _resetSmokeStateForTests } from '../server/smoke'

interface CapturedResponse {
  status: number
  body: string
  contentType: string
}

function makeReq(
  method: string,
  url: string,
  headers: Record<string, string> = {},
  body = '',
): IncomingMessage {
  const socket = new Socket()
  const req = new IncomingMessage(socket)
  req.method = method
  req.url = url
  req.headers = { host: 'localhost', ...headers }
  // Signal end-of-stream so handlers that read the body don't hang.
  if (body) req.push(body)
  req.push(null)
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

const SECRET = 's'.repeat(32)

const PROD_BASE = {
  NODE_ENV: 'production',
  ADMIN_PASSWORD: 'pw',
  ADMIN_SESSION_SECRET: SECRET,
  STATEWAVE_API_URL: 'https://upstream.example',
  STATEWAVE_API_KEY: 'k',
}

let savedEnv: NodeJS.ProcessEnv

function applyEnv(extra: Record<string, string>): void {
  for (const [k, v] of Object.entries(extra)) {
    process.env[k] = v
  }
}

function makeCookie(): string {
  const token = signSession(
    { exp: Math.floor(Date.now() / 1000) + 3600, v: 1 },
    SECRET,
  )
  return `${COOKIE_NAME}=${token}`
}

beforeEach(() => {
  savedEnv = { ...process.env }
  process.env = {} as NodeJS.ProcessEnv
  applyEnv(PROD_BASE)
  _resetEvalRunnerForTests()
  _resetEvalStorageForTests()
  _resetSmokeStateForTests()
  vi.restoreAllMocks()
})
afterEach(() => {
  process.env = savedEnv
})

describe('GET /api/self-healing-eval/status', () => {
  it('returns 401 without a session cookie', async () => {
    const req = makeReq('GET', ROUTES.evalStatus)
    const { res, captured } = makeRes()
    expect(await dispatch(req, res)).toBe(true)
    expect(captured.status).toBe(401)
  })

  it('reports available=false when feature disabled', async () => {
    const req = makeReq('GET', ROUTES.evalStatus, { cookie: makeCookie() })
    const { res, captured } = makeRes()
    await dispatch(req, res)
    expect(captured.status).toBe(200)
    const body = JSON.parse(captured.body)
    expect(body.availability.available).toBe(false)
    expect(body.availability.enabled).toBe(false)
  })

  it('reports available=false when LLM config missing even if enabled', async () => {
    applyEnv({ ADMIN_SELF_HEALING_EVAL_ENABLED: 'true' })
    const req = makeReq('GET', ROUTES.evalStatus, { cookie: makeCookie() })
    const { res, captured } = makeRes()
    await dispatch(req, res)
    const body = JSON.parse(captured.body)
    expect(body.availability.available).toBe(false)
    expect(body.availability.llm_configured).toBe(false)
  })

  it('reports available=true when enabled + LLM + demo agent + statewave api are all set', async () => {
    applyEnv({
      ADMIN_SELF_HEALING_EVAL_ENABLED: 'true',
      ADMIN_EVAL_LLM_PROVIDER: 'openai',
      ADMIN_EVAL_LLM_MODEL: 'gpt-4o-mini',
      ADMIN_EVAL_LLM_API_KEY: 'sk-test',
      ADMIN_DEMO_AGENT_URL: 'https://demo.example/agent',
    })
    const req = makeReq('GET', ROUTES.evalStatus, { cookie: makeCookie() })
    const { res, captured } = makeRes()
    await dispatch(req, res)
    const body = JSON.parse(captured.body)
    expect(body.availability.available).toBe(true)
    expect(body.availability.llm_configured).toBe(true)
    expect(body.availability.demo_agent_configured).toBe(true)
    expect(body.config_summary.llm_provider).toBe('openai')
    // API key value never appears in the response.
    expect(captured.body).not.toContain('sk-test')
  })
})

describe('POST /api/self-healing-eval/run', () => {
  it('returns 409 when LLM is not configured', async () => {
    applyEnv({ ADMIN_SELF_HEALING_EVAL_ENABLED: 'true' })
    const req = makeReq('POST', ROUTES.evalRun, {
      cookie: makeCookie(),
      'content-type': 'application/json',
    })
    const { res, captured } = makeRes()
    await dispatch(req, res)
    expect(captured.status).toBe(409)
    const body = JSON.parse(captured.body)
    expect(body.ok).toBe(false)
    expect(String(body.error)).toMatch(/ADMIN_EVAL_LLM/)
  })

  it('returns 401 without a session cookie', async () => {
    const req = makeReq('POST', ROUTES.evalRun)
    const { res, captured } = makeRes()
    await dispatch(req, res)
    expect(captured.status).toBe(401)
  })
})

describe('POST /api/self-healing-eval/questions/generate', () => {
  it('returns 401 without a session cookie', async () => {
    const req = makeReq('POST', '/api/self-healing-eval/questions/generate', {
      'content-type': 'application/json',
    }, JSON.stringify({ topic: 't', grounding: 'a'.repeat(50), mode: 'smoke' }))
    const { res, captured } = makeRes()
    await dispatch(req, res)
    expect(captured.status).toBe(401)
  })

  it('returns 400 when topic is missing', async () => {
    const req = makeReq(
      'POST',
      '/api/self-healing-eval/questions/generate',
      { cookie: makeCookie(), 'content-type': 'application/json' },
      JSON.stringify({ grounding: 'a'.repeat(50), mode: 'smoke' }),
    )
    const { res, captured } = makeRes()
    await dispatch(req, res)
    expect(captured.status).toBe(400)
    expect(captured.body).toContain('topic_required')
  })

  it('returns 400 when grounding is missing or too short', async () => {
    for (const grounding of ['', 'short']) {
      const req = makeReq(
        'POST',
        '/api/self-healing-eval/questions/generate',
        { cookie: makeCookie(), 'content-type': 'application/json' },
        JSON.stringify({ topic: 'Statewave', grounding, mode: 'smoke' }),
      )
      const { res, captured } = makeRes()
      await dispatch(req, res)
      expect(captured.status).toBe(400)
      expect(captured.body).toContain('grounding_required')
    }
  })

  it('returns 400 on invalid mode', async () => {
    const req = makeReq(
      'POST',
      '/api/self-healing-eval/questions/generate',
      { cookie: makeCookie(), 'content-type': 'application/json' },
      JSON.stringify({ topic: 'X', grounding: 'a'.repeat(50), mode: 'turbo' }),
    )
    const { res, captured } = makeRes()
    await dispatch(req, res)
    expect(captured.status).toBe(400)
    expect(captured.body).toContain('invalid_mode')
  })

  it('returns 503 when LLM is not configured', async () => {
    // PROD_BASE has no ADMIN_EVAL_LLM_* set.
    const req = makeReq(
      'POST',
      '/api/self-healing-eval/questions/generate',
      { cookie: makeCookie(), 'content-type': 'application/json' },
      JSON.stringify({ topic: 'X', grounding: 'a'.repeat(50), mode: 'smoke' }),
    )
    const { res, captured } = makeRes()
    await dispatch(req, res)
    expect(captured.status).toBe(503)
    expect(captured.body).toContain('llm_not_configured')
  })
})

describe('POST /api/self-healing-eval/grounding/suggest', () => {
  it('returns 401 without a session cookie', async () => {
    const req = makeReq(
      'POST',
      '/api/self-healing-eval/grounding/suggest',
      { 'content-type': 'application/json' },
      JSON.stringify({ subject_id: 's' }),
    )
    const { res, captured } = makeRes()
    await dispatch(req, res)
    expect(captured.status).toBe(401)
  })

  it('returns 400 when subject_id is missing', async () => {
    const req = makeReq(
      'POST',
      '/api/self-healing-eval/grounding/suggest',
      { cookie: makeCookie(), 'content-type': 'application/json' },
      JSON.stringify({}),
    )
    const { res, captured } = makeRes()
    await dispatch(req, res)
    expect(captured.status).toBe(400)
    expect(captured.body).toContain('subject_id_required')
  })

  it('returns 503 with llm_not_configured when ADMIN_EVAL_LLM_* are unset', async () => {
    const req = makeReq(
      'POST',
      '/api/self-healing-eval/grounding/suggest',
      { cookie: makeCookie(), 'content-type': 'application/json' },
      JSON.stringify({ subject_id: 'statewave-support-docs' }),
    )
    const { res, captured } = makeRes()
    await dispatch(req, res)
    expect(captured.status).toBe(503)
    expect(captured.body).toContain('llm_not_configured')
  })
})

describe('GET /api/self-healing-eval/report/latest', () => {
  it('returns 404 when no run has finished yet', async () => {
    const req = makeReq('GET', ROUTES.evalReportLatest, { cookie: makeCookie() })
    const { res, captured } = makeRes()
    await dispatch(req, res)
    expect(captured.status).toBe(404)
  })
})
