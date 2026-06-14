import type { ReactNode } from 'react'
import { useAuth } from '../lib/auth'
import { LoginPage } from '../pages/LoginPage'

/**
 * AuthGate sits OUTSIDE the BrowserRouter — it has to render the
 * LoginPage without router context, so it can't use wizard / route
 * hooks. The previous "admin auth disabled" banner has been moved
 * into Shell (which IS inside the router) so it can openWizard()
 * in-place via the WizardsProvider rather than full-navigate.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { loading, authenticated, configError, authDisabled } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--theme-surface-0)] flex items-center justify-center">
        <div className="flex items-center gap-2 text-xs text-theme-muted">
          <span className="inline-block w-3 h-3 rounded-full border-2 border-theme-border border-t-transparent animate-spin" />
          Checking session…
        </div>
      </div>
    )
  }

  // Block access whenever the server is misconfigured in production, even if
  // a stale cookie technically validates — the user must re-auth/configure.
  if (configError && !authDisabled) {
    return <LoginPage />
  }

  if (!authenticated) {
    return <LoginPage />
  }

  return <>{children}</>
}
