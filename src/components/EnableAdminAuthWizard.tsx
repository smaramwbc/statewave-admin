/**
 * One-click "Enable admin authentication" flow.
 *
 * Triggered by the Production-readiness card's Fix button on the
 * critical "Admin authentication is disabled" issue. Replaces the
 * previous "edit your deployment env and redeploy" path with a single
 * modal that:
 *
 *   1. Lets the operator paste a new admin password OR generate a
 *      strong one (32 bytes CSPRNG, base64).
 *   2. POSTs to `/api/admin-settings/enable-admin-auth`. The server
 *      atomically:
 *        - sets `process.env.ADMIN_PASSWORD`
 *        - generates + sets `process.env.ADMIN_SESSION_SECRET` if missing
 *        - deletes `process.env.ADMIN_AUTH_DISABLED` (the actual fix)
 *        - persists all three to the encrypted SecretsStore
 *      Auth is live on the next request — no admin-server restart
 *      needed.
 *   3. Logs the operator out (the existing session was issued with
 *      auth disabled — there's no signed cookie, so the next gated
 *      request would 401 anyway) and routes them to /login.
 *
 * Safety:
 *   - If the SecretsStore isn't configured (no master key), the
 *     server still mutates `process.env` so the change takes effect
 *     immediately, but warns that it'll revert on next restart. The
 *     UI surfaces that warning in the success step.
 *   - The wizard runs UNDER an already-disabled-auth admin (the only
 *     state where this CTA is reachable), so calling it without
 *     authentication is by design — that's the same security model
 *     the existing /api/admin-settings endpoints use under
 *     ADMIN_AUTH_DISABLED.
 */
import { useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, Check, Copy, KeyRound, RefreshCw, ShieldCheck, Wand2 } from 'lucide-react'
import { Button, Modal } from './ui'
import { enableAdminAuth } from '../lib/settings'

interface Props {
  open: boolean
  onClose: () => void
}

function generateStrongKey(): string {
  // Same primitive the EnableAuth wizard uses — 32 random bytes from
  // crypto.getRandomValues, URL-safe base64. 256 bits is overkill for
  // a password but easy to copy/paste; the server accepts ≥ 8 chars.
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

type Phase = 'input' | 'applying' | 'done' | 'failed'

export function EnableAdminAuthWizard({ open, onClose }: Props) {
  const [password, setPassword] = useState('')
  // True iff the operator has affirmatively clicked the "I've saved
  // this" checkbox. We gate Apply on it whenever the password was
  // generated locally — generated passwords have no recovery path
  // outside the encrypted secrets file (which only the master key can
  // decrypt). Without the gate, an operator clicks Apply and then has
  // no idea what they just persisted; the only way back in is a docker
  // exec recovery script. This belt-and-braces requires them to
  // actually save it.
  const [acknowledged, setAcknowledged] = useState(false)
  const [wasGenerated, setWasGenerated] = useState(false)
  const [copyDone, setCopyDone] = useState(false)
  const [phase, setPhase] = useState<Phase>('input')
  const [error, setError] = useState<string | null>(null)
  const [persisted, setPersisted] = useState(false)

  const reset = () => {
    setPassword('')
    setAcknowledged(false)
    setWasGenerated(false)
    setCopyDone(false)
    setPhase('input')
    setError(null)
    setPersisted(false)
  }

  const onGenerate = () => {
    setPassword(generateStrongKey())
    setWasGenerated(true)
    setAcknowledged(false)
    setCopyDone(false)
  }

  const onManualEdit = (v: string) => {
    setPassword(v)
    // If the operator types over the generated value, drop the
    // "generated" flag — a value they typed themselves is by
    // definition something they know.
    setWasGenerated(false)
    setAcknowledged(false)
    setCopyDone(false)
  }

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(password)
      setCopyDone(true)
      // Auto-reset the "copied" affordance so the operator who copies
      // multiple times still gets visual feedback on each click.
      setTimeout(() => setCopyDone(false), 2000)
    } catch {
      // Clipboard API can be unavailable on http: origins or in
      // sandboxed contexts. Fall back to a selection so the operator
      // can ⌘C / ctrl-C themselves.
      toast.info('Clipboard blocked. Select the password and copy manually.')
    }
  }

  const close = () => {
    reset()
    onClose()
  }

  const apply = async () => {
    if (password.length < 8) {
      setError('Password must be at least 8 characters. Click "Generate" for a strong default.')
      return
    }
    setError(null)
    setPhase('applying')
    try {
      const r = await enableAdminAuth(password)
      setPersisted(r.persisted)
      setPhase('done')
    } catch (e) {
      setError((e as Error).message)
      setPhase('failed')
    }
  }

  const goToLogin = async () => {
    // Best-effort logout — even though the cookie is meaningless under
    // auth-disabled, clearing it keeps things clean. We don't await
    // the response because the redirect is the operator-facing change.
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } catch {
      /* ignore — the redirect is what matters */
    }
    toast.success('Admin authentication enabled. Please log in with your new password.')
    // Hard navigation so the AuthGate re-runs cleanly with the new
    // env. A react-router push would keep the stale auth context.
    window.location.replace('/')
  }

  return (
    <Modal open={open} onClose={close} title="Enable admin authentication">
      <div className="space-y-4 text-sm">
        {phase === 'input' && (
          <>
            <div className="p-3 rounded-md bg-blue-50 dark:bg-blue-950/30 text-blue-900 dark:text-blue-200 text-xs flex gap-2">
              <KeyRound className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                After this, the admin UI requires a password to access.
                The change applies <strong>instantly</strong> — no admin-server
                restart needed. You will be logged out and redirected to the
                login screen.
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-theme-primary mb-1">
                New admin password
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  className="flex-1 px-3 py-2 border border-theme-border rounded-md bg-[var(--theme-card-bg)] text-theme-primary font-mono text-xs"
                  value={password}
                  onChange={(e) => onManualEdit(e.target.value)}
                  placeholder="Paste a password or click Generate"
                  autoComplete="off"
                  spellCheck={false}
                />
                <Button
                  variant="secondary"
                  onClick={onGenerate}
                  title="Generate a 32-byte CSPRNG password"
                >
                  <Wand2 className="w-4 h-4 mr-1.5" /> Generate
                </Button>
              </div>
              <p className="text-xs text-theme-muted mt-1">
                Minimum 8 chars.
              </p>
              {error && (
                <p className="mt-1.5 text-xs text-red-600 dark:text-red-400 flex items-start gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  {error}
                </p>
              )}
            </div>

            {/* Save-this gate — only renders when the password came
                from the Generate button. If the operator typed their
                own value they obviously already know it; the gate
                exists for the random-base64 case where forgetting it
                means a docker-exec recovery dance. */}
            {wasGenerated && password.length >= 8 && (
              <div className="p-3 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-900">
                <div className="flex items-start gap-2 text-xs text-amber-900 dark:text-amber-200">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <p>
                    <strong>Save this password somewhere safe.</strong> It's a
                    random string — no one else has it. Forgetting it means
                    decrypting the secrets file from inside the container to
                    recover (recovery script in <code>statewave-admin/scripts/</code>).
                  </p>
                </div>
                <div className="mt-3 flex gap-2">
                  <code className="flex-1 px-2 py-1.5 rounded bg-[var(--theme-surface-2)] font-mono text-xs text-theme-primary break-all">
                    {password}
                  </code>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={copyToClipboard}
                  >
                    {copyDone ? (
                      <>
                        <Check className="w-3.5 h-3.5 mr-1.5 text-green-600 dark:text-green-400" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5 mr-1.5" /> Copy
                      </>
                    )}
                  </Button>
                </div>
                <label className="mt-3 flex items-center gap-2 text-xs text-theme-primary cursor-pointer">
                  <input
                    type="checkbox"
                    checked={acknowledged}
                    onChange={(e) => setAcknowledged(e.target.checked)}
                    className="w-4 h-4"
                  />
                  I've saved this password in a password manager / safe place.
                </label>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={close}>Cancel</Button>
              <Button
                onClick={apply}
                disabled={password.length < 8 || (wasGenerated && !acknowledged)}
              >
                <ShieldCheck className="w-4 h-4 mr-1.5" />
                Enable authentication
              </Button>
            </div>
          </>
        )}

        {phase === 'applying' && (
          <div className="text-center py-6 space-y-3">
            <RefreshCw className="w-8 h-8 mx-auto text-theme-muted animate-spin" />
            <p className="text-theme-secondary">Enabling admin authentication…</p>
          </div>
        )}

        {phase === 'done' && (
          <div className="space-y-3">
            <div className="p-3 rounded-md bg-green-50 dark:bg-green-950/30 text-green-900 dark:text-green-200 text-sm">
              <p className="font-medium">Admin authentication is now active.</p>
              <p className="mt-1 text-xs">
                Next request will require login. Click below to log out and
                re-authenticate with your new password.
              </p>
              {!persisted && (
                <p className="mt-2 text-xs text-amber-700 dark:text-amber-300 flex items-start gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  STATEWAVE_ADMIN_MASTER_KEY is not set, so the change is
                  in-memory only. Set the master key and reapply to make it
                  survive an admin restart.
                </p>
              )}
            </div>
            {/* Last-chance copy panel for the generated-password case.
                The operator already acknowledged on the input step, but
                showing it again on success lets them copy IF the prior
                copy got eaten by a sandboxed clipboard or browser
                weirdness. Once they leave this modal the only recovery
                is the docker-exec decrypt script. */}
            {wasGenerated && (
              <div className="p-3 rounded-md bg-[var(--theme-surface-1)] border border-theme-border">
                <p className="text-xs text-theme-muted mb-2">
                  Last chance to copy — this view doesn't come back:
                </p>
                <div className="flex gap-2">
                  <code className="flex-1 px-2 py-1.5 rounded bg-[var(--theme-surface-2)] font-mono text-xs text-theme-primary break-all">
                    {password}
                  </code>
                  <Button size="sm" variant="secondary" onClick={copyToClipboard}>
                    {copyDone ? (
                      <>
                        <Check className="w-3.5 h-3.5 mr-1.5 text-green-600 dark:text-green-400" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5 mr-1.5" /> Copy
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button onClick={goToLogin}>Continue to login</Button>
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
              <Button onClick={apply}>Retry</Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
