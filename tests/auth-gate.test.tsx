import React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  render,
  screen,
  waitFor,
  act,
  cleanup,
  fireEvent,
} from '@testing-library/react'
import App from '../src/App'

const SESSION_UNAUTH = {
  authenticated: false,
  authDisabled: false,
  configError: null,
  source: 'none',
}
const SESSION_OK = {
  authenticated: true,
  authDisabled: false,
  configError: null,
  source: 'session',
}
const SESSION_AUTH_DISABLED = {
  authenticated: true,
  authDisabled: true,
  configError: null,
  source: 'disabled',
}
const SESSION_MISCONFIGURED = {
  authenticated: false,
  authDisabled: false,
  configError: 'Admin is not configured. Set ADMIN_PASSWORD and ADMIN_SESSION_SECRET.',
  source: 'none',
}

function jsonRes(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

const DASH_BODY = {
  readiness: { status: 'ok', checks: [] },
  migration: { current_revision: null, expected_head: '', is_compatible: true, pending_count: 0 },
  counts: { episodes: 0, memories: 0, subjects: 0 },
  jobs: {},
  webhooks: { total: 0, delivered: 0, pending: 0, dead_letter: 0 },
  health_distribution: null,
}
const USAGE_BODY = {
  episodes: { today: 0, '7d': 0, '30d': 0, total: 0 },
  memories: { today: 0, '7d': 0, '30d': 0, total: 0 },
  compile_jobs: { today: 0, '7d': 0, '30d': 0, total: 0 },
  webhooks: { today: 0, '7d': 0, '30d': 0, total: 0 },
  active_subjects: { '7d': 0, '30d': 0, total: 0 },
  generated_at: '2026-04-30T12:00:00Z',
  tenant_id: null,
}

function dashboardOrUsage(url: string): Response {
  if (decodeURIComponent(url).includes('/admin/usage')) {
    return jsonRes(200, USAGE_BODY)
  }
  return jsonRes(200, DASH_BODY)
}

describe('Frontend auth gate', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })
  afterEach(() => {
    cleanup()
  })

  it('shows the login page when unauthenticated', async () => {
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      const u = typeof url === 'string' ? url : url.toString()
      if (u.includes('/api/auth/session')) return Promise.resolve(jsonRes(200, SESSION_UNAUTH))
      return Promise.resolve(jsonRes(200, {}))
    })
    await act(async () => { render(<App />) })
    await waitFor(() => {
      expect(screen.getByText('Admin authentication required')).toBeInTheDocument()
    })
    // Admin shell is NOT rendered.
    expect(screen.queryByText('Overview')).not.toBeInTheDocument()
  })

  it('shows the configuration error when production secrets are missing', async () => {
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      const u = typeof url === 'string' ? url : url.toString()
      if (u.includes('/api/auth/session')) return Promise.resolve(jsonRes(200, SESSION_MISCONFIGURED))
      return Promise.resolve(jsonRes(200, {}))
    })
    await act(async () => { render(<App />) })
    await waitFor(() => {
      expect(
        screen.getByText(/Admin is not configured/i),
      ).toBeInTheDocument()
    })
  })

  it('renders the dashboard when authenticated', async () => {
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      const u = typeof url === 'string' ? url : url.toString()
      if (u.includes('/api/auth/session')) return Promise.resolve(jsonRes(200, SESSION_OK))
      const decoded = decodeURIComponent(u)
      if (decoded.includes('/admin/usage')) {
        return Promise.resolve(jsonRes(200, {
          episodes: { today: 0, '7d': 0, '30d': 0, total: 0 },
          memories: { today: 0, '7d': 0, '30d': 0, total: 0 },
          compile_jobs: { today: 0, '7d': 0, '30d': 0, total: 0 },
          webhooks: { today: 0, '7d': 0, '30d': 0, total: 0 },
          active_subjects: { '7d': 0, '30d': 0, total: 0 },
          generated_at: '2026-04-30T12:00:00Z',
          tenant_id: null,
        }))
      }
      return Promise.resolve(jsonRes(200, {
        readiness: { status: 'ok', checks: [] },
        migration: { current_revision: null, expected_head: '', is_compatible: true, pending_count: 0 },
        counts: { episodes: 0, memories: 0, subjects: 0 },
        jobs: {},
        webhooks: { total: 0, delivered: 0, pending: 0, dead_letter: 0 },
        health_distribution: null,
      }))
    })
    await act(async () => { render(<App />) })
    await waitFor(() => {
      expect(screen.getByText('Readiness')).toBeInTheDocument()
    })
    // The login form is gone.
    expect(screen.queryByText('Admin authentication required')).not.toBeInTheDocument()
  })

  it('shows the warning banner when ADMIN_AUTH_DISABLED=true', async () => {
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      const u = typeof url === 'string' ? url : url.toString()
      if (u.includes('/api/auth/session')) return Promise.resolve(jsonRes(200, SESSION_AUTH_DISABLED))
      const decoded = decodeURIComponent(u)
      if (decoded.includes('/admin/usage')) {
        return Promise.resolve(jsonRes(200, {
          episodes: { today: 0, '7d': 0, '30d': 0, total: 0 },
          memories: { today: 0, '7d': 0, '30d': 0, total: 0 },
          compile_jobs: { today: 0, '7d': 0, '30d': 0, total: 0 },
          webhooks: { today: 0, '7d': 0, '30d': 0, total: 0 },
          active_subjects: { '7d': 0, '30d': 0, total: 0 },
          generated_at: '2026-04-30T12:00:00Z',
          tenant_id: null,
        }))
      }
      return Promise.resolve(jsonRes(200, {
        readiness: { status: 'ok', checks: [] },
        migration: { current_revision: null, expected_head: '', is_compatible: true, pending_count: 0 },
        counts: { episodes: 0, memories: 0, subjects: 0 },
        jobs: {},
        webhooks: { total: 0, delivered: 0, pending: 0, dead_letter: 0 },
        health_distribution: null,
      }))
    })
    await act(async () => { render(<App />) })
    await waitFor(() => {
      expect(
        screen.getByText(/Admin authentication is DISABLED/i),
      ).toBeInTheDocument()
    })
  })

  it('login flow: wrong password shows error, correct password lets the dashboard render', async () => {
    let authed = false
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(
      (input, init) => {
        const u = typeof input === 'string' ? input : input.toString()
        if (u.includes('/api/auth/session')) {
          return Promise.resolve(jsonRes(200, authed ? SESSION_OK : SESSION_UNAUTH))
        }
        if (u.includes('/api/auth/login')) {
          const body = JSON.parse(init?.body as string)
          if (body.password === 'correct') {
            authed = true
            return Promise.resolve(jsonRes(200, { ok: true }))
          }
          return Promise.resolve(jsonRes(401, { error: 'invalid_credentials' }))
        }
        return Promise.resolve(dashboardOrUsage(u))
      },
    )

    await act(async () => { render(<App />) })
    await waitFor(() => {
      expect(screen.getByText('Admin authentication required')).toBeInTheDocument()
    })

    const input = screen.getByLabelText(/password/i) as HTMLInputElement

    // Wrong password
    fireEvent.change(input, { target: { value: 'wrong' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /sign in/i }))
    })
    await waitFor(() => {
      expect(screen.getByText(/Incorrect password/i)).toBeInTheDocument()
    })

    // Correct password
    fireEvent.change(input, { target: { value: 'correct' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /sign in/i }))
    })

    await waitFor(() => {
      expect(screen.getByText('Readiness')).toBeInTheDocument()
    })

    // Login was actually POSTed.
    const loginCall = fetchSpy.mock.calls.find(
      ([u]) => typeof u === 'string' && u.includes('/api/auth/login'),
    )
    expect(loginCall).toBeDefined()
    expect((loginCall![1] as RequestInit).method).toBe('POST')
  })

  it('logout: clicking Sign out calls /api/auth/logout', async () => {
    let authed = true
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(
      (input) => {
        const u = typeof input === 'string' ? input : input.toString()
        if (u.includes('/api/auth/session')) {
          return Promise.resolve(jsonRes(200, authed ? SESSION_OK : SESSION_UNAUTH))
        }
        if (u.includes('/api/auth/logout')) {
          authed = false
          return Promise.resolve(jsonRes(200, { ok: true }))
        }
        return Promise.resolve(dashboardOrUsage(u))
      },
    )

    await act(async () => { render(<App />) })
    await waitFor(() => {
      expect(screen.getByText('Readiness')).toBeInTheDocument()
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /sign out/i }))
    })

    await waitFor(() => {
      expect(screen.getByText('Admin authentication required')).toBeInTheDocument()
    })

    const logoutCall = fetchSpy.mock.calls.find(
      ([u]) => typeof u === 'string' && u.includes('/api/auth/logout'),
    )
    expect(logoutCall).toBeDefined()
    expect((logoutCall![1] as RequestInit).method).toBe('POST')
  })
})
