/**
 * Admin shell mobile drawer behavior.
 *
 * On phones the sidebar collapses to an off-canvas drawer. This test
 * locks down the contract: the hamburger toggle exists, opens the
 * drawer with role="dialog", body scroll is locked while open, Escape
 * closes, and clicking the backdrop closes.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { Shell } from '../src/components/layout'
import { ThemeProvider } from '../src/lib/theme'
import { AuthProvider } from '../src/lib/auth'
import { FAKE_SESSION_OK } from './setup'

afterEach(() => {
  cleanup()
  document.documentElement.removeAttribute('data-scroll-lock')
  document.body.style.position = ''
  document.body.style.top = ''
  vi.restoreAllMocks()
})

beforeEach(() => {
  // The Sidebar uses scrollTo on close to restore the saved offset.
  window.scrollTo = (() => {}) as typeof window.scrollTo
  vi.spyOn(global, 'fetch').mockImplementation((input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
    if (url.includes('/api/auth/session')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => FAKE_SESSION_OK,
      } as Response)
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as Response)
  })
})

function renderShell(route = '/') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <ThemeProvider>
        <AuthProvider>
          <Routes>
            <Route element={<Shell />}>
              <Route path="/" element={<div>overview content</div>} />
              <Route path="/subjects" element={<div>subjects content</div>} />
            </Route>
          </Routes>
        </AuthProvider>
      </ThemeProvider>
    </MemoryRouter>,
  )
}

describe('Admin shell mobile drawer', () => {
  it('renders the hamburger toggle with proper ARIA', () => {
    renderShell()
    const toggle = screen.getByRole('button', { name: /open navigation menu/i })
    expect(toggle).toBeInTheDocument()
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveAttribute('aria-controls', 'admin-mobile-drawer')
  })

  it('toggle meets the 44×44 tap-target floor', () => {
    renderShell()
    const toggle = screen.getByRole('button', { name: /open navigation menu/i })
    expect(toggle.className).toMatch(/w-11/)
    expect(toggle.className).toMatch(/h-11/)
  })

  it('opens the drawer and locks body scroll', async () => {
    renderShell()
    fireEvent.click(screen.getByRole('button', { name: /open navigation menu/i }))
    await waitFor(() => {
      expect(document.documentElement.dataset.scrollLock).toBe('true')
    })
    expect(document.body.style.position).toBe('fixed')
    // The drawer aside is always rendered; aria-hidden flips with state.
    const drawer = document.getElementById('admin-mobile-drawer')
    expect(drawer).not.toBeNull()
    expect(drawer!.getAttribute('aria-hidden')).toBe('false')
  })

  it('closes the drawer on Escape and unlocks body scroll', async () => {
    renderShell()
    fireEvent.click(screen.getByRole('button', { name: /open navigation menu/i }))
    await waitFor(() => expect(document.documentElement.dataset.scrollLock).toBe('true'))
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => {
      expect(document.documentElement.hasAttribute('data-scroll-lock')).toBe(false)
    })
    expect(document.body.style.position).toBe('')
  })

  it('closes the drawer when its close button is clicked', async () => {
    renderShell()
    fireEvent.click(screen.getByRole('button', { name: /open navigation menu/i }))
    const drawer = await screen.findByRole('dialog', { name: /admin navigation/i })
    fireEvent.click(within(drawer).getByRole('button', { name: /close navigation menu/i }))
    await waitFor(() => {
      expect(document.documentElement.hasAttribute('data-scroll-lock')).toBe(false)
    })
  })

  it('closes the drawer when the backdrop is clicked', async () => {
    renderShell()
    fireEvent.click(screen.getByRole('button', { name: /open navigation menu/i }))
    const backdrop = await screen.findByRole('button', { name: /dismiss navigation menu/i, hidden: true })
    fireEvent.click(backdrop)
    await waitFor(() => {
      expect(document.documentElement.hasAttribute('data-scroll-lock')).toBe(false)
    })
  })

  it('renders all primary nav items inside the drawer', () => {
    renderShell()
    const drawer = document.getElementById('admin-mobile-drawer')
    expect(drawer).not.toBeNull()
    for (const label of ['Overview', 'Subjects', 'Jobs', 'Webhooks', 'Diagnostics']) {
      expect(within(drawer!).getByText(label)).toBeInTheDocument()
    }
  })
})
