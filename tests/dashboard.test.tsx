import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import App from '../src/App'

const mockDashboard = {
  readiness: {
    status: 'ok',
    checks: [
      { name: 'database', status: 'ok', detail: 'connected', latency_ms: 5 },
      { name: 'llm', status: 'ok', detail: 'reachable', latency_ms: 120 },
    ],
  },
  migration: {
    current_revision: '0012_add_health_cache',
    expected_head: '0012_add_health_cache',
    is_compatible: true,
    pending_count: 0,
  },
  counts: { episodes: 1200, memories: 340, subjects: 42 },
  jobs: { completed: 50, failed: 2, running: 1 },
  webhooks: { total: 100, delivered: 90, failed: 5, pending: 3, dead_letter: 2 },
  health_distribution: { healthy: 30, degraded: 8, critical: 4 },
}

describe('Admin Dashboard', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('renders loading state initially', () => {
    vi.spyOn(global, 'fetch').mockImplementation(() => new Promise(() => {}))
    render(<App />)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('renders dashboard data after fetch', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => mockDashboard,
    } as Response)

    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('1,200')).toBeInTheDocument()
    })

    expect(screen.getByText('42')).toBeInTheDocument()
    expect(screen.getByText('340')).toBeInTheDocument()
  })

  it('renders error state on fetch failure', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'))

    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('Failed to load dashboard')).toBeInTheDocument()
    })
  })

  it('shows degraded status chips when failures exist', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => mockDashboard,
    } as Response)

    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('Readiness')).toBeInTheDocument()
    })
  })
})
