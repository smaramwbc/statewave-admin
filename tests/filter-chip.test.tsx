import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { FilterChip } from '../src/components/ui/FilterChip'

/**
 * FilterChip — pins the toggle contract every chip group relies on:
 *   * `selected` controls the `aria-pressed` attribute (true/false)
 *   * an unselected chip announces aria-pressed="false" (not omitted)
 *   * defaults to type="button" so it never submits a form
 *   * an optional `count` renders as a small numeric badge after the
 *     visible label
 *   * disabled blocks clicks and dims the chip
 */

afterEach(() => cleanup())

describe('FilterChip', () => {
  it('renders the children as the accessible name', () => {
    render(
      <FilterChip selected={false} onClick={() => {}}>
        Active
      </FilterChip>,
    )
    expect(screen.getByRole('button', { name: 'Active' })).toBeInTheDocument()
  })

  it('selected chip carries aria-pressed="true"', () => {
    render(
      <FilterChip selected={true} onClick={() => {}}>
        Active
      </FilterChip>,
    )
    expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('true')
  })

  it('unselected chip carries aria-pressed="false" (not omitted)', () => {
    render(
      <FilterChip selected={false} onClick={() => {}}>
        Active
      </FilterChip>,
    )
    expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('false')
  })

  it('defaults to type="button"', () => {
    render(
      <FilterChip selected={false} onClick={() => {}}>
        x
      </FilterChip>,
    )
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button')
  })

  it('renders an optional count after the label', () => {
    render(
      <FilterChip selected={false} count={42} onClick={() => {}}>
        Active
      </FilterChip>,
    )
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()
  })

  it('fires onClick when not disabled', () => {
    const onClick = vi.fn()
    render(
      <FilterChip selected={false} onClick={onClick}>
        Active
      </FilterChip>,
    )
    act(() => {
      fireEvent.click(screen.getByRole('button'))
    })
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('blocks clicks when disabled', () => {
    const onClick = vi.fn()
    render(
      <FilterChip selected={false} disabled onClick={onClick}>
        Active
      </FilterChip>,
    )
    act(() => {
      fireEvent.click(screen.getByRole('button'))
    })
    expect(onClick).not.toHaveBeenCalled()
  })

  it('forwards arbitrary aria props', () => {
    render(
      <FilterChip selected={false} onClick={() => {}} aria-label="Filter by status">
        Active
      </FilterChip>,
    )
    // aria-label trumps the visible text for the accessible name.
    expect(
      screen.getByRole('button', { name: 'Filter by status' }),
    ).toBeInTheDocument()
  })
})
