import { useState, type FormEvent } from 'react'
import { useAuth } from '../lib/auth'
import { useTheme } from '../lib/theme'
import { Button } from '../components/ui'

export function LoginPage() {
  const { login, configError, authDisabled } = useAuth()
  const { resolvedTheme } = useTheme()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!password) return
    setSubmitting(true)
    setError(null)
    const r = await login(password)
    setSubmitting(false)
    if (r.ok) {
      // LoginPage renders outside BrowserRouter so useNavigate() is not
      // available. Replace /login (or any auth-gate URL) with the root so
      // the router doesn't render a blank page for an unregistered path.
      window.location.replace('/')
      return
    }
    if (!r.ok) {
      setError(
        r.error === 'auth_not_configured'
          ? 'Admin is not configured. Set ADMIN_PASSWORD and ADMIN_SESSION_SECRET on the server.'
          : r.error === 'network_error'
            ? 'Could not reach the admin auth service.'
            : 'Incorrect password.',
      )
      setPassword('')
    }
  }

  return (
    <div className="min-h-screen bg-[var(--theme-surface-0)] flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <img
            src={resolvedTheme === 'dark' ? '/statewave_icon_dark.png' : '/statewave_icon_light.png'}
            alt="Statewave"
            className="h-12 w-12 mb-3"
          />
          <div className="text-sm font-semibold text-theme-primary tracking-tight">
            Statewave
          </div>
          <div className="text-[11px] text-theme-muted uppercase tracking-wider mt-1">
            Admin Console
          </div>
        </div>

        <div className="rounded-xl border border-theme-border bg-[var(--theme-card-bg)] p-6">
          <h1 className="text-base font-semibold text-theme-primary mb-1">
            Admin authentication required
          </h1>
          <p className="text-xs text-theme-muted mb-5">
            Sign in to access the operator console.
          </p>

          {configError && (
            <div
              role="alert"
              className="mb-4 rounded-lg border border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/40 px-3 py-2 text-xs text-red-700 dark:text-red-300"
            >
              {configError}
            </div>
          )}

          {authDisabled && (
            <div
              role="alert"
              className="mb-4 rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40 px-3 py-2 text-xs text-amber-800 dark:text-amber-300"
            >
              Authentication is disabled (ADMIN_AUTH_DISABLED=true). For local
              and dev use only — never enable this in production.
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3">
            <label className="block">
              <span className="text-[11px] uppercase tracking-wider text-theme-muted font-medium">
                Password
              </span>
              <input
                type="password"
                autoComplete="current-password"
                autoFocus
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded-lg border border-theme-border bg-[var(--theme-surface-1)] px-3 py-2 text-sm text-theme-primary focus:outline-none focus:ring-2 focus:ring-accent/40"
              />
            </label>

            {error && (
              <div role="alert" className="text-xs text-red-600 dark:text-red-400">
                {error}
              </div>
            )}

            <Button
              type="submit"
              variant="primary"
              size="md"
              disabled={!password}
              loading={submitting}
              className="w-full"
            >
              {submitting ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </div>

        <p className="text-[10px] text-theme-muted text-center mt-4">
          This console is private. Pair the built-in password with an external
          access layer (Cloudflare Access, OAuth2 Proxy, IP allowlist, or VPN)
          for production.
        </p>
      </div>
    </div>
  )
}
