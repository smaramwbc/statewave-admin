import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { ThemeSwitcher } from '../ThemeSwitcher'
import { useAuth } from '../../lib/auth'

export function Shell() {
  const { authDisabled, logout } = useAuth()
  return (
    <div className="min-h-screen bg-[var(--theme-surface-0)] flex">
      {/* Skip to main content link */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:bg-accent focus:text-white focus:rounded-lg focus:text-sm focus:font-medium"
      >
        Skip to main content
      </a>
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="h-14 border-b border-theme-border bg-[var(--theme-card-bg)] flex items-center justify-end px-4 gap-3 shrink-0">
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
        </header>
        {/* Main content */}
        <main id="main-content" className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
