/**
 * Admin-server self-settings — ADMIN_PASSWORD + STATEWAVE_API_KEY.
 *
 * These are NOT proxied to the statewave backend. They control the admin
 * Node process itself: the login password and the API key that the proxy
 * forwards to statewave.
 *
 * Why a Windows-resolution-style revert pattern: an operator who edits
 * ADMIN_PASSWORD or STATEWAVE_API_KEY incorrectly can lock themselves
 * out of the admin (no login) or the backend (every proxied request
 * 401s). The recovery path — SSH in, fix the env, restart — is painful.
 *
 * Pattern (same as the Windows display-resolution dialog):
 *   1. PATCH applies the change immediately. The change is `pending`
 *      with a wall-clock deadline (default 5 min).
 *   2. The UI shows "Are you sure? Reverting in 5:00…" and the
 *      operator must click Confirm.
 *   3. If Confirm: pending is cleared, the value sticks.
 *   4. If timer expires: revert restores the previous value.
 *
 * Persistence: the in-process env is mutated, AND the previous value is
 * stashed in memory. We DON'T touch the OS env or a config file — those
 * are the deploy-time source of truth. The change is therefore lost on
 * server restart (Windows-revert is for "did the operator type it right",
 * not for durable storage). Operators who want persistence should write
 * the confirmed value into their deployment env after the dialog
 * confirms — the UI prompts them to do so.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'
import { getStore, type SecretsBlob } from './admin-secrets-store.js'

const DEFAULT_REVERT_MS = 5 * 60 * 1000

type Field = 'admin_password' | 'statewave_api_key'

// Narrowed to the string-typed subset of SecretsBlob so TypeScript
// can prove `patch[key] = string | undefined` is safe (the blob now
// also has a boolean field that we don't touch here).
const FIELD_TO_SECRETS_KEY: Record<Field, 'admin_password' | 'statewave_api_key'> = {
  admin_password: 'admin_password',
  statewave_api_key: 'statewave_api_key',
}

const ENV_BY_FIELD: Record<Field, string> = {
  admin_password: 'ADMIN_PASSWORD',
  statewave_api_key: 'STATEWAVE_API_KEY',
}

interface Pending {
  field: Field
  previousValue: string | undefined
  appliedAt: number
  revertAt: number
  timer: ReturnType<typeof setTimeout>
}

// One pending change at most (per field) — concurrent edits to the same
// knob would race and leave us unable to revert cleanly.
const pendingByField = new Map<Field, Pending>()

/** For tests: dispose every pending timer. */
export function _resetForTests() {
  for (const p of pendingByField.values()) clearTimeout(p.timer)
  pendingByField.clear()
}

function sendJson(res: ServerResponse, status: number, body: object) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (!text) return {}
  return JSON.parse(text)
}

function snapshotPending(p: Pending) {
  return {
    field: p.field,
    applied_at: new Date(p.appliedAt).toISOString(),
    revert_in_seconds: Math.max(0, Math.round((p.revertAt - Date.now()) / 1000)),
  }
}

/**
 * Apply a candidate value to the process env and schedule a revert.
 *
 * Empty string is treated as "unset" — for STATEWAVE_API_KEY this turns
 * off the auth header injection; for ADMIN_PASSWORD this disables admin
 * login entirely (the auth gate refuses to start without it). The UI
 * warns about the latter before letting the operator submit.
 */
export function applyPending(
  field: Field,
  value: string,
  revertMs: number = DEFAULT_REVERT_MS,
): ReturnType<typeof snapshotPending> {
  const envKey = ENV_BY_FIELD[field]

  // If there's an existing pending change, snapshot ITS previousValue
  // (not the current env) so multiple edits in a row still revert all
  // the way back to the original. Cancel the existing timer.
  const existing = pendingByField.get(field)
  const previousValue = existing ? existing.previousValue : process.env[envKey]
  if (existing) clearTimeout(existing.timer)

  if (value === '') {
    delete process.env[envKey]
  } else {
    process.env[envKey] = value
  }

  const appliedAt = Date.now()
  const revertAt = appliedAt + revertMs
  const timer = setTimeout(() => {
    // Auto-revert: restore the captured previous value.
    if (previousValue === undefined) {
      delete process.env[envKey]
    } else {
      process.env[envKey] = previousValue
    }
    pendingByField.delete(field)
  }, revertMs)
  // Don't keep the Node event loop alive solely for this timer — if
  // the process is otherwise idle the revert will fire on shutdown
  // anyway, and pinning the loop alive for 5 minutes is a misfeature.
  if (typeof (timer as { unref?: () => unknown }).unref === 'function') {
    ;(timer as { unref?: () => unknown }).unref!()
  }

  const pending: Pending = { field, previousValue, appliedAt, revertAt, timer }
  pendingByField.set(field, pending)
  return snapshotPending(pending)
}

export function confirmPending(field: Field): boolean {
  const p = pendingByField.get(field)
  if (!p) return false
  clearTimeout(p.timer)
  pendingByField.delete(field)
  // Persist the confirmed value, if the encrypted store is configured.
  // We persist the CURRENT process.env value (which is what applyPending
  // set) rather than carrying it through Pending — keeps the in-memory
  // path and the on-disk path reading from the same source of truth.
  try {
    const envKey = ENV_BY_FIELD[field]
    const value = process.env[envKey]
    const store = getStore()
    const patch: SecretsBlob = {}
    patch[FIELD_TO_SECRETS_KEY[field]] = value
    store.write(patch)
  } catch (exc) {
    // Persistence failure is non-fatal — the change is still applied
    // in memory (the operator already confirmed). Surface in logs so
    // an ops review can spot a bad mount / wrong perms.
    console.warn(
      `[admin-settings] persist on confirm failed: ${(exc as Error).message}`,
    )
  }
  return true
}

export function revertPending(field: Field): boolean {
  const p = pendingByField.get(field)
  if (!p) return false
  clearTimeout(p.timer)
  const envKey = ENV_BY_FIELD[field]
  if (p.previousValue === undefined) {
    delete process.env[envKey]
  } else {
    process.env[envKey] = p.previousValue
  }
  pendingByField.delete(field)
  return true
}

export function currentState() {
  // We expose only set/unset booleans — never the raw values, even
  // through this server-side helper, so an accidental log line can't
  // leak the credential.
  const pending = pendingByField.size > 0
    ? snapshotPending(pendingByField.values().next().value as Pending)
    : null
  const store = getStore()
  return {
    admin_password_set: Boolean(process.env.ADMIN_PASSWORD),
    statewave_api_key_set: Boolean(process.env.STATEWAVE_API_KEY),
    pending,
    // Persistence telemetry — surfaced in the UI as a banner. We
    // expose status + file path but NEVER the master key (it's only
    // ever read from env, never returned over HTTP).
    persistence: {
      status: store.status(), // 'disabled' | 'ready' | 'corrupt'
      file_path: store.filePath(),
    },
  }
}

/**
 * Boot-time helper — load persisted secrets into process.env BEFORE
 * the auth gate / proxy read them. Returns true if anything was
 * loaded, false otherwise (no master key, no file, or decryption
 * failure). Failures are intentionally swallowed: the server must
 * boot even with a corrupt secrets file (the UI banner asks the
 * operator to re-enter).
 *
 * Precedence:
 *   * ADMIN_PASSWORD / STATEWAVE_API_KEY / ADMIN_SESSION_SECRET:
 *     env wins — a fresh deploy with explicit env overrides the
 *     persisted file (key rotation via deploy config).
 *   * `admin_auth_disabled`: PERSISTED WINS. When the operator hits
 *     "Enable admin authentication" in the UI, that decision must
 *     outlive a forgotten `ADMIN_AUTH_DISABLED=true` in the deploy
 *     env. Removing the persisted file is the escape hatch.
 */
export function loadPersistedSecretsAtStartup(): {
  loaded: string[]
  status: 'disabled' | 'ready' | 'corrupt'
} {
  const store = getStore()
  const loaded: string[] = []
  try {
    const blob = store.load()
    if (blob.admin_password !== undefined && !process.env.ADMIN_PASSWORD) {
      process.env.ADMIN_PASSWORD = blob.admin_password
      loaded.push('ADMIN_PASSWORD')
    }
    if (blob.statewave_api_key !== undefined && !process.env.STATEWAVE_API_KEY) {
      process.env.STATEWAVE_API_KEY = blob.statewave_api_key
      loaded.push('STATEWAVE_API_KEY')
    }
    if (blob.admin_session_secret !== undefined && !process.env.ADMIN_SESSION_SECRET) {
      process.env.ADMIN_SESSION_SECRET = blob.admin_session_secret
      loaded.push('ADMIN_SESSION_SECRET')
    }
    // Persisted-wins override for the auth-disabled flag — see
    // SecretsBlob docs for why this is asymmetric vs the others.
    if (blob.admin_auth_disabled === false) {
      if (process.env.ADMIN_AUTH_DISABLED === 'true') {
        delete process.env.ADMIN_AUTH_DISABLED
        loaded.push('ADMIN_AUTH_DISABLED→false (persisted override)')
      }
    }
  } catch (exc) {
    console.warn(
      `[admin-settings] could not load persisted secrets: ${(exc as Error).message}`,
    )
  }
  return { loaded, status: store.status() }
}

// ─── Enable Admin Authentication (atomic UI flow) ───────────────────────

/**
 * One-shot helper that turns ADMIN_AUTH_DISABLED=true into a fully
 * configured authenticated admin in a single call:
 *
 *   1. Set ADMIN_PASSWORD (in-memory + persisted) to the supplied value.
 *   2. Generate + set ADMIN_SESSION_SECRET if not already present
 *      (32 random bytes, base64).
 *   3. Persist `admin_auth_disabled: false` and DELETE
 *      `process.env.ADMIN_AUTH_DISABLED` so the next request rejects
 *      anonymous traffic.
 *
 * Failure mode is deliberate: if persistence is disabled (no master
 * key) we still mutate process.env so the change takes effect, but
 * we warn the caller — survival across restart needs the master key.
 *
 * Returns the set of changes that landed for the UI to confirm.
 */
export function enableAdminAuthentication(
  password: string,
): {
  generated_session_secret: boolean
  persisted: boolean
} {
  if (password.length < 8) {
    throw new Error('Admin password must be at least 8 characters.')
  }
  process.env.ADMIN_PASSWORD = password
  let generated_session_secret = false
  if (!process.env.ADMIN_SESSION_SECRET) {
    // node:crypto CSPRNG. 32 random bytes → 256 bits, base64-encoded.
    // The session HMAC reads this verbatim — no parsing constraints.
    process.env.ADMIN_SESSION_SECRET = randomBytes(32).toString('base64')
    generated_session_secret = true
  }
  // The mutation that actually fixes the issue: re-enable auth at runtime.
  delete process.env.ADMIN_AUTH_DISABLED

  const store = getStore()
  const persisted = store.write({
    admin_password: password,
    admin_session_secret: process.env.ADMIN_SESSION_SECRET,
    admin_auth_disabled: false,
  })
  if (!persisted) {
    console.warn(
      '[admin-settings] Admin auth enabled in memory, but not persisted ' +
      '(STATEWAVE_ADMIN_MASTER_KEY is not set). The change reverts on restart.',
    )
  }
  return { generated_session_secret, persisted }
}

// ─── HTTP handler ────────────────────────────────────────────────────────

const FIELDS: readonly Field[] = ['admin_password', 'statewave_api_key']

function isField(v: unknown): v is Field {
  return typeof v === 'string' && (FIELDS as readonly string[]).includes(v)
}

export async function handleAdminSettings(req: IncomingMessage, res: ServerResponse) {
  const method = (req.method ?? 'GET').toUpperCase()
  if (method === 'GET') {
    return sendJson(res, 200, currentState())
  }
  if (method !== 'PATCH') {
    return sendJson(res, 405, { error: 'method_not_allowed' })
  }
  let body: unknown
  try {
    body = await readJson(req)
  } catch {
    return sendJson(res, 400, { error: 'invalid_json' })
  }
  const field = (body as { field?: unknown }).field
  const value = (body as { value?: unknown }).value
  if (!isField(field)) {
    return sendJson(res, 400, { error: 'invalid_field' })
  }
  if (typeof value !== 'string') {
    return sendJson(res, 400, { error: 'value_must_be_string' })
  }
  const snapshot = applyPending(field, value)
  return sendJson(res, 200, snapshot)
}

export async function handleAdminSettingsConfirm(req: IncomingMessage, res: ServerResponse) {
  if ((req.method ?? 'GET').toUpperCase() !== 'POST') {
    return sendJson(res, 405, { error: 'method_not_allowed' })
  }
  let body: unknown
  try {
    body = await readJson(req)
  } catch {
    return sendJson(res, 400, { error: 'invalid_json' })
  }
  const field = (body as { field?: unknown }).field
  if (!isField(field)) return sendJson(res, 400, { error: 'invalid_field' })
  const ok = confirmPending(field)
  return sendJson(res, ok ? 200 : 404, { ok, field })
}

export async function handleEnableAdminAuth(req: IncomingMessage, res: ServerResponse) {
  if ((req.method ?? 'GET').toUpperCase() !== 'POST') {
    return sendJson(res, 405, { error: 'method_not_allowed' })
  }
  let body: unknown
  try {
    body = await readJson(req)
  } catch {
    return sendJson(res, 400, { error: 'invalid_json' })
  }
  const password = (body as { password?: unknown }).password
  if (typeof password !== 'string') {
    return sendJson(res, 400, { error: 'password_must_be_string' })
  }
  try {
    const result = enableAdminAuthentication(password)
    return sendJson(res, 200, {
      ok: true,
      // The operator's current session was issued under "auth disabled"
      // (no signed cookie). They MUST re-authenticate; the UI handles
      // the logout + redirect, but we surface the flag so future
      // automated clients (e.g. a CLI) know to drop their session.
      session_invalidated: true,
      ...result,
    })
  } catch (e) {
    return sendJson(res, 400, { error: (e as Error).message })
  }
}

export async function handleAdminSettingsRevert(req: IncomingMessage, res: ServerResponse) {
  if ((req.method ?? 'GET').toUpperCase() !== 'POST') {
    return sendJson(res, 405, { error: 'method_not_allowed' })
  }
  let body: unknown
  try {
    body = await readJson(req)
  } catch {
    return sendJson(res, 400, { error: 'invalid_json' })
  }
  const field = (body as { field?: unknown }).field
  if (!isField(field)) return sendJson(res, 400, { error: 'invalid_field' })
  const ok = revertPending(field)
  return sendJson(res, ok ? 200 : 404, { ok, field })
}
