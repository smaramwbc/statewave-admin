/**
 * Guided flow for "Enable backend authentication".
 *
 * Replaces the previous 4-step manual dance (set STATEWAVE_API_KEY on
 * admin → set api_key on backend → restart → hope you got the order
 * right) with a single modal that:
 *
 *   1. Lets the operator EITHER paste a key OR generate a strong one
 *      (32 random URL-safe bytes from `crypto.getRandomValues`).
 *   2. Writes the key to the admin server's encrypted store FIRST —
 *      this is always safe because the backend doesn't yet require it,
 *      so the admin proxy injecting a Bearer header is a no-op until
 *      step 3 lands. If the operator cancels here, no permanent change.
 *   3. Writes the same key to the backend's `system_settings.api_key`
 *      row via PATCH. Still a no-op live; the backend's auth
 *      middleware only reads `settings.api_key` at boot.
 *   4. Prompts "Restart backend now" — the existing pending-restart
 *      banner already does this, so we just toast a hint and let the
 *      operator click the existing button when they're ready.
 *
 * Failure handling: if step 3 fails (backend unreachable, DB error),
 * we offer to roll back step 2 with a single click — restoring the
 * admin's previous STATEWAVE_API_KEY state. The encrypted store
 * remembers the prior value so the rollback is clean.
 *
 * The wizard is INTENTIONALLY a no-op when called twice for the same
 * key — re-running it just refreshes the secret end-to-end (useful for
 * rotation). For DISABLING auth, the operator clears `api_key` directly
 * from the Settings page; we don't ship a "disable" wizard because the
 * disable path has no lockout risk.
 */
import { useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, KeyRound, RefreshCw, Wand2 } from 'lucide-react'
import { Button, Modal } from './ui'
import {
  patchAdminSetting,
  confirmAdminSetting,
  revertAdminSetting,
  patchSetting,
  restartBackend,
  waitForBackend,
} from '../lib/settings'

interface Props {
  open: boolean
  onClose: () => void
  /** Called after the backend PATCH lands. Parent should refetch
   *  settings so the pending-restart banner shows. */
  onApplied: () => void
}

/**
 * Generate a 32-byte URL-safe random key. Uses `crypto.getRandomValues`
 * — every modern browser exposes it, and it's cryptographically secure
 * (CSPRNG, not Math.random). 32 bytes → 256 bits, which is overkill
 * for an HMAC key but matches industry norms for bearer tokens.
 */
function generateStrongKey(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  // URL-safe base64: replace `+`/`/` with `-`/`_`, strip padding.
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

type Phase =
  | 'input'
  | 'applying-admin'
  | 'applying-backend'
  | 'done'         // Key landed on both sides; restart not yet attempted.
  | 'restarting'   // Restart in flight; we're polling the backend to come back.
  | 'failed'
  | 'restart-failed' // Restart endpoint refused or backend never came back.

export function EnableAuthWizard({ open, onClose, onApplied }: Props) {
  const [key, setKey] = useState('')
  const [phase, setPhase] = useState<Phase>('input')
  const [error, setError] = useState<string | null>(null)
  // Set when step 2 succeeded — used to gate the rollback option if
  // step 3 fails (we only roll back what we successfully changed).
  const [adminApplied, setAdminApplied] = useState(false)

  const reset = () => {
    setKey('')
    setPhase('input')
    setError(null)
    setAdminApplied(false)
  }

  const close = () => {
    reset()
    onClose()
  }

  const apply = async () => {
    if (key.length < 16) {
      setError('API key must be at least 16 characters. Click "Generate" for a strong default.')
      return
    }
    setError(null)
    setPhase('applying-admin')
    try {
      // Step 1: admin side. Use the Windows-revert pattern's confirm
      // path so we go straight to encrypted-persisted state — the
      // operator has already explicitly chosen to enable auth.
      await patchAdminSetting('statewave_api_key', key)
      await confirmAdminSetting('statewave_api_key')
      setAdminApplied(true)
    } catch (e) {
      setError(`Could not set admin-side key: ${(e as Error).message}`)
      setPhase('failed')
      return
    }
    setPhase('applying-backend')
    try {
      // Step 2: backend side via DB override. Apply lands at next boot.
      await patchSetting('api_key', key, { note: 'Enabled via Auth wizard' })
    } catch (e) {
      setError(
        `Admin key was set, but the backend update failed: ${(e as Error).message}. ` +
          `You can roll back the admin change to keep both sides in sync, or fix the backend ` +
          `and re-run the wizard.`,
      )
      setPhase('failed')
      return
    }
    setPhase('done')
    onApplied()
    toast.success('Authentication staged. Restart the backend to activate it.')
  }

  const rollbackAdmin = async () => {
    try {
      await revertAdminSetting('statewave_api_key')
      toast.success('Admin-side key reverted.')
      close()
    } catch (e) {
      toast.error(`Rollback failed: ${(e as Error).message}`)
    }
  }

  /**
   * Kick the backend's `POST /admin/restart` and wait for it to come
   * back. Same flow as the Settings page's RestartBanner — kept inline
   * here so the operator doesn't have to navigate away after enabling
   * auth. On success: the new api_key is enforced, the parent reloads
   * settings (and the dashboard banner clears on its own).
   */
  const restartNow = async () => {
    setPhase('restarting')
    setError(null)
    try {
      const r = await restartBackend()
      // Wait for the actual exit to land before polling (otherwise the
      // first poll sees the still-alive pre-exit process). Use the
      // delay the server told us, with a 500ms floor.
      await new Promise((res) => setTimeout(res, Math.max(500, (r.exit_in_seconds ?? 2) * 1000)))
      await waitForBackend()
      toast.success('Backend restarted. Authentication is now enforced.')
      onApplied()
      close()
    } catch (e) {
      setError((e as Error).message)
      setPhase('restart-failed')
    }
  }

  return (
    <Modal open={open} onClose={close} title="Enable backend authentication">
      <div className="space-y-4 text-sm">
        {phase === 'input' && (
          <>
            <div className="p-3 rounded-md bg-blue-50 dark:bg-blue-950/30 text-blue-900 dark:text-blue-200 text-xs flex gap-2">
              <KeyRound className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                After this, every request to the backend requires{' '}
                <code className="font-mono">Authorization: Bearer &lt;key&gt;</code>.
                The admin UI's proxy will inject the same key automatically, so
                this dashboard keeps working. SDK and external clients need to
                start sending the header.
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-theme-primary mb-1">
                API key
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  className="flex-1 px-3 py-2 border border-theme-border rounded-md bg-[var(--theme-card-bg)] text-theme-primary font-mono text-xs"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder="Paste a key or click Generate"
                  autoComplete="off"
                  spellCheck={false}
                />
                <Button
                  variant="secondary"
                  onClick={() => setKey(generateStrongKey())}
                  title="Generate a 32-byte CSPRNG key"
                >
                  <Wand2 className="w-4 h-4 mr-1.5" /> Generate
                </Button>
              </div>
              <p className="text-xs text-theme-muted mt-1">
                Minimum 16 chars. Strong default = 32 bytes (256 bits) of
                random data from <code>crypto.getRandomValues</code>.
              </p>
              {error && (
                <p className="mt-1.5 text-xs text-red-600 dark:text-red-400 flex items-start gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  {error}
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={close}>Cancel</Button>
              <Button onClick={apply} disabled={key.length < 16}>
                Apply &amp; stage restart
              </Button>
            </div>
          </>
        )}

        {(phase === 'applying-admin' || phase === 'applying-backend') && (
          <div className="text-center py-6 space-y-3">
            <RefreshCw className="w-8 h-8 mx-auto text-theme-muted animate-spin" />
            <p className="text-theme-secondary">
              {phase === 'applying-admin'
                ? 'Setting admin-server key (encrypted)…'
                : 'Setting backend api_key override…'}
            </p>
          </div>
        )}

        {phase === 'done' && (
          <div className="space-y-3">
            <div className="p-3 rounded-md bg-green-50 dark:bg-green-950/30 text-green-900 dark:text-green-200 text-sm">
              <p className="font-medium">Key staged on both sides.</p>
              <p className="mt-1 text-xs">
                Restart the backend now to activate enforcement, or
                defer — the "Restart required" banner on the Settings
                page has the same one-click button.
              </p>
              <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                ~5–15 seconds of API downtime expected; in-flight requests
                are dropped.
              </p>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={close}>Restart later</Button>
              <Button onClick={restartNow}>
                <RefreshCw className="w-4 h-4 mr-1.5" /> Restart backend now
              </Button>
            </div>
          </div>
        )}

        {phase === 'restarting' && (
          <div className="text-center py-6 space-y-3">
            <RefreshCw className="w-8 h-8 mx-auto text-theme-muted animate-spin" />
            <p className="text-theme-secondary">Restarting backend…</p>
            <p className="text-xs text-theme-muted">
              Waiting for the orchestrator's restart policy to bring the
              process back. This usually takes 3–10 seconds.
            </p>
          </div>
        )}

        {phase === 'restart-failed' && (
          <div className="space-y-3">
            <div className="p-3 rounded-md bg-red-50 dark:bg-red-950/30 text-red-900 dark:text-red-200 text-sm flex gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">Restart did not complete.</p>
                <p className="mt-1 text-xs">{error}</p>
                <p className="mt-2 text-xs">
                  The key IS staged on both sides — once the backend
                  comes back (manual <code className="font-mono">docker
                  compose restart api</code> if needed), auth will be
                  active. Until then, the deployment still runs with
                  the previous (no-auth) state.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={close}>Close</Button>
              <Button onClick={restartNow}>Retry restart</Button>
            </div>
          </div>
        )}

        {phase === 'failed' && (
          <div className="space-y-3">
            <div className="p-3 rounded-md bg-red-50 dark:bg-red-950/30 text-red-900 dark:text-red-200 text-sm flex gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <p>{error}</p>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={close}>Close</Button>
              {adminApplied && (
                <Button variant="secondary" onClick={rollbackAdmin}>
                  Roll back admin key
                </Button>
              )}
              <Button onClick={apply}>Retry</Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
