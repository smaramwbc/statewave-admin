/**
 * Typed client for the backend's `/admin/settings/*` endpoints
 * (see `server/api/admin.py` + `server/core/settings_catalogue.py`).
 *
 * Kept in its own file rather than appended to the giant `api.ts` so the
 * settings surface is easy to grep for and easy to mock out in vitest.
 */

function adminUrl(path: string): string {
  return `/api/proxy?path=${encodeURIComponent(path)}`
}

export type SettingCategory =
  | 'backend'
  | 'auth'
  | 'llm'
  | 'embeddings'
  | 'webhooks'
  | 'rate_limits'
  | 'memory'
  | 'labeling'
  | 'advanced'

export type SettingKind = 'string' | 'int' | 'float' | 'bool' | 'json' | 'string_or_null'

export type SettingSource = 'env' | 'global_db' | 'tenant_db'

/**
 * One row in the effective-settings snapshot returned by GET /admin/settings.
 *
 * `value` is redacted for secrets — the UI never receives the raw string,
 * only a `•••<last-3>` preview. Editing a secret is therefore a write-only
 * action: the operator types a new value into the field and PATCHes it.
 */
export interface SettingEntry {
  /** What the DB currently resolves to (after redaction for secrets). */
  value: unknown
  /** What the live process is currently using (env_settings.X at boot,
   *  possibly mutated by `apply_db_overrides_to_settings`). Different
   *  from `value` when a DB override has been written since last boot. */
  applied_value: unknown
  /** True iff `value` ≠ `applied_value` and this setting can't hot-reload.
   *  Drives the "Restart required" banner. Clears on its own after a
   *  successful restart since the next snapshot has applied_value=value. */
  pending_restart: boolean
  source: SettingSource
  is_secret: boolean
  category: SettingCategory
  kind: SettingKind
  env_name: string
  description: string
  hot_reloadable: boolean
  tenant_overridable: boolean
  editable: boolean
  /** Fixed set of legal values — rendered as a `<select>` in the UI. */
  allowed_values: string[] | null
  /** Inclusive numeric bounds, if any. */
  min_value: number | null
  max_value: number | null
  /** Optional format hint: 'url' triggers client-side URL shape check. */
  format: 'url' | null
}

export interface SettingsSnapshot {
  settings: Record<string, SettingEntry>
  tenant_id: string | null
}

export interface SettingsAuditEntry {
  id: string
  key: string
  old_value: unknown
  new_value: unknown
  action: 'patch' | 'delete' | 'test'
  tenant_id: string | null
  changed_by: string | null
  changed_at: string | null
  note: string | null
}

export interface SettingsAuditResponse {
  entries: SettingsAuditEntry[]
}

export interface SettingTestResult {
  ok: boolean
  detail: string
  extra: Record<string, unknown> | null
}

/**
 * The shape returned by PATCH /admin/settings/{key} when the new value
 * is rejected by the catalogue. The backend wraps it in HTTP 400; this
 * helper hands the message back to the caller as a thrown Error.
 */
async function readError(res: Response): Promise<string> {
  try {
    const body = await res.json()
    const detail = (body as { detail?: unknown }).detail
    if (typeof detail === 'string') return detail
    if (detail && typeof detail === 'object') {
      const msg = (detail as { message?: string }).message
      if (msg) return msg
    }
    return `HTTP ${res.status}`
  } catch {
    return `HTTP ${res.status}`
  }
}

export async function fetchSettings(tenantId?: string): Promise<SettingsSnapshot> {
  const path = tenantId
    ? `/admin/settings?tenant_id=${encodeURIComponent(tenantId)}`
    : '/admin/settings'
  const res = await fetch(adminUrl(path))
  if (!res.ok) throw new Error(await readError(res))
  return res.json()
}

export async function fetchSetting(key: string, tenantId?: string): Promise<SettingEntry> {
  const path = tenantId
    ? `/admin/settings/${encodeURIComponent(key)}?tenant_id=${encodeURIComponent(tenantId)}`
    : `/admin/settings/${encodeURIComponent(key)}`
  const res = await fetch(adminUrl(path))
  if (!res.ok) throw new Error(await readError(res))
  return res.json()
}

export async function patchSetting(
  key: string,
  value: unknown,
  opts: { changedBy?: string; note?: string } = {},
): Promise<{ key: string; value: unknown; source: SettingSource }> {
  const res = await fetch(adminUrl(`/admin/settings/${encodeURIComponent(key)}`), {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ value, changed_by: opts.changedBy, note: opts.note }),
  })
  if (!res.ok) throw new Error(await readError(res))
  return res.json()
}

export async function deleteSetting(
  key: string,
  opts: { changedBy?: string; note?: string } = {},
): Promise<void> {
  const params = new URLSearchParams()
  if (opts.changedBy) params.set('changed_by', opts.changedBy)
  if (opts.note) params.set('note', opts.note)
  const qs = params.toString()
  const path = `/admin/settings/${encodeURIComponent(key)}${qs ? `?${qs}` : ''}`
  const res = await fetch(adminUrl(path), { method: 'DELETE' })
  if (!res.ok) throw new Error(await readError(res))
}

export async function patchTenantSetting(
  tenantId: string,
  key: string,
  value: unknown,
  opts: { changedBy?: string; note?: string } = {},
): Promise<{ tenant_id: string; key: string; value: unknown; source: SettingSource }> {
  const res = await fetch(
    adminUrl(
      `/admin/settings/tenants/${encodeURIComponent(tenantId)}/${encodeURIComponent(key)}`,
    ),
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value, changed_by: opts.changedBy, note: opts.note }),
    },
  )
  if (!res.ok) throw new Error(await readError(res))
  return res.json()
}

export async function deleteTenantSetting(
  tenantId: string,
  key: string,
  opts: { changedBy?: string; note?: string } = {},
): Promise<void> {
  const params = new URLSearchParams()
  if (opts.changedBy) params.set('changed_by', opts.changedBy)
  if (opts.note) params.set('note', opts.note)
  const qs = params.toString()
  const path = `/admin/settings/tenants/${encodeURIComponent(tenantId)}/${encodeURIComponent(key)}${
    qs ? `?${qs}` : ''
  }`
  const res = await fetch(adminUrl(path), { method: 'DELETE' })
  if (!res.ok) throw new Error(await readError(res))
}

export async function testSetting(key: string, value: unknown): Promise<SettingTestResult> {
  const res = await fetch(adminUrl('/admin/settings/test'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key, value }),
  })
  if (!res.ok) throw new Error(await readError(res))
  return res.json()
}

export async function fetchSettingsAudit(
  opts: { key?: string; limit?: number } = {},
): Promise<SettingsAuditResponse> {
  const params = new URLSearchParams()
  if (opts.key) params.set('key', opts.key)
  if (opts.limit) params.set('limit', String(opts.limit))
  const qs = params.toString()
  const path = `/admin/settings/audit/log${qs ? `?${qs}` : ''}`
  const res = await fetch(adminUrl(path))
  if (!res.ok) throw new Error(await readError(res))
  return res.json()
}

// ─── Admin-side settings (statewave-admin's own knobs) ───────────────────
//
// These do NOT proxy to the statewave backend; they hit the admin server's
// `/api/admin-settings/*` routes, which control ADMIN_PASSWORD and the
// STATEWAVE_API_KEY that the admin proxy injects when calling the backend.
// Both writes follow a Windows-resolution-style revert pattern: the change
// applies immediately with `pending=true`, and if the operator doesn't
// confirm within `revert_in_seconds`, the change rolls back automatically.

export interface AdminSettings {
  /** Whether ADMIN_PASSWORD is currently set on the admin server. */
  admin_password_set: boolean
  /** Whether STATEWAVE_API_KEY is currently set on the admin server. */
  statewave_api_key_set: boolean
  /** Pending change waiting for operator confirmation, if any. */
  pending: AdminSettingsPending | null
  /** Encrypted-storage status. */
  persistence: AdminSettingsPersistence
}

export interface AdminSettingsPersistence {
  /**
   * - `disabled`: STATEWAVE_ADMIN_MASTER_KEY isn't set. Confirms are
   *   in-memory only — values will revert on next restart.
   * - `ready`: master key configured, file readable / writable. Confirms
   *   persist to disk and survive restart.
   * - `corrupt`: file exists but couldn't be decrypted (e.g. master key
   *   changed since the file was written). UI prompts the operator to
   *   re-enter; next confirm overwrites the unreadable file.
   */
  status: 'disabled' | 'ready' | 'corrupt'
  /** Where the encrypted file lives. Shown in the banner so an operator
   *  can chmod / back it up manually if needed. Never contains the key. */
  file_path: string
}

export interface AdminSettingsPending {
  field: 'admin_password' | 'statewave_api_key'
  applied_at: string
  revert_in_seconds: number
}

export async function fetchAdminSettings(): Promise<AdminSettings> {
  const res = await fetch('/api/admin-settings')
  if (!res.ok) throw new Error(await readError(res))
  return res.json()
}

export async function patchAdminSetting(
  field: AdminSettingsPending['field'],
  value: string,
): Promise<AdminSettingsPending> {
  const res = await fetch('/api/admin-settings', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ field, value }),
  })
  if (!res.ok) throw new Error(await readError(res))
  return res.json()
}

export async function confirmAdminSetting(field: AdminSettingsPending['field']): Promise<void> {
  const res = await fetch('/api/admin-settings/confirm', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ field }),
  })
  if (!res.ok) throw new Error(await readError(res))
}

export async function revertAdminSetting(field: AdminSettingsPending['field']): Promise<void> {
  const res = await fetch('/api/admin-settings/revert', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ field }),
  })
  if (!res.ok) throw new Error(await readError(res))
}

/**
 * One-shot atomic enable of admin authentication. Backend sets the
 * password, generates a session secret if missing, mutates
 * `process.env.ADMIN_AUTH_DISABLED` to off, and writes everything to
 * the encrypted secrets store. The caller's existing session is
 * invalidated (it was issued under "auth disabled") — the UI should
 * log out and redirect to /login right after this resolves.
 */
export async function enableAdminAuth(password: string): Promise<{
  generated_session_secret: boolean
  persisted: boolean
  session_invalidated: boolean
}> {
  const res = await fetch('/api/admin-settings/enable-admin-auth', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  })
  if (!res.ok) throw new Error(await readError(res))
  return res.json()
}

// ─── Connection info ─────────────────────────────────────────────────────

/**
 * Backend's self-description — what the live process knows about its
 * own bind config + features. Returned by the backend's
 * `GET /admin/connection-info`.
 */
export interface BackendConnectionInfo {
  version: string
  schema_head: string
  host: string
  port: number
  region: string | null
  auth_enabled: boolean
  compiler_type: string
  embedding_provider: string
  require_tenant: boolean
}

/**
 * Admin-proxy info — what URL the admin server is calling. Returned by
 * the admin's `GET /api/admin/proxy-info`. Distinct from
 * `BackendConnectionInfo` because the backend can't know the URL its
 * own callers use — only the proxy / load balancer knows that.
 */
export interface ProxyInfo {
  api_url: string | null
  api_key_set: boolean
}

export async function fetchBackendConnectionInfo(): Promise<BackendConnectionInfo> {
  const res = await fetch(adminUrl('/admin/connection-info'))
  if (!res.ok) throw new Error(await readError(res))
  return res.json()
}

export async function fetchProxyInfo(): Promise<ProxyInfo> {
  const res = await fetch('/api/admin/proxy-info')
  if (!res.ok) throw new Error(await readError(res))
  return res.json()
}

// ─── Production readiness ────────────────────────────────────────────────

export type IssueSeverity = 'critical' | 'high' | 'medium' | 'low'

export type WizardId = 'enable-auth' | 'enable-admin-auth'

export interface ReadinessIssue {
  id: string
  severity: IssueSeverity
  title: string
  summary: string
  fix?:
    | { kind: 'setting'; key: string }
    | { kind: 'wizard'; id: WizardId }
    | { kind: 'admin_tab'; field?: string }
    | { kind: 'env'; env_var?: string }
  /**
   * True when this issue is firing against the live process but a
   * DB override is queued that would clear it after a restart. The
   * UI badges these as "Pending restart" so an operator who just
   * clicked Save doesn't think their fix was ignored.
   */
  fix_staged?: boolean
}

export interface ReadinessResponse {
  issues: ReadinessIssue[]
}

/** Backend's view (config-level checks on `settings.*`). */
export async function fetchBackendReadiness(): Promise<ReadinessResponse> {
  const res = await fetch(adminUrl('/admin/readiness-check'))
  if (!res.ok) throw new Error(await readError(res))
  return res.json()
}

/** Admin-server's view (admin auth, master key, proxy key). */
export async function fetchAdminReadiness(): Promise<ReadinessResponse> {
  const res = await fetch('/api/admin/readiness-check')
  if (!res.ok) throw new Error(await readError(res))
  return res.json()
}

// ─── Backend restart ─────────────────────────────────────────────────────

/**
 * Trigger the backend's `POST /admin/restart` endpoint. The backend
 * returns 202, then exits after a short delay; the orchestrator's
 * restart policy (Docker `restart: unless-stopped`, k8s Pod default,
 * systemd `Restart=on-success`) brings it back.
 */
export async function restartBackend(): Promise<{ exit_in_seconds: number }> {
  const res = await fetch(adminUrl('/admin/restart'), { method: 'POST' })
  if (!res.ok) throw new Error(await readError(res))
  return res.json()
}

/**
 * Poll `/admin/settings` until the backend is reachable again. Used
 * after `restartBackend()` to drive the UI state forward without
 * forcing the operator to refresh. Resolves on the first successful
 * response or rejects after `timeoutMs` (default 60s — generous to
 * cover slow cold starts on under-provisioned hosts).
 */
export async function waitForBackend(timeoutMs = 60_000, intervalMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  // First, wait until the backend is DOWN — otherwise we'd false-positive
  // off the still-alive pre-exit window. We accept either 502/503 (proxy
  // sees no upstream) or a network error.
  while (Date.now() < deadline) {
    try {
      const res = await fetch(adminUrl('/admin/settings'), { method: 'GET' })
      if (res.status >= 500) break
    } catch {
      break
    }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  // Now wait until it's back UP.
  while (Date.now() < deadline) {
    try {
      const res = await fetch(adminUrl('/admin/settings'), { method: 'GET' })
      if (res.ok) return
    } catch {
      // network error → still down → keep polling
    }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  throw new Error('Backend did not come back online within the timeout.')
}
