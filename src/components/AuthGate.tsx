import type { ReactNode } from 'react'
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

  return (
    <>
      {authDisabled && (
        <div
          role="alert"
          className="bg-amber-100 dark:bg-amber-950/50 border-b border-amber-300 dark:border-amber-900 text-amber-800 dark:text-amber-300 text-xs px-4 py-1.5 text-center font-medium"
        >
          ⚠️ Admin authentication is DISABLED (ADMIN_AUTH_DISABLED=true). For
          local development only — never use in production.
        </div>
      )}
      {children}
    </>
  )
}
