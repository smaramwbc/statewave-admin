import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { WebhooksPage } from '../src/pages/WebhooksPage'
import { ThemeProvider } from '../src/lib/theme'

const mockWebhooksResponse = {
  events: [
    {
      id: 'aaaa1111-2222-3333-4444-555566667777',
      event: 'episode.created',
      status: 'delivered',
      attempts: 1,
      max_attempts: 5,
      last_attempt_at: '2026-04-30T10:00:01Z',
      next_attempt_at: null,
      last_error: null,
      http_status: 200,
      created_at: '2026-04-30T10:00:00Z',
      delivered_at: '2026-04-30T10:00:01Z',
      tenant_id: 'acme',
    },
    {
      id: 'bbbb2222-3333-4444-5555-666677778888',
      event: 'memory.compiled',
      status: 'dead_letter',
      attempts: 5,
      max_attempts: 5,
      last_attempt_at: '2026-04-30T09:55:30Z',
      next_attempt_at: null,
      last_error: 'Connection refused: 127.0.0.1:8080',
      http_status: null,
      created_at: '2026-04-30T09:50:00Z',
      delivered_at: null,
      tenant_id: 'acme',
    },
    {
      id: 'cccc3333-4444-5555-6666-777788889999',
      event: 'episode.created',
      status: 'pending',
      attempts: 2,
      max_attempts: 5,
      last_attempt_at: '2026-04-30T10:05:00Z',
      next_attempt_at: '2026-04-30T10:08:00Z',
      last_error: 'HTTP 503: Service Unavailable',
      http_status: 503,
      created_at: '2026-04-30T10:04:00Z',
      delivered_at: null,
      tenant_id: 'acme',
    },
    {
      id: 'dddd4444-5555-6666-7777-88889999aaaa',
      event: 'subject.deleted',
      status: 'pending',
      attempts: 0,
      max_attempts: 5,
      last_attempt_at: null,
      next_attempt_at: '2026-04-30T10:06:00Z',
      last_error: null,
      http_status: null,
      created_at: '2026-04-30T10:05:30Z',
      delivered_at: null,
      tenant_id: 'acme',
    },
  ],
  total: 4,
  limit: 50,
  offset: 0,
}

const mockEmptyResponse = {
  events: [],
  total: 0,
  limit: 50,
  offset: 0,
}

function renderWebhooksPage(search = '') {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[`/webhooks${search}`]}>
        <Routes>
          <Route path="/webhooks" element={<WebhooksPage />} />
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

    if (decoded.includes('/admin/webhooks')) {
      return Promise.resolve({
        ok: true,
        json: async () => (options?.empty ? mockEmptyResponse : mockWebhooksResponse),
      } as Response)
    }

    return Promise.resolve({
      ok: true,
      json: async () => ({}),
    } as Response)
  })
}

describe('WebhooksPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    // Mock timers for "stalled" detection and auto-refresh
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2026-04-30T10:10:00Z'))
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('renders loading state initially', () => {
    vi.spyOn(global, 'fetch').mockImplementation(() => new Promise(() => {}))
    renderWebhooksPage()
    // Initial load uses a TableSkeleton (animate-pulse blocks) instead of
    // the previous full-page LoadingOverlay copy.
    expect(document.querySelector('.animate-pulse')).toBeInTheDocument()
  })

  it('renders event list after fetch', async () => {
    createMock()
    renderWebhooksPage()

    await waitFor(() => {
      expect(screen.getByText('aaaa1111…')).toBeInTheDocument()
    })

    // Check event types are displayed (using getAllBy since they appear in both filter and table)
    expect(screen.getAllByText('episode.created').length).toBeGreaterThan(0)
    expect(screen.getAllByText('memory.compiled').length).toBeGreaterThan(0)
  })

  it('renders status badges correctly', async () => {
    createMock()
    renderWebhooksPage()

    await waitFor(() => {
      expect(screen.getByText('aaaa1111…')).toBeInTheDocument()
    })

    // Check status badges
    expect(screen.getByText('delivered')).toBeInTheDocument()
    expect(screen.getByText('dead_letter')).toBeInTheDocument()
    expect(screen.getAllByText('pending').length).toBeGreaterThan(0)
  })

  it('shows error message for failed events', async () => {
    createMock()
    renderWebhooksPage()

    await waitFor(() => {
      expect(screen.getByText('aaaa1111…')).toBeInTheDocument()
    })

    // Check error is displayed (truncated)
    expect(screen.getByText(/Connection refused/)).toBeInTheDocument()
  })

  it('shows RETRY indicator for pending events with attempts', async () => {
    createMock()
    renderWebhooksPage()

    await waitFor(() => {
      expect(screen.getByText('aaaa1111…')).toBeInTheDocument()
    })

    // The third event (cccc3333) has status=pending and attempts=2
    expect(screen.getByText('RETRY')).toBeInTheDocument()
  })

  it('shows problem warning banner when dead_letter events exist', async () => {
    createMock()
    renderWebhooksPage()

    await waitFor(() => {
      expect(screen.getByText('aaaa1111…')).toBeInTheDocument()
    })

    // Should show problem warning banner (1 dead_letter)
    expect(screen.getByText(/1 problem event/)).toBeInTheDocument()
  })

  it('renders empty state when no events', async () => {
    createMock({ empty: true })
    renderWebhooksPage()

    await waitFor(() => {
      // Premium copy: "No webhook events yet" + helper sentence.
      expect(screen.getByText('No webhook events yet')).toBeInTheDocument()
    })
  })

  it('renders error state on fetch failure', async () => {
    createMock({ error: true })
    renderWebhooksPage()

    await waitFor(() => {
      // Structured ErrorState leads with the page-specific title.
      expect(screen.getByText('Failed to load webhook events')).toBeInTheDocument()
    })
  })

  it('displays attempt counts', async () => {
    createMock()
    renderWebhooksPage()

    await waitFor(() => {
      expect(screen.getByText('aaaa1111…')).toBeInTheDocument()
    })

    // Check attempt counts are shown (1/5, 5/5, 2/5, 0/5)
    expect(screen.getByText('1/5')).toBeInTheDocument()
    expect(screen.getByText('5/5')).toBeInTheDocument()
    expect(screen.getByText('2/5')).toBeInTheDocument()
    expect(screen.getByText('0/5')).toBeInTheDocument()
  })

  it('displays HTTP status codes', async () => {
    createMock()
    renderWebhooksPage()

    await waitFor(() => {
      expect(screen.getByText('aaaa1111…')).toBeInTheDocument()
    })

    // Check HTTP status codes
    expect(screen.getByText('200')).toBeInTheDocument()
    expect(screen.getByText('503')).toBeInTheDocument()
  })

  it('refresh button triggers reload', async () => {
    const fetchSpy = createMock()
    renderWebhooksPage()

    await waitFor(() => {
      expect(screen.getByText('aaaa1111…')).toBeInTheDocument()
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
})

describe('WebhooksPage - URL State', () => {
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
    renderWebhooksPage('?status=dead_letter')

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled()
    })

    // Check that the API was called with the status filter
    const fetchUrl = fetchSpy.mock.calls[0][0] as string
    expect(decodeURIComponent(fetchUrl)).toContain('status=dead_letter')
  })

  it('applies event type filter from URL', async () => {
    const fetchSpy = createMock()
    renderWebhooksPage('?event=episode.created')

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled()
    })

    // Check that the API was called with the event_type filter
    const fetchUrl = fetchSpy.mock.calls[0][0] as string
    expect(decodeURIComponent(fetchUrl)).toContain('event_type=episode.created')
  })

  it('applies page from URL', async () => {
    const fetchSpy = createMock()
    renderWebhooksPage('?page=2')

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled()
    })

    // Check that the API was called with offset for page 2
    const fetchUrl = fetchSpy.mock.calls[0][0] as string
    expect(decodeURIComponent(fetchUrl)).toContain('offset=50')
  })

  it('combines multiple filters in URL', async () => {
    const fetchSpy = createMock()
    renderWebhooksPage('?status=pending&event=memory.compiled')

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled()
    })

    const fetchUrl = fetchSpy.mock.calls[0][0] as string
    const decoded = decodeURIComponent(fetchUrl)
    expect(decoded).toContain('status=pending')
    expect(decoded).toContain('event_type=memory.compiled')
  })
})
