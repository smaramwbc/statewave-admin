import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, act, cleanup, waitFor, within } from '@testing-library/react'
import { Toaster, toast } from 'sonner'
import { CopyableMono } from '../src/components/ui/CopyableMono'

/**
 * CopyableMono — pins the contract pages depend on:
 *   * the visible value is rendered in monospace
 *   * the copy button has an accessible label that names the kind of
 *     identifier (so screen readers announce "Copy subject ID", not
 *     "Copy")
 *   * clicking the button sends the FULL value to the clipboard, even
 *     when `display` shows a truncated preview
 *   * a success toast appears on a successful copy
 */

afterEach(() => {
  // sonner keeps its toasts in a module-level store that outlives the React
  // tree, so `cleanup()` unmounts the Toaster but leaves the toast itself
  // queued. The next test in the file renders a fresh Toaster, the survivor is
  // re-rendered into it, and a `getByText` for the toast title finds two.
  //
  // sonner 2.0.7 happened not to re-render the survivor, so the leak was
  // invisible; 2.0.8 does, which is what turned three of these files red on the
  // dependency bump. The store is the thing that needs clearing.
  toast.dismiss()
  cleanup()
  vi.restoreAllMocks()
})

describe('CopyableMono', () => {
  beforeEach(() => {
    // happy-dom's Navigator doesn't ship clipboard out of the box; install
    // a controllable mock so we can assert on what got written.
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn(async () => undefined) },
      configurable: true,
      writable: true,
    })
  })

  it('renders the value in monospace by default', () => {
    render(<CopyableMono value="user-123" labelForA11y="subject ID" />)
    const span = screen.getByText('user-123')
    expect(span.className).toMatch(/font-mono/)
  })

  it('exposes an accessible label naming the identifier', () => {
    render(<CopyableMono value="user-123" labelForA11y="subject ID" />)
    expect(screen.getByRole('button', { name: 'Copy subject ID' })).toBeInTheDocument()
  })

  it('copies the FULL value, not the truncated display, to the clipboard', async () => {
    const fullId = 'demo_web_18bc4811c260475ab8fb7bb27c2f3a97__support-agent'
    render(
      <CopyableMono
        value={fullId}
        display={`${fullId.slice(0, 8)}…`}
        labelForA11y="subject ID"
      />,
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy subject ID' }))
    })
    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1)
    expect((navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
      fullId,
    )
  })

  it('shows a "Copied" toast on success', async () => {
    render(
      <>
        <Toaster position="bottom-right" />
        <CopyableMono value="user-123" labelForA11y="subject ID" />
      </>,
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy subject ID' }))
    })
    const toastTitle = await waitFor(() => screen.getByText('Copied'))
    // Description carries the identifier label so the toast is informative.
    const toastLi = toastTitle.closest('li') as HTMLElement
    expect(toastLi).not.toBeNull()
    expect(within(toastLi).getByText(/subject ID/i)).toBeInTheDocument()
  })

  it('shows a "Copy failed" toast when the clipboard write throws', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: vi.fn(async () => {
          throw new Error('blocked')
        }),
      },
      configurable: true,
      writable: true,
    })
    render(
      <>
        <Toaster position="bottom-right" />
        <CopyableMono value="user-123" labelForA11y="subject ID" />
      </>,
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy subject ID' }))
    })
    await waitFor(() => {
      expect(screen.getByText('Copy failed')).toBeInTheDocument()
    })
  })
})
