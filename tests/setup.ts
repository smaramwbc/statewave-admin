import '@testing-library/jest-dom/vitest'
import { beforeEach } from 'vitest'

/**
 * The admin UI now sits behind /api/auth/session. Tests that mock fetch must
 * answer that URL too — use this helper to wrap an existing per-URL mock
 * with a session response. See `tests/auth-gate.test.tsx` for tests that
 * explicitly exercise the auth flow.
 */
export const FAKE_SESSION_OK = {
  authenticated: true,
  authDisabled: false,
  configError: null,
  source: 'session' as const,
}

export function makeSessionMock(
  overrides: Partial<typeof FAKE_SESSION_OK> = {},
): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ ...FAKE_SESSION_OK, ...overrides }),
  } as unknown as Response
}

export function isSessionUrl(input: RequestInfo | URL): boolean {
  const u =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : (input as Request).url
  return typeof u === 'string' && u.includes('/api/auth/session')
}

export function isSmokeStatusUrl(input: RequestInfo | URL): boolean {
  const u = urlString(input)
  return typeof u === 'string' && u.includes('/api/admin/smoke/status')
}

export function isSmokeRunUrl(input: RequestInfo | URL): boolean {
  const u = urlString(input)
  return typeof u === 'string' && u.includes('/api/admin/smoke/run')
}

function urlString(input: RequestInfo | URL): string {
  return typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : (input as Request).url
}

/**
 * Minimal smoke-status response — enough to tell the dashboard card that
 * the check has already run, so it does NOT auto-fire from inside other
 * tests. Tests that exercise the smoke flow itself should ignore this and
 * provide their own mock.
 */
export const FAKE_SMOKE_STATUS_DONE = {
  enabled: true,
  has_run: true,
  is_running: false,
  subject_id: 'statewave-demo:first-admin-run',
  last_result: {
    status: 'success' as const,
    started_at: '2026-04-01T00:00:00Z',
    finished_at: '2026-04-01T00:00:01Z',
    duration_ms: 1000,
    backend: { status: 'ok' as const, detail: 'Backend reachable.' },
    demo_job: {
      status: 'ok' as const,
      detail: 'Demo job completed.',
      subject_id: 'statewave-demo:first-admin-run',
      episode_id: 'ep-1',
      job_id: 'job-1',
      memories_created: 1,
      job_mode: 'async' as const,
      subject_visible: true,
    },
    demo_webhook: {
      status: 'ok' as const,
      detail: 'Webhook delivered.',
      state: 'configured_delivered' as const,
      total_before: 0,
      total_after: 1,
      sample: { id: 'wh-1', event: 'episode.created', status: 'delivered', http_status: 200 },
    },
    error: null,
  },
}

export function makeSmokeStatusMock(
  overrides: Partial<typeof FAKE_SMOKE_STATUS_DONE> = {},
): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ ...FAKE_SMOKE_STATUS_DONE, ...overrides }),
  } as unknown as Response
}

/**
 * Reset localStorage between tests so the smoke-card auto-fire flag from
 * one test does not leak into another. happy-dom keeps the same window
 * across renders within a single test file by default.
 */
beforeEach(() => {
  try {
    window.localStorage.clear()
  } catch {
    // happy-dom always exposes localStorage; the try is defensive only
  }
})
