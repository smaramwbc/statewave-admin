import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { EmptyState } from '../src/components/ui/EmptyState'
import { Button } from '../src/components/ui/Button'

/**
 * EmptyState — pins the upgraded primaryAction/secondaryAction contract
 * AND the legacy `action` fallback used by older call sites.
 */

afterEach(() => cleanup())

describe('EmptyState', () => {
  it('renders title and description', () => {
    render(<EmptyState title="No subjects yet" description="Subjects appear when episodes are ingested." />)
    expect(screen.getByText('No subjects yet')).toBeInTheDocument()
    expect(screen.getByText(/Subjects appear/)).toBeInTheDocument()
  })

  it('renders the primary action when provided', () => {
    const onClick = vi.fn()
    render(
      <EmptyState
        title="No subjects yet"
        primaryAction={
          <Button variant="secondary" size="sm" onClick={onClick}>
            Import / Restore…
          </Button>
        }
      />,
    )
    const btn = screen.getByRole('button', { name: /Import \/ Restore/ })
    expect(btn).toBeInTheDocument()
    act(() => {
      fireEvent.click(btn)
    })
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('renders both primary and secondary actions side by side', () => {
    render(
      <EmptyState
        title="No subjects yet"
        primaryAction={<Button size="sm">Primary</Button>}
        secondaryAction={
          <a href="https://example/docs" className="text-xs text-accent">
            Learn more
          </a>
        }
      />,
    )
    expect(screen.getByRole('button', { name: 'Primary' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Learn more/ })).toBeInTheDocument()
  })

  it('falls back to the legacy `action` prop when no primaryAction is set', () => {
    render(
      <EmptyState
        title="No results"
        action={<button type="button">Clear filters</button>}
      />,
    )
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument()
  })
})
