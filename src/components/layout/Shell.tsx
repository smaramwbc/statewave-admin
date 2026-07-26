import { useEffect, useState } from 'react'
import { Outlet } from 'react-router'
import { AlertTriangle, Menu, PanelLeftClose, PanelLeftOpen, ShieldCheck } from 'lucide-react'
import { Sidebar } from './Sidebar'
import { ThemeSwitcher } from '../ThemeSwitcher'
import { InstallPrompt } from '../InstallPrompt'
import { useAuth } from '../../lib/auth'
import { isTauri } from '../../lib/tauri-bridge'
import { useWizards } from '../../lib/wizards'

// Persists across reloads. Keep the key in sync with the Sidebar
// component — both read it on mount to avoid a flash of the wrong
// width before the state propagates.
const SIDEBAR_COLLAPSED_KEY = 'statewave-admin:sidebar-collapsed'

function readPersistedCollapsed(): boolean {
  // SSR / non-browser environments (the Tauri sidecar smoke tests,
  // vitest happy-dom) sometimes don't expose localStorage at all.
  // Default to expanded if anything goes wrong reading it.
  try {
    return globalThis.localStorage?.getItem(SIDEBAR_COLLAPSED_KEY) === 'true'
  } catch {
    return false
  }
}

export function Shell() {
  const { authDisabled, logout } = useAuth()
  const { openWizard } = useWizards()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  // Desktop-only sidebar collapse. On phones the sidebar is always an
  // off-canvas drawer (controlled by mobileNavOpen above), so this
  // flag has no effect at < md.
  const [collapsed, setCollapsed] = useState<boolean>(() => readPersistedCollapsed())

  useEffect(() => {
    try {
      globalThis.localStorage?.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed))
    } catch {
      /* private mode / quota / etc — best-effort */
    }
  }, [collapsed])

  // Tauri desktop bundles intentionally run with ADMIN_AUTH_DISABLED=true
  // (OS user + per-user config-dir perms ARE the auth boundary). Don't
  // nag with a banner in that context — the warning would be wrong.
  const showAuthDisabledBanner = authDisabled && !isTauri()

  return (
    // `h-screen` (not h-full) so the Shell OWNS its viewport height.
    // Previously this was h-full and worked only because AuthGate
    // wrapped it in an h-screen — that wrapper was removed when the
    // banner moved into Shell, and h-full collapsed to 0, letting the
    // page body grow past the viewport and producing a single
    // scrollbar that took the sidebar with it. h-screen + flex-col +
    // overflow-hidden on the inner row keeps the sidebar pinned and
    // restricts scrolling to the <main> element.
    <div className="h-screen bg-[var(--theme-surface-0)] flex flex-col overflow-hidden">
      {/* Skip to main content link */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[60] focus:px-4 focus:py-2 focus:bg-accent focus:text-white focus:rounded-lg focus:text-sm focus:font-medium"
      >
        Skip to main content
      </a>
      {/* Persistent banner for the "admin auth is off" critical state.
          Lives in Shell (inside BrowserRouter) so it can invoke the
          enable-admin-auth wizard via the global WizardsProvider —
          the modal opens IN PLACE, no navigation, cancel keeps the
          operator wherever they were. Previously the banner lived in
          AuthGate which sits OUTSIDE the router and could only do a
          plain href; that meant clicking it full-reloaded the page
          and the cancel button stranded users on /settings. */}
      {showAuthDisabledBanner && (
        <button
          type="button"
          onClick={() => openWizard('enable-admin-auth')}
          role="alert"
          aria-label="Open the Enable Admin Authentication wizard"
          title="Click to enable admin authentication"
          className="
            shrink-0 w-full
            bg-amber-100 dark:bg-amber-950/50
            border-b border-amber-300 dark:border-amber-900
            text-amber-800 dark:text-amber-300
            hover:bg-amber-200 dark:hover:bg-amber-950/70
            hover:text-amber-900 dark:hover:text-amber-200
            text-xs px-4 py-1.5 text-center font-medium
            flex items-center justify-center gap-2
            cursor-pointer
            transition-colors
            focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 focus-visible:ring-inset
          "
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            Admin authentication is DISABLED (ADMIN_AUTH_DISABLED=true).
            For local development only — never use in production.{' '}
            <span className="underline inline-flex items-center gap-0.5">
              <ShieldCheck className="h-3 w-3" aria-hidden="true" />
              Enable now
            </span>
          </span>
        </button>
      )}
      {/* Inner row — `min-h-0 overflow-hidden` is what keeps the
          sidebar from being dragged along by the page scroll. Without
          min-h-0, a tall <main> child can push the row taller than
          its parent and the whole viewport becomes scrollable. */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
      <Sidebar
        mobileOpen={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
        collapsed={collapsed}
      />
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar. Two hamburger affordances live here:
            * mobile (< md): opens the off-canvas drawer
            * desktop (≥ md): toggles the sidebar between full-width
              and icons-only; the choice is persisted in localStorage
              under `statewave-admin:sidebar-collapsed`. */}
        <header className="h-14 border-b border-theme-border bg-[var(--theme-card-bg)] flex items-center px-3 sm:px-4 gap-2 sm:gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open navigation menu"
            aria-expanded={mobileNavOpen}
            aria-controls="admin-mobile-drawer"
            className="md:hidden inline-flex items-center justify-center w-11 h-11 -ml-2 rounded-md text-theme-muted hover:text-theme-primary hover:bg-[var(--theme-surface-1)] transition-colors"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-pressed={collapsed}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="hidden md:inline-flex items-center justify-center w-9 h-9 -ml-1.5 rounded-md text-theme-muted hover:text-theme-primary hover:bg-[var(--theme-surface-1)] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
          >
            {collapsed ? (
              <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
            ) : (
              <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
          <div className="flex items-center gap-2 sm:gap-3 ml-auto">
            <InstallPrompt />
            <ThemeSwitcher />
            {!authDisabled && (
              <button
                type="button"
                onClick={() => void logout()}
                className="text-xs text-theme-secondary hover:text-theme-primary px-2 py-1 rounded-lg border border-theme-border bg-[var(--theme-surface-1)] hover:bg-[var(--theme-surface-2)] transition-colors"
              >
                Sign out
              </button>
            )}
          </div>
        </header>
        {/* Main content. THIS is the only scroll container in the
            authenticated app — header stays put (`shrink-0` + outside
            this element), sidebar stays put (its own column outside
            this element). Operator scrolls a long table without
            losing the chrome. */}
        <main id="main-content" className="flex-1 overflow-auto min-h-0">
          <Outlet />
        </main>
      </div>
      </div>
    </div>
  )
}
