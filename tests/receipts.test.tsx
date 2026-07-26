import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { MemoryRouter, Route, Routes } from 'react-router'
import { ReceiptsPage } from '../src/pages/ReceiptsPage'
import { ThemeProvider } from '../src/lib/theme'

const SAMPLE_RECEIPT = {
  receipt_id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  parent_receipt_id: null,
  mode: 'retrieval',
  query_id: null,
  task_id: null,
  tenant_id: 'acme',
  subject_id: 'user-42',
  task: 'What plan is the customer on?',
  as_of: '2026-05-12T10:00:00+00:00',
  created_at: '2026-05-12T10:00:00+00:00',
  selected_entries: [
    {
      type: 'memory',
      memory_id: '00000000-0000-0000-0000-000000000001',
      kind: 'profile_fact',
      valid_from: '2026-05-01T00:00:00+00:00',
      valid_to: null,
      supersession_status: 'active',
      source_episode_ids: [],
      provenance_hash: 'deadbeef',
      fact_key: null,
      conflict_status: 'none',
      rank: 1,
      score: 14.2,
    },
    {
      type: 'episode',
      episode_id: '00000000-0000-0000-0000-000000000099',
      source: 'slack',
      event_type: 'message',
      occurred_at: '2026-05-11T22:00:00+00:00',
      rank: 2,
    },
  ],
  policy: {
    policy_bundle_hash: null,
    filters_applied: [],
    filters_skipped: [],
    mode: 'log_only',
  },
  output: {
    context_hash: 'a'.repeat(64),
    context_size_bytes: 256,
    canonicalization_version: 1,
    token_estimate: 80,
  },
  region: null,
  receipt_signature: null,
}

function renderPage(search = '') {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[`/receipts${search}`]}>
        <Routes>
          <Route path="/receipts" element={<ReceiptsPage />} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  )
}

function mockFetch(options?: { empty?: boolean; error?: boolean }) {
  return vi.spyOn(global, 'fetch').mockImplementation((input) => {
    const url = typeof input === 'string' ? input : input.toString()
    const decoded = decodeURIComponent(url)

    if (options?.error) {
      return Promise.resolve({ ok: false, status: 500 } as Response)
    }

    if (decoded.includes('/admin/receipts/01ARZ3NDEKTSV4RRFFQ69G5FAV')) {
      return Promise.resolve({
        ok: true,
        json: async () => SAMPLE_RECEIPT,
      } as Response)
    }
    if (decoded.includes('/admin/receipts')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          receipts: options?.empty ? [] : [SAMPLE_RECEIPT],
          next_cursor: null,
          limit: 50,
        }),
      } as Response)
    }
    return Promise.resolve({ ok: true, json: async () => ({}) } as Response)
  })
}

describe('ReceiptsPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })
  afterEach(() => cleanup())

  it('shows guidance when no filter is set and does not fetch', async () => {
    const fetchSpy = mockFetch()
    renderPage()
    expect(await screen.findByText(/Pick a scope/i)).toBeInTheDocument()
    // The page must NOT issue an unscoped fetch — the admin endpoint
    // refuses unscoped listing on purpose, and silently fetching anyway
    // would surface a confusing 400 in the UI.
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('renders rows once a subject filter is provided', async () => {
    mockFetch()
    renderPage('?subject_id=user-42')
    // Task text renders twice (desktop table + mobile card list); both are
    // valid — match any.
    const taskMatches = await screen.findAllByText(/What plan is the customer on/i)
    expect(taskMatches.length).toBeGreaterThan(0)
    // Mode badge surfaces the assembly mode.
    expect(screen.getAllByText('retrieval').length).toBeGreaterThan(0)
  })

  it('opens the detail modal with the receipt body on row click', async () => {
    mockFetch()
    renderPage('?subject_id=user-42')
    const taskCells = await screen.findAllByText(/What plan is the customer on/i)
    // Pick the row variant (inside a <tr>); the mobile card is inside a <button>.
    const rowCell = taskCells.find((el) => el.closest('tr')) ?? taskCells[0]
    fireEvent.click(rowCell.closest('tr')!)
    await waitFor(() =>
      expect(screen.getByText(/Selected memories/i)).toBeInTheDocument(),
    )
    expect(screen.getByText(/Selected episodes/i)).toBeInTheDocument()
    // The policy block should advertise log_only — receipts ship with
    // the policy layer dormant until issue #50 wires it up.
    expect(screen.getAllByText('log_only').length).toBeGreaterThan(0)
  })

  it('shows a no-results state when the scope returns empty', async () => {
    mockFetch({ empty: true })
    renderPage('?subject_id=ghost')
    await waitFor(() =>
      expect(screen.getByText(/No receipts found/i)).toBeInTheDocument(),
    )
  })

  it('surfaces an error state on backend failure', async () => {
    mockFetch({ error: true })
    renderPage('?subject_id=user-42')
    await waitFor(() =>
      expect(screen.getByText(/Failed to load receipts/i)).toBeInTheDocument(),
    )
  })
})


// ─── Replay button (v0.9 #159 / #160) ────────────────────────────────────────

const SAMPLE_REPLAY_RESPONSE = {
  original_receipt_id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  replay_receipt_id: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
  diff: {
    context_hash: {
      original: 'a'.repeat(64),
      replay: 'b'.repeat(64),
      changed: true,
    },
    selected_entries: {
      added: [
        {
          type: 'memory',
          memory_id: '00000000-0000-0000-0000-000000000002',
          rank: 1,
        },
      ],
      removed: [],
      common: 1,
    },
    filters_applied: { added: [], removed: [] },
  },
}

function mockFetchWithReplay(options?: { replayFails?: boolean; preV09?: boolean }) {
  const receipt = options?.preV09
    ? { ...SAMPLE_RECEIPT }
    : {
        ...SAMPLE_RECEIPT,
        policy_snapshot: {
          bundle_hash: 'sha256-xyz',
          bundle_yaml: 'version: 1\nrules: []\n',
          captured_at: '2026-05-25T12:00:00+00:00',
        },
      }

  return vi.spyOn(global, 'fetch').mockImplementation((input, init) => {
    const url = typeof input === 'string' ? input : input.toString()
    const decoded = decodeURIComponent(url)
    const method = init?.method ?? 'GET'

    if (
      method === 'POST' &&
      decoded.includes('/admin/receipts/') &&
      decoded.includes('/replay')
    ) {
      if (options?.replayFails) {
        return Promise.resolve({
          ok: false,
          status: 422,
          json: async () => ({
            error: { code: 'unreplayable.invalid_snapshot', message: 'bad yaml' },
          }),
        } as Response)
      }
      return Promise.resolve({
        ok: true,
        json: async () => SAMPLE_REPLAY_RESPONSE,
      } as Response)
    }
    if (decoded.includes('/admin/receipts/01ARZ3NDEKTSV4RRFFQ69G5FAV')) {
      return Promise.resolve({
        ok: true,
        json: async () => receipt,
      } as Response)
    }
    if (decoded.includes('/admin/receipts')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          receipts: [SAMPLE_RECEIPT],
          next_cursor: null,
          limit: 50,
        }),
      } as Response)
    }
    return Promise.resolve({ ok: true, json: async () => ({}) } as Response)
  })
}

describe('ReceiptsPage — replay button (v0.9 #159 / #160)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })
  afterEach(() => cleanup())

  it('shows the replay button when the receipt has a policy snapshot', async () => {
    mockFetchWithReplay()
    renderPage('?subject_id=user-42')
    const taskCells = await screen.findAllByText(/What plan is the customer on/i)
    const rowCell = taskCells.find((el) => el.closest('tr')) ?? taskCells[0]
    fireEvent.click(rowCell.closest('tr')!)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Replay this receipt/i })).toBeInTheDocument()
    })
  })

  it('hides the replay button for pre-v0.9 receipts and explains why', async () => {
    mockFetchWithReplay({ preV09: true })
    renderPage('?subject_id=user-42')
    const taskCells = await screen.findAllByText(/What plan is the customer on/i)
    const rowCell = taskCells.find((el) => el.closest('tr')) ?? taskCells[0]
    fireEvent.click(rowCell.closest('tr')!)
    await waitFor(() =>
      expect(screen.getByText(/Pre-v0.9 receipt/i)).toBeInTheDocument(),
    )
    expect(
      screen.queryByRole('button', { name: /Replay this receipt/i }),
    ).not.toBeInTheDocument()
  })

  it('renders the diff envelope after a successful replay', async () => {
    mockFetchWithReplay()
    renderPage('?subject_id=user-42')
    const taskCells = await screen.findAllByText(/What plan is the customer on/i)
    fireEvent.click(taskCells.find((el) => el.closest('tr'))!.closest('tr')!)
    const button = await screen.findByRole('button', { name: /Replay this receipt/i })
    fireEvent.click(button)
    await waitFor(() => {
      expect(screen.getByText(/Output differs/i)).toBeInTheDocument()
    })
    expect(screen.getByText(/1 added · 0 removed/i)).toBeInTheDocument()
  })

  it('surfaces a 422 error inline instead of crashing', async () => {
    mockFetchWithReplay({ replayFails: true })
    renderPage('?subject_id=user-42')
    const taskCells = await screen.findAllByText(/What plan is the customer on/i)
    fireEvent.click(taskCells.find((el) => el.closest('tr'))!.closest('tr')!)
    const button = await screen.findByRole('button', { name: /Replay this receipt/i })
    fireEvent.click(button)
    await waitFor(() => {
      expect(screen.getByText(/bad yaml/i)).toBeInTheDocument()
    })
  })
})
