/**
 * Persona-health endpoint: auth gating + happy-path shape.
 *
 * The endpoint imports each bundled demo pack into an ephemeral test
 * subject, runs retrieval probes, then deletes the subject. That requires
 * write access to the connected backend, so it MUST sit behind the same
 * session/gateway gate as the rest of /admin/*. These tests pin that
 * contract without needing a real Statewave backend — fetch is mocked.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { dispatch, ROUTES } from '../server/handlers'
import { COOKIE_NAME, signSession } from '../server/auth'

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
    return realSetHeader(name, value as string)
  }) as typeof res.setHeader
  const realEnd = res.end.bind(res)
  res.end = ((chunk?: unknown) => {
    captured.status = res.statusCode
    captured.body = typeof chunk === 'string' ? chunk : ''
    return realEnd(chunk as string)
  }) as typeof res.end
  return { res, captured }
}

function authedCookie(secret = 'test-secret'): string {
  const session = signSession({ exp: Date.now() / 1000 + 3600, v: 1 }, secret)
  return `${COOKIE_NAME}=${session}`
}

describe('GET /api/admin/persona-health', () => {
  const ENV_BACKUP = { ...process.env }

  beforeEach(() => {
    process.env.ADMIN_PASSWORD = 'pw'
    process.env.ADMIN_SESSION_SECRET = 'test-secret'
    process.env.STATEWAVE_API_URL = 'http://backend.test'
    delete process.env.STATEWAVE_API_KEY
    delete process.env.ADMIN_AUTH_DISABLED
  })

  afterEach(() => {
    process.env = { ...ENV_BACKUP }
    vi.restoreAllMocks()
  })

  it('rejects unauthenticated requests with 401', async () => {
    const { res, captured } = makeRes()
    await dispatch(makeReq('GET', ROUTES.personaHealth), res)
    expect(captured.status).toBe(401)
  })

  it('rejects non-GET methods with 405', async () => {
    const { res, captured } = makeRes()
    const req = makeReq('POST', ROUTES.personaHealth, { cookie: authedCookie() })
    await dispatch(req, res)
    expect(captured.status).toBe(405)
  })

  it('returns "not_configured" status per persona when STATEWAVE_API_URL is unset', async () => {
    delete process.env.STATEWAVE_API_URL
    const { res, captured } = makeRes()
    const req = makeReq('GET', ROUTES.personaHealth + '?force=true', {
      cookie: authedCookie(),
    })
    await dispatch(req, res)
    expect(captured.status).toBe(200)
    const body = JSON.parse(captured.body)
    expect(body.personas).toHaveLength(5)
    expect(body.personas.every((p: { status: string }) => p.status === 'not_configured')).toBe(true)
    expect(body.personas[0].error).toMatch(/STATEWAVE_API_URL/)
  })

  it('returns the expected 5 personas with stable pack_ids', async () => {
    delete process.env.STATEWAVE_API_URL
    const { res, captured } = makeRes()
    const req = makeReq('GET', ROUTES.personaHealth + '?force=true', {
      cookie: authedCookie(),
    })
    await dispatch(req, res)
    const body = JSON.parse(captured.body)
    const ids = body.personas.map((p: { pack_id: string }) => p.pack_id).sort()
    expect(ids).toEqual([
      'demo-coding-assistant',
      'demo-devops-agent',
      'demo-research-assistant',
      'demo-sales-copilot',
      'demo-support-agent',
    ])
  })

  it('passes through happy-path probe results when backend is reachable (mocked)', async () => {
    // Mock fetch so each persona's import + memories list + N context probes +
    // final delete all succeed. The handler is the unit under test; the
    // backend wire shape is faked deliberately (real coverage of the wire
    // shape lives in the integration suite).
    type FetchInit = {
      method?: string
      headers?: Record<string, string>
      body?: string
    }
    let importCalls = 0
    let probeCalls = 0
    let deleteCalls = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation((async (url: string | URL, init?: FetchInit) => {
      const u = String(url)
      const method = (init?.method ?? 'GET').toUpperCase()
      if (method === 'DELETE' && u.includes('/v1/subjects/')) {
        deleteCalls += 1
        return new Response('{}', { status: 200 })
      }
      if (u.includes('/admin/memory/starter-packs/import')) {
        importCalls += 1
        return new Response(
          JSON.stringify({
            imported_episodes: 44,
            imported_memories: 50,
            installed_version: 'test-version',
          }),
          { status: 200 },
        )
      }
      if (u.includes('/admin/subjects/') && u.includes('/memories')) {
        // Return all-embedded
        return new Response(
          JSON.stringify({
            memories: Array.from({ length: 50 }, () => ({ has_embedding: true })),
          }),
          { status: 200 },
        )
      }
      if (u.includes('/v1/context')) {
        probeCalls += 1
        // Return a memory whose content matches the probe's expected
        // substring on the FIRST result, so every probe lands rank 1.
        const body = init?.body ? JSON.parse(init.body) : {}
        const expected = inferExpectedSubstr(body.task as string)
        return new Response(
          JSON.stringify({
            facts: [{ content: `Synthetic match for ${expected}` }],
            procedures: [],
          }),
          { status: 200 },
        )
      }
      return new Response('{}', { status: 200 })
    }) as typeof fetch)

    const { res, captured } = makeRes()
    const req = makeReq('GET', ROUTES.personaHealth + '?force=true', {
      cookie: authedCookie(),
    })
    await dispatch(req, res)
    expect(captured.status).toBe(200)
    const body = JSON.parse(captured.body)
    expect(body.personas).toHaveLength(5)
    for (const p of body.personas) {
      expect(p.status).toBe('pass')
      expect(p.episode_count).toBe(44)
      expect(p.memory_count).toBe(50)
      expect(p.embedding_coverage).toBe(1)
      expect(p.probes).toHaveLength(3)
      for (const probe of p.probes) {
        expect(probe.rank).toBe(1)
        expect(probe.pass).toBe(true)
      }
    }
    // Sanity: 5 personas × 1 import + 3 probes + 1 delete each (plus optional
    // pre-cleanup deletes), so the counts roughly match.
    expect(importCalls).toBe(5)
    expect(probeCalls).toBe(15)
    expect(deleteCalls).toBeGreaterThanOrEqual(5)
  })
})

// Map a probe's question to the expected_substring the panel asserts on.
// Mirrors the table in `server/persona-health.ts`. Kept here so the test
// generates "matching" memories deterministically without re-importing the
// internal PERSONA_SPECS.
function inferExpectedSubstr(question: string): string {
  const map: Record<string, string> = {
    "What is Northwind's webhook URL pattern?": 'hooks.northwind',
    'When does Northwind renew their contract?': '2026-09-15',
    'What was the root cause of ticket 4937?': '60k',
    'What backend stack does Priya use?': 'fastapi',
    'Where do shared TypeScript types live?': '@stratus/types',
    'What is the policy on database mocking in tests?': 'never mock',
    'When does Sarah Chen prefer to meet?': 'tuesday',
    'Who is the AE on Delta Health?': 'priya',
    'How do we position against Mem0?': 'deterministic',
    'What is the alert threshold for p95 latency?': '300ms',
    'How do I roll back the nimbus-api deploy?': 'fly deploy',
    'Why did we choose Datadog over Grafana Cloud?': 'datadog',
    'How should I cite a preprint?': 'arxiv',
    'Who is the co-author on the NeurIPS paper?': 'mei wu',
    'What was the compiler-density experiment result?': '5 memories',
  }
  return map[question] ?? ''
}
