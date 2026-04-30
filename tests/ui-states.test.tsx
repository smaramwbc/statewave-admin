import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import {
  LoadingState,
  LoadingSpinner,
  InlineLoading,
  EmptyState,
  NoResultsState,
  InlineEmpty,
  ErrorState,
  InlineError,
} from '../src/components/ui'

describe('Loading States', () => {
  afterEach(() => {
    cleanup()
  })

  describe('LoadingState', () => {
    it('renders skeleton rows with correct count', () => {
      const { container } = render(<LoadingState rows={3} />)
      const skeletons = container.querySelectorAll('[aria-hidden="true"]')
      expect(skeletons).toHaveLength(3)
    })

    it('shows optional message', () => {
      render(<LoadingState message="Loading items…" />)
      expect(screen.getByText('Loading items…')).toBeInTheDocument()
    })

    it('has correct accessibility attributes', () => {
      render(<LoadingState message="Loading" />)
      const status = screen.getByRole('status')
      expect(status).toHaveAttribute('aria-label', 'Loading')
    })

    it('applies fading opacity to rows', () => {
      const { container } = render(<LoadingState rows={3} />)
      const skeletons = container.querySelectorAll('[aria-hidden="true"]')
      // First row should be more opaque than last
      const firstOpacity = parseFloat(skeletons[0].getAttribute('style')?.match(/opacity: ([\d.]+)/)?.[1] || '1')
      const lastOpacity = parseFloat(skeletons[2].getAttribute('style')?.match(/opacity: ([\d.]+)/)?.[1] || '1')
      expect(firstOpacity).toBeGreaterThan(lastOpacity)
    })
  })

  describe('LoadingSpinner', () => {
    it('renders with default size', () => {
      const { container } = render(<LoadingSpinner />)
      const spinner = container.querySelector('.animate-spin')
      expect(spinner).toHaveClass('w-6', 'h-6')
    })

    it('renders with small size', () => {
      const { container } = render(<LoadingSpinner size="sm" />)
      const spinner = container.querySelector('.animate-spin')
      expect(spinner).toHaveClass('w-4', 'h-4')
    })

    it('renders with large size', () => {
      const { container } = render(<LoadingSpinner size="lg" />)
      const spinner = container.querySelector('.animate-spin')
      expect(spinner).toHaveClass('w-8', 'h-8')
    })

    it('has correct accessibility attributes', () => {
      render(<LoadingSpinner />)
      const status = screen.getByRole('status')
      expect(status).toHaveAttribute('aria-label', 'Loading')
    })
  })

  describe('InlineLoading', () => {
    it('renders with default message', () => {
      render(<InlineLoading />)
      expect(screen.getByText('Loading…')).toBeInTheDocument()
    })

    it('renders with custom message', () => {
      render(<InlineLoading message="Fetching data…" />)
      expect(screen.getByText('Fetching data…')).toBeInTheDocument()
    })

    it('has spinner', () => {
      const { container } = render(<InlineLoading />)
      expect(container.querySelector('.animate-spin')).toBeInTheDocument()
    })

    it('has correct accessibility attributes', () => {
      render(<InlineLoading />)
      expect(screen.getByRole('status')).toBeInTheDocument()
    })
  })
})

describe('Empty States', () => {
  afterEach(() => {
    cleanup()
  })

  describe('EmptyState', () => {
    it('renders title', () => {
      render(<EmptyState title="No items" />)
      expect(screen.getByText('No items')).toBeInTheDocument()
    })

    it('renders optional description', () => {
      render(<EmptyState title="No items" description="Create your first item" />)
      expect(screen.getByText('Create your first item')).toBeInTheDocument()
    })

    it('renders optional action', () => {
      const action = <button>Create Item</button>
      render(<EmptyState title="No items" action={action} />)
      expect(screen.getByRole('button', { name: 'Create Item' })).toBeInTheDocument()
    })

    it('renders empty icon', () => {
      const { container } = render(<EmptyState title="No items" />)
      expect(container.querySelector('[aria-hidden="true"]')).toHaveTextContent('∅')
    })
  })

  describe('NoResultsState', () => {
    it('renders default title', () => {
      render(<NoResultsState />)
      expect(screen.getByText('No results found')).toBeInTheDocument()
    })

    it('renders custom title', () => {
      render(<NoResultsState title="No matches" />)
      expect(screen.getByText('No matches')).toBeInTheDocument()
    })

    it('renders filter summary', () => {
      render(<NoResultsState filterSummary="No items match 'test'" />)
      expect(screen.getByText("No items match 'test'")).toBeInTheDocument()
    })

    it('renders clear filters button when onClearFilters provided', () => {
      const onClear = vi.fn()
      render(<NoResultsState onClearFilters={onClear} />)
      const button = screen.getByRole('button', { name: 'Clear filters' })
      expect(button).toBeInTheDocument()
    })

    it('calls onClearFilters when clicked', () => {
      const onClear = vi.fn()
      render(<NoResultsState onClearFilters={onClear} />)
      fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
      expect(onClear).toHaveBeenCalledTimes(1)
    })

    it('does not render button when onClearFilters not provided', () => {
      render(<NoResultsState />)
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })

    it('renders search icon', () => {
      const { container } = render(<NoResultsState />)
      expect(container.querySelector('svg[aria-hidden="true"]')).toBeInTheDocument()
    })
  })

  describe('InlineEmpty', () => {
    it('renders message', () => {
      render(<InlineEmpty message="No items here" />)
      expect(screen.getByText('No items here')).toBeInTheDocument()
    })

    it('renders empty icon', () => {
      const { container } = render(<InlineEmpty message="Empty" />)
      expect(container.querySelector('[aria-hidden="true"]')).toHaveTextContent('∅')
    })
  })
})

describe('Error States', () => {
  afterEach(() => {
    cleanup()
  })

  describe('ErrorState', () => {
    it('renders default title', () => {
      render(<ErrorState message="Something failed" />)
      expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    })

    it('renders custom title', () => {
      render(<ErrorState title="Connection failed" message="Unable to connect" />)
      expect(screen.getByText('Connection failed')).toBeInTheDocument()
    })

    it('renders error message', () => {
      render(<ErrorState message="Network error" />)
      expect(screen.getByText('Network error')).toBeInTheDocument()
    })

    it('renders retry button when onRetry provided', () => {
      const onRetry = vi.fn()
      render(<ErrorState message="Error" onRetry={onRetry} />)
      expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    })

    it('calls onRetry when clicked', () => {
      const onRetry = vi.fn()
      render(<ErrorState message="Error" onRetry={onRetry} />)
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
      expect(onRetry).toHaveBeenCalledTimes(1)
    })

    it('has alert role', () => {
      render(<ErrorState message="Error" />)
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })
  })

  describe('InlineError', () => {
    it('renders error message', () => {
      render(<InlineError message="Failed to load" />)
      expect(screen.getByText('Failed to load')).toBeInTheDocument()
    })

    it('renders retry button when onRetry provided', () => {
      const onRetry = vi.fn()
      render(<InlineError message="Error" onRetry={onRetry} />)
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    })

    it('calls onRetry when clicked', () => {
      const onRetry = vi.fn()
      render(<InlineError message="Error" onRetry={onRetry} />)
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
      expect(onRetry).toHaveBeenCalledTimes(1)
    })

    it('has alert role', () => {
      render(<InlineError message="Error" />)
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })

    it('does not render button when onRetry not provided', () => {
      render(<InlineError message="Error" />)
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })
  })
})
