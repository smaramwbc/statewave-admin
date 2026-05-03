import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import {
  Skeleton,
  TableSkeleton,
  CardSkeleton,
  StatSkeleton,
} from '../src/components/ui'

/**
 * Skeleton primitives — small smoke tests pinning the contracts pages
 * rely on (aria-busy on the wrapper, the right number of rows/cells, an
 * accessible label).
 */

afterEach(() => cleanup())

describe('Skeleton', () => {
  it('renders an aria-hidden block by default (decorative)', () => {
    const { container } = render(<Skeleton className="h-4 w-20" />)
    const div = container.firstChild as HTMLElement
    expect(div).not.toBeNull()
    expect(div.getAttribute('aria-hidden')).toBe('true')
    expect(div.className).toContain('animate-pulse')
  })

  it('exposes role=status when given an aria label', () => {
    render(<Skeleton ariaLabel="Loading title" />)
    expect(screen.getByRole('status', { name: /Loading title/ })).toBeInTheDocument()
  })
})

describe('TableSkeleton', () => {
  it('renders the requested rows × columns and is marked busy', () => {
    render(<TableSkeleton rows={3} columns={4} ariaLabel="Loading list" />)
    const region = screen.getByRole('status', { name: /Loading list/ })
    expect(region.getAttribute('aria-busy')).toBe('true')
    // 3 rows × 4 cells = 12 skeleton blocks inside <td>s.
    const tds = region.querySelectorAll('td')
    expect(tds.length).toBe(12)
  })
})

describe('CardSkeleton', () => {
  it('renders the requested number of body lines', () => {
    render(<CardSkeleton lines={5} />)
    const region = screen.getByRole('status', { name: /Loading card/ })
    // 1 header strip + 5 body lines = each row has 2 skeleton blocks
    // (label + value), so total animate-pulse divs = 2 + 5 * 2 = 12.
    const blocks = region.querySelectorAll('.animate-pulse')
    expect(blocks.length).toBe(12)
  })
})

describe('StatSkeleton', () => {
  it('renders a label + value placeholder pair', () => {
    render(<StatSkeleton />)
    const region = screen.getByRole('status', { name: /Loading stat/ })
    const blocks = region.querySelectorAll('.animate-pulse')
    expect(blocks.length).toBe(2)
  })
})
