import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import { ErrorState } from '../src/components/ui/ErrorState'

/**
 * ErrorState — pins the structured-error contract:
 *   * suggestion renders directly under the message
 *   * technical details render inside a collapsible disclosure
 *   * onRetry callback is wired to the visible Try-again button
 *   * docsHref renders a link to a runbook when provided
 */

afterEach(() => cleanup())

describe('ErrorState', () => {
  it('renders title, message, and suggestion together', () => {
    render(
      <ErrorState
        title="Failed to load subjects"
        message="Backend was unreachable."
        suggestion="Check that the proxy is running."
      />,
    )
    expect(screen.getByText('Failed to load subjects')).toBeInTheDocument()
    expect(screen.getByText('Backend was unreachable.')).toBeInTheDocument()
    expect(screen.getByText('Check that the proxy is running.')).toBeInTheDocument()
  })

  it('hides technical details behind a disclosure that toggles on click', async () => {
    render(
      <ErrorState
        message="Something went wrong."
        technicalDetails="HTTP 502 — upstream timeout (request 7c4f)"
      />,
    )
    // Hidden by default
    expect(
      screen.queryByText(/HTTP 502 — upstream timeout/),
    ).not.toBeInTheDocument()
    // Disclosure trigger lives next to "Technical details" label
    const trigger = screen.getByRole('button', { name: /Technical details/ })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    await act(async () => {
      fireEvent.click(trigger)
    })
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText(/HTTP 502 — upstream timeout/)).toBeInTheDocument()
  })

  it('renders a Try again button that fires onRetry', async () => {
    let calls = 0
    render(
      <ErrorState
        message="Boom."
        onRetry={() => {
          calls++
        }}
      />,
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Try again/i }))
    })
    expect(calls).toBe(1)
  })

  it('renders a docs link with target=_blank when docsHref is set', () => {
    render(
      <ErrorState
        message="Boom."
        docsHref="https://example.com/runbook"
        docsLabel="Open runbook"
      />,
    )
    const link = screen.getByRole('link', { name: /Open runbook/ })
    expect(link).toHaveAttribute('href', 'https://example.com/runbook')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link.getAttribute('rel')).toContain('noopener')
  })

  it('omits the disclosure entirely when no technicalDetails are passed', () => {
    render(<ErrorState message="Boom." />)
    expect(
      screen.queryByRole('button', { name: /Technical details/ }),
    ).not.toBeInTheDocument()
  })
})
