import { useEffect, useState } from 'react'

/**
 * Small, dismissible "Install" pill for Statewave Admin.
 *
 * Behavior:
 *   - Listens for `beforeinstallprompt` (Chrome / Edge / Android Chrome).
 *     Until the browser fires that event, the component renders nothing.
 *   - Once installable, surfaces a one-line affordance in the header.
 *     Tapping it calls the deferred prompt's `prompt()` method and
 *     reports the outcome to the console for debugging.
 *   - User dismissal is sticky for 30 days via localStorage so we don't
 *     pester them on every visit.
 *   - When the app is already running standalone, or after install, the
 *     component renders nothing.
 *
 * iOS Safari does not fire `beforeinstallprompt` — install on iOS is
 * "Share → Add to Home Screen" only. We intentionally do not show a
 * custom iOS instruction because we'd just be teaching users a
 * platform feature they'll trip over once. The README documents this.
 */

const DISMISSED_KEY = 'statewave-admin-install-dismissed-at'
const DISMISS_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: ReadonlyArray<string>
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
  prompt: () => Promise<void>
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true
  // iOS Safari: legacy Apple-only flag.
  const navAny = window.navigator as Navigator & { standalone?: boolean }
  return navAny.standalone === true
}

function isRecentlyDismissed(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const at = window.localStorage.getItem(DISMISSED_KEY)
    if (!at) return false
    const ts = Number.parseInt(at, 10)
    if (Number.isNaN(ts)) return false
    return Date.now() - ts < DISMISS_TTL_MS
  } catch {
    return false
  }
}

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  // Initialize installed lazily — checking display-mode at mount avoids a
  // setState-in-effect violation and gives us the right value on the
  // first paint (so we never flash the install pill in standalone mode).
  const [installed, setInstalled] = useState<boolean>(() => isStandalone())

  useEffect(() => {
    if (installed) return
    if (isRecentlyDismissed()) return

    const onBeforeInstall = (e: Event) => {
      // Stop Chrome from showing its own mini-infobar; we render our own.
      e.preventDefault()
      setDeferred(e as BeforeInstallPromptEvent)
    }
    const onInstalled = () => {
      setInstalled(true)
      setDeferred(null)
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [installed])

  if (installed || !deferred) return null

  const onInstall = async () => {
    try {
      await deferred.prompt()
      const choice = await deferred.userChoice
      if (choice.outcome === 'dismissed') {
        try {
          window.localStorage.setItem(DISMISSED_KEY, String(Date.now()))
        } catch {
          // best-effort — Safari private mode etc.
        }
      }
    } finally {
      // The deferred prompt is single-use; drop it either way.
      setDeferred(null)
    }
  }

  const onDismiss = () => {
    try {
      window.localStorage.setItem(DISMISSED_KEY, String(Date.now()))
    } catch {
      // best-effort
    }
    setDeferred(null)
  }

  return (
    <div
      role="region"
      aria-label="Install Statewave Admin"
      className="hidden sm:inline-flex items-center gap-2 px-2 py-1 rounded-lg border border-theme-border bg-[var(--theme-surface-1)]"
    >
      <button
        type="button"
        onClick={onInstall}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-theme-primary hover:text-accent transition-colors px-2 py-1 rounded-md"
        title="Install Statewave Admin as an app"
      >
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v12m0 0l-4-4m4 4l4-4M4 20h16" />
        </svg>
        Install app
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss install prompt"
        className="inline-flex items-center justify-center w-6 h-6 text-theme-muted hover:text-theme-primary rounded-md transition-colors"
      >
        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}
