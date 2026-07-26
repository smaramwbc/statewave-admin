import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { MemoryRouter, Route, Routes } from 'react-router'
import { PolicyPage } from '../src/pages/PolicyPage'
import { MemoryDetailModal } from '../src/components/MemoryDetailModal'
import { ThemeProvider } from '../src/lib/theme'


const ACTIVE_BUNDLE = {
  bundle_hash: 'a'.repeat(64),
  version: 1,
  rule_count: 2,
  metadata: {},
  rules: [
    {
      id: 'deny-pii-marketing',
      description: 'PII memories cannot be read by marketing tools',
      when: { memory_has_any_label: ['pii'], caller_type: 'marketing_tool' },
      action: 'deny' as const,
    },
    {
      id: 'redact-secrets',
      description: '',
      when: { memory_has_any_label: ['secret'] },
      action: 'redact' as const,
    },
  ],
}

const BUNDLES = [
  {
    bundle_hash: 'a'.repeat(64),
    tenant_id: 'acme',
    active: true,
    created_at: '2026-05-12T10:00:00Z',
  },
  {
    bundle_hash: 'b'.repeat(64),
    tenant_id: 'acme',
    active: false,
    created_at: '2026-05-10T09:00:00Z',
  },
]


function renderPolicyPage() {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={['/policy']}>
        <Routes>
          <Route path="/policy" element={<PolicyPage />} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  )
}


function policyMock() {
  return vi.spyOn(global, 'fetch').mockImplementation((input, init) => {
    const url = typeof input === 'string' ? input : input.toString()
    const decoded = decodeURIComponent(url)
    if (decoded.includes('/admin/policy/active')) {
      return Promise.resolve({
        ok: true,
        json: async () => ACTIVE_BUNDLE,
      } as Response)
    }
    if (decoded.includes('/admin/policy/bundles/' + 'a'.repeat(64))) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          ...BUNDLES[0],
          yaml_content: 'version: 1\nrules: []',
          metadata: {},
          rules: ACTIVE_BUNDLE.rules,
        }),
      } as Response)
    }
    if (decoded.includes('/admin/policy/bundles')) {
      const method = init?.method ?? 'GET'
      if (method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            bundle_hash: 'c'.repeat(64),
            rule_count: 1,
            active: true,
          }),
        } as Response)
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ bundles: BUNDLES }),
      } as Response)
    }
    if (decoded.includes('/admin/policy/activate')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ bundle_hash: 'b'.repeat(64), active: true }),
      } as Response)
    }
    return Promise.resolve({ ok: true, json: async () => ({}) } as Response)
  })
}


describe('PolicyPage', () => {
  beforeEach(() => vi.restoreAllMocks())
  afterEach(() => cleanup())

  it('renders the active bundle card and rule count', async () => {
    policyMock()
    renderPolicyPage()
    await waitFor(() =>
      expect(screen.getByText(/2 rule\(s\)/i)).toBeInTheDocument(),
    )
    expect(screen.getByText(/Active bundle for/i)).toBeInTheDocument()
  })

  it('lists all bundles with active/inactive badges', async () => {
    policyMock()
    renderPolicyPage()
    await waitFor(() =>
      expect(screen.getAllByText(/active/i).length).toBeGreaterThan(0),
    )
    expect(screen.getByText(/inactive/i)).toBeInTheDocument()
  })

  it('opens bundle detail modal on View click', async () => {
    policyMock()
    renderPolicyPage()
    const viewButtons = await screen.findAllByText('View')
    fireEvent.click(viewButtons[0])
    await waitFor(() =>
      expect(screen.getByText(/Rules \(2\)/i)).toBeInTheDocument(),
    )
    expect(screen.getByText('deny-pii-marketing')).toBeInTheDocument()
  })
})


// ───────────────────────────────────────────────────────────────────────────
// MemoryDetailModal labels editor
// ───────────────────────────────────────────────────────────────────────────


const SAMPLE_MEMORY = {
  id: 'mem-1',
  kind: 'profile_fact',
  content: 'alice@example.com',
  summary: '',
  confidence: 1,
  status: 'active',
  source_episode_ids: [],
  valid_from: '2026-01-01T00:00:00Z',
  valid_to: null,
  sensitivity_labels: ['pii'],
  created_at: '2026-01-01T00:00:00Z',
}


describe('MemoryDetailModal sensitivity labels editor', () => {
  beforeEach(() => vi.restoreAllMocks())
  afterEach(() => cleanup())

  it('shows existing labels as badges', () => {
    render(
      <ThemeProvider>
        <MemoryDetailModal memory={SAMPLE_MEMORY} onClose={() => {}} />
      </ThemeProvider>,
    )
    // The label appears in the badges row. It's also pre-populated in
    // the textarea, so this assertion needs to scope to the badge.
    const badges = screen.getAllByText('pii')
    expect(badges.length).toBeGreaterThan(0)
  })

  it('shows untagged placeholder when no labels', () => {
    render(
      <ThemeProvider>
        <MemoryDetailModal
          memory={{ ...SAMPLE_MEMORY, sensitivity_labels: [] }}
          onClose={() => {}}
        />
      </ThemeProvider>,
    )
    expect(screen.getByText(/untagged.*default allow/i)).toBeInTheDocument()
  })

  it('PATCHes the labels endpoint on save', async () => {
    const mockFetch = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toContain('/admin/memories/mem-1/labels')
      expect(init?.method).toBe('PATCH')
      const body = JSON.parse(init!.body as string)
      expect(body.sensitivity_labels).toEqual(['pii', 'financial'])
      return new Response(
        JSON.stringify({
          ...SAMPLE_MEMORY,
          sensitivity_labels: ['financial', 'pii'],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    })
    vi.stubGlobal('fetch', mockFetch)

    render(
      <ThemeProvider>
        <MemoryDetailModal memory={SAMPLE_MEMORY} onClose={() => {}} />
      </ThemeProvider>,
    )
    // Labels editor is behind an Edit button in the new modal design
    fireEvent.click(screen.getByText('Edit'))
    const input = screen.getByLabelText(/Comma-separated sensitivity labels/i)
    fireEvent.change(input, { target: { value: 'pii, financial' } })
    fireEvent.click(screen.getByText('Save'))
    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    vi.unstubAllGlobals()
  })
})
