import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  render,
  screen,
  waitFor,
  cleanup,
  fireEvent,
  act,
  within,
} from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { Toaster } from 'sonner'
import { WebhooksPage } from '../src/pages/WebhooksPage'
import { ThemeProvider } from '../src/lib/theme'

/**
 * Cleanup affordance tests for WebhooksPage. Mirrors the JobsPage cleanup
 * suite; see comments there for the per-case rationale.
 */

const baseEvent = {
  id: 'aaaa1111-2222-3333-4444-555566667777',
  event: 'episode.created',
  status: 'dead_letter',
  attempts: 5,
  max_attempts: 5,
  last_attempt_at: '2026-04-30T10:00:01Z',
  next_attempt_at: null,
  last_error: 'HTTP 429',
  http_status: 429,
  created_at: '2026-04-30T10:00:00Z',
  delivered_at: null,
  tenant_id: 'acme',
}

const eventsResponse = {
  events: [baseEvent],
  total: 1,
  limit: 50,
  offset: 0,
}

function renderWebhooksPage(search = '') {
  return render(
    <ThemeProvider>
      <Toaster position="bottom-right" />
      <MemoryRouter initialEntries={[`/webhooks${search}`]}>
        <Routes>
          <Route path="/webhooks" element={<WebhooksPage />} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  )
}

interface MockOpts {
  deleteStatus?: number
  deleted?: number
  deleteError?: boolean
}

function installMocks(opts: MockOpts = {}) {
  return vi.spyOn(global, 'fetch').mockImplementation((input, init) => {
    const url = typeof input === 'string' ? input : input.toString()
    const method = (init?.method ?? 'GET').toUpperCase()
    const decoded = decodeURIComponent(url)

    if (method === 'DELETE' && decoded.includes('/admin/webhooks')) {
      if (opts.deleteError) {
        return Promise.reject(new Error('network down'))
      }
      const status = opts.deleteStatus ?? 200
      const ok = status >= 200 && status < 300
      return Promise.resolve({
        ok,
        status,
        json: async () =>
          ok ? { deleted: opts.deleted ?? 1 } : { error: { message: 'forbidden' } },
      } as Response)
    }

    if (decoded.includes('/admin/webhooks')) {
      return Promise.resolve({
        ok: true,
        json: async () => eventsResponse,
      } as Response)
    }

    return Promise.resolve({ ok: true, json: async () => ({}) } as Response)
  })
}

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  cleanup()
})

describe('WebhooksPage cleanup', () => {
  it('the Cleanup button is disabled until a filter is active', async () => {
    installMocks()
    renderWebhooksPage()

    const btn = await screen.findByRole('button', { name: /^Cleanup$/i })
    expect(btn).toBeDisabled()
  })

  it('the Cleanup button is disabled when only a non-terminal status is set', async () => {
    installMocks()
    renderWebhooksPage('?status=pending')

    const btn = await screen.findByRole('button', { name: /^Cleanup$/i })
    expect(btn).toBeDisabled()
  })

  it('confirming with status=dead_letter calls DELETE and refreshes', async () => {
    const fetchSpy = installMocks({ deleted: 50 })
    renderWebhooksPage('?status=dead_letter')

    const btn = await waitFor(async () => {
      const b = await screen.findByRole('button', { name: /^Cleanup$/i })
      expect(b).not.toBeDisabled()
      return b
    })
    await act(async () => {
      fireEvent.click(btn)
    })

    const dialog = await screen.findByRole('dialog')
    const beforeCallCount = fetchSpy.mock.calls.length
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: /Delete events/i }))
    })

    await waitFor(() => {
      const deleteCalls = fetchSpy.mock.calls.filter((c) => {
        const init = c[1] as RequestInit | undefined
        return (init?.method ?? 'GET').toUpperCase() === 'DELETE'
      })
      expect(deleteCalls.length).toBeGreaterThan(0)
      const url = decodeURIComponent(String(deleteCalls[0][0]))
      expect(url).toContain('/admin/webhooks')
      expect(url).toContain('status=dead_letter')
    })

    await waitFor(() => {
      expect(fetchSpy.mock.calls.length).toBeGreaterThan(beforeCallCount)
    })
  })

  it('cancelling the modal does NOT call DELETE', async () => {
    const fetchSpy = installMocks()
    renderWebhooksPage('?status=delivered')

    const btn = await waitFor(async () => {
      const b = await screen.findByRole('button', { name: /^Cleanup$/i })
      expect(b).not.toBeDisabled()
      return b
    })
    await act(async () => {
      fireEvent.click(btn)
    })
    const dialog = await screen.findByRole('dialog')
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: /Cancel/i }))
    })

    const deleteCalls = fetchSpy.mock.calls.filter((c) => {
      const init = c[1] as RequestInit | undefined
      return (init?.method ?? 'GET').toUpperCase() === 'DELETE'
    })
    expect(deleteCalls.length).toBe(0)
  })

  it('a successful cleanup surfaces a "Deleted N webhook events" toast', async () => {
    installMocks({ deleted: 50 })
    renderWebhooksPage('?status=dead_letter')

    const btn = await waitFor(async () => {
      const b = await screen.findByRole('button', { name: /^Cleanup$/i })
      expect(b).not.toBeDisabled()
      return b
    })
    await act(async () => {
      fireEvent.click(btn)
    })
    const dialog = await screen.findByRole('dialog')
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: /Delete events/i }))
    })

    await waitFor(() => {
      expect(screen.getByText(/Deleted 50 webhook events/)).toBeInTheDocument()
    })
  })

  it('a failed cleanup surfaces a "Cleanup failed" toast', async () => {
    installMocks({ deleteStatus: 500 })
    renderWebhooksPage('?status=dead_letter')

    const btn = await waitFor(async () => {
      const b = await screen.findByRole('button', { name: /^Cleanup$/i })
      expect(b).not.toBeDisabled()
      return b
    })
    await act(async () => {
      fireEvent.click(btn)
    })
    const dialog = await screen.findByRole('dialog')
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: /Delete events/i }))
    })

    await waitFor(() => {
      expect(screen.getByText(/Cleanup failed/)).toBeInTheDocument()
    })
  })

  it('shows a cross-tenant warning when no tenant filter is set', async () => {
    installMocks()
    renderWebhooksPage('?status=dead_letter')

    const btn = await waitFor(async () => {
      const b = await screen.findByRole('button', { name: /^Cleanup$/i })
      expect(b).not.toBeDisabled()
      return b
    })
    await act(async () => {
      fireEvent.click(btn)
    })

    const dialog = await screen.findByRole('dialog')
    // The warning text is split across <p> and <span> — match the
    // single text node ("every tenant") that uniquely identifies it.
    expect(within(dialog).getByText(/every tenant/i)).toBeInTheDocument()
  })

  it('hides the cross-tenant warning once a tenant filter is set', async () => {
    installMocks()
    renderWebhooksPage('?status=dead_letter&tenant=acme')

    const btn = await waitFor(async () => {
      const b = await screen.findByRole('button', { name: /^Cleanup$/i })
      expect(b).not.toBeDisabled()
      return b
    })
    await act(async () => {
      fireEvent.click(btn)
    })

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByText(/every tenant/i)).not.toBeInTheDocument()
  })

  it('cleanup is enabled by tenant filter alone (no status required)', async () => {
    installMocks()
    renderWebhooksPage('?tenant=acme')

    const btn = await waitFor(async () => {
      const b = await screen.findByRole('button', { name: /^Cleanup$/i })
      expect(b).not.toBeDisabled()
      return b
    })
    expect(btn).not.toBeDisabled()
  })

  it('passes the tenant filter on the GET fetch', async () => {
    const fetchSpy = installMocks()
    renderWebhooksPage('?tenant=acme')

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled()
    })
    const url = decodeURIComponent(String(fetchSpy.mock.calls[0][0]))
    expect(url).toContain('tenant_id=acme')
  })
})
