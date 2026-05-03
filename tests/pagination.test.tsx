import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { Pagination } from '../src/components/ui/Pagination'

/**
 * Pagination — pins the accessibility + behavior contract pages depend on.
 * The internal markup uses a mix of the shared Button primitive (prev/next)
 * and a square `<PageButton>` helper for page numbers; the assertions
 * here target visible labels / aria so the implementation can keep
 * evolving without the tests breaking.
 */

afterEach(() => cleanup())

describe('Pagination', () => {
  it('returns null when there is only one page', () => {
    const { container } = render(
      <Pagination
        currentPage={1}
        totalPages={1}
        totalItems={5}
        onPageChange={() => {}}
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('wraps the control in a labelled <nav>', () => {
    render(
      <Pagination
        currentPage={1}
        totalPages={3}
        totalItems={50}
        onPageChange={() => {}}
      />,
    )
    expect(screen.getByRole('navigation', { name: /Pagination/ })).toBeInTheDocument()
  })

  it('marks the current page with aria-current=page', () => {
    render(
      <Pagination
        currentPage={2}
        totalPages={5}
        totalItems={100}
        onPageChange={() => {}}
      />,
    )
    const active = screen.getByRole('button', { name: 'Go to page 2' })
    expect(active.getAttribute('aria-current')).toBe('page')
    const inactive = screen.getByRole('button', { name: 'Go to page 1' })
    expect(inactive.getAttribute('aria-current')).toBeNull()
  })

  it('disables Prev on the first page and Next on the last', () => {
    const { rerender } = render(
      <Pagination
        currentPage={1}
        totalPages={4}
        totalItems={100}
        onPageChange={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: 'Go to previous page' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Go to next page' })).not.toBeDisabled()

    rerender(
      <Pagination
        currentPage={4}
        totalPages={4}
        totalItems={100}
        onPageChange={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: 'Go to previous page' })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: 'Go to next page' })).toBeDisabled()
  })

  it('calls onPageChange with the next page when Next is clicked', () => {
    const onPageChange = vi.fn()
    render(
      <Pagination
        currentPage={2}
        totalPages={5}
        totalItems={100}
        onPageChange={onPageChange}
      />,
    )
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Go to next page' }))
    })
    expect(onPageChange).toHaveBeenCalledWith(3)
  })

  it('calls onPageChange with the page number when a numeric button is clicked', () => {
    const onPageChange = vi.fn()
    render(
      <Pagination
        currentPage={1}
        totalPages={5}
        totalItems={100}
        onPageChange={onPageChange}
      />,
    )
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Go to page 3' }))
    })
    expect(onPageChange).toHaveBeenCalledWith(3)
  })

  it('shows ellipsis-style abbreviation when there are many pages', () => {
    const { container } = render(
      <Pagination
        currentPage={10}
        totalPages={20}
        totalItems={1000}
        onPageChange={() => {}}
      />,
    )
    // First two and last two page buttons render verbatim.
    expect(screen.getByRole('button', { name: 'Go to page 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Go to page 2' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Go to page 19' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Go to page 20' })).toBeInTheDocument()
    // The active middle page also renders.
    expect(screen.getByRole('button', { name: 'Go to page 10' })).toBeInTheDocument()
    // Ellipsis filler is present (rendered as an aria-hidden span).
    const ellipsisCount = Array.from(
      container.querySelectorAll('span[aria-hidden="true"]'),
    ).filter((el) => el.textContent === '…').length
    expect(ellipsisCount).toBeGreaterThanOrEqual(1)
  })

  it('does not render numeric page buttons beyond totalPages', () => {
    render(
      <Pagination
        currentPage={1}
        totalPages={3}
        totalItems={30}
        onPageChange={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: 'Go to page 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Go to page 3' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Go to page 4' })).not.toBeInTheDocument()
  })
})
