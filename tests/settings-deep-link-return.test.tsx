/**
 * End-to-end pin for the "click Fix on Overview → Cancel returns to
 * Overview" flow.
 *
 * Tests the chain that's easy to break in pieces:
 *   1. ProductionReadinessCard navigates with `{state: {from: '/'}}`
 *   2. SettingsPage reads that state on mount and locks it into
 *      useState BEFORE setSearchParams strips the `?edit=` param
 *      (which would otherwise clear location.state).
 *   3. Closing the editor (Cancel / X / Save) navigates back to the
 *      stashed from-value.
 *
 * The earlier bug was at step 2 — the page read location.state on
 * every render via `(location.state as ...).from`, which started as
 * `'/'` then flipped to null the moment the useEffect's
 * setSearchParams call ran. Cancel had nowhere to go. This test
 * pins the fix.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, render, screen, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { WizardsProvider } from '../src/lib/wizards'
import { SettingsPage } from '../src/pages/SettingsPage'

// Surface the current location so the test can assert on it after
// the user clicks Cancel. Rendered alongside the SettingsPage as a
// sibling route.
function LocationProbe() {
  const loc = useLocation()
  return (
    <span data-testid="probe-path">{loc.pathname}{loc.search}</span>
  )
}

const SETTINGS_RESPONSE = {
  settings: {
    strict_schema: {
      value: false,
      applied_value: false,
      pending_restart: false,
      source: 'env',
      is_secret: false,
      category: 'backend',
      kind: 'bool',
      env_name: 'STATEWAVE_STRICT_SCHEMA',
      description: 'Strict schema check.',
      hot_reloadable: false,
      tenant_overridable: false,
      editable: true,
      allowed_values: null,
      min_value: null,
      max_value: null,
      format: null,
    },
  },
  tenant_id: null,
}

beforeEach(() => {
  // Minimal fetch stub. The admin proxy wraps backend paths into
  // `/api/proxy?path=%2Fadmin%2Fsettings` (URL-encoded), so we
  // decode the `path` query before matching.
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const raw = typeof input === 'string' ? input : input.toString()
    const u = new URL(raw, 'http://localhost')
    const backendPath = u.searchParams.get('path') ?? ''
    if (u.pathname === '/api/proxy' && backendPath === '/admin/settings') {
      return new Response(JSON.stringify(SETTINGS_RESPONSE), { status: 200 })
    }
    if (u.pathname === '/api/admin-settings') {
      return new Response(
        JSON.stringify({
          admin_password_set: true,
          statewave_api_key_set: true,
          pending: null,
          persistence: { status: 'disabled', file_path: '/dev/null' },
        }),
        { status: 200 },
      )
    }
    return new Response('{}', { status: 200 })
  }))
})

function renderApp(initialEntries: Array<string | { pathname: string; search?: string; state?: unknown }>) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <WizardsProvider>
        <Routes>
          <Route path="/" element={<div>overview content<LocationProbe /></div>} />
          <Route path="/settings" element={<><SettingsPage /><LocationProbe /></>} />
        </Routes>
      </WizardsProvider>
    </MemoryRouter>,
  )
}

afterEach()
function afterEach() {
  // intentional empty — vitest auto-cleans via the global afterEach
  // registered by vitest/setup
}
import { afterEach as vitestAfterEach } from 'vitest'
vitestAfterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})


describe('Settings deep-link → close → return to origin', () => {
  it('Cancelling an editor opened via ?edit= with from-state returns to /', async () => {
    // Simulate: ProductionReadinessCard called
    //   navigate('/settings?edit=strict_schema', { state: { from: '/' } })
    renderApp([{ pathname: '/settings', search: '?edit=strict_schema', state: { from: '/' } }])

    // Wait for the editor modal to mount.
    await waitFor(() => {
      expect(screen.getByText(/edit strict schema check/i)).toBeInTheDocument()
    })

    // Sanity: we ARE on /settings right now (?edit= will be stripped
    // by SettingsPage's useEffect, possibly along with state in older
    // builds — the next assertion is what catches that).
    expect(screen.getByTestId('probe-path').textContent).toMatch(/^\/settings/)

    // Click Cancel.
    const cancelBtn = screen.getByRole('button', { name: /^cancel$/i })
    await act(async () => { cancelBtn.click() })

    // The contract: closeEditor saw editorOrigin='deep-link' AND
    // cameFrom='/', so it navigates back to '/'.
    await waitFor(() => {
      expect(screen.getByTestId('probe-path').textContent).toBe('/')
    })
    expect(screen.getByText('overview content')).toBeInTheDocument()
  })

  it('Inline open from /settings (no from-state) stays on /settings after Cancel', async () => {
    // Land on /settings with NO state and NO ?edit=. The page
    // renders; we'd need to click the row's Edit button to open the
    // editor — but that pulls in the full row UI which is overkill
    // for this assertion. Instead we verify the "no from = no
    // redirect" invariant by exercising the deep-link path with
    // NULL state.
    renderApp([{ pathname: '/settings', search: '?edit=strict_schema' /* no state */ }])

    await waitFor(() => {
      expect(screen.getByText(/edit strict schema check/i)).toBeInTheDocument()
    })

    const cancelBtn = screen.getByRole('button', { name: /^cancel$/i })
    await act(async () => { cancelBtn.click() })

    // No from-state → no auto-return → we stay on /settings.
    // (The ?edit= param has been stripped by SettingsPage's
    // useEffect, so just match the pathname prefix.)
    await waitFor(() => {
      expect(screen.getByTestId('probe-path').textContent).toMatch(/^\/settings/)
    })
  })
})
