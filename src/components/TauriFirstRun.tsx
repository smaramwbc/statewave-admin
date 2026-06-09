/**
 * First-run wizard — collects the backend Statewave API URL + API key
 * the embedded sidecar needs to proxy admin requests upstream. Only
 * shown inside the Tauri desktop bundle when no credentials have been
 * stored yet.
 *
 * After save: we ask the Rust shell to spawn the sidecar and navigate
 * the main window at it. The window reload picks up the saved creds
 * automatically and lands the user on the dashboard.
 *
 * Styling mirrors `LoginPage.tsx` — same logo block, same card
 * chrome, same theme tokens — so the desktop first-run feels like a
 * member of the same console rather than a stray pre-app screen.
 */
import { FormEvent, useState } from 'react'
import { Button } from './ui'
import { useTheme } from '../lib/theme'
import {
  ensureSidecar,
  saveBackendCredentials,
  validateBackend,
} from '../lib/tauri-bridge'

export function TauriFirstRun({
  onConnected,
}: {
  onConnected?: (sidecarUrl: string) => void
}) {
  const { resolvedTheme } = useTheme()
  const [url, setUrl] = useState('http://localhost:8100')
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const trimmed = url.trim().replace(/\/+$/, '')
      if (!/^https?:\/\//i.test(trimmed)) {
        throw new Error('Backend URL must start with http:// or https://')
      }
      // Probe the backend BEFORE saving so we catch wrong-URL /
      // unreachable-host / wrong-API-key cases inline, instead of
      // saving bad creds, spawning the sidecar, and surfacing the
      // error post-facto on the dashboard.
      await validateBackend(trimmed, apiKey.trim())
      // API key is optional — many local / self-hosted Statewave
      // deployments run without one. The sidecar passes the trimmed
      // value (possibly empty) through to STATEWAVE_API_KEY; the
      // backend decides whether auth is required.
      await saveBackendCredentials(trimmed, apiKey.trim())
      const sidecarUrl = await ensureSidecar()
      // The Rust shell already navigated the webview; this onConnected
      // hook is a hint for the bootstrap layer in case it wants to
      // render a "starting…" message before the location swap takes
      // effect.
      onConnected?.(sidecarUrl)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-[var(--theme-surface-0)] flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <img
            src={
              resolvedTheme === 'dark'
                ? '/statewave_icon_dark.png'
                : '/statewave_icon_light.png'
            }
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
            Connect to your backend
          </h1>
          <p className="text-xs text-theme-muted mb-5">
            Both fields are stored in your per-user config directory and used
            by the embedded admin server. You can change them later from the
            menu bar via{' '}
            <span className="font-medium text-theme-primary">
              Statewave Admin → Disconnect Backend…
            </span>
          </p>

          <form onSubmit={onSubmit} className="space-y-3">
            <label className="block">
              <span className="text-[11px] uppercase tracking-wider text-theme-muted font-medium">
                Statewave API URL
              </span>
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="http://localhost:8100"
                required
                autoFocus
                className="mt-1 w-full rounded-lg border border-theme-border bg-[var(--theme-surface-1)] px-3 py-2 text-sm text-theme-primary focus:outline-none focus:ring-2 focus:ring-accent/40"
              />
            </label>

            <label className="block">
              <span className="text-[11px] uppercase tracking-wider text-theme-muted font-medium">
                Statewave API key{' '}
                <span className="text-theme-muted/70 normal-case tracking-normal">
                  · optional
                </span>
              </span>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="leave blank if your backend has no API-key auth"
                className="mt-1 w-full rounded-lg border border-theme-border bg-[var(--theme-surface-1)] px-3 py-2 text-sm text-theme-primary font-mono focus:outline-none focus:ring-2 focus:ring-accent/40"
              />
            </label>

            {error ? (
              <div role="alert" className="text-xs text-red-600 dark:text-red-400">
                {error}
              </div>
            ) : null}

            <Button
              type="submit"
              variant="primary"
              size="md"
              disabled={busy}
              loading={busy}
              className="w-full"
            >
              {busy ? 'Connecting…' : 'Connect'}
            </Button>
          </form>
        </div>

        <p className="text-[10px] text-theme-muted text-center mt-4">
          The embedded admin server runs locally on{' '}
          <code className="font-mono">127.0.0.1</code> and never exposes a port
          to the network.
        </p>
      </div>
    </div>
  )
}

export function TauriStartingSidecar() {
  const { resolvedTheme } = useTheme()
  return (
    <div className="min-h-screen bg-[var(--theme-surface-0)] flex items-center justify-center px-6">
      <div className="flex flex-col items-center text-center">
        <img
          src={
            resolvedTheme === 'dark'
              ? '/statewave_icon_dark.png'
              : '/statewave_icon_light.png'
          }
          alt="Statewave"
          className="h-12 w-12 mb-3 animate-pulse"
        />
        <p className="text-sm text-theme-muted">Starting Statewave Admin…</p>
      </div>
    </div>
  )
}
