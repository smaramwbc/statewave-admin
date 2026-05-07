/**
 * First-run wizard — collects the backend Statewave API URL + API key
 * the embedded sidecar needs to proxy admin requests upstream. Only
 * shown inside the Tauri desktop bundle when no credentials have been
 * stored yet.
 *
 * After save: we ask the Rust shell to spawn the sidecar and navigate
 * the main window at it. The window reload picks up the saved creds
 * automatically and lands the user on the dashboard.
 */
import { FormEvent, useState } from 'react'
import { ensureSidecar, saveBackendCredentials } from '../lib/tauri-bridge'

export function TauriFirstRun({
  onConnected,
}: {
  onConnected?: (sidecarUrl: string) => void
}) {
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
      if (!apiKey.trim()) {
        throw new Error('API key is required')
      }
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
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem',
      }}
    >
      <form
        onSubmit={onSubmit}
        style={{
          maxWidth: '460px',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
        }}
      >
        <h1 style={{ margin: 0, fontSize: '1.25rem' }}>Statewave Admin</h1>
        <p style={{ margin: 0, opacity: 0.75 }}>
          Connect this desktop app to your Statewave backend. Both fields are
          stored in your OS keychain and used by the embedded admin server.
        </p>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <span>Statewave API URL</span>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="http://localhost:8100"
            required
            autoFocus
            style={{
              padding: '0.5rem 0.75rem',
              fontSize: '1rem',
              border: '1px solid currentColor',
              borderRadius: '0.375rem',
              background: 'transparent',
              color: 'inherit',
            }}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <span>Statewave API key</span>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-…"
            required
            style={{
              padding: '0.5rem 0.75rem',
              fontSize: '1rem',
              border: '1px solid currentColor',
              borderRadius: '0.375rem',
              background: 'transparent',
              color: 'inherit',
              fontFamily: 'monospace',
            }}
          />
        </label>
        {error ? (
          <div role="alert" style={{ color: 'crimson', fontSize: '0.875rem' }}>
            {error}
          </div>
        ) : null}
        <button
          type="submit"
          disabled={busy}
          style={{
            padding: '0.625rem 1rem',
            fontSize: '1rem',
            border: '1px solid currentColor',
            borderRadius: '0.375rem',
            cursor: busy ? 'progress' : 'pointer',
            background: 'transparent',
            color: 'inherit',
          }}
        >
          {busy ? 'Connecting…' : 'Connect'}
        </button>
      </form>
    </div>
  )
}

export function TauriStartingSidecar() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem',
        opacity: 0.75,
      }}
    >
      Starting Statewave Admin…
    </div>
  )
}
