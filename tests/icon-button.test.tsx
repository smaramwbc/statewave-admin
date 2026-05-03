import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { X, MoreVertical } from 'lucide-react'
import { IconButton } from '../src/components/ui/IconButton'

/**
 * IconButton — pins the contracts every icon-only call site relies on:
 *   * the accessible name comes from `aria-label` (required by the type)
 *   * the icon is decorative — wrapped in an aria-hidden span
 *   * disabled and loading both block clicks
 *   * loading sets `aria-busy="true"` and swaps the icon for a spinner
 *   * defaults to type="button" so it never accidentally submits a form
 */

afterEach(() => cleanup())

describe('IconButton', () => {
  it('exposes its action via aria-label', () => {
    render(<IconButton aria-label="Close modal" icon={<X />} />)
    expect(screen.getByRole('button', { name: 'Close modal' })).toBeInTheDocument()
  })

  it('defaults to type="button"', () => {
    render(<IconButton aria-label="Close" icon={<X />} />)
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button')
  })

  it('renders the icon inside an aria-hidden wrapper', () => {
    render(<IconButton aria-label="Open menu" icon={<MoreVertical data-testid="ic" />} />)
    const btn = screen.getByRole('button')
    // The wrapper element is aria-hidden, the icon itself is inside.
    const hidden = btn.querySelector('[aria-hidden="true"]')
    expect(hidden).not.toBeNull()
    expect(hidden?.querySelector('[data-testid="ic"]')).not.toBeNull()
  })

  it('blocks clicks when disabled', () => {
    const onClick = vi.fn()
    render(
      <IconButton
        aria-label="Close"
        icon={<X />}
        disabled
        onClick={onClick}
      />,
    )
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('loading state sets aria-busy and blocks clicks', () => {
    const onClick = vi.fn()
    render(
      <IconButton
        aria-label="Refresh"
        icon={<X />}
        loading
        onClick={onClick}
      />,
    )
    const btn = screen.getByRole('button', { name: 'Refresh' })
    expect(btn.getAttribute('aria-busy')).toBe('true')
    act(() => {
      fireEvent.click(btn)
    })
    expect(onClick).not.toHaveBeenCalled()
    // Spinner replaces the icon while loading.
    expect(btn.querySelector('svg.animate-spin')).not.toBeNull()
  })

  it.each(['ghost', 'secondary', 'destructive'] as const)(
    'renders the %s variant',
    (variant) => {
      render(<IconButton aria-label="x" icon={<X />} variant={variant} />)
      expect(screen.getByRole('button', { name: 'x' })).toBeInTheDocument()
    },
  )

  it.each(['sm', 'md'] as const)('renders the %s size', (size) => {
    render(<IconButton aria-label="x" icon={<X />} size={size} />)
    expect(screen.getByRole('button', { name: 'x' })).toBeInTheDocument()
  })

  it('forwards arbitrary button props (aria-haspopup, aria-expanded)', () => {
    render(
      <IconButton
        aria-label="Open menu"
        icon={<MoreVertical />}
        aria-haspopup="menu"
        aria-expanded={false}
      />,
    )
    const btn = screen.getByRole('button', { name: 'Open menu' })
    expect(btn.getAttribute('aria-haspopup')).toBe('menu')
    expect(btn.getAttribute('aria-expanded')).toBe('false')
  })
})
