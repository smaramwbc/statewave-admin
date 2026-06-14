/**
 * Settings page — exposes every backend-catalogued setting plus the
 * admin-server's own two privileged knobs (ADMIN_PASSWORD,
 * STATEWAVE_API_KEY) over the UI.
 *
 * Layout:
 *   - Tabbed by category (LLM / Auth / Webhooks / …)
 *   - Each row shows: current value (redacted for secrets), source
 *     (env | global_db | tenant_db), Edit + Test + Revert.
 *   - "Admin server" tab handles ADMIN_PASSWORD + STATEWAVE_API_KEY
 *     with the Windows-revert pattern.
 *
 * We deliberately render every setting on first load (no lazy fetch
 * per category) so an operator scanning for "where the heck is X" can
 * Cmd-F across the page.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useWizards } from '../lib/wizards'
import {
  Button,
  Badge,
  PageHeader,
  ErrorState,
  LoadingState,
  Tabs,
  TabPanel,
  Modal,
} from '../components/ui'
import {
  fetchSettings,
  patchSetting,
  deleteSetting,
  testSetting,
  applySettings,
  fetchAdminSettings,
  patchAdminSetting,
  confirmAdminSetting,
  revertAdminSetting,
  restartBackend,
  waitForBackend,
  type SettingEntry,
  type SettingsSnapshot,
  type AdminSettings,
} from '../lib/settings'
import { AlertTriangle, ArrowLeft, RotateCcw, FlaskConical, HelpCircle, ShieldCheck, ShieldOff, RefreshCw } from 'lucide-react'

// Backend setting categories. Order = tab order.
const CATEGORY_LABELS: Record<string, string> = {
  auth: 'Auth',
  llm: 'LLM',
  embeddings: 'Embeddings',
  webhooks: 'Webhooks',
  rate_limits: 'Rate limits',
  memory: 'Memory',
  labeling: 'Labeling',
  backend: 'Backend',
  advanced: 'Advanced',
}

// Hand-curated humanized titles. Anything not in this map falls back to
// `humanizeKey()`, which Title-cases the snake_case and upper-cases known
// acronyms — that handles the long tail without 34 redundant entries.
const SETTING_TITLES: Record<string, string> = {
  api_key: 'Backend API key',
  litellm_api_key: 'LLM provider API key',
  litellm_model: 'LLM chat model',
  litellm_embedding_model: 'Embedding model',
  litellm_api_base: 'LLM API base URL',
  litellm_timeout_seconds: 'LLM request timeout',
  litellm_max_retries: 'LLM retry budget',
  litellm_temperature: 'LLM temperature',
  litellm_compile_max_tokens: 'LLM compile max-tokens',
  compiler_type: 'Memory compiler',
  embedding_provider: 'Embedding provider',
  webhook_url: 'Webhook destination URL',
  webhook_timeout: 'Webhook timeout',
  webhook_events: 'Webhook event allowlist',
  rate_limit_rpm: 'Requests per minute',
  rate_limit_strategy: 'Rate-limit strategy',
  compile_batch_size: 'Compile batch size',
  compile_max_iterations: 'Compile iteration cap',
  compile_job_retention_hours: 'Compile job retention',
  kind_ttl_days: 'Per-kind memory TTL',
  memory_import_max_bytes: 'Import size cap',
  memory_import_max_episodes: 'Import episode cap',
  memory_import_max_memories: 'Import memory cap',
  memory_import_max_subjects: 'Import subject cap',
  auto_labeling_enabled: 'Auto-labeling',
  auto_labeling_provider: 'Auto-labeling provider',
  require_tenant: 'Require tenant header',
  tenant_header: 'Tenant header name',
  cors_origins: 'CORS origins',
  database_url: 'Database URL',
  host: 'Bind host',
  port: 'Bind port',
  region: 'Server region',
  strict_schema: 'Strict schema check',
}

const ACRONYMS = new Set([
  'api',
  'url',
  'cors',
  'rpm',
  'ttl',
  'llm',
  'json',
  'http',
  'https',
  'id',
  'uri',
  'oauth',
  'sso',
])

function humanizeKey(key: string): string {
  return key
    .split('_')
    .map((part) =>
      ACRONYMS.has(part.toLowerCase())
        ? part.toUpperCase()
        : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase(),
    )
    .join(' ')
}

function titleFor(key: string): string {
  return SETTING_TITLES[key] ?? humanizeKey(key)
}

function groupByCategory(settings: Record<string, SettingEntry>) {
  const groups: Record<string, [string, SettingEntry][]> = {}
  for (const [key, entry] of Object.entries(settings)) {
    if (!groups[entry.category]) groups[entry.category] = []
    groups[entry.category].push([key, entry])
  }
  for (const arr of Object.values(groups)) arr.sort((a, b) => a[0].localeCompare(b[0]))
  return groups
}

function sourceBadge(source: SettingEntry['source']) {
  if (source === 'tenant_db') return <Badge variant="success">tenant</Badge>
  if (source === 'global_db') return <Badge variant="warning">override</Badge>
  return <Badge variant="muted">env</Badge>
}

function renderValue(entry: SettingEntry): string {
  if (entry.value === null || entry.value === undefined) return '— (not set)'
  if (entry.value === '') return '"" (empty)'
  if (typeof entry.value === 'object') return JSON.stringify(entry.value)
  return String(entry.value)
}

// ─── Per-row editor modal ────────────────────────────────────────────────

interface EditorProps {
  settingKey: string
  entry: SettingEntry
  onClose: () => void
  onSaved: () => void
}

/** Result of validating the raw input string against the setting spec. */
type Validation =
  | { ok: true; value: unknown; warning?: string }
  | { ok: false; error: string; suggestion?: string }

/**
 * Edit-distance for the closest hit in `options` so a typo like
 * 'lllm' suggests 'llm'. Matches the server-side Levenshtein-≤2
 * cutoff in `dynamic_settings._suggest()` — we want the UI to catch
 * the typo before the server does, with the same threshold.
 */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a) return b.length
  if (!b) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur.push(Math.min(
        cur[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      ))
    }
    prev = cur
  }
  return prev[b.length]
}

function suggestFrom(value: string, options: readonly string[]): string | undefined {
  let best: { d: number; opt: string } | null = null
  for (const opt of options) {
    const d = levenshtein(value.toLowerCase(), opt.toLowerCase())
    if (!best || d < best.d) best = { d, opt }
  }
  return best && best.d <= 2 ? best.opt : undefined
}

function validate(raw: string, entry: SettingEntry): Validation {
  // String + string_or_null
  if (entry.kind === 'string' || entry.kind === 'string_or_null') {
    if (raw === '') {
      if (entry.kind === 'string_or_null') return { ok: true, value: null }
      if (entry.allowed_values && !entry.allowed_values.includes('')) {
        return { ok: false, error: 'Required — pick a value.' }
      }
      return { ok: true, value: '' }
    }
    if (entry.allowed_values && !entry.allowed_values.includes(raw)) {
      const suggestion = suggestFrom(raw, entry.allowed_values)
      return {
        ok: false,
        error: `Not allowed. Must be one of: ${entry.allowed_values.join(', ')}.`,
        suggestion,
      }
    }
    if (entry.format === 'url' && raw !== '') {
      if (!/^https?:\/\//i.test(raw)) {
        return { ok: false, error: 'URL must start with http:// or https://' }
      }
      try {
        new URL(raw)
      } catch {
        return { ok: false, error: 'Not a valid URL.' }
      }
    }
    return { ok: true, value: raw }
  }

  // Bool — only ever 'true' / 'false' from the <select> below.
  if (entry.kind === 'bool') return { ok: true, value: raw === 'true' }

  // Numbers
  if (entry.kind === 'int' || entry.kind === 'float') {
    if (raw.trim() === '') return { ok: false, error: 'Required.' }
    const n = entry.kind === 'int' ? Number.parseInt(raw, 10) : Number.parseFloat(raw)
    if (Number.isNaN(n)) {
      return { ok: false, error: entry.kind === 'int' ? 'Must be an integer.' : 'Must be a number.' }
    }
    if (entry.kind === 'int' && !Number.isInteger(Number.parseFloat(raw))) {
      return { ok: false, error: 'Must be an integer (no decimal).' }
    }
    if (entry.min_value !== null && n < entry.min_value) {
      return { ok: false, error: `Must be ≥ ${entry.min_value}.` }
    }
    if (entry.max_value !== null && n > entry.max_value) {
      return { ok: false, error: `Must be ≤ ${entry.max_value}.` }
    }
    return { ok: true, value: n }
  }

  // JSON
  if (entry.kind === 'json') {
    if (raw.trim() === '') return { ok: false, error: 'Required.' }
    try {
      return { ok: true, value: JSON.parse(raw) }
    } catch (e) {
      return { ok: false, error: `Invalid JSON: ${(e as Error).message}` }
    }
  }

  return { ok: true, value: raw }
}

function SettingEditor({ settingKey, entry, onClose, onSaved }: EditorProps) {
  const [raw, setRaw] = useState<string>(() => {
    if (entry.is_secret) return ''
    if (entry.value === null || entry.value === undefined) return ''
    if (typeof entry.value === 'object') return JSON.stringify(entry.value, null, 2)
    return String(entry.value)
  })
  const [busy, setBusy] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; detail: string } | null>(null)
  // For secrets, we trust the operator — they can't see the current
  // value, so we can't compare. For other fields, treat the input as
  // pristine (no error shown) until they type or attempt to save.
  const [touched, setTouched] = useState(false)

  const validation = useMemo(() => validate(raw, entry), [raw, entry])
  const showError = touched && !validation.ok

  const onTest = async () => {
    if (!validation.ok) {
      setTouched(true)
      return
    }
    setBusy(true)
    setTestResult(null)
    try {
      const result = await testSetting(settingKey, validation.value)
      setTestResult({ ok: result.ok, detail: result.detail })
    } catch (e) {
      setTestResult({ ok: false, detail: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const onSave = async () => {
    if (!validation.ok) {
      setTouched(true)
      return
    }
    setBusy(true)
    try {
      await patchSetting(settingKey, validation.value)
      // Fire-and-forget: apply hot-reloadable overrides immediately so the
      // pending-restart banner clears without an orchestrator restart.
      // Swallow errors — older backends without this endpoint still work.
      applySettings().catch(() => undefined)
      toast.success(`Saved ${titleFor(settingKey)}`)
      onSaved()
      onClose()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const inputClass = `w-full px-3 py-2 border rounded-md bg-[var(--theme-card-bg)] text-theme-primary ${
    showError ? 'border-red-500' : 'border-theme-border'
  }`

  const setAndTouch = (value: string) => {
    setRaw(value)
    setTouched(true)
  }

  // Render priority:
  //   1. allowed_values → <select> (impossible to typo)
  //   2. kind=bool → <select> true/false
  //   3. kind=json → <textarea>
  //   4. kind=int/float → <input type="number">
  //   5. fallback → <input type="text"|"password">
  // Strip the browser-native arrow + leave room on the right for our
  // own chevron, matching the pattern in `components/ui/FilterSelect`
  // so every <select> in the admin looks identical.
  const selectClass = `${inputClass} appearance-none pr-9`
  const chevron = (
    <span
      aria-hidden="true"
      className="absolute right-3 top-1/2 -translate-y-1/2 text-theme-muted text-xs pointer-events-none"
    >
      ▾
    </span>
  )

  const input = entry.allowed_values ? (
    <div className="relative">
      <select className={selectClass} value={raw} onChange={(e) => setAndTouch(e.target.value)}>
        {entry.allowed_values.map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
      {chevron}
    </div>
  ) : entry.kind === 'bool' ? (
    <div className="relative">
      <select className={selectClass} value={raw} onChange={(e) => setAndTouch(e.target.value)}>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
      {chevron}
    </div>
  ) : entry.kind === 'json' ? (
    <textarea
      className={`${inputClass} font-mono text-xs`}
      rows={6}
      value={raw}
      onChange={(e) => setAndTouch(e.target.value)}
      spellCheck={false}
    />
  ) : entry.kind === 'int' || entry.kind === 'float' ? (
    <input
      type="number"
      step={entry.kind === 'int' ? 1 : 'any'}
      min={entry.min_value ?? undefined}
      max={entry.max_value ?? undefined}
      className={inputClass}
      value={raw}
      onChange={(e) => setAndTouch(e.target.value)}
      autoComplete="off"
    />
  ) : (
    <input
      type={entry.is_secret ? 'password' : entry.format === 'url' ? 'url' : 'text'}
      className={inputClass}
      value={raw}
      onChange={(e) => setAndTouch(e.target.value)}
      placeholder={
        entry.is_secret
          ? 'Enter new value (write-only)'
          : entry.format === 'url'
            ? 'https://…'
            : ''
      }
      autoComplete="off"
      spellCheck={false}
    />
  )

  return (
    <Modal open onClose={onClose} title={`Edit ${titleFor(settingKey)}`}>
      <div className="space-y-4">
        <p className="text-sm text-theme-secondary">{entry.description}</p>
        <dl className="text-xs text-theme-muted space-y-1">
          <div className="flex gap-2"><dt>key:</dt><dd className="font-mono">{settingKey}</dd></div>
          <div className="flex gap-2"><dt>env var:</dt><dd className="font-mono">{entry.env_name}</dd></div>
          <div className="flex gap-2"><dt>kind:</dt><dd>{entry.kind}</dd></div>
          <div className="flex gap-2"><dt>current source:</dt><dd>{entry.source}</dd></div>
          {!entry.hot_reloadable && (
            <div className="flex items-center gap-1.5 text-amber-600 mt-1">
              <AlertTriangle className="w-3 h-3" />
              <span>Requires server restart to take effect.</span>
            </div>
          )}
        </dl>
        <div>
          <label className="block text-sm font-medium text-theme-primary mb-1">
            New value
          </label>
          {input}
          {/* Allowed-values affordance — shown for free-text fields with
              suggested options but no strict allowlist (none today, but
              future-proof). For strict allowlists we render <select> so
              this hint is redundant. */}
          {!entry.allowed_values && entry.format === 'url' && (
            <p className="text-xs text-theme-muted mt-1">Must start with http:// or https://</p>
          )}
          {(entry.kind === 'int' || entry.kind === 'float') &&
            (entry.min_value !== null || entry.max_value !== null) && (
              <p className="text-xs text-theme-muted mt-1">
                Range:{' '}
                {entry.min_value !== null ? entry.min_value : '−∞'} … {entry.max_value !== null ? entry.max_value : '∞'}
              </p>
            )}
          {showError && (
            <div className="mt-1.5 text-xs text-red-600 dark:text-red-400 flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <div>
                <p>{!validation.ok ? validation.error : ''}</p>
                {!validation.ok && validation.suggestion && (
                  <button
                    type="button"
                    onClick={() => setAndTouch(validation.suggestion!)}
                    className="mt-1 underline hover:text-red-700 dark:hover:text-red-300"
                  >
                    Did you mean &quot;{validation.suggestion}&quot;? Use it
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
        {testResult && (
          <div className={`text-sm p-2 rounded-md ${testResult.ok ? 'bg-green-50 text-green-900 dark:bg-green-950 dark:text-green-200' : 'bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-200'}`}>
            {testResult.detail}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="secondary" onClick={onTest} disabled={busy || !validation.ok}>
            <FlaskConical className="w-4 h-4 mr-1.5" /> Test
          </Button>
          <Button onClick={onSave} disabled={busy || !validation.ok}>Save</Button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Backend settings table (one tab per category) ──────────────────────

interface CategoryTabProps {
  entries: [string, SettingEntry][]
  onEdit: (key: string) => void
  onRevert: (key: string) => void
}

function HelpTooltip({ entry, settingKey }: { entry: SettingEntry; settingKey: string }) {
  // CSS-only tooltip — no extra state, no portal, no popper lib. We sit
  // the popover above-and-to-the-left so it doesn't get clipped off the
  // right edge of the table on narrow viewports; `group-hover`/`group-
  // focus-within` make it equally keyboard-accessible.
  return (
    <span className="relative inline-flex group align-middle">
      <button
        type="button"
        aria-label={`Help for ${settingKey}`}
        className="inline-flex items-center justify-center w-5 h-5 rounded text-theme-muted hover:text-theme-primary focus:text-theme-primary focus:outline-none focus:ring-1 focus:ring-accent"
      >
        <HelpCircle className="w-3.5 h-3.5" />
      </button>
      <span
        role="tooltip"
        // Anchored at `left-0` so the popover extends into the open
        // column space to the right of the help icon (the icon sits at
        // the left edge of the title cell, so right-extending stays in-
        // view). `z-50` keeps it above sibling row content; the parent
        // doesn't create a clipping context now that the table's
        // overflow wrapper is gone.
        className="
          pointer-events-none absolute z-50 left-0 top-full mt-1
          w-80 max-w-[20rem] p-3 rounded-md
          bg-[var(--theme-card-bg)] border border-theme-border shadow-lg
          text-xs text-theme-primary
          opacity-0 invisible
          group-hover:opacity-100 group-hover:visible
          group-focus-within:opacity-100 group-focus-within:visible
          transition-opacity
        "
      >
        <p className="font-medium text-sm mb-1">{titleFor(settingKey)}</p>
        <p className="text-theme-secondary leading-relaxed">{entry.description}</p>
        <dl className="mt-2 pt-2 border-t border-theme-border/60 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11px] text-theme-muted">
          <dt>Env var</dt>
          <dd className="font-mono text-theme-secondary">{entry.env_name}</dd>
          <dt>Kind</dt>
          <dd>{entry.kind}</dd>
          <dt>Hot-reload</dt>
          <dd>{entry.hot_reloadable ? 'yes' : 'no — restart needed'}</dd>
          <dt>Per-tenant</dt>
          <dd>{entry.tenant_overridable ? 'yes' : 'no'}</dd>
          <dt>Source</dt>
          <dd>{entry.source}</dd>
        </dl>
      </span>
    </span>
  )
}

function CategoryTab({ entries, onEdit, onRevert }: CategoryTabProps) {
  // No overflow wrapper: it created a second (vertical) scrollbar AND
  // clipped the per-row tooltip popover. The page-level <main> already
  // handles scroll; the table can render naturally. `table-fixed` keeps
  // column widths predictable so a long description doesn't push the
  // value column off-screen.
  return (
    <div>
      <table className="w-full text-sm table-fixed">
        <colgroup>
          <col />
          <col className="w-48" />
          <col className="w-24" />
          <col className="w-32" />
        </colgroup>
        <thead className="text-xs text-theme-muted uppercase">
          <tr className="border-b border-theme-border">
            <th className="text-left py-2 pr-4">Setting</th>
            <th className="text-left py-2 pr-4">Value</th>
            <th className="text-left py-2 pr-4">Source</th>
            <th className="text-right py-2"></th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([key, entry]) => (
            <tr key={key} className="border-b border-theme-border/50 last:border-0">
              <td className="py-3 pr-4 align-top">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium text-theme-primary">{titleFor(key)}</span>
                  <HelpTooltip entry={entry} settingKey={key} />
                </div>
                <div className="font-mono text-[11px] text-theme-muted mt-0.5">{key}</div>
                <div className="text-xs text-theme-secondary mt-1 max-w-md leading-relaxed">
                  {entry.description}
                </div>
              </td>
              <td className="py-3 pr-4 align-top font-mono text-xs text-theme-primary break-all max-w-[16rem]">
                {renderValue(entry)}
              </td>
              <td className="py-3 pr-4 align-top">{sourceBadge(entry.source)}</td>
              <td className="py-3 align-top text-right">
                <div className="inline-flex gap-1">
                  {entry.editable ? (
                    <Button size="sm" variant="ghost" onClick={() => onEdit(key)}>Edit</Button>
                  ) : (
                    <span className="text-xs text-theme-muted">read-only</span>
                  )}
                  {entry.source === 'global_db' && (
                    <Button size="sm" variant="ghost" onClick={() => onRevert(key)} title="Revert to env">
                      <RotateCcw className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Admin-server tab (ADMIN_PASSWORD + STATEWAVE_API_KEY) ───────────────

interface AdminTabProps {
  state: AdminSettings | null
  reload: () => void
}

function AdminServerTab({ state, reload }: AdminTabProps) {
  const [editing, setEditing] = useState<'admin_password' | 'statewave_api_key' | null>(null)
  const [newValue, setNewValue] = useState('')
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null)

  // Tick down the revert countdown while a pending change is live.
  useEffect(() => {
    if (!state?.pending) {
      setSecondsLeft(null)
      return
    }
    setSecondsLeft(state.pending.revert_in_seconds)
    const interval = setInterval(() => {
      setSecondsLeft((s) => (s !== null && s > 0 ? s - 1 : 0))
    }, 1000)
    return () => clearInterval(interval)
  }, [state?.pending])

  // When the countdown reaches zero, the server-side timer has fired
  // (or is about to) — reload state so the UI reflects the rollback.
  useEffect(() => {
    if (secondsLeft === 0) {
      const id = setTimeout(reload, 1000)
      return () => clearTimeout(id)
    }
  }, [secondsLeft, reload])

  if (!state) return null

  const onApply = async (field: 'admin_password' | 'statewave_api_key') => {
    try {
      await patchAdminSetting(field, newValue)
      toast.warning('Change applied. Confirm within the timer or it will revert.')
      setEditing(null)
      setNewValue('')
      reload()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const onConfirm = async () => {
    if (!state.pending) return
    try {
      await confirmAdminSetting(state.pending.field)
      toast.success('Change confirmed.')
      reload()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const onRevert = async () => {
    if (!state.pending) return
    try {
      await revertAdminSetting(state.pending.field)
      toast.success('Change reverted.')
      reload()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const persistence = state.persistence
  return (
    <div className="space-y-6">
      <div className="p-3 rounded-md bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 text-sm flex gap-2">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
        <div>
          These two values control admin login (ADMIN_PASSWORD) and how the
          admin proxy talks to the statewave backend (STATEWAVE_API_KEY). A
          wrong value locks you out. Edits apply immediately with a 5-minute
          confirm timer — if you don't confirm, the previous value comes back.
        </div>
      </div>

      {persistence.status === 'ready' && (
        <div className="p-3 rounded-md bg-green-50 dark:bg-green-950/30 text-green-900 dark:text-green-200 text-sm flex gap-2">
          <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <p>
              <strong>Encrypted persistence is ON.</strong> Confirmed values
              are written to <span className="font-mono text-xs">{persistence.file_path}</span> (AES-256-GCM, key from
              <span className="font-mono text-xs"> STATEWAVE_ADMIN_MASTER_KEY</span>) and survive restart.
            </p>
          </div>
        </div>
      )}
      {persistence.status === 'disabled' && (
        <div className="p-3 rounded-md bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 text-sm flex gap-2">
          <ShieldOff className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <p>
              <strong>Persistence is OFF.</strong> Set
              <span className="font-mono text-xs"> STATEWAVE_ADMIN_MASTER_KEY</span> (any passphrase ≥ 8 chars) in your
              admin-server deployment env and restart to enable encrypted
              storage at <span className="font-mono text-xs">{persistence.file_path}</span>. Until then, confirms
              are in-memory only and will revert on next restart.
            </p>
          </div>
        </div>
      )}
      {persistence.status === 'corrupt' && (
        <div className="p-3 rounded-md bg-red-50 dark:bg-red-950/30 text-red-900 dark:text-red-200 text-sm flex gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <p>
              <strong>Persisted secrets file is unreadable.</strong> The
              master key likely changed since it was written. Re-enter
              your values below — the next confirm overwrites the broken
              file at <span className="font-mono text-xs">{persistence.file_path}</span>.
            </p>
          </div>
        </div>
      )}

      {state.pending && (
        <div className="border border-amber-300 dark:border-amber-700 rounded-md p-4 bg-amber-50/50 dark:bg-amber-950/20 flex items-center justify-between">
          <div>
            <p className="text-sm text-theme-primary">
              <strong>{state.pending.field}</strong> changed —
              reverting in {secondsLeft !== null ? `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}` : '…'}
            </p>
            <p className="text-xs text-theme-muted mt-0.5">
              applied at {state.pending.applied_at}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onRevert}>Revert now</Button>
            <Button onClick={onConfirm}>Confirm</Button>
          </div>
        </div>
      )}

      <div className="grid gap-4">
        {(['admin_password', 'statewave_api_key'] as const).map((field) => {
          const isSet =
            field === 'admin_password' ? state.admin_password_set : state.statewave_api_key_set
          return (
            <div key={field} className="border border-theme-border rounded-md p-4">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h3 className="text-sm font-medium text-theme-primary">
                    {field === 'admin_password' ? 'Admin password' : 'Statewave API key'}
                  </h3>
                  <p className="text-xs text-theme-muted mt-0.5">
                    env: {field === 'admin_password' ? 'ADMIN_PASSWORD' : 'STATEWAVE_API_KEY'}
                  </p>
                </div>
                <div>{isSet ? <Badge variant="success">set</Badge> : <Badge variant="muted">unset</Badge>}</div>
              </div>
              {editing === field ? (
                <div className="space-y-2">
                  <input
                    type="password"
                    className="w-full px-3 py-2 border border-theme-border rounded-md bg-[var(--theme-card-bg)] text-theme-primary"
                    value={newValue}
                    onChange={(e) => setNewValue(e.target.value)}
                    placeholder="New value (write-only)"
                    autoComplete="off"
                  />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => onApply(field)}>Apply with 5-min revert</Button>
                    <Button size="sm" variant="ghost" onClick={() => { setEditing(null); setNewValue('') }}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <Button size="sm" variant="secondary" onClick={() => setEditing(field)}>Change</Button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Restart banner ──────────────────────────────────────────────────────


/**
 * Shown at the top of the Settings page whenever there's at least one
 * non-hot-reloadable override in the DB that hasn't been picked up by
 * the live process yet.
 *
 * The button kicks the backend via `POST /admin/restart` — the backend
 * returns 202, schedules `os._exit(0)`, and the container orchestrator
 * (Docker `restart: unless-stopped`, k8s Pod restart, systemd) brings
 * it back. We poll `/admin/settings` until it answers, then refresh
 * the page state so the banner clears on its own. No manual `docker
 * compose restart api` needed.
 */
interface RestartBannerProps {
  pendingKeys: string[]
  onRestarted: () => void
}

function RestartBanner({ pendingKeys, onRestarted }: RestartBannerProps) {
  type Phase = 'idle' | 'confirm' | 'restarting' | 'failed'
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)

  const doRestart = async () => {
    setPhase('restarting')
    setError(null)
    try {
      const r = await restartBackend()
      // Give the backend a moment to actually exit before we start
      // polling (otherwise the first poll sees the still-alive pre-
      // exit process). The endpoint returns its own delay; use it.
      await new Promise((res) => setTimeout(res, Math.max(500, (r.exit_in_seconds ?? 2) * 1000)))
      await waitForBackend()
      toast.success('Backend restarted; pending overrides are now live.')
      setPhase('idle')
      onRestarted()
    } catch (e) {
      setError((e as Error).message)
      setPhase('failed')
    }
  }

  return (
    <>
      <div className="p-3 rounded-md bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 text-sm flex gap-2 items-start">
        <RefreshCw className={`w-4 h-4 shrink-0 mt-0.5 ${phase === 'restarting' ? 'animate-spin' : ''}`} />
        <div className="flex-1">
          <p>
            <strong>Restart required.</strong> {pendingKeys.length} setting{pendingKeys.length === 1 ? '' : 's'} {pendingKeys.length === 1 ? 'is' : 'are'} wired at startup (CORS, auth middleware, embedding provider) and won't take effect until the backend restarts.
          </p>
          <p className="mt-1 font-mono text-xs text-theme-secondary break-all">
            {pendingKeys.join(', ')}
          </p>
          {phase === 'failed' && error && (
            <p className="mt-2 text-xs text-red-700 dark:text-red-300">
              Restart failed: {error}. Falling back to manual:{' '}
              <code className="px-1 py-0.5 rounded bg-[var(--theme-surface-2)] font-mono">docker compose restart api</code>
            </p>
          )}
        </div>
        <div className="shrink-0">
          {phase === 'restarting' ? (
            <Button size="sm" disabled>Restarting…</Button>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => setPhase('confirm')}>
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Restart backend now
            </Button>
          )}
        </div>
      </div>

      <Modal
        open={phase === 'confirm'}
        onClose={() => setPhase('idle')}
        title="Restart backend?"
      >
        <div className="space-y-3 text-sm">
          <p className="text-theme-secondary">
            The backend will exit and the orchestrator will start it again.
            In-flight requests are dropped; expect ~5–15 seconds of API
            downtime depending on cold-start.
          </p>
          <p className="text-theme-secondary">
            These pending overrides will become active:
          </p>
          <ul className="font-mono text-xs text-theme-primary list-disc pl-5 space-y-0.5">
            {pendingKeys.map((k) => <li key={k}>{k}</li>)}
          </ul>
          <p className="text-xs text-amber-700 dark:text-amber-300">
            Requires the backend container to have a restart policy
            (Docker <code className="font-mono">restart: unless-stopped</code>, k8s default Pod restart). Without one,
            the backend stays down after exit.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setPhase('idle')}>Cancel</Button>
            <Button onClick={doRestart}>
              <RefreshCw className="w-4 h-4 mr-1.5" /> Restart now
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}


// ─── Page ────────────────────────────────────────────────────────────────

export function SettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { openWizard, applyCount } = useWizards()
  const [snapshot, setSnapshot] = useState<SettingsSnapshot | null>(null)
  const [adminState, setAdminState] = useState<AdminSettings | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  // Track HOW the editor was opened so close/save can decide whether
  // to auto-return to where the operator came from:
  //   * 'deep-link' = arrived via `?edit=<key>` (a Fix button on the
  //     Overview page navigated here). Closing the editor — whether by
  //     Cancel, X, or successful Save — drops back to that origin.
  //   * 'inline' = opened by clicking Edit on a row of /settings.
  //     Closing stays on /settings (the operator might want to keep
  //     editing other rows).
  const [editorOrigin, setEditorOrigin] = useState<'deep-link' | 'inline' | null>(null)
  const [activeTab, setActiveTab] = useState<string>(() => searchParams.get('tab') ?? 'llm')

  // "Where did the operator come from?" — a fix button on the dashboard
  // (or anywhere else) passes `{from: <pathname>}` via location.state
  // so this page can render a breadcrumb back AND auto-return on
  // close. Captured ONCE via useState's lazy initializer because:
  //
  //   - `setSearchParams(searchParams, {replace: true})` below strips
  //     the `?edit=` param from the URL, and under the hood it does
  //     a navigate() that DOESN'T preserve location.state. So a
  //     plain `location.state` read on re-render would flip to null
  //     and Cancel would have no destination to return to. That was
  //     the bug behind "I clicked Fix and Cancel still left me on
  //     /settings" — the state was gone before Cancel even fired.
  //
  //   - useState's initializer runs once on mount, before any
  //     useEffect, so we lock in the from-value before any
  //     setSearchParams call can nuke it.
  const [cameFrom] = useState<string | null>(() => {
    const fromState = (location.state as { from?: string } | null)?.from
    return fromState ?? null
  })

  // Friendly label for the back link — keep this in sync with the
  // sidebar's nav labels so the user sees the same word in both
  // places. Unknown routes fall back to "previous page".
  const cameFromLabel = (() => {
    if (cameFrom === '/' || cameFrom === '/overview') return 'Overview'
    if (cameFrom === '/subjects') return 'Subjects'
    if (cameFrom === '/jobs') return 'Jobs'
    if (cameFrom === '/webhooks') return 'Webhooks'
    if (cameFrom === '/receipts') return 'Receipts'
    if (cameFrom === '/policy') return 'Policy'
    if (cameFrom === '/diagnostics') return 'Diagnostics'
    if (cameFrom === '/suggested-labels') return 'Suggested labels'
    return 'previous page'
  })()

  const load = useCallback(async () => {
    setError(null)
    try {
      const [snap, admin] = await Promise.all([fetchSettings(), fetchAdminSettings()])
      setSnapshot(snap)
      setAdminState(admin)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Re-fetch when a global wizard reports an apply (e.g. the
  // Enable-Auth wizard PATCHing api_key from anywhere in the app).
  // `applyCount` increments per apply; we ignore the initial value so
  // the first mount doesn't double-fetch.
  useEffect(() => {
    if (applyCount === 0) return
    void load()
  }, [applyCount, load])

  // Honour deep-link query params. `?edit=<key>` opens the editor for
  // one specific setting; `?tab=<name>` picks an initial tab. Wizard
  // deep-links (`?wizard=`) are handled globally by WizardsProvider,
  // not here. Clears handled params from the URL on first use so a
  // browser refresh doesn't re-fire them.
  useEffect(() => {
    if (loading) return
    const editKey = searchParams.get('edit')
    let dirty = false
    if (editKey) {
      if (snapshot?.settings[editKey]) {
        setEditingKey(editKey)
        setEditorOrigin('deep-link')
        // Switch tab to where the setting lives so it lands in view.
        const cat = snapshot.settings[editKey].category
        if (CATEGORY_LABELS[cat]) setActiveTab(cat)
      } else if (snapshot) {
        // The deep-link references a key that isn't in the catalogue.
        // Silently no-op'ing leaves the operator staring at /settings
        // wondering why "Fix" didn't open anything — surface a toast
        // so we both notice the gap AND signal something happened.
        // This is also the canary that catches catalogue drift: if a
        // readiness rule starts pointing at an uncatalogued key, the
        // first operator to hit it gets a clear error instead of a
        // silent dead end.
        toast.error(
          `Setting "${editKey}" not found in the catalogue. ` +
            `This is a bug — please report it.`,
        )
      }
      searchParams.delete('edit')
      dirty = true
    }
    if (dirty) {
      // Pass through `location.state` explicitly so the from-value we
      // depend on for auto-return doesn't get clobbered. Default
      // navigateOptions has `state: undefined` which would replace
      // our state with null.
      setSearchParams(searchParams, { replace: true, state: location.state })
    }
  }, [loading, snapshot, searchParams, setSearchParams, location.state])

  // Close handler shared by Cancel / X / Save. If the editor was
  // opened via a Fix button on another page (e.g. the Dashboard's
  // Production-readiness card), auto-return there — the operator
  // took an atomic action and is done. Inline opens (Edit on a row
  // of /settings) keep them on /settings since they may want to edit
  // multiple rows in a row.
  const closeEditor = useCallback(() => {
    const wasDeepLink = editorOrigin === 'deep-link'
    setEditingKey(null)
    setEditorOrigin(null)
    if (wasDeepLink && cameFrom) {
      navigate(cameFrom)
    }
  }, [editorOrigin, cameFrom, navigate])

  // Inline-opened editor (from an Edit button on a Settings row).
  // Marked 'inline' so closeEditor knows NOT to auto-navigate back
  // — the operator is exploring the settings page and probably
  // wants to stay.
  const openEditorInline = useCallback((key: string) => {
    setEditingKey(key)
    setEditorOrigin('inline')
  }, [])

  const groups = useMemo(
    () => (snapshot ? groupByCategory(snapshot.settings) : {}),
    [snapshot],
  )

  const onRevert = async (key: string) => {
    try {
      await deleteSetting(key)
      applySettings().catch(() => undefined)
      toast.success(`Reverted ${key} to env`)
      void load()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const editingEntry = editingKey && snapshot ? snapshot.settings[editingKey] : null

  // Tab list — backend categories that have at least one entry, plus an
  // "Admin server" tab for the local Node knobs.
  const tabs = useMemo(() => {
    const cats = Object.keys(CATEGORY_LABELS).filter((c) => groups[c]?.length)
    return [
      ...cats.map((c) => ({ id: c, label: CATEGORY_LABELS[c] })),
      { id: 'admin', label: 'Admin server' },
    ]
  }, [groups])

  if (loading) return <LoadingState message="Loading settings…" />
  if (error) return <ErrorState title="Failed to load settings" message={error} onRetry={load} />

  // Is backend auth currently active? The api_key setting being non-
  // empty in the live process is the source of truth — applied_value
  // is what the running process committed to at boot. We check
  // applied_value (not value) because a queued-but-not-yet-restarted
  // override doesn't actually gate requests until restart.
  const authEnabled = Boolean(
    snapshot?.settings.api_key && (snapshot.settings.api_key.applied_value as unknown),
  )

  // Pending-restart rows: keys whose live process value differs from
  // what the DB currently resolves to. The backend computes this — we
  // just consume the flag. (Earlier versions of this UI filtered on
  // `source ≠ env`, which never cleared after a restart because the
  // DB row still existed; the new flag clears as soon as the next
  // snapshot fetch sees applied_value === value.)
  const pendingRestartKeys = snapshot
    ? Object.entries(snapshot.settings)
        .filter(([, e]) => e.pending_restart && e.editable)
        .map(([k]) => k)
    : []

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-4">
      {/* Breadcrumb back to wherever the operator came from. Shown ONLY
          when a fix button (or another deep link) routed them here via
          location.state. Without it, an operator landing on /settings
          to fix one row from the Dashboard had no fast way back —
          they'd have to find Overview in the sidebar. */}
      {cameFrom && (
        <button
          type="button"
          onClick={() => navigate(cameFrom)}
          className="inline-flex items-center gap-1.5 text-xs text-theme-muted hover:text-theme-primary transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to {cameFromLabel}
        </button>
      )}
      <PageHeader
        title="Settings"
        description="Backend configuration + admin-server credentials. Backend values resolve as tenant → DB override → env. Secrets are write-only. Hover the help icon on any row for full details."
      />
      {pendingRestartKeys.length > 0 && (
        <RestartBanner
          pendingKeys={pendingRestartKeys}
          onRestarted={() => void load()}
        />
      )}
      <Tabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />
      {tabs.map((tab) => (
        <TabPanel key={tab.id} isActive={activeTab === tab.id}>
          {tab.id === 'admin' ? (
            <AdminServerTab state={adminState} reload={() => void load()} />
          ) : tab.id === 'auth' ? (
            <>
              {/* If the backend's api_key is unset (effective value
                  is null/empty AND there's no DB override → source
                  is env), surface the wizard CTA at the top of the
                  Auth tab. Hides itself the moment a key lands so
                  there's never a stale "enable" prompt next to an
                  already-set value. */}
              {!authEnabled && (
                <div className="mb-4 p-3 rounded-md bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 text-sm flex gap-2 items-start">
                  <ShieldOff className="w-4 h-4 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p>
                      <strong>Authentication is disabled.</strong> Anyone who
                      can reach the backend can read and write memories.
                      Enable it with the guided wizard — sets the key on
                      both the admin proxy and the backend so the UI keeps
                      working through the rollout.
                    </p>
                  </div>
                  <div className="shrink-0">
                    <Button size="sm" onClick={() => openWizard('enable-auth')}>
                      <ShieldCheck className="w-3.5 h-3.5 mr-1.5" />
                      Enable authentication
                    </Button>
                  </div>
                </div>
              )}
              <CategoryTab
                entries={groups[tab.id] ?? []}
                onEdit={openEditorInline}
                onRevert={onRevert}
              />
            </>
          ) : (
            <CategoryTab
              entries={groups[tab.id] ?? []}
              onEdit={openEditorInline}
              onRevert={onRevert}
            />
          )}
        </TabPanel>
      ))}
      {editingEntry && editingKey && (
        <SettingEditor
          settingKey={editingKey}
          entry={editingEntry}
          onClose={closeEditor}
          onSaved={() => {
            // Refetch the snapshot so the row shows the new value /
            // pending-restart state; the close itself (incl. auto-
            // return for deep-linked opens) is handled by closeEditor.
            void load()
          }}
        />
      )}
      {/* The Enable-Auth + Enable-Admin-Auth wizards now live in the
          global WizardsProvider, not here — so the same wizards open
          from the Dashboard's Production-readiness card, from the
          top-of-page "Admin auth disabled" banner, AND from
          /settings, all with consistent cancel-stays-in-place
          behaviour. */}
    </div>
  )
}

// Exported for the vitest suite so client-side validation stays
// behaviourally pinned to the server-side rules. Not part of the public
// page API — prefer using the editor UI directly in production code.
export { validate as __test_validate }
