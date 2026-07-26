import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { MemoryRouter } from 'react-router'
import { ErrorBoundary } from '../src/components/ErrorBoundary'
import { ThemeProvider } from '../src/lib/theme'

// Component that throws an error
function BrokenComponent({ shouldThrow = true }: { shouldThrow?: boolean }) {
  if (shouldThrow) {
    throw new Error('Test error from BrokenComponent')
  }
  return <div>Working component</div>
}

// Wrapper for tests that need routing context
function TestWrapper({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <MemoryRouter>
        {children}
      </MemoryRouter>
    </ThemeProvider>
  )
}

describe('ErrorBoundary', () => {
  // Suppress console.error during error boundary tests
  const originalError = console.error
  beforeEach(() => {
    console.error = vi.fn()
  })

  afterEach(() => {
    console.error = originalError
    cleanup()
  })

  it('renders children when no error occurs', () => {
    render(
      <TestWrapper>
        <ErrorBoundary level="page">
          <div>Normal content</div>
        </ErrorBoundary>
      </TestWrapper>
    )

    expect(screen.getByText('Normal content')).toBeInTheDocument()
  })

  it('catches errors and shows page-level fallback', () => {
    render(
      <TestWrapper>
        <ErrorBoundary level="page">
          <BrokenComponent />
        </ErrorBoundary>
      </TestWrapper>
    )

    expect(screen.getByText('This page encountered an error')).toBeInTheDocument()
    expect(screen.getByText('Try Again')).toBeInTheDocument()
    expect(screen.getByText('Go to Overview')).toBeInTheDocument()
  })

  it('catches errors and shows section-level fallback', () => {
    render(
      <TestWrapper>
        <ErrorBoundary level="section">
          <BrokenComponent />
        </ErrorBoundary>
      </TestWrapper>
    )

    expect(screen.getByText('Failed to load this section')).toBeInTheDocument()
    expect(screen.getByText('Retry')).toBeInTheDocument()
  })

  it('catches errors and shows modal-level fallback', () => {
    render(
      <TestWrapper>
        <ErrorBoundary level="modal">
          <BrokenComponent />
        </ErrorBoundary>
      </TestWrapper>
    )

    expect(screen.getByText('Failed to load this content')).toBeInTheDocument()
    expect(screen.getByText('Try Again')).toBeInTheDocument()
  })

  it('catches errors and shows app-level fallback', () => {
    render(
      <ErrorBoundary level="app">
        <BrokenComponent />
      </ErrorBoundary>
    )

    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByText('Reload Page')).toBeInTheDocument()
  })

  it('resets error state when Try Again is clicked', () => {
    let shouldThrow = true

    function ConditionalBroken() {
      if (shouldThrow) {
        throw new Error('Conditional error')
      }
      return <div>Recovered content</div>
    }

    const { rerender } = render(
      <TestWrapper>
        <ErrorBoundary level="page">
          <ConditionalBroken />
        </ErrorBoundary>
      </TestWrapper>
    )

    // Should show error fallback
    expect(screen.getByText('This page encountered an error')).toBeInTheDocument()

    // Fix the error condition
    shouldThrow = false

    // Click Try Again
    fireEvent.click(screen.getByText('Try Again'))

    // Re-render to trigger the reset
    rerender(
      <TestWrapper>
        <ErrorBoundary level="page">
          <ConditionalBroken />
        </ErrorBoundary>
      </TestWrapper>
    )

    // Should show recovered content
    expect(screen.getByText('Recovered content')).toBeInTheDocument()
  })

  it('logs error to console', () => {
    render(
      <TestWrapper>
        <ErrorBoundary level="section">
          <BrokenComponent />
        </ErrorBoundary>
      </TestWrapper>
    )

    expect(console.error).toHaveBeenCalled()
  })

  it('isolates errors - sibling components still render', () => {
    render(
      <TestWrapper>
        <div>
          <div data-testid="sibling">Sibling content</div>
          <ErrorBoundary level="section">
            <BrokenComponent />
          </ErrorBoundary>
        </div>
      </TestWrapper>
    )

    // Sibling should still render
    expect(screen.getByTestId('sibling')).toHaveTextContent('Sibling content')
    // Error boundary should show fallback
    expect(screen.getByText('Failed to load this section')).toBeInTheDocument()
  })

  it('uses custom fallback when provided', () => {
    render(
      <TestWrapper>
        <ErrorBoundary fallback={<div>Custom error message</div>}>
          <BrokenComponent />
        </ErrorBoundary>
      </TestWrapper>
    )

    expect(screen.getByText('Custom error message')).toBeInTheDocument()
  })
})

describe('ErrorBoundary - Go to Overview link', () => {
  const originalError = console.error
  beforeEach(() => {
    console.error = vi.fn()
  })

  afterEach(() => {
    console.error = originalError
    cleanup()
  })

  it('page-level fallback has link to home', () => {
    render(
      <TestWrapper>
        <ErrorBoundary level="page">
          <BrokenComponent />
        </ErrorBoundary>
      </TestWrapper>
    )

    const overviewLink = screen.getByText('Go to Overview')
    expect(overviewLink.closest('a')).toHaveAttribute('href', '/')
  })
})
