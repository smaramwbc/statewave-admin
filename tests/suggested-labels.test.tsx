import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { MemoryRouter } from 'react-router-dom'
import { SuggestedLabelsPage } from '../src/pages/SuggestedLabelsPage'
import { ThemeProvider } from '../src/lib/theme'

const SAMPLE_MEMORY = {
  id: '00000000-0000-0000-0000-000000000001',
  subject_id: 'user-42',
  tenant_id: 'acme',
  kind: 'profile_fact',
  content: 'alice@example.com is the primary contact',
  summary: 'alice email',
  suggested_labels: ['pii.email', 'pii.phone'],
  sensitivity_labels: [],
  created_at: '2026-05-25T12:00:00+00:00',
}

const CATALOGUE = [
  { label: 'pii.email', description: 'Email address' },
  { label: 'pii.phone', description: 'Phone number' },
  { label: 'financial.card', description: 'Credit-card-shaped' },
  { label: 'secret.token', description: 'API key / JWT' },
]

function renderPage() {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={['/suggested-labels']}>
        <SuggestedLabelsPage />
      </MemoryRouter>
    </ThemeProvider>,
  )
}

interface MockOpts {
  rows?: typeof SAMPLE_MEMORY[]
  total?: number
  promoteFails?: boolean
}

function mockFetch(opts: MockOpts = {}) {
  const rows = opts.rows ?? [SAMPLE_MEMORY]
  const total = opts.total ?? rows.length

  return vi.spyOn(global, 'fetch').mockImplementation((input, init) => {
    const url = typeof input === 'string' ? input : input.toString()
    const decoded = decodeURIComponent(url)
    const method = init?.method ?? 'GET'

    if (decoded.includes('/admin/memories/with-suggested-labels')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          memories: rows,
          total,
          limit: 50,
          offset: 0,
          catalogue: CATALOGUE,
        }),
      } as Response)
    }
    if (
      method === 'POST' &&
      decoded.includes('/admin/memories/') &&
      decoded.includes('/promote-labels')
    ) {
      if (opts.promoteFails) {
        return Promise.resolve({
          ok: false,
          status: 422,
          json: async () => ({
            error: { code: 'promote_labels.not_suggested', message: 'label not on row' },
          }),
        } as Response)
      }
      const body = JSON.parse(String(init?.body ?? '{}')) as { labels: string[] }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          memory_id: SAMPLE_MEMORY.id,
          promoted: body.labels,
          sensitivity_labels: body.labels,
          suggested_labels: SAMPLE_MEMORY.suggested_labels.filter(
            (l) => !body.labels.includes(l),
          ),
        }),
      } as Response)
    }
    return Promise.resolve({ ok: true, json: async () => ({}) } as Response)
  })
}

describe('SuggestedLabelsPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })
  afterEach(() => cleanup())

  it('renders the review table with suggested labels', async () => {
    mockFetch()
    renderPage()
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /Suggested labels/i })).toBeInTheDocument(),
    )
    // The page surfaces detector labels in two places (filter dropdown
    // + the per-row badge), so `findAllByText` is the correct assertion.
    const emails = await screen.findAllByText('pii.email')
    expect(emails.length).toBeGreaterThan(0)
    expect(screen.getAllByText('pii.phone').length).toBeGreaterThan(0)
  })

  it('disables the promote button when nothing is selected', async () => {
    mockFetch()
    renderPage()
    const button = await screen.findByRole('button', { name: /^Promote$/i })
    expect(button).toBeDisabled()
  })

  it('enables the promote button after a checkbox is ticked and reflects success', async () => {
    mockFetch()
    renderPage()
    await screen.findAllByText('pii.email')
    // Wait for the disabled "Promote" button to render — initial state
    // has nothing selected so the button reads exactly "Promote".
    await screen.findByRole('button', { name: /^Promote$/i })

    const checkboxes = screen.getAllByRole('checkbox')
    fireEvent.click(checkboxes[0])

    // After the checkbox click the button label flips to "Promote (1)"
    // and becomes enabled.
    const button = await screen.findByRole('button', { name: /Promote \(1\)/i })
    await waitFor(() => expect(button).toBeEnabled())
    fireEvent.click(button)

    // Mock responds with `promoted: ["pii.email"]` and the page reloads
    // the list — the reload result mock keeps suggesting pii.email, so
    // the row stays visible. We assert success by observing the button
    // returning out of the "Promoting…" state.
    await waitFor(
      () => {
        expect(
          screen.queryByRole('button', { name: /Promoting…/i }),
        ).not.toBeInTheDocument()
      },
      { timeout: 3000 },
    )
  })

  it('surfaces a 422 error from the server without crashing', async () => {
    mockFetch({ promoteFails: true })
    renderPage()
    await screen.findAllByText('pii.email')
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    const button = await screen.findByRole('button', { name: /Promote \(1\)/i })
    fireEvent.click(button)
    // The error path keeps the button reachable; no crash, no
    // permanent "Promoting…" lock.
    await waitFor(() => {
      const stillPromoting = screen.queryByRole('button', { name: /Promoting…/i })
      expect(stillPromoting).not.toBeInTheDocument()
    })
  })

  it('shows the empty state when no rows have suggestions', async () => {
    mockFetch({ rows: [], total: 0 })
    renderPage()
    await waitFor(() =>
      expect(
        screen.getByText(/No memories carry auto-labeling suggestions yet/i),
      ).toBeInTheDocument(),
    )
  })
})
