import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { JobsPage } from '../src/pages/JobsPage'
import { ThemeProvider } from '../src/lib/theme'

const mockJobsResponse = {
  jobs: [
    {
      job_id: 'abc12345',
      subject_id: 'user_123',
      tenant_id: 'acme',
      status: 'completed',
      memories_created: 5,
      error: null,
      created_at: '2026-04-30T10:00:00Z',
      started_at: '2026-04-30T10:00:01Z',
      completed_at: '2026-04-30T10:00:03Z',
    },
    {
      job_id: 'def67890',
      subject_id: 'user_456',
      tenant_id: 'acme',
      status: 'failed',
      memories_created: 0,
      error: 'LLM API timeout after 30 seconds',
      created_at: '2026-04-30T09:55:00Z',
      started_at: '2026-04-30T09:55:01Z',
      completed_at: '2026-04-30T09:55:31Z',
    },
    {
      job_id: 'ghi11111',
      subject_id: 'user_789',
      tenant_id: 'acme',
      status: 'running',
      memories_created: 0,
      error: null,
      created_at: '2026-04-30T09:50:00Z',
      started_at: '2026-04-30T09:50:01Z',
      completed_at: null,
    },
    {
      job_id: 'jkl22222',
      subject_id: 'user_000',
      tenant_id: 'acme',
      status: 'pending',
      memories_created: 0,
      error: null,
      created_at: '2026-04-30T10:05:00Z',
      started_at: null,
      completed_at: null,
    },
  ],
  total: 4,
  limit: 50,
  offset: 0,
}

const mockEmptyResponse = {
  jobs: [],
  total: 0,
  limit: 50,
  offset: 0,
}

function renderJobsPage(search = '') {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[`/jobs${search}`]}>
        <Routes>
          <Route path="/jobs" element={<JobsPage />} />
          <Route path="/subjects/:subjectId" element={<div>Subject Page</div>} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>
  )
}

function createMock(options?: { empty?: boolean; error?: boolean }) {
  return vi.spyOn(global, 'fetch').mockImplementation((input) => {
    const url = typeof input === 'string' ? input : input.toString()
    const decoded = decodeURIComponent(url)

    if (options?.error) {
      return Promise.resolve({
        ok: false,
        status: 500,
      } as Response)
    }

    if (decoded.includes('/admin/jobs')) {
      return Promise.resolve({
        ok: true,
        json: async () => (options?.empty ? mockEmptyResponse : mockJobsResponse),
      } as Response)
    }

    return Promise.resolve({
      ok: true,
      json: async () => ({}),
    } as Response)
  })
}

describe('JobsPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    // Mock timers for "stuck" detection and auto-refresh
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2026-04-30T10:10:00Z'))
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('renders loading state initially', () => {
    vi.spyOn(global, 'fetch').mockImplementation(() => new Promise(() => {}))
    renderJobsPage()
    // Initial load uses a TableSkeleton (animate-pulse blocks) instead of
    // the previous full-page LoadingOverlay copy.
    expect(document.querySelector('.animate-pulse')).toBeInTheDocument()
  })

  it('renders job list after fetch', async () => {
    createMock()
    renderJobsPage()

    await waitFor(() => {
      expect(screen.getByText('abc12345')).toBeInTheDocument()
    })

    // Check subjects are displayed
    expect(screen.getByText('user_123')).toBeInTheDocument()
    expect(screen.getByText('user_456')).toBeInTheDocument()
  })

  it('renders status badges correctly', async () => {
    createMock()
    renderJobsPage()

    await waitFor(() => {
      expect(screen.getByText('abc12345')).toBeInTheDocument()
    })

    // Check status badges
    expect(screen.getByText('completed')).toBeInTheDocument()
    expect(screen.getByText('failed')).toBeInTheDocument()
    expect(screen.getByText('running')).toBeInTheDocument()
    expect(screen.getByText('pending')).toBeInTheDocument()
  })

  it('shows error message for failed jobs', async () => {
    createMock()
    renderJobsPage()

    await waitFor(() => {
      expect(screen.getByText('abc12345')).toBeInTheDocument()
    })

    // Check error is displayed (truncated)
    expect(screen.getByText(/LLM API timeout/)).toBeInTheDocument()
  })

  it('shows stuck indicator for long-running jobs', async () => {
    createMock()
    renderJobsPage()

    await waitFor(() => {
      expect(screen.getByText('abc12345')).toBeInTheDocument()
    })

    // The running job started 20 minutes ago (at 09:50:01, current time is 10:10:00)
    // Should show STUCK indicator
    expect(screen.getByText('STUCK')).toBeInTheDocument()
  })

  it('shows stuck warning banner when stuck jobs exist', async () => {
    createMock()
    renderJobsPage()

    await waitFor(() => {
      expect(screen.getByText('abc12345')).toBeInTheDocument()
    })

    // Should show stuck warning banner
    expect(screen.getByText(/1 stuck job/)).toBeInTheDocument()
  })

  it('renders empty state when no jobs', async () => {
    createMock({ empty: true })
    renderJobsPage()

    await waitFor(() => {
      // Premium copy: "No jobs yet" + the helper sentence about when
      // jobs appear. Pinning the title is enough.
      expect(screen.getByText('No jobs yet')).toBeInTheDocument()
    })
  })

  it('renders error state on fetch failure', async () => {
    createMock({ error: true })
    renderJobsPage()

    await waitFor(() => {
      // Structured ErrorState leads with the page-specific title
      // ("Failed to load jobs") instead of the generic fallback.
      expect(screen.getByText('Failed to load jobs')).toBeInTheDocument()
    })
  })

  it('subject links navigate to subject detail', async () => {
    createMock()
    renderJobsPage()

    await waitFor(() => {
      expect(screen.getByText('user_123')).toBeInTheDocument()
    })

    // Subject should be a link
    const subjectLink = screen.getByText('user_123')
    expect(subjectLink.closest('a')).toHaveAttribute('href', '/subjects/user_123')
  })

  it('status filter updates URL', async () => {
    createMock()
    renderJobsPage()

    await waitFor(() => {
      expect(screen.getByText('abc12345')).toBeInTheDocument()
    })

    // The status filter should be present
    const filterSelect = screen.getByRole('combobox')
    expect(filterSelect).toBeInTheDocument()
  })

  it('refresh button triggers reload', async () => {
    const fetchSpy = createMock()
    renderJobsPage()

    await waitFor(() => {
      expect(screen.getByText('abc12345')).toBeInTheDocument()
    })

    // Initial fetch
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    // Click refresh — pin by accessible name so we don't match the button
    // label and the title attribute simultaneously.
    fireEvent.click(screen.getByRole('button', { name: /refresh page data/i }))

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(2)
    })
  })

  it('shows memories created count', async () => {
    createMock()
    renderJobsPage()

    await waitFor(() => {
      expect(screen.getByText('abc12345')).toBeInTheDocument()
    })

    // The completed job created 5 memories
    expect(screen.getByText('5')).toBeInTheDocument()
  })
})

describe('JobsPage - URL State', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2026-04-30T10:10:00Z'))
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('applies status filter from URL', async () => {
    const fetchSpy = createMock()
    renderJobsPage('?status=failed')

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled()
    })

    // Check that the API was called with the status filter
    const fetchUrl = fetchSpy.mock.calls[0][0] as string
    expect(decodeURIComponent(fetchUrl)).toContain('status=failed')
  })

  it('applies page from URL', async () => {
    const fetchSpy = createMock()
    renderJobsPage('?page=2')

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled()
    })

    // Check that the API was called with offset for page 2
    const fetchUrl = fetchSpy.mock.calls[0][0] as string
    expect(decodeURIComponent(fetchUrl)).toContain('offset=50')
  })
})
