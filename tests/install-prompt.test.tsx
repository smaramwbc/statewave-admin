/**
 * InstallPrompt UX contract.
 *
 * The component renders nothing by default; only a `beforeinstallprompt`
 * event flips it on. We can synthesize that event in happy-dom and
 * verify the install / dismiss paths.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { InstallPrompt } from '../src/components/InstallPrompt'

interface FakePromptEvent extends Event {
  platforms: string[]
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
  prompt: () => Promise<void>
  preventDefault: () => void
}

function fireBeforeInstallPrompt(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const promptFn = vi.fn(() => Promise.resolve())
  const event: FakePromptEvent = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
    platforms: ['web'],
    userChoice: Promise.resolve({ outcome, platform: 'web' }),
    prompt: promptFn,
  })
  window.dispatchEvent(event)
  return { promptFn, event }
}

beforeEach(() => {
  // matchMedia in happy-dom returns a default; force it to "browser" so
  // the standalone-detection in the component returns false.
  window.matchMedia = (q: string) =>
    ({
      matches: false,
      media: q,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList
  try {
    window.localStorage.removeItem('statewave-admin-install-dismissed-at')
  } catch {
    // ignore
  }
})

afterEach(() => {
  cleanup()
})

describe('InstallPrompt', () => {
  it('renders nothing before beforeinstallprompt fires', () => {
    const { container } = render(<InstallPrompt />)
    expect(container.firstChild).toBeNull()
  })

  it('appears after beforeinstallprompt and offers an install button', async () => {
    render(<InstallPrompt />)
    fireBeforeInstallPrompt()
    const installButton = await screen.findByRole('button', { name: /install app/i })
    expect(installButton).toBeInTheDocument()
  })

  it('calls prompt() when the install button is clicked', async () => {
    render(<InstallPrompt />)
    const { promptFn } = fireBeforeInstallPrompt('accepted')
    const installButton = await screen.findByRole('button', { name: /install app/i })
    fireEvent.click(installButton)
    await waitFor(() => expect(promptFn).toHaveBeenCalledTimes(1))
  })

  it('dismiss button hides the prompt and persists the dismissal', async () => {
    render(<InstallPrompt />)
    fireBeforeInstallPrompt()
    const dismiss = await screen.findByRole('button', { name: /dismiss install prompt/i })
    fireEvent.click(dismiss)
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /install app/i })).not.toBeInTheDocument()
    })
    expect(window.localStorage.getItem('statewave-admin-install-dismissed-at')).not.toBeNull()
  })

  it('does not re-render after the user dismissed within the 30-day window', async () => {
    // Simulate a recent dismissal (yesterday).
    const yesterday = Date.now() - 24 * 60 * 60 * 1000
    window.localStorage.setItem('statewave-admin-install-dismissed-at', String(yesterday))

    const { container } = render(<InstallPrompt />)
    fireBeforeInstallPrompt()
    // Give React a tick — the listener wasn't even attached, so nothing renders.
    await new Promise((r) => setTimeout(r, 0))
    expect(container.firstChild).toBeNull()
  })
})
