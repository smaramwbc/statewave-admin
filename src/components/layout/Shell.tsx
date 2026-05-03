import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Menu } from 'lucide-react'
import { Sidebar } from './Sidebar'
import { ThemeSwitcher } from '../ThemeSwitcher'
import { InstallPrompt } from '../InstallPrompt'
import { useAuth } from '../../lib/auth'

export function Shell() {
  const { authDisabled, logout } = useAuth()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  return (
    <div className="h-full min-h-0 bg-[var(--theme-surface-0)] flex">
      {/* Skip to main content link */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[60] focus:px-4 focus:py-2 focus:bg-accent focus:text-white focus:rounded-lg focus:text-sm focus:font-medium"
      >
        Skip to main content
      </a>
      <Sidebar
        mobileOpen={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
      />
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar — gets a hamburger toggle on phones, where the sidebar
            is an off-canvas drawer instead of a permanent column. The
            44×44 tap target meets WCAG / Apple HIG for touch. */}
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
        {/* Main content */}
        <main id="main-content" className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
