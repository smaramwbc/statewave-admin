/**
 * Tests for the TenantConfigCard inside PolicyPage (#50 follow-up).
 *
 * The card is the operator-facing wrapper around PATCH /admin/tenants/{id}/config.
 * It exists specifically to make `policy_mode: enforce` reachable
 * without a SQL shell, which was the gap caught in #50's prod smoke.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { MemoryRouter, Route, Routes } from 'react-router'
import { PolicyPage } from '../src/pages/PolicyPage'
import { ThemeProvider } from '../src/lib/theme'


const EMPTY_BUNDLES = { bundles: [] }
const NO_ACTIVE_BUNDLE = null


function renderPage() {
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

/** PolicyPage's tenantFilter is plain useState (not URL-driven), so
 * tests need to type into the SearchInput to set it. */
async function selectTenant(tenantId: string) {
  const input = await screen.findByPlaceholderText(/tenant_id/i)
  fireEvent.change(input, { target: { value: tenantId } })
}


function tenantConfigMock(opts: {
  initial?: Record<string, unknown>
  initialVersion?: number
  // What the server returns on PATCH; null = call shouldn't have happened
  expectPatch?: (body: Record<string, unknown>) => Record<string, unknown>
}) {
  let currentConfig = opts.initial ?? {}
  let currentVersion = opts.initialVersion ?? 0
  const patchSpy = vi.fn()

  vi.spyOn(global, 'fetch').mockImplementation((input, init) => {
    const url = typeof input === 'string' ? input : input.toString()
    const decoded = decodeURIComponent(url)

    if (decoded.includes('/admin/tenants/acme/config')) {
      const method = init?.method ?? 'GET'
      if (method === 'PATCH') {
        const body = JSON.parse(init!.body as string)
        patchSpy(body)
        const next = opts.expectPatch?.(body) ?? {
          ...currentConfig,
          ...Object.fromEntries(
            Object.entries(body).filter(([k]) => k !== 'expected_version'),
          ),
        }
        currentConfig = next
        currentVersion += 1
        return Promise.resolve({
          ok: true,
          json: async () => ({
            tenant_id: 'acme',
            config: currentConfig,
            version: currentVersion,
            created_at: null,
            updated_at: null,
          }),
        } as Response)
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          tenant_id: 'acme',
          config: currentConfig,
          version: currentVersion,
          created_at: null,
          updated_at: null,
        }),
      } as Response)
    }

    // Stub out the other PolicyPage requests so the page renders
    // without spurious errors.
    if (decoded.includes('/admin/policy/bundles')) {
      return Promise.resolve({
        ok: true, json: async () => EMPTY_BUNDLES,
      } as Response)
    }
    if (decoded.includes('/admin/policy/active')) {
      return Promise.resolve({
        ok: true, json: async () => NO_ACTIVE_BUNDLE,
      } as Response)
    }
    return Promise.resolve({ ok: true, json: async () => ({}) } as Response)
  })

  return { patchSpy }
}


describe('TenantConfigCard', () => {
  beforeEach(() => vi.restoreAllMocks())
  afterEach(() => cleanup())

  it('is NOT rendered when no tenant scope is selected', async () => {
    tenantConfigMock({})
    renderPage()
    // Give the page time to render its non-tenant state.
    await waitFor(() => expect(screen.getByText(/Pick a scope|Upload bundle/i)).toBeInTheDocument())
    expect(screen.queryByText(/Tenant configuration/i)).not.toBeInTheDocument()
  })

  it('renders with current config values pre-filled when tenant is selected', async () => {
    tenantConfigMock({
      initial: {
        receipts: 'always',
        policy_mode: 'log_only',
        require_caller_identity: false,
      },
      initialVersion: 3,
    })
    renderPage(); await selectTenant('acme')
    await waitFor(() =>
      expect(screen.getByText(/Tenant configuration/i)).toBeInTheDocument(),
    )
    expect(screen.getByText(/version 3/i)).toBeInTheDocument()
    // The receipts select reflects "always".
    const receiptsSelect = screen.getByLabelText(/Receipts emission/i) as HTMLSelectElement
    expect(receiptsSelect.value).toBe('always')
  })

  it('PATCHes only the changed field + passes expected_version', async () => {
    const { patchSpy } = tenantConfigMock({
      initial: { policy_mode: 'log_only' },
      initialVersion: 5,
    })
    renderPage(); await selectTenant('acme')
    await waitFor(() =>
      expect(screen.getByText(/Tenant configuration/i)).toBeInTheDocument(),
    )
    // Flip policy_mode to enforce.
    const policySelect = screen.getByLabelText(/Policy mode/i) as HTMLSelectElement
    fireEvent.change(policySelect, { target: { value: 'enforce' } })
    fireEvent.click(screen.getByText('Save changes'))
    await waitFor(() => expect(patchSpy).toHaveBeenCalled())
    const body = patchSpy.mock.calls[0][0]
    // Diffed payload: only policy_mode changed, expected_version pinned.
    expect(body.policy_mode).toBe('enforce')
    expect(body.expected_version).toBe(5)
    // receipts/retention/require_caller weren't changed → not in body.
    expect(body.receipts).toBeUndefined()
    expect(body.receipt_retention_days).toBeUndefined()
  })

  it('shows the enforce warning when flipping to enforce', async () => {
    tenantConfigMock({
      initial: { policy_mode: 'log_only' },
      initialVersion: 1,
    })
    renderPage(); await selectTenant('acme')
    await waitFor(() =>
      expect(screen.getByText(/Tenant configuration/i)).toBeInTheDocument(),
    )
    const policySelect = screen.getByLabelText(/Policy mode/i) as HTMLSelectElement
    fireEvent.change(policySelect, { target: { value: 'enforce' } })
    expect(
      screen.getByText(/Switching to/i),
    ).toBeInTheDocument()
    expect(screen.getByText(/Audit a few days/i)).toBeInTheDocument()
  })

  it('does NOT PATCH when Save is clicked without changes', async () => {
    const { patchSpy } = tenantConfigMock({
      initial: { policy_mode: 'log_only' },
      initialVersion: 1,
    })
    renderPage(); await selectTenant('acme')
    await waitFor(() =>
      expect(screen.getByText(/Tenant configuration/i)).toBeInTheDocument(),
    )
    fireEvent.click(screen.getByText('Save changes'))
    // Give the click handler a tick to run.
    await new Promise((r) => setTimeout(r, 50))
    expect(patchSpy).not.toHaveBeenCalled()
  })
})
