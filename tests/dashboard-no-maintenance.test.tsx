import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, act, cleanup } from '@testing-library/react'
import App from '../src/App'
import { isSessionUrl, makeSessionMock } from './setup'

/**
 * Regression: per the spec, all memory actions live on the Subjects page,
 * never the Dashboard. This test pins that the Dashboard does NOT render
 * the previous "Maintenance" / "Restore Statewave Support" card.
 */

const mockDashboard = {
  readiness: {
    status: 'ok',
    checks: [{ name: 'database', status: 'ok', detail: 'connected', latency_ms: 5 }],
  },
  migration: {
    current_revision: 'rev',
    expected_head: 'rev',
    is_compatible: true,
    pending_count: 0,
  },
  counts: { episodes: 1, memories: 1, subjects: 1 },
  jobs: {},
  webhooks: { total: 0, delivered: 0, pending: 0, dead_letter: 0 },
  health_distribution: null,
}

const mockUsage = {
  episodes: { today: 0, '7d': 0, '30d': 0, total: 0 },
  memories: { today: 0, '7d': 0, '30d': 0, total: 0 },
  compile_jobs: { today: 0, '7d': 0, '30d': 0, total: 0 },
  webhooks: { today: 0, '7d': 0, '30d': 0, total: 0 },
  active_subjects: { '7d': 0, '30d': 0, total: 0 },
  generated_at: '2026-05-01T00:00:00Z',
  tenant_id: null,
}

describe('Dashboard — memory actions are not present', () => {
  beforeEach(() => {
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (isSessionUrl(url)) return Promise.resolve(makeSessionMock())
      const u = typeof url === 'string' ? url : (url as URL).toString()
      if (u.includes('usage')) {
        return Promise.resolve({ ok: true, json: async () => mockUsage } as Response)
      }
      return Promise.resolve({ ok: true, json: async () => mockDashboard } as Response)
    })
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('does not show "Maintenance" section heading on the Dashboard', async () => {
    await act(async () => {
      render(<App />)
    })
    await waitFor(() => {
      expect(screen.getByText('Readiness')).toBeInTheDocument()
    })
    expect(screen.queryByText(/^Maintenance$/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Restore Statewave Support docs/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Re-seed/i })).not.toBeInTheDocument()
  })
})
