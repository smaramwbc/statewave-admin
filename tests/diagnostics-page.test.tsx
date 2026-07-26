/**
 * Tests for the new /diagnostics page.
 *
 * Pins the contract for the new operator-initiated checks surface:
 *   - mounts the SystemSmokeCheck card
 *   - renders the page header
 *   - the smoke card auto-fires on first visit (has_run=false)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, act, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { DiagnosticsPage } from '../src/pages/DiagnosticsPage'
import { isSmokeRunUrl, isSmokeStatusUrl } from './setup'

function jsonRes(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

const FRESH_STATUS = {
  enabled: true,
  has_run: false,
  is_running: false,
  subject_id: 'statewave-demo:first-admin-run',
  last_result: null,
}

const RUN_RESULT = {
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
    sample: null,
  },
  error: null,
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

describe('DiagnosticsPage', () => {
  it('renders a header and hosts the smoke check card', async () => {
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (isSmokeStatusUrl(url)) return Promise.resolve(jsonRes(FRESH_STATUS))
      if (isSmokeRunUrl(url)) return Promise.resolve(jsonRes(RUN_RESULT))
      return Promise.resolve(jsonRes({}))
    })

    await act(async () => {
      render(
        <MemoryRouter>
          <DiagnosticsPage />
        </MemoryRouter>,
      )
    })

    expect(screen.getByText('Diagnostics')).toBeInTheDocument()
    // Smoke card auto-fires and lands on success.
    await waitFor(() => {
      expect(screen.getByText('All checks passed')).toBeInTheDocument()
    })
  })

  it('does NOT auto-fire when the deployment has already run smoke', async () => {
    const calls: string[] = []
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      const u = typeof url === 'string' ? url : url.toString()
      calls.push(u)
      if (isSmokeStatusUrl(url)) {
        return Promise.resolve(
          jsonRes({ ...FRESH_STATUS, has_run: true, last_result: RUN_RESULT }),
        )
      }
      if (isSmokeRunUrl(url)) return Promise.resolve(jsonRes(RUN_RESULT))
      return Promise.resolve(jsonRes({}))
    })

    await act(async () => {
      render(
        <MemoryRouter>
          <DiagnosticsPage />
        </MemoryRouter>,
      )
    })
    await waitFor(() => {
      expect(screen.getByText('All checks passed')).toBeInTheDocument()
    })
    expect(calls.some((u) => u.includes('/api/admin/smoke/run'))).toBe(false)
  })
})
