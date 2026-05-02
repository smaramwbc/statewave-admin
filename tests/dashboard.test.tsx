import React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, act, cleanup } from '@testing-library/react'
import App from '../src/App'
import { isSessionUrl, makeSessionMock } from './setup'

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
  webhooks: { total: 100, delivered: 90, pending: 3, dead_letter: 2 },
  health_distribution: { healthy: 30, degraded: 8, critical: 4 },
}

const mockUsage = {
  episodes: { today: 15, '7d': 120, '30d': 500, total: 1200 },
  memories: { today: 5, '7d': 40, '30d': 180, total: 340 },
  compile_jobs: { today: 3, '7d': 25, '30d': 100, total: 200 },
  webhooks: { today: 10, '7d': 80, '30d': 300, total: 600 },
  active_subjects: { '7d': 12, '30d': 30, total: 42 },
  generated_at: '2026-04-30T12:00:00Z',
  tenant_id: null,
}

function mockFetchSuccess() {
  vi.spyOn(global, 'fetch').mockImplementation((url) => {
    if (isSessionUrl(url)) return Promise.resolve(makeSessionMock())
    const u = typeof url === 'string' ? url : url.toString()
    // URL contains /admin/usage via the proxy path parameter
    if (u.includes('usage')) {
      return Promise.resolve({ ok: true, json: async () => mockUsage } as Response)
    }
    return Promise.resolve({ ok: true, json: async () => mockDashboard } as Response)
  })
}

describe('Admin Dashboard', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders loading state initially', async () => {
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (isSessionUrl(url)) return Promise.resolve(makeSessionMock())
      return new Promise(() => {})
    })
    await act(async () => {
      render(<App />)
    })
    await waitFor(() => {
      expect(screen.getByText('Loading dashboard…')).toBeInTheDocument()
    })
    // Should have spinner overlay
    expect(document.querySelector('.animate-spin')).toBeInTheDocument()
  })

  it('renders dashboard data after fetch', async () => {
    mockFetchSuccess()
    await act(async () => {
      render(<App />)
    })

    await waitFor(() => {
      expect(screen.getByText('Readiness')).toBeInTheDocument()
    }, { timeout: 3000 })

    // StatCards show formatted numbers
    expect(screen.getAllByText('42').length).toBeGreaterThan(0)
    expect(screen.getAllByText('340').length).toBeGreaterThan(0)
  })

  it('renders usage metering section', async () => {
    mockFetchSuccess()
    await act(async () => {
      render(<App />)
    })

    await waitFor(() => {
      expect(screen.getAllByText('Usage (rolling)').length).toBeGreaterThan(0)
    }, { timeout: 3000 })
  })

  it('renders error state on fetch failure', async () => {
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (isSessionUrl(url)) return Promise.resolve(makeSessionMock())
      return Promise.reject(new Error('Network error'))
    })

    await act(async () => {
      render(<App />)
    })

    await waitFor(() => {
      expect(screen.getByText('Failed to load dashboard')).toBeInTheDocument()
    })
  })

  it('subjects card links to subjects page', async () => {
    mockFetchSuccess()
    await act(async () => {
      render(<App />)
    })

    await waitFor(() => {
      // Wait for dashboard data to load
      expect(screen.getByText('Readiness')).toBeInTheDocument()
    }, { timeout: 3000 })

    // Find StatCard links - the Subjects card should link to /subjects
    const allLinks = screen.getAllByRole('link')
    const subjectsCardLink = allLinks.find(link => 
      link.getAttribute('href') === '/subjects' && 
      link.textContent?.includes('42') // The count
    )
    expect(subjectsCardLink).toBeTruthy()
  })

  it('job status rows link to filtered jobs page', async () => {
    mockFetchSuccess()
    await act(async () => {
      render(<App />)
    })

    await waitFor(() => {
      expect(screen.getByText('failed')).toBeInTheDocument()
    }, { timeout: 3000 })

    // Each job status should link to /jobs?status={status}
    const failedLink = screen.getByText('failed').closest('a')
    expect(failedLink).toHaveAttribute('href', '/jobs?status=failed')

    const runningLink = screen.getByText('running').closest('a')
    expect(runningLink).toHaveAttribute('href', '/jobs?status=running')

    const completedLink = screen.getByText('completed').closest('a')
    expect(completedLink).toHaveAttribute('href', '/jobs?status=completed')
  })

  it('webhook counts link to filtered webhooks page', async () => {
    mockFetchSuccess()
    await act(async () => {
      render(<App />)
    })

    await waitFor(() => {
      expect(screen.getByText('Delivered')).toBeInTheDocument()
    }, { timeout: 3000 })

    // Delivered count should link to /webhooks?status=delivered
    const deliveredLink = screen.getByText('Delivered').closest('a')
    expect(deliveredLink).toHaveAttribute('href', '/webhooks?status=delivered')

    // Pending count should link to /webhooks?status=pending
    const pendingLink = screen.getByText('Pending').closest('a')
    expect(pendingLink).toHaveAttribute('href', '/webhooks?status=pending')

    // Dead Letter count should link to /webhooks?status=dead_letter
    const deadLetterLink = screen.getByText('Dead Letter').closest('a')
    expect(deadLetterLink).toHaveAttribute('href', '/webhooks?status=dead_letter')
  })

  it('has view all jobs link', async () => {
    mockFetchSuccess()
    await act(async () => {
      render(<App />)
    })

    await waitFor(() => {
      expect(screen.getByText('View all jobs →')).toBeInTheDocument()
    }, { timeout: 3000 })

    const viewAllLink = screen.getByText('View all jobs →')
    expect(viewAllLink).toHaveAttribute('href', '/jobs')
  })

  it('has view all webhooks link', async () => {
    mockFetchSuccess()
    await act(async () => {
      render(<App />)
    })

    await waitFor(() => {
      expect(screen.getByText('View all webhooks →')).toBeInTheDocument()
    }, { timeout: 3000 })

    const viewAllLink = screen.getByText('View all webhooks →')
    expect(viewAllLink).toHaveAttribute('href', '/webhooks')
  })
})
