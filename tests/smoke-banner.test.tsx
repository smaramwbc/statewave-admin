/**
 * Tests for the dashboard SmokeCheckBanner.
 *
 * The banner is the lightweight "first-run / something-broke" nudge that
 * lives on the Overview page. The full smoke card lives on /diagnostics.
 *
 * Spec the banner pins:
 *   - has_run=false                  → renders + links to /diagnostics
 *   - last_result.status=failed      → renders amber + links to /diagnostics
 *   - last_result.status=partial     → renders amber + links to /diagnostics
 *   - last_result.status=success     → renders nothing (clean dashboard)
 *   - enabled=false                  → renders nothing (operator opted out)
 *   - status fetch errors            → renders nothing (non-blocking)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, act, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SmokeCheckBanner } from '../src/components/SmokeCheckBanner'
import { isSmokeStatusUrl } from './setup'

function jsonRes(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

function renderInRouter() {
  return render(
    <MemoryRouter>
      <SmokeCheckBanner />
    </MemoryRouter>,
  )
}

const SUCCESS_RESULT = {
  status: 'success',
  started_at: '2026-04-01T00:00:00Z',
  finished_at: '2026-04-01T00:00:01Z',
  duration_ms: 1000,
  backend: { status: 'ok', detail: 'ok' },
  demo_job: {
    status: 'ok',
    detail: 'ok',
    subject_id: 'statewave-demo:first-admin-run',
    episode_id: 'ep-1',
    job_id: 'job-1',
    memories_created: 1,
    job_mode: 'async',
    subject_visible: true,
  },
  demo_webhook: {
    status: 'ok',
    detail: 'ok',
    state: 'configured_delivered',
    total_before: 0,
    total_after: 1,
    sample: { id: 'wh-1', event: 'episode.created', status: 'delivered', http_status: 200 },
  },
  error: null,
}

beforeEach(() => {
  vi.restoreAllMocks()
})
afterEach(() => {
  cleanup()
})

describe('SmokeCheckBanner — rendering rules', () => {
  it('renders the "pending" prompt when smoke has never run', async () => {
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (isSmokeStatusUrl(url)) {
        return Promise.resolve(
          jsonRes({
            enabled: true,
            has_run: false,
            is_running: false,
            subject_id: 'statewave-demo:first-admin-run',
            last_result: null,
          }),
        )
      }
      return Promise.resolve(jsonRes({}))
    })

    await act(async () => {
      renderInRouter()
    })
    await waitFor(() => {
      expect(screen.getByText(/First-run system check pending/i)).toBeInTheDocument()
    })
    const link = screen.getByText(/Run now →/i).closest('a')
    expect(link).toHaveAttribute('href', '/diagnostics')
  })

  it('renders the "needs attention" amber state when a previous run failed', async () => {
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (isSmokeStatusUrl(url)) {
        return Promise.resolve(
          jsonRes({
            enabled: true,
            has_run: true,
            is_running: false,
            subject_id: 'statewave-demo:first-admin-run',
            last_result: { ...SUCCESS_RESULT, status: 'failed' },
          }),
        )
      }
      return Promise.resolve(jsonRes({}))
    })

    await act(async () => {
      renderInRouter()
    })
    await waitFor(() => {
      expect(screen.getByText(/needs attention/i)).toBeInTheDocument()
    })
    expect(screen.getByText(/View diagnostics →/i)).toBeInTheDocument()
  })

  it('renders nothing when the last run succeeded (clean dashboard)', async () => {
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (isSmokeStatusUrl(url)) {
        return Promise.resolve(
          jsonRes({
            enabled: true,
            has_run: true,
            is_running: false,
            subject_id: 'statewave-demo:first-admin-run',
            last_result: SUCCESS_RESULT,
          }),
        )
      }
      return Promise.resolve(jsonRes({}))
    })

    const { container } = renderInRouter()
    // Wait long enough for the status fetch to resolve, then assert the
    // banner has rendered nothing visible.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    await waitFor(() => {
      expect(container.querySelector('[role="status"]')).toBeNull()
    })
  })

  it('renders nothing when the smoke check is disabled by env', async () => {
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (isSmokeStatusUrl(url)) {
        return Promise.resolve(
          jsonRes({
            enabled: false,
            has_run: false,
            is_running: false,
            subject_id: 'statewave-demo:first-admin-run',
            last_result: null,
          }),
        )
      }
      return Promise.resolve(jsonRes({}))
    })

    const { container } = renderInRouter()
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(container.querySelector('[role="status"]')).toBeNull()
  })

  it('renders nothing when the status fetch fails (non-blocking)', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(() =>
      Promise.reject(new Error('network down')),
    )

    const { container } = renderInRouter()
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(container.querySelector('[role="status"]')).toBeNull()
  })
})

describe('SmokeCheckBanner — independence from Self-Healing Eval', () => {
  /**
   * Pins the contract that the Overview banner reflects ONLY the smoke
   * check. A failed Self-Healing Eval run must never push the banner
   * back onto the Dashboard, and the banner must never call the eval
   * status endpoint. Overview stays clean on healthy installs even if
   * the operator has had failing eval runs.
   */
  it('renders nothing on successful smoke check, even if a hypothetical eval failure existed', async () => {
    const calledUrls: string[] = []
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      const u = typeof url === 'string' ? url : url.toString()
      calledUrls.push(u)
      if (isSmokeStatusUrl(url)) {
        return Promise.resolve(
          jsonRes({
            enabled: true,
            has_run: true,
            is_running: false,
            subject_id: 'statewave-demo:first-admin-run',
            last_result: SUCCESS_RESULT,
          }),
        )
      }
      // Eval endpoints would respond with a failed run here, but the
      // banner must not query them and must not surface them. If we
      // see the banner calling /api/self-healing-eval/* the test fails.
      return Promise.resolve(
        jsonRes({
          availability: { available: false, enabled: false, reasons: [] },
          is_running: false,
          latest: {
            run_id: 'eval-deadbeef',
            status: 'fail',
            finished_at: '2026-04-01T00:00:00Z',
            overall_score: 0.1,
            mode: 'smoke',
          },
        }),
      )
    })

    const { container } = renderInRouter()
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    // No banner rendered on the Dashboard.
    expect(container.querySelector('[role="status"]')).toBeNull()
    // And the banner never called the eval endpoints.
    for (const u of calledUrls) {
      expect(u).not.toContain('/api/self-healing-eval/')
    }
  })

  it('does not show the "needs attention" amber state for an eval failure', async () => {
    // Smoke is green; eval has failed previously. The amber banner is
    // gated on smoke result only — not eval — so the dashboard stays
    // clean. (This is the contract that keeps Overview from drifting
    // into a junk drawer.)
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (isSmokeStatusUrl(url)) {
        return Promise.resolve(
          jsonRes({
            enabled: true,
            has_run: true,
            is_running: false,
            subject_id: 'statewave-demo:first-admin-run',
            last_result: SUCCESS_RESULT,
          }),
        )
      }
      return Promise.resolve(jsonRes({}))
    })

    renderInRouter()
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(screen.queryByText(/needs attention/i)).toBeNull()
    expect(screen.queryByText(/View diagnostics →/i)).toBeNull()
    expect(screen.queryByText(/eval/i)).toBeNull()
  })
})
