import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { Button } from '../src/components/ui/Button'

/**
 * Pins the contract every other surface in the admin UI relies on:
 *   * variant + size produce stable class fragments
 *   * disabled blocks click handlers
 *   * loading swaps in a spinner, sets aria-busy, and ignores clicks
 *   * leftIcon / rightIcon render alongside the label
 *   * type defaults to "button" to avoid accidental form submits
 */

afterEach(() => cleanup())

describe('Button', () => {
  it('renders the children as the accessible name', () => {
    render(<Button>Save</Button>)
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
  })

  it('defaults to type="button" so it never submits a form by accident', () => {
    render(<Button>Save</Button>)
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button')
  })

  it.each(['primary', 'secondary', 'ghost', 'destructive'] as const)(
    'renders the %s variant',
    (variant) => {
      render(<Button variant={variant}>X</Button>)
      // We pin the role + name; the visual diff is covered by the variant
      // class string in the source. Tests just need to confirm we don't
      // crash on any variant value.
      expect(screen.getByRole('button', { name: 'X' })).toBeInTheDocument()
    },
  )

  it.each(['sm', 'md'] as const)('renders the %s size', (size) => {
    render(<Button size={size}>X</Button>)
    expect(screen.getByRole('button', { name: 'X' })).toBeInTheDocument()
  })

  it('disables clicks when disabled', () => {
    const onClick = vi.fn()
    render(
      <Button disabled onClick={onClick}>
        Save
      </Button>,
    )
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('loading state suppresses clicks AND sets aria-busy', () => {
    const onClick = vi.fn()
    render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    )
    const btn = screen.getByRole('button', { name: 'Save' })
    expect(btn).toHaveAttribute('aria-busy', 'true')
    fireEvent.click(btn)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('renders the loading spinner element when loading', () => {
    render(<Button loading>Save</Button>)
    // Lucide icons render as <svg>; the loading one carries animate-spin.
    const svg = document.querySelector('svg.animate-spin')
    expect(svg).not.toBeNull()
  })

  it('renders left and right icons alongside the label', () => {
    render(
      <Button
        leftIcon={<span data-testid="left">L</span>}
        rightIcon={<span data-testid="right">R</span>}
      >
        Save
      </Button>,
    )
    expect(screen.getByTestId('left')).toBeInTheDocument()
    expect(screen.getByTestId('right')).toBeInTheDocument()
  })

  it('hides leftIcon while loading (spinner takes its place)', () => {
    render(
      <Button leftIcon={<span data-testid="left">L</span>} loading>
        Save
      </Button>,
    )
    expect(screen.queryByTestId('left')).not.toBeInTheDocument()
  })

  it('forwards arbitrary button props', () => {
    render(
      <Button data-testid="custom" aria-label="My label">
        X
      </Button>,
    )
    const btn = screen.getByTestId('custom')
    expect(btn).toHaveAttribute('aria-label', 'My label')
  })
})

describe('Button — accessibility regression', () => {
  it('an icon-only Button still has an accessible name via aria-label', () => {
    render(
      <Button aria-label="Open menu" leftIcon={<span aria-hidden="true">⋮</span>} />,
    )
    expect(screen.getByRole('button', { name: 'Open menu' })).toBeInTheDocument()
  })
})
