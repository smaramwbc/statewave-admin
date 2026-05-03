import type { ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { LoginPage } from '../pages/LoginPage'

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

  // Banner-aware layout. Without this wrapper, the ⚠️ banner sits above
  // Shell's `min-h-screen` container and forces total page height to
  // `banner + 100vh`, which produces a body-level scrollbar even when the
  // page contents fit. Making the parent a fixed-height column flex lets
  // the banner consume its natural row and Shell fill the remainder.
  return (
    <div className="h-screen flex flex-col">
      {authDisabled && (
        <div
          role="alert"
          className="shrink-0 bg-amber-100 dark:bg-amber-950/50 border-b border-amber-300 dark:border-amber-900 text-amber-800 dark:text-amber-300 text-xs px-4 py-1.5 text-center font-medium flex items-center justify-center gap-2"
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            Admin authentication is DISABLED (ADMIN_AUTH_DISABLED=true). For
            local development only — never use in production.
          </span>
        </div>
      )}
      <div className="flex-1 min-h-0 flex flex-col">{children}</div>
    </div>
  )
}
