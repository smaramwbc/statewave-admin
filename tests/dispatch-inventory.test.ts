/**
 * Inventory + 404 contract for the single dispatch surface.
 *
 * The Vercel adapter (`api/[[...slug]].ts`), the standalone Node server
 * (`server/index.ts`), and the Vite dev plugin all share one entry
 * point — `dispatch()` in `server/handlers.ts`. These tests pin the
 * route inventory so a future edit to handlers.ts without a matching
 * dispatch entry is caught immediately, and assert that any unknown
 * `/api/*` path is returned to the host (so the host can render its
 * own 404) rather than silently swallowed.
 */
import { describe, expect, it } from 'vitest'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { dispatch, ROUTES } from '../server/handlers'
import vercelDispatch from '../api/dispatch'

function makeReq(method: string, url: string): IncomingMessage {
  const req = new IncomingMessage(new Socket())
  req.method = method
  req.url = url
  req.headers = { host: 'localhost' }
  return req
}

function makeRes(): { res: ServerResponse; captured: { status: number; body: string } } {
  const captured = { status: 0, body: '' }
  const res = new ServerResponse(new IncomingMessage(new Socket()))
  res.end = ((chunk?: string | Buffer) => {
    if (chunk !== undefined) captured.body = chunk.toString()
    captured.status = res.statusCode
    return res
  }) as typeof res.end
  return { res, captured }
}

describe('dispatch — inventory', () => {
  it('exposes the full set of public admin routes', () => {
    // Pin the inventory. If a handler is added to handlers.ts without a
    // ROUTES entry + dispatch branch, this snapshot fails and the dev
    // adds the wiring before the catch-all silently 404s the new path.
    expect(Object.values(ROUTES).sort()).toEqual(
      [
        '/api/auth/login',
        '/api/auth/logout',
        '/api/auth/session',
        '/api/admin/smoke/run',
        '/api/admin/smoke/status',
        '/api/admin/persona-health',
        '/api/proxy',
        '/api/self-healing-eval/grounding/suggest',
        '/api/self-healing-eval/questions/generate',
        '/api/self-healing-eval/report/',
        '/api/self-healing-eval/report/latest',
        '/api/self-healing-eval/run',
        '/api/self-healing-eval/status',
      ].sort(),
    )
  })

  it('returns true for every known route (so the catch-all forwards them)', async () => {
    // We don't care about the response status here — auth gating + body
    // shape are covered by the per-handler tests. We only assert that
    // dispatch() *claimed* the path. If it returns false the catch-all
    // would 404 a real route.
    const knownPaths = [
      ROUTES.session,
      ROUTES.login,
      ROUTES.logout,
      ROUTES.proxy,
      ROUTES.smokeStatus,
      ROUTES.smokeRun,
      ROUTES.personaHealth,
      ROUTES.evalStatus,
      ROUTES.evalRun,
      ROUTES.evalReportLatest,
      ROUTES.evalQuestionsGenerate,
      ROUTES.evalGroundingSuggest,
      `${ROUTES.evalReportPrefix}some-run-id`,
    ]
    for (const path of knownPaths) {
      const { res } = makeRes()
      const handled = await dispatch(makeReq('GET', path), res)
      expect(handled, `dispatch should claim ${path}`).toBe(true)
    }
  })
})

describe('dispatch — 404', () => {
  it('returns false for unknown /api/* paths so the host can render its own 404', async () => {
    const { res, captured } = makeRes()
    const handled = await dispatch(makeReq('GET', '/api/not-a-real-route'), res)
    expect(handled).toBe(false)
    // Dispatch must not write a response when it returns false — the
    // catch-all (or standalone server) is responsible for the 404 body.
    expect(captured.status).toBe(0)
    expect(captured.body).toBe('')
  })

  it('does not claim the empty eval-report prefix as a runId lookup', async () => {
    // /api/self-healing-eval/report/ with no id should fall through, not
    // dispatch to handleEvalReportById. The "latest" suffix has its own
    // route; the bare prefix is otherwise undefined.
    const { res } = makeRes()
    const handled = await dispatch(makeReq('GET', ROUTES.evalReportPrefix), res)
    expect(handled).toBe(false)
  })

  it('does not claim non-/api paths (host serves the SPA)', async () => {
    const { res } = makeRes()
    const handled = await dispatch(makeReq('GET', '/dashboard'), res)
    expect(handled).toBe(false)
  })
})

describe('vercel adapter — query-param rewrite', () => {
  // Regression for #18 (the real fix). vercel.json's capture is named
  // `:slug*` rather than `:path*` because Vercel auto-injects every
  // named capture onto the rewritten request as a query param of the
  // same name, and that auto-inject *replaces* any same-named query
  // the client sent. With `:path*` the injection clobbered the
  // proxy's `?path=<upstream>` argument, so /api/proxy?path=/admin/X
  // arrived at the function as `path=proxy` and 400'd as `invalid_path`.
  //
  // These tests pin the post-rewrite shape Vercel actually sends:
  // `?_path=<capture>&slug=<capture>` plus whatever the client sent.
  it('preserves a client-sent ?path= alongside the auto-injected ?slug=', async () => {
    const req = makeReq(
      'GET',
      '/api/dispatch?_path=proxy&slug=proxy&path=%2Fadmin%2Fdashboard',
    )
    const { res } = makeRes()
    await vercelDispatch(req, res)
    const u = new URL(req.url ?? '/', 'http://localhost')
    expect(u.pathname).toBe('/api/proxy')
    expect(u.searchParams.get('path')).toBe('/admin/dashboard')
    expect(u.searchParams.get('slug')).toBeNull()
    expect(u.searchParams.get('_path')).toBeNull()
  })

  it('strips the auto-injected ?slug= when no client query was sent', async () => {
    const req = makeReq('GET', '/api/dispatch?_path=proxy&slug=proxy')
    const { res } = makeRes()
    await vercelDispatch(req, res)
    const u = new URL(req.url ?? '/', 'http://localhost')
    expect(u.pathname).toBe('/api/proxy')
    expect(u.searchParams.get('slug')).toBeNull()
  })

  it('preserves the full client query string for nested admin paths', async () => {
    // /api/proxy?path=/admin/subjects?sort_by=last_activity (the
    // browser URL-encodes the inner `?` and `&`).
    const inner = '%2Fadmin%2Fsubjects%3Fsort_by%3Dlast_activity'
    const req = makeReq(
      'GET',
      `/api/dispatch?_path=proxy&slug=proxy&path=${inner}`,
    )
    const { res } = makeRes()
    await vercelDispatch(req, res)
    const u = new URL(req.url ?? '/', 'http://localhost')
    expect(u.searchParams.get('path')).toBe(
      '/admin/subjects?sort_by=last_activity',
    )
  })
})
