/**
 * Server-side smoke endpoint tests.
 *
 * Covers the spec's acceptance criteria for the first-admin-run flow:
 *   - happy path: backend reachable + episode + compile + webhook delivered
 *   - backend not reachable / not configured → failure with diagnostic detail
 *   - webhook URL not configured on backend → "not configured" neutral state
 *   - smoke disabled by env var → run + status both report disabled
 *   - run is single-flighted (one in-flight call cannot be doubled up)
 *   - status persists across reads in the same process
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  getSmokeConfig,
  runSmoke,
  getSmokeStatus,
  _resetSmokeStateForTests,
  SMOKE_SUBJECT_ID,
  type UpstreamFetch,
} from '../server/smoke'

interface UpstreamCall {
  method: string
  url: string
  body: string | null
}

interface MockResponseSpec {
  status?: number
  body?: unknown
  /** Throw a network-style error for this call. Mutually exclusive with body/status. */
  reject?: Error
}

function makeFetch(handler: (call: UpstreamCall) => MockResponseSpec): {
  fetchImpl: UpstreamFetch
  calls: UpstreamCall[]
} {
  const calls: UpstreamCall[] = []
  const fetchImpl: UpstreamFetch = async (url, init) => {
    const call: UpstreamCall = {
      method: (init.method ?? 'GET').toUpperCase(),
      url,
      body: typeof init.body === 'string' ? init.body : null,
    }
    calls.push(call)
    const spec = handler(call)
    if (spec.reject) throw spec.reject
    const status = spec.status ?? 200
    const text =
      spec.body === undefined
        ? ''
        : typeof spec.body === 'string'
          ? spec.body
          : JSON.stringify(spec.body)
    return new Response(text, {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }
  return { fetchImpl, calls }
}

const BASE_ENV: NodeJS.ProcessEnv = {
  STATEWAVE_API_URL: 'https://upstream.example',
  STATEWAVE_API_KEY: 'test-key',
} as NodeJS.ProcessEnv

beforeEach(() => {
  _resetSmokeStateForTests()
  vi.restoreAllMocks()
})

describe('getSmokeConfig', () => {
  it('reads STATEWAVE_API_URL and STATEWAVE_API_KEY', () => {
    const cfg = getSmokeConfig({
      STATEWAVE_API_URL: 'https://x',
      STATEWAVE_API_KEY: 'k',
    } as NodeJS.ProcessEnv)
    expect(cfg.apiUrl).toBe('https://x')
    expect(cfg.apiKey).toBe('k')
    expect(cfg.disabled).toBe(false)
  })

  it('honors ADMIN_SMOKE_DISABLED=true', () => {
    const cfg = getSmokeConfig({
      ADMIN_SMOKE_DISABLED: 'true',
    } as NodeJS.ProcessEnv)
    expect(cfg.disabled).toBe(true)
  })

  it('only the literal "true" disables the smoke check', () => {
    for (const v of ['1', 'TRUE', 'yes', '']) {
      const cfg = getSmokeConfig({
        ADMIN_SMOKE_DISABLED: v,
      } as NodeJS.ProcessEnv)
      expect(cfg.disabled).toBe(false)
    }
  })
})

/**
 * Sleep injected into runSmoke so the polling loop returns instantly in
 * tests. Production uses setTimeout — see RunSmokeOptions.sleep.
 */
const noopSleep = async () => {}

describe('runSmoke — happy path', () => {
  it('runs episode + async compile (with poll) + webhook check end-to-end', async () => {
    let webhookTotal = 0
    const { fetchImpl, calls } = makeFetch((call) => {
      if (call.url.endsWith('/readyz') && call.method === 'GET') {
        return { body: { status: 'ready' } }
      }
      if (call.url.endsWith('/admin/dashboard') && call.method === 'GET') {
        return { body: { readiness: { status: 'ok' }, webhooks: { total: webhookTotal } } }
      }
      if (call.url.endsWith('/admin/webhooks/stats') && call.method === 'GET') {
        return { body: { total: webhookTotal } }
      }
      if (call.url.endsWith('/v1/episodes') && call.method === 'POST') {
        webhookTotal += 1
        return { status: 201, body: { id: 'episode-uuid' } }
      }
      if (call.url.endsWith('/v1/memories/compile') && call.method === 'POST') {
        webhookTotal += 1
        return {
          status: 202,
          body: { job_id: 'job-1', status: 'pending', subject_id: SMOKE_SUBJECT_ID },
        }
      }
      // Job status endpoint — returns completed on the first probe so the
      // poll loop exits immediately without waiting.
      if (call.url.endsWith('/v1/memories/compile/job-1') && call.method === 'GET') {
        return {
          body: {
            job_id: 'job-1',
            status: 'completed',
            subject_id: SMOKE_SUBJECT_ID,
            memories_created: 2,
          },
        }
      }
      if (call.url.includes('/admin/subjects/') && call.method === 'GET') {
        return { body: { subject_id: SMOKE_SUBJECT_ID, summary: { episode_count: 1 } } }
      }
      if (call.url.includes('/admin/webhooks?limit=1') && call.method === 'GET') {
        return {
          body: {
            events: [
              { id: 'wh-1', event: 'episode.created', status: 'delivered', http_status: 200 },
            ],
          },
        }
      }
      return { status: 404, body: { error: 'unmatched' } }
    })

    const cfg = getSmokeConfig(BASE_ENV)
    const result = await runSmoke(cfg, { fetchImpl, sleep: noopSleep })

    expect(result.status).toBe('success')
    expect(result.backend.status).toBe('ok')
    expect(result.demo_job.status).toBe('ok')
    expect(result.demo_job.subject_id).toBe(SMOKE_SUBJECT_ID)
    expect(result.demo_job.episode_id).toBe('episode-uuid')
    expect(result.demo_job.job_id).toBe('job-1')
    expect(result.demo_job.job_mode).toBe('async')
    expect(result.demo_job.memories_created).toBe(2)
    expect(result.demo_job.detail).toMatch(/\/jobs/)
    expect(result.demo_webhook.status).toBe('ok')
    expect(result.demo_webhook.state).toBe('configured_delivered')
    expect(result.demo_webhook.sample?.id).toBe('wh-1')

    // We hit the compile endpoint with async:true and polled the status
    // endpoint at least once.
    const compileCall = calls.find(
      (c) => c.url.endsWith('/v1/memories/compile') && c.method === 'POST',
    )
    expect(compileCall?.body).toContain('"async":true')
    expect(
      calls.some((c) => c.url.endsWith('/v1/memories/compile/job-1') && c.method === 'GET'),
    ).toBe(true)

    const episodeCall = calls.find((c) => c.url.endsWith('/v1/episodes'))
    expect(episodeCall).toBeDefined()
    expect(episodeCall!.body).toContain(SMOKE_SUBJECT_ID)
    expect(episodeCall!.body).toContain('"smoke":true')
  })

  it('polls the compile job until it leaves pending', async () => {
    let pollCount = 0
    const fetchImpl: UpstreamFetch = async (url, init) => {
      const method = (init.method ?? 'GET').toUpperCase()
      if (url.endsWith('/readyz')) {
        return new Response(JSON.stringify({ status: 'ready' }), { status: 200 })
      }
      if (url.endsWith('/admin/dashboard')) {
        return new Response(JSON.stringify({ readiness: { status: 'ok' } }), { status: 200 })
      }
      if (url.endsWith('/admin/webhooks/stats')) {
        return new Response(JSON.stringify({ total: 0 }), { status: 200 })
      }
      if (url.endsWith('/v1/episodes') && method === 'POST') {
        return new Response(JSON.stringify({ id: 'ep-1' }), { status: 201 })
      }
      if (url.endsWith('/v1/memories/compile') && method === 'POST') {
        return new Response(
          JSON.stringify({ job_id: 'j', status: 'pending', subject_id: SMOKE_SUBJECT_ID }),
          { status: 202 },
        )
      }
      if (url.endsWith('/v1/memories/compile/j') && method === 'GET') {
        pollCount += 1
        if (pollCount === 1) {
          return new Response(
            JSON.stringify({ job_id: 'j', status: 'pending', subject_id: SMOKE_SUBJECT_ID }),
            { status: 200 },
          )
        }
        if (pollCount === 2) {
          return new Response(
            JSON.stringify({ job_id: 'j', status: 'running', subject_id: SMOKE_SUBJECT_ID }),
            { status: 200 },
          )
        }
        return new Response(
          JSON.stringify({
            job_id: 'j',
            status: 'completed',
            subject_id: SMOKE_SUBJECT_ID,
            memories_created: 1,
          }),
          { status: 200 },
        )
      }
      if (url.includes('/admin/subjects/')) {
        return new Response(
          JSON.stringify({ subject_id: SMOKE_SUBJECT_ID, summary: { episode_count: 1 } }),
          { status: 200 },
        )
      }
      return new Response(JSON.stringify({}), { status: 404 })
    }

    const cfg = getSmokeConfig(BASE_ENV)
    const result = await runSmoke(cfg, { fetchImpl, sleep: noopSleep })
    expect(result.status).toBe('success')
    expect(pollCount).toBe(3)
    expect(result.demo_job.memories_created).toBe(1)
  })

  it('marks demo_job failed when the compile job reports status=failed', async () => {
    const fetchImpl: UpstreamFetch = async (url, init) => {
      const method = (init.method ?? 'GET').toUpperCase()
      if (url.endsWith('/readyz')) {
        return new Response(JSON.stringify({ status: 'ready' }), { status: 200 })
      }
      if (url.endsWith('/admin/dashboard')) {
        return new Response(JSON.stringify({ readiness: { status: 'ok' } }), { status: 200 })
      }
      if (url.endsWith('/admin/webhooks/stats')) {
        return new Response(JSON.stringify({ total: 0 }), { status: 200 })
      }
      if (url.endsWith('/v1/episodes') && method === 'POST') {
        return new Response(JSON.stringify({ id: 'ep-1' }), { status: 201 })
      }
      if (url.endsWith('/v1/memories/compile') && method === 'POST') {
        return new Response(
          JSON.stringify({ job_id: 'jx', status: 'pending', subject_id: SMOKE_SUBJECT_ID }),
          { status: 202 },
        )
      }
      if (url.endsWith('/v1/memories/compile/jx') && method === 'GET') {
        return new Response(
          JSON.stringify({
            job_id: 'jx',
            status: 'failed',
            subject_id: SMOKE_SUBJECT_ID,
            error: 'compiler exploded',
          }),
          { status: 200 },
        )
      }
      return new Response(JSON.stringify({}), { status: 404 })
    }
    const cfg = getSmokeConfig(BASE_ENV)
    const result = await runSmoke(cfg, { fetchImpl, sleep: noopSleep })
    expect(result.status).toBe('failed')
    expect(result.demo_job.status).toBe('failed')
    expect(result.demo_job.job_id).toBe('jx')
    expect(result.demo_job.detail).toMatch(/compiler exploded/)
  })

  it('forwards X-API-Key on every upstream call', async () => {
    let webhookTotal = 0
    const headers: Record<string, string>[] = []
    const fetchImpl: UpstreamFetch = async (url, init) => {
      headers.push({ ...(init.headers as Record<string, string>) })
      const method = (init.method ?? 'GET').toUpperCase()
      if (url.endsWith('/readyz')) {
        return new Response(JSON.stringify({ status: 'ready' }), { status: 200 })
      }
      if (url.endsWith('/admin/dashboard')) {
        return new Response(JSON.stringify({ readiness: { status: 'ok' } }), { status: 200 })
      }
      if (url.endsWith('/admin/webhooks/stats')) {
        return new Response(JSON.stringify({ total: webhookTotal }), { status: 200 })
      }
      if (url.endsWith('/v1/episodes') && method === 'POST') {
        webhookTotal += 1
        return new Response(JSON.stringify({ id: 'ep-1' }), { status: 201 })
      }
      if (url.endsWith('/v1/memories/compile') && method === 'POST') {
        return new Response(
          JSON.stringify({ job_id: 'j', status: 'pending', subject_id: SMOKE_SUBJECT_ID }),
          { status: 202 },
        )
      }
      if (url.endsWith('/v1/memories/compile/j') && method === 'GET') {
        return new Response(
          JSON.stringify({
            job_id: 'j',
            status: 'completed',
            subject_id: SMOKE_SUBJECT_ID,
            memories_created: 0,
          }),
          { status: 200 },
        )
      }
      if (url.includes('/admin/subjects/')) {
        return new Response(
          JSON.stringify({ subject_id: SMOKE_SUBJECT_ID, summary: { episode_count: 1 } }),
          { status: 200 },
        )
      }
      if (url.includes('/admin/webhooks?limit=1')) {
        return new Response(
          JSON.stringify({ events: [{ id: 'a', event: 'episode.created', status: 'delivered' }] }),
          { status: 200 },
        )
      }
      return new Response(JSON.stringify({}), { status: 404 })
    }

    const cfg = getSmokeConfig(BASE_ENV)
    const result = await runSmoke(cfg, { fetchImpl, sleep: noopSleep })
    expect(result.status).toBe('success')
    expect(headers.length).toBeGreaterThan(0)
    for (const h of headers) {
      expect(h['X-API-Key']).toBe('test-key')
    }
  })
})

describe('runSmoke — backend unreachable', () => {
  it('marks the run failed when /readyz cannot be reached', async () => {
    const fetchImpl: UpstreamFetch = async () => {
      throw new Error('ECONNREFUSED')
    }
    const cfg = getSmokeConfig(BASE_ENV)
    const result = await runSmoke(cfg, { fetchImpl })
    expect(result.status).toBe('failed')
    expect(result.backend.status).toBe('failed')
    expect(result.demo_job.status).toBe('skipped')
    expect(result.demo_webhook.status).toBe('skipped')
    expect(result.error).toMatch(/Backend not reachable/)
  })

  it('marks the run failed when STATEWAVE_API_URL is missing', async () => {
    const cfg = getSmokeConfig({} as NodeJS.ProcessEnv)
    const result = await runSmoke(cfg)
    expect(result.status).toBe('failed')
    expect(result.backend.status).toBe('failed')
    expect(result.error).toMatch(/STATEWAVE_API_URL/)
  })

  it('marks the run failed when /admin/dashboard returns 401 (bad API key)', async () => {
    const fetchImpl: UpstreamFetch = async (url) => {
      if (url.endsWith('/readyz')) {
        return new Response(JSON.stringify({ status: 'ready' }), { status: 200 })
      }
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })
    }
    const cfg = getSmokeConfig(BASE_ENV)
    const result = await runSmoke(cfg, { fetchImpl })
    expect(result.status).toBe('failed')
    expect(result.backend.detail).toMatch(/STATEWAVE_API_KEY/)
  })
})

describe('runSmoke — webhook not configured', () => {
  it('reports neutral "not configured" with actionable STATEWAVE_WEBHOOK_URL hint', async () => {
    const fetchImpl: UpstreamFetch = async (url, init) => {
      const method = (init.method ?? 'GET').toUpperCase()
      if (url.endsWith('/readyz')) {
        return new Response(JSON.stringify({ status: 'ready' }), { status: 200 })
      }
      if (url.endsWith('/admin/dashboard')) {
        return new Response(JSON.stringify({ readiness: { status: 'ok' } }), { status: 200 })
      }
      if (url.endsWith('/admin/webhooks/stats')) {
        // Backend has no webhook URL configured — fire() returns None and
        // no row is persisted, so total stays at zero across the entire run.
        return new Response(JSON.stringify({ total: 0 }), { status: 200 })
      }
      if (url.endsWith('/v1/episodes') && method === 'POST') {
        return new Response(JSON.stringify({ id: 'ep-1' }), { status: 201 })
      }
      if (url.endsWith('/v1/memories/compile') && method === 'POST') {
        return new Response(
          JSON.stringify({ job_id: 'j', status: 'pending', subject_id: SMOKE_SUBJECT_ID }),
          { status: 202 },
        )
      }
      if (url.endsWith('/v1/memories/compile/j') && method === 'GET') {
        return new Response(
          JSON.stringify({
            job_id: 'j',
            status: 'completed',
            subject_id: SMOKE_SUBJECT_ID,
            memories_created: 0,
          }),
          { status: 200 },
        )
      }
      if (url.includes('/admin/subjects/')) {
        return new Response(
          JSON.stringify({ subject_id: SMOKE_SUBJECT_ID, summary: { episode_count: 1 } }),
          { status: 200 },
        )
      }
      return new Response(JSON.stringify({}), { status: 404 })
    }
    const cfg = getSmokeConfig(BASE_ENV)
    const result = await runSmoke(cfg, { fetchImpl, sleep: noopSleep })
    expect(result.status).toBe('success')
    expect(result.demo_webhook.status).toBe('skipped')
    expect(result.demo_webhook.state).toBe('not_configured')
    expect(result.demo_webhook.detail).toMatch(/not configured/i)
    expect(result.demo_webhook.detail).toMatch(/STATEWAVE_WEBHOOK_URL/)
  })
})

describe('runSmoke — webhook configured but failed', () => {
  it('marks overall as partial when delivery is in dead_letter', async () => {
    let total = 0
    const fetchImpl: UpstreamFetch = async (url, init) => {
      const method = (init.method ?? 'GET').toUpperCase()
      if (url.endsWith('/readyz')) {
        return new Response(JSON.stringify({ status: 'ready' }), { status: 200 })
      }
      if (url.endsWith('/admin/dashboard')) {
        return new Response(JSON.stringify({ readiness: { status: 'ok' } }), { status: 200 })
      }
      if (url.endsWith('/admin/webhooks/stats')) {
        return new Response(JSON.stringify({ total }), { status: 200 })
      }
      if (url.endsWith('/v1/episodes') && method === 'POST') {
        total += 1
        return new Response(JSON.stringify({ id: 'ep-1' }), { status: 201 })
      }
      if (url.endsWith('/v1/memories/compile') && method === 'POST') {
        total += 1
        return new Response(
          JSON.stringify({ job_id: 'j', status: 'pending', subject_id: SMOKE_SUBJECT_ID }),
          { status: 202 },
        )
      }
      if (url.endsWith('/v1/memories/compile/j') && method === 'GET') {
        return new Response(
          JSON.stringify({
            job_id: 'j',
            status: 'completed',
            subject_id: SMOKE_SUBJECT_ID,
            memories_created: 0,
          }),
          { status: 200 },
        )
      }
      if (url.includes('/admin/subjects/')) {
        return new Response(
          JSON.stringify({ subject_id: SMOKE_SUBJECT_ID, summary: { episode_count: 1 } }),
          { status: 200 },
        )
      }
      if (url.includes('/admin/webhooks?limit=1')) {
        return new Response(
          JSON.stringify({
            events: [
              {
                id: 'wh-1',
                event: 'episode.created',
                status: 'dead_letter',
                http_status: 500,
              },
            ],
          }),
          { status: 200 },
        )
      }
      return new Response(JSON.stringify({}), { status: 404 })
    }
    const cfg = getSmokeConfig(BASE_ENV)
    const result = await runSmoke(cfg, { fetchImpl, sleep: noopSleep })
    expect(result.status).toBe('partial')
    expect(result.demo_job.status).toBe('ok')
    expect(result.demo_webhook.status).toBe('failed')
    expect(result.demo_webhook.state).toBe('configured_failed')
  })
})

describe('runSmoke — disabled by env', () => {
  it('returns a disabled result without touching the backend', async () => {
    const fetchImpl = vi.fn()
    const cfg = getSmokeConfig({
      ...BASE_ENV,
      ADMIN_SMOKE_DISABLED: 'true',
    } as NodeJS.ProcessEnv)
    const result = await runSmoke(cfg, { fetchImpl })
    expect(result.status).toBe('disabled')
    expect(result.backend.status).toBe('skipped')
    expect(result.demo_job.status).toBe('skipped')
    expect(result.demo_webhook.status).toBe('skipped')
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('runSmoke — single-flight', () => {
  it('two concurrent calls share one upstream run', async () => {
    let total = 0
    let episodeCount = 0
    const fetchImpl: UpstreamFetch = async (url, init) => {
      const method = (init.method ?? 'GET').toUpperCase()
      if (url.endsWith('/readyz')) {
        return new Response(JSON.stringify({ status: 'ready' }), { status: 200 })
      }
      if (url.endsWith('/admin/dashboard')) {
        return new Response(JSON.stringify({ readiness: { status: 'ok' } }), { status: 200 })
      }
      if (url.endsWith('/admin/webhooks/stats')) {
        return new Response(JSON.stringify({ total }), { status: 200 })
      }
      if (url.endsWith('/v1/episodes') && method === 'POST') {
        episodeCount += 1
        total += 1
        return new Response(JSON.stringify({ id: `ep-${episodeCount}` }), { status: 201 })
      }
      if (url.endsWith('/v1/memories/compile') && method === 'POST') {
        return new Response(
          JSON.stringify({ job_id: 'j', status: 'pending', subject_id: SMOKE_SUBJECT_ID }),
          { status: 202 },
        )
      }
      if (url.endsWith('/v1/memories/compile/j') && method === 'GET') {
        return new Response(
          JSON.stringify({
            job_id: 'j',
            status: 'completed',
            subject_id: SMOKE_SUBJECT_ID,
            memories_created: 0,
          }),
          { status: 200 },
        )
      }
      if (url.includes('/admin/subjects/')) {
        return new Response(
          JSON.stringify({ subject_id: SMOKE_SUBJECT_ID, summary: { episode_count: 1 } }),
          { status: 200 },
        )
      }
      if (url.includes('/admin/webhooks?limit=1')) {
        return new Response(
          JSON.stringify({
            events: [{ id: 'wh-1', event: 'episode.created', status: 'delivered' }],
          }),
          { status: 200 },
        )
      }
      return new Response(JSON.stringify({}), { status: 404 })
    }
    const cfg = getSmokeConfig(BASE_ENV)
    const [a, b] = await Promise.all([
      runSmoke(cfg, { fetchImpl, sleep: noopSleep }),
      runSmoke(cfg, { fetchImpl, sleep: noopSleep }),
    ])
    expect(a).toBe(b)
    // Only ONE demo episode was created across the two concurrent calls.
    expect(episodeCount).toBe(1)
  })
})

describe('getSmokeStatus', () => {
  it('reports has_run=false on a fresh process', async () => {
    const cfg = getSmokeConfig(BASE_ENV)
    const status = await getSmokeStatus(cfg)
    expect(status.has_run).toBe(false)
    expect(status.is_running).toBe(false)
    expect(status.subject_id).toBe(SMOKE_SUBJECT_ID)
    expect(status.last_result).toBeNull()
  })

  it('reflects the most recent run result', async () => {
    const fetchImpl: UpstreamFetch = async (url, init) => {
      const method = (init.method ?? 'GET').toUpperCase()
      if (url.endsWith('/readyz')) {
        return new Response(JSON.stringify({ status: 'ready' }), { status: 200 })
      }
      if (url.endsWith('/admin/dashboard')) {
        return new Response(JSON.stringify({ readiness: { status: 'ok' } }), { status: 200 })
      }
      if (url.endsWith('/admin/webhooks/stats')) {
        return new Response(JSON.stringify({ total: 0 }), { status: 200 })
      }
      if (url.endsWith('/v1/episodes') && method === 'POST') {
        return new Response(JSON.stringify({ id: 'ep-1' }), { status: 201 })
      }
      if (url.endsWith('/v1/memories/compile') && method === 'POST') {
        return new Response(
          JSON.stringify({ job_id: 'j', status: 'pending', subject_id: SMOKE_SUBJECT_ID }),
          { status: 202 },
        )
      }
      if (url.endsWith('/v1/memories/compile/j') && method === 'GET') {
        return new Response(
          JSON.stringify({
            job_id: 'j',
            status: 'completed',
            subject_id: SMOKE_SUBJECT_ID,
            memories_created: 1,
          }),
          { status: 200 },
        )
      }
      if (url.includes('/admin/subjects/')) {
        return new Response(
          JSON.stringify({ subject_id: SMOKE_SUBJECT_ID, summary: { episode_count: 1 } }),
          { status: 200 },
        )
      }
      return new Response(JSON.stringify({}), { status: 404 })
    }
    const cfg = getSmokeConfig(BASE_ENV)
    await runSmoke(cfg, { fetchImpl, sleep: noopSleep })
    const status = await getSmokeStatus(cfg)
    expect(status.has_run).toBe(true)
    expect(status.is_running).toBe(false)
    expect(status.last_result?.status).toBe('success')
  })

  it('reports enabled=false when ADMIN_SMOKE_DISABLED=true', async () => {
    const cfg = getSmokeConfig({
      ADMIN_SMOKE_DISABLED: 'true',
    } as NodeJS.ProcessEnv)
    const status = await getSmokeStatus(cfg)
    expect(status.enabled).toBe(false)
    expect(status.has_run).toBe(false)
  })
})
