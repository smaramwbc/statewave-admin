import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { Badge, HealthBadge } from '../src/components/ui/Badge'
import { SearchInput } from '../src/components/ui/SearchInput'
import { FilterSelect } from '../src/components/ui/FilterSelect'
import { Pagination } from '../src/components/ui/Pagination'
import { EmptyState } from '../src/components/ui/EmptyState'
import { ErrorState } from '../src/components/ui/ErrorState'
import { LoadingOverlay } from '../src/components/ui/LoadingOverlay'
import { Tabs, TabPanel } from '../src/components/ui/Tabs'

describe('UI Components', () => {
  afterEach(() => {
    cleanup()
  })

  describe('Badge', () => {
    it('renders with default variant', () => {
      render(<Badge>Default</Badge>)
      expect(screen.getByText('Default')).toBeInTheDocument()
    })

    it('renders with success variant', () => {
      render(<Badge variant="success">Success</Badge>)
      expect(screen.getByText('Success')).toHaveClass('text-emerald-400')
    })

    it('renders with dot indicator', () => {
      render(<Badge variant="success" dot>Active</Badge>)
      const dot = document.querySelector('.rounded-full.bg-emerald-500')
      expect(dot).toBeInTheDocument()
    })
  })

  describe('HealthBadge', () => {
    it('renders healthy state', () => {
      render(<HealthBadge state="healthy" score={85} />)
      expect(screen.getByText('healthy')).toBeInTheDocument()
      expect(screen.getByText('(85)')).toBeInTheDocument()
    })

    it('renders warning states', () => {
      render(<HealthBadge state="watch" />)
      expect(screen.getByText('watch')).toHaveClass('text-amber-400')
    })

    it('renders null state as dash', () => {
      render(<HealthBadge state={null} />)
      expect(screen.getByText('—')).toBeInTheDocument()
    })
  })

  describe('SearchInput', () => {
    it('renders with placeholder', () => {
      render(<SearchInput value="" onChange={() => {}} placeholder="Search here" />)
      expect(screen.getByPlaceholderText('Search here')).toBeInTheDocument()
    })

    it('shows clear button when has value', () => {
      render(<SearchInput value="test" onChange={() => {}} />)
      expect(screen.getByText('✕')).toBeInTheDocument()
    })
  })

  describe('FilterSelect', () => {
    const options = [
      { value: 'a', label: 'Option A' },
      { value: 'b', label: 'Option B' },
    ]

    it('renders options', () => {
      render(<FilterSelect value="" onChange={() => {}} options={options} />)
      expect(screen.getByText('Option A')).toBeInTheDocument()
      expect(screen.getByText('Option B')).toBeInTheDocument()
    })

    it('shows placeholder option', () => {
      render(<FilterSelect value="" onChange={() => {}} options={options} placeholder="Pick one" />)
      expect(screen.getByText('Pick one')).toBeInTheDocument()
    })
  })

  describe('Pagination', () => {
    it('renders page info', () => {
      render(
        <Pagination
          currentPage={1}
          totalPages={5}
          totalItems={100}
          onPageChange={() => {}}
        />
      )
      expect(screen.getByText(/Page 1 of 5/)).toBeInTheDocument()
      expect(screen.getByText(/100 total/)).toBeInTheDocument()
    })

    it('returns null for single page', () => {
      const { container } = render(
        <Pagination
          currentPage={1}
          totalPages={1}
          totalItems={10}
          onPageChange={() => {}}
        />
      )
      expect(container.firstChild).toBeNull()
    })

    it('disables prev on first page', () => {
      render(
        <Pagination
          currentPage={1}
          totalPages={5}
          totalItems={100}
          onPageChange={() => {}}
        />
      )
      expect(screen.getByText('← Prev')).toBeDisabled()
    })
  })

  describe('EmptyState', () => {
    it('renders title and description', () => {
      render(<EmptyState title="No items" description="Try adding some" />)
      expect(screen.getByText('No items')).toBeInTheDocument()
      expect(screen.getByText('Try adding some')).toBeInTheDocument()
    })

    it('renders action', () => {
      render(
        <EmptyState
          title="Empty"
          action={<button>Add item</button>}
        />
      )
      expect(screen.getByText('Add item')).toBeInTheDocument()
    })
  })

  describe('ErrorState', () => {
    it('renders error message', () => {
      render(<ErrorState message="Something broke" />)
      expect(screen.getByText('Something went wrong')).toBeInTheDocument()
      expect(screen.getByText('Something broke')).toBeInTheDocument()
    })

    it('shows retry button when onRetry provided', () => {
      const onRetry = vi.fn()
      render(<ErrorState message="Error" onRetry={onRetry} />)
      expect(screen.getByText('Try again')).toBeInTheDocument()
    })
  })

  describe('LoadingOverlay', () => {
    it('renders with default message', () => {
      render(<LoadingOverlay />)
      expect(screen.getByText('Loading…')).toBeInTheDocument()
    })

    it('renders with custom message', () => {
      render(<LoadingOverlay message="Fetching data…" />)
      expect(screen.getByText('Fetching data…')).toBeInTheDocument()
    })

    it('has spinner animation', () => {
      render(<LoadingOverlay />)
      const spinner = document.querySelector('.animate-spin')
      expect(spinner).toBeInTheDocument()
    })
  })

  describe('Tabs', () => {
    const tabs = [
      { id: 'one', label: 'Tab One' },
      { id: 'two', label: 'Tab Two', count: 5 },
    ]

    it('renders tabs', () => {
      render(<Tabs tabs={tabs} activeTab="one" onTabChange={() => {}} />)
      expect(screen.getByText('Tab One')).toBeInTheDocument()
      expect(screen.getByText('Tab Two')).toBeInTheDocument()
    })

    it('shows count badge', () => {
      render(<Tabs tabs={tabs} activeTab="one" onTabChange={() => {}} />)
      expect(screen.getByText('5')).toBeInTheDocument()
    })

    it('highlights active tab', () => {
      render(<Tabs tabs={tabs} activeTab="one" onTabChange={() => {}} />)
      const activeTab = screen.getByText('Tab One').closest('button')
      expect(activeTab).toHaveClass('text-theme-primary')
    })
  })

  describe('TabPanel', () => {
    it('renders children when active', () => {
      render(<TabPanel isActive={true}>Content</TabPanel>)
      expect(screen.getByText('Content')).toBeInTheDocument()
    })

    it('returns null when not active', () => {
      const { container } = render(<TabPanel isActive={false}>Hidden</TabPanel>)
      expect(container.firstChild).toBeNull()
    })
  })
})
