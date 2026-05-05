/**
 * UI tests for the dashboard SystemSmokeCheck card.
 *
 * Pins the spec's user-visible contract:
 *   - First mount with `has_run: false` auto-fires the run.
 *   - The card renders backend / demo job / demo webhook lines with the
 *     right status badges (success, partial, not-configured neutral).
 *   - The "Run smoke check again" button re-triggers `/api/admin/smoke/run`.
 *   - When the smoke endpoint is unreachable, the card shows a graceful
 *     error and never throws — non-blocking is part of the contract.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, act, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SystemSmokeCheck } from '../src/components/SystemSmokeCheck'
import {
  isSmokeRunUrl,
  isSmokeStatusUrl,
} from './setup'

function renderInRouter() {
  return render(
    <MemoryRouter>
      <SystemSmokeCheck />
    </MemoryRouter>,
  )
}

interface SmokeFixture {
  enabled?: boolean
  has_run?: boolean
  is_running?: boolean
  subject_id?: string
  last_result?: unknown
}

function statusBody(over: SmokeFixture = {}): unknown {
  return {
    enabled: over.enabled ?? true,
    has_run: over.has_run ?? true,
    is_running: over.is_running ?? false,
    subject_id: over.subject_id ?? 'statewave-demo:first-admin-run',
    last_result: over.last_result ?? {
      status: 'success',
      started_at: '2026-04-01T00:00:00Z',
      finished_at: '2026-04-01T00:00:01Z',
      duration_ms: 1000,
      backend: { status: 'ok', detail: 'Backend reachable.' },
      demo_job: {
        status: 'ok',
        detail: 'Demo job ok.',
        subject_id: 'statewave-demo:first-admin-run',
        episode_id: 'ep-1',
        job_id: 'job-1',
        memories_created: 1,
        job_mode: 'async',
        subject_visible: true,
      },
      demo_webhook: {
        status: 'ok',
        detail: 'Webhook delivered.',
        state: 'configured_delivered',
        total_before: 0,
        total_after: 1,
        sample: { id: 'wh-1', event: 'episode.created', status: 'delivered', http_status: 200 },
      },
      error: null,
    },
  }
}

function jsonRes(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

beforeEach(() => {
  vi.restoreAllMocks()
  try {
    window.localStorage.clear()
  } catch {
    /* ignore */
  }
})
afterEach(() => {
  cleanup()
})

describe('SystemSmokeCheck — first run auto-fires', () => {
  it('calls /api/admin/smoke/run when status reports has_run=false', async () => {
    const calls: string[] = []
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      const u = typeof url === 'string' ? url : url.toString()
      calls.push(u)
      if (isSmokeStatusUrl(url)) {
        return Promise.resolve(jsonRes(statusBody({ has_run: false, last_result: null })))
      }
      if (isSmokeRunUrl(url)) {
        return Promise.resolve(
          jsonRes(statusBody().last_result),
        )
      }
      return Promise.resolve(jsonRes({}))
    })

    await act(async () => {
      renderInRouter()
    })
    await waitFor(() => {
      expect(calls.some((u) => u.includes('/api/admin/smoke/run'))).toBe(true)
    })
    await waitFor(() => {
      expect(screen.getByText('All checks passed')).toBeInTheDocument()
    })
  })

  it('renders a link to /jobs when the demo job has a job_id', async () => {
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (isSmokeStatusUrl(url)) {
        return Promise.resolve(jsonRes(statusBody()))
      }
      return Promise.resolve(jsonRes({}))
    })

    await act(async () => {
      renderInRouter()
    })
    await waitFor(() => {
      expect(screen.getByText(/View compile job in \/jobs/i)).toBeInTheDocument()
    })
    const link = screen.getByText(/View compile job in \/jobs/i).closest('a')
    expect(link).toHaveAttribute('href', '/jobs')
  })

  it('does NOT auto-fire when status already reports has_run=true', async () => {
    const calls: string[] = []
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      const u = typeof url === 'string' ? url : url.toString()
      calls.push(u)
      if (isSmokeStatusUrl(url)) {
        return Promise.resolve(jsonRes(statusBody()))
      }
      if (isSmokeRunUrl(url)) {
        return Promise.resolve(jsonRes(statusBody().last_result))
      }
      return Promise.resolve(jsonRes({}))
    })

    await act(async () => {
      renderInRouter()
    })
    await waitFor(() => {
      expect(screen.getByText('All checks passed')).toBeInTheDocument()
    })
    expect(calls.some((u) => u.includes('/api/admin/smoke/run'))).toBe(false)
  })
})

describe('SystemSmokeCheck — webhook states', () => {
  it('renders "not configured" neutral state when webhooks are off', async () => {
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (isSmokeStatusUrl(url)) {
        return Promise.resolve(
          jsonRes(
            statusBody({
              last_result: {
                ...(statusBody().last_result as Record<string, unknown>),
                demo_webhook: {
                  status: 'skipped',
                  detail: 'Webhooks are not configured on the backend — nothing to test.',
                  state: 'not_configured',
                  total_before: 0,
                  total_after: 0,
                  sample: null,
                },
              },
            }),
          ),
        )
      }
      return Promise.resolve(jsonRes({}))
    })

    await act(async () => {
      renderInRouter()
    })
    await waitFor(() => {
      expect(screen.getByText(/Webhooks are not configured/i)).toBeInTheDocument()
    })
    // The "not configured" badge also renders next to the row.
    expect(screen.getAllByText(/not configured/i).length).toBeGreaterThanOrEqual(1)
  })

  it('renders the "partial" state when webhook delivery failed', async () => {
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (isSmokeStatusUrl(url)) {
        return Promise.resolve(
          jsonRes(
            statusBody({
              last_result: {
                ...(statusBody().last_result as Record<string, unknown>),
                status: 'partial',
                demo_webhook: {
                  status: 'failed',
                  detail: "Most recent webhook (episode.created) is in 'dead_letter' state. Inspect /webhooks for details.",
                  state: 'configured_failed',
                  total_before: 0,
                  total_after: 1,
                  sample: { id: 'wh-1', event: 'episode.created', status: 'dead_letter', http_status: 500 },
                },
              },
            }),
          ),
        )
      }
      return Promise.resolve(jsonRes({}))
    })

    await act(async () => {
      renderInRouter()
    })
    await waitFor(() => {
      expect(screen.getByText('Demo flow ok, webhook needs attention')).toBeInTheDocument()
    })
  })
})

describe('SystemSmokeCheck — manual rerun + error states', () => {
  it('Run-again button POSTs /api/admin/smoke/run', async () => {
    let runCalls = 0
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (isSmokeStatusUrl(url)) {
        return Promise.resolve(jsonRes(statusBody()))
      }
      if (isSmokeRunUrl(url)) {
        runCalls += 1
        return Promise.resolve(jsonRes(statusBody().last_result))
      }
      return Promise.resolve(jsonRes({}))
    })

    await act(async () => {
      renderInRouter()
    })
    await waitFor(() => {
      expect(screen.getByText('All checks passed')).toBeInTheDocument()
    })

    const btn = screen.getByRole('button', { name: /run smoke check again/i })
    await act(async () => {
      fireEvent.click(btn)
    })
    await waitFor(() => {
      expect(runCalls).toBe(1)
    })
  })

  it('renders a graceful error when the smoke status fetch fails', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(() => {
      return Promise.reject(new Error('network down'))
    })

    await act(async () => {
      renderInRouter()
    })
    await waitFor(() => {
      expect(
        screen.getByText(/Could not contact the admin smoke endpoint/i),
      ).toBeInTheDocument()
    })
  })

  it('shows the disabled message when ADMIN_SMOKE_DISABLED=true', async () => {
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (isSmokeStatusUrl(url)) {
        return Promise.resolve(
          jsonRes(statusBody({ enabled: false, has_run: false, last_result: null })),
        )
      }
      return Promise.resolve(jsonRes({}))
    })

    await act(async () => {
      renderInRouter()
    })
    await waitFor(() => {
      expect(screen.getByText(/Smoke check disabled/)).toBeInTheDocument()
    })
    expect(screen.getByText(/ADMIN_SMOKE_DISABLED/)).toBeInTheDocument()
  })
})
