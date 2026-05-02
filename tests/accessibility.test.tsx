import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ThemeProvider } from '../src/lib/theme'
import { AuthProvider } from '../src/lib/auth'
import { Shell } from '../src/components/layout/Shell'
import { Modal } from '../src/components/ui/Modal'
import { Pagination } from '../src/components/ui/Pagination'
import { FilterSelect } from '../src/components/ui/FilterSelect'
import { isSessionUrl, makeSessionMock } from './setup'

function renderWithProviders(ui: React.ReactElement) {
  // Shell now uses useAuth — provide a session mock so AuthProvider settles.
  vi.spyOn(global, 'fetch').mockImplementation((url) => {
    if (isSessionUrl(url)) return Promise.resolve(makeSessionMock())
    return Promise.resolve({ ok: true, json: async () => ({}) } as Response)
  })
  return render(
    <ThemeProvider>
      <AuthProvider>
        <MemoryRouter>{ui}</MemoryRouter>
      </AuthProvider>
    </ThemeProvider>
  )
}

describe('Accessibility', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  describe('Shell', () => {
    it('renders skip-to-content link', () => {
      renderWithProviders(<Shell />)
      const skipLink = screen.getByRole('link', { name: /skip to main content/i })
      expect(skipLink).toBeInTheDocument()
      expect(skipLink).toHaveAttribute('href', '#main-content')
    })

    it('renders main content area with correct id', () => {
      renderWithProviders(<Shell />)
      const main = screen.getByRole('main')
      expect(main).toHaveAttribute('id', 'main-content')
    })

    it('sidebar has aria-label for navigation', () => {
      renderWithProviders(<Shell />)
      const nav = screen.getByRole('navigation', { name: /main navigation/i })
      expect(nav).toBeInTheDocument()
    })
  })

  describe('Modal', () => {
    it('links title to dialog via aria-labelledby', () => {
      const { container } = render(
        <Modal open={true} onClose={() => {}} title="Test Modal">
          <p>Modal content</p>
        </Modal>
      )
      const dialog = container.querySelector('dialog')
      const titleId = dialog?.getAttribute('aria-labelledby')
      expect(titleId).toBeTruthy()
      
      const title = container.querySelector(`#${CSS.escape(titleId!)}`)
      expect(title).toHaveTextContent('Test Modal')
    })

    it('close button has aria-label', () => {
      render(
        <Modal open={true} onClose={() => {}} title="Test Modal">
          <p>Modal content</p>
        </Modal>
      )
      const closeButton = screen.getByRole('button', { name: /close modal/i })
      expect(closeButton).toBeInTheDocument()
    })

    it('close button icon is hidden from screen readers', () => {
      const { container } = render(
        <Modal open={true} onClose={() => {}} title="Test Modal">
          <p>Modal content</p>
        </Modal>
      )
      const svg = container.querySelector('button[aria-label="Close modal"] svg')
      expect(svg).toHaveAttribute('aria-hidden', 'true')
    })
  })

  describe('Pagination', () => {
    it('renders as navigation landmark', () => {
      render(
        <Pagination
          currentPage={1}
          totalPages={5}
          totalItems={50}
          onPageChange={() => {}}
        />
      )
      const nav = screen.getByRole('navigation', { name: /pagination/i })
      expect(nav).toBeInTheDocument()
    })

    it('page buttons have aria-labels', () => {
      render(
        <Pagination
          currentPage={1}
          totalPages={5}
          totalItems={50}
          onPageChange={() => {}}
        />
      )
      const page1 = screen.getByRole('button', { name: /go to page 1/i })
      const page2 = screen.getByRole('button', { name: /go to page 2/i })
      expect(page1).toBeInTheDocument()
      expect(page2).toBeInTheDocument()
    })

    it('current page has aria-current', () => {
      render(
        <Pagination
          currentPage={2}
          totalPages={5}
          totalItems={50}
          onPageChange={() => {}}
        />
      )
      const page2 = screen.getByRole('button', { name: /go to page 2/i })
      expect(page2).toHaveAttribute('aria-current', 'page')
      
      const page1 = screen.getByRole('button', { name: /go to page 1/i })
      expect(page1).not.toHaveAttribute('aria-current')
    })

    it('prev/next buttons have aria-labels', () => {
      render(
        <Pagination
          currentPage={2}
          totalPages={5}
          totalItems={50}
          onPageChange={() => {}}
        />
      )
      expect(screen.getByRole('button', { name: /go to previous page/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /go to next page/i })).toBeInTheDocument()
    })
  })

  describe('FilterSelect', () => {
    it('accepts and applies aria-label prop', () => {
      render(
        <FilterSelect
          value=""
          onChange={() => {}}
          options={[{ value: 'a', label: 'Option A' }]}
          aria-label="Filter by category"
        />
      )
      const select = screen.getByRole('combobox', { name: /filter by category/i })
      expect(select).toBeInTheDocument()
    })

    it('dropdown indicator is hidden from screen readers', () => {
      const { container } = render(
        <FilterSelect
          value=""
          onChange={() => {}}
          options={[{ value: 'a', label: 'Option A' }]}
        />
      )
      const indicator = container.querySelector('span[aria-hidden="true"]')
      expect(indicator).toBeInTheDocument()
      expect(indicator).toHaveTextContent('▾')
    })
  })
})
