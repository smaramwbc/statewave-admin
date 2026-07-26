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
import { MemoryRouter, Route, Routes } from 'react-router'
import { Toaster } from 'sonner'
import { JobsPage } from '../src/pages/JobsPage'
import { ThemeProvider } from '../src/lib/theme'

/**
 * Cleanup affordance tests for JobsPage.
 *
 * Tests the operator path described in issue #24:
 *   - The Cleanup button is gated by a terminal-status filter (or tenant)
 *     so an empty-filter click can't wipe the entire history.
 *   - Confirming the modal calls DELETE with the active filter and the
 *     list refreshes.
 *   - Cancelling the modal never reaches the network.
 *   - Success and failure both surface a toast.
 *   - A no-tenant cleanup gets an explicit cross-tenant warning in the
 *     modal so the operator has to acknowledge it before confirming.
 */

const baseJob = {
  job_id: 'abc12345',
  subject_id: 'user_123',
  tenant_id: 'acme',
  status: 'completed',
  memories_created: 5,
  error: null,
  created_at: '2026-04-30T10:00:00Z',
  started_at: '2026-04-30T10:00:01Z',
  completed_at: '2026-04-30T10:00:03Z',
}

const completedJobsResponse = {
  jobs: [baseJob],
  total: 1,
  limit: 50,
  offset: 0,
}

function renderJobsPage(search = '') {
  return render(
    <ThemeProvider>
      <Toaster position="bottom-right" />
      <MemoryRouter initialEntries={[`/jobs${search}`]}>
        <Routes>
          <Route path="/jobs" element={<JobsPage />} />
          <Route path="/subjects/:subjectId" element={<div>Subject Page</div>} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  )
}

interface MockOpts {
  /** When set, DELETE responses use this status code. */
  deleteStatus?: number
  /** When set, DELETE responses include this `deleted` count. */
  deleted?: number
  /** When set, DELETE rejects with a network-style failure. */
  deleteError?: boolean
}

function installMocks(opts: MockOpts = {}) {
  return vi.spyOn(global, 'fetch').mockImplementation((input, init) => {
    const url = typeof input === 'string' ? input : input.toString()
    const method = (init?.method ?? 'GET').toUpperCase()
    const decoded = decodeURIComponent(url)

    if (method === 'DELETE' && decoded.includes('/admin/jobs')) {
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

    if (decoded.includes('/admin/jobs')) {
      return Promise.resolve({
        ok: true,
        json: async () => completedJobsResponse,
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

describe('JobsPage cleanup', () => {
  it('the Cleanup button is disabled until a terminal-status filter is active', async () => {
    installMocks()
    renderJobsPage()

    const cleanup = await screen.findByRole('button', { name: /^Cleanup$/i })
    expect(cleanup).toBeDisabled()
  })

  it('the Cleanup button is disabled for a non-terminal status', async () => {
    installMocks()
    renderJobsPage('?status=running')

    const cleanup = await screen.findByRole('button', { name: /^Cleanup$/i })
    expect(cleanup).toBeDisabled()
  })

  it('the Cleanup button enables when status=completed and confirms call DELETE', async () => {
    const fetchSpy = installMocks({ deleted: 4 })
    renderJobsPage('?status=completed')

    // Button enabled after the page settles on its filter.
    const cleanupBtn = await waitFor(async () => {
      const b = await screen.findByRole('button', { name: /^Cleanup$/i })
      expect(b).not.toBeDisabled()
      return b
    })

    await act(async () => {
      fireEvent.click(cleanupBtn)
    })

    // Modal appears with the destructive confirm + a Cancel button.
    const dialog = await screen.findByRole('dialog')
    const confirm = within(dialog).getByRole('button', { name: /Delete jobs/i })

    const beforeCallCount = fetchSpy.mock.calls.length
    await act(async () => {
      fireEvent.click(confirm)
    })

    // The DELETE request fired with status=completed in the URL.
    await waitFor(() => {
      const deleteCalls = fetchSpy.mock.calls.filter((c) => {
        const init = c[1] as RequestInit | undefined
        return (init?.method ?? 'GET').toUpperCase() === 'DELETE'
      })
      expect(deleteCalls.length).toBeGreaterThan(0)
      const url = decodeURIComponent(String(deleteCalls[0][0]))
      expect(url).toContain('/admin/jobs')
      expect(url).toContain('status=completed')
    })

    // List is refreshed after success: a follow-up GET fires.
    await waitFor(() => {
      expect(fetchSpy.mock.calls.length).toBeGreaterThan(beforeCallCount)
    })
  })

  it('cancelling the modal does NOT call DELETE', async () => {
    const fetchSpy = installMocks()
    renderJobsPage('?status=failed')

    const cleanupBtn = await waitFor(async () => {
      const b = await screen.findByRole('button', { name: /^Cleanup$/i })
      expect(b).not.toBeDisabled()
      return b
    })
    await act(async () => {
      fireEvent.click(cleanupBtn)
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

  it('a successful cleanup surfaces a "Deleted N compile jobs" toast', async () => {
    installMocks({ deleted: 7 })
    renderJobsPage('?status=failed')

    const cleanupBtn = await waitFor(async () => {
      const b = await screen.findByRole('button', { name: /^Cleanup$/i })
      expect(b).not.toBeDisabled()
      return b
    })
    await act(async () => {
      fireEvent.click(cleanupBtn)
    })

    const dialog = await screen.findByRole('dialog')
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: /Delete jobs/i }))
    })

    // sonner mounts toasts in an aria-live region — match by content.
    await waitFor(() => {
      expect(screen.getByText(/Deleted 7 compile jobs/)).toBeInTheDocument()
    })
  })

  it('a failed cleanup surfaces a "Cleanup failed" toast', async () => {
    installMocks({ deleteStatus: 500 })
    renderJobsPage('?status=failed')

    const cleanupBtn = await waitFor(async () => {
      const b = await screen.findByRole('button', { name: /^Cleanup$/i })
      expect(b).not.toBeDisabled()
      return b
    })
    await act(async () => {
      fireEvent.click(cleanupBtn)
    })
    const dialog = await screen.findByRole('dialog')
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: /Delete jobs/i }))
    })

    await waitFor(() => {
      expect(screen.getByText(/Cleanup failed/)).toBeInTheDocument()
    })
  })

  it('shows a cross-tenant warning when no tenant filter is set', async () => {
    installMocks()
    renderJobsPage('?status=completed')

    const cleanupBtn = await waitFor(async () => {
      const b = await screen.findByRole('button', { name: /^Cleanup$/i })
      expect(b).not.toBeDisabled()
      return b
    })
    await act(async () => {
      fireEvent.click(cleanupBtn)
    })

    const dialog = await screen.findByRole('dialog')
    // The warning text is split across <p> and <span> — match the
    // single text node ("every tenant") that uniquely identifies it.
    expect(within(dialog).getByText(/every tenant/i)).toBeInTheDocument()
  })

  it('hides the cross-tenant warning once a tenant filter is set', async () => {
    installMocks()
    renderJobsPage('?status=completed&tenant=acme')

    const cleanupBtn = await waitFor(async () => {
      const b = await screen.findByRole('button', { name: /^Cleanup$/i })
      expect(b).not.toBeDisabled()
      return b
    })
    await act(async () => {
      fireEvent.click(cleanupBtn)
    })

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByText(/every tenant/i)).not.toBeInTheDocument()
  })

  it('cleanup is enabled by tenant filter alone (no status required)', async () => {
    installMocks()
    renderJobsPage('?tenant=acme')

    const cleanupBtn = await waitFor(async () => {
      const b = await screen.findByRole('button', { name: /^Cleanup$/i })
      expect(b).not.toBeDisabled()
      return b
    })
    expect(cleanupBtn).not.toBeDisabled()
  })

  it('passes the tenant filter on the GET fetch', async () => {
    const fetchSpy = installMocks()
    renderJobsPage('?tenant=acme')

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled()
    })
    const url = decodeURIComponent(String(fetchSpy.mock.calls[0][0]))
    expect(url).toContain('tenant_id=acme')
  })
})
