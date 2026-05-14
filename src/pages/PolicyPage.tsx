import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  Badge,
  Button,
  CopyableMono,
  EmptyState,
  ErrorState,
  Modal,
  PageHeader,
  SearchInput,
  TableSkeleton,
} from '../components/ui'
import { RefreshControl } from '../components/RefreshControl'
import { PullToRefresh } from '../components/PullToRefresh'
import {
  activatePolicyBundle,
  fetchActivePolicy,
  fetchPolicyBundle,
  fetchPolicyBundles,
  fetchTenantConfig,
  patchTenantConfig,
  uploadPolicyBundle,
  type ActivePolicyBundle,
  type PolicyBundleDetail,
  type PolicyBundleSummary,
  type TenantConfig,
} from '../lib/api'


function formatRelativeTime(timestamp: string | null | undefined): string {
  if (!timestamp) return '—'
  const date = new Date(timestamp)
  const now = new Date()
  const diffSeconds = Math.floor((now.getTime() - date.getTime()) / 1000)
  if (diffSeconds < 60) return 'just now'
  if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m ago`
  if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)}h ago`
  if (diffSeconds < 604800) return `${Math.floor(diffSeconds / 86400)}d ago`
  return date.toLocaleDateString()
}


function TenantConfigCard({ tenantId }: { tenantId: string }) {
  // Form state is initialised from a GET. The PATCH path supplies
  // `expected_version` from the most recent successful read so
  // concurrent admin edits surface as a 409 + clear retry, rather
  // than a silent lost-update.
  const [config, setConfig] = useState<TenantConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Form fields. Each holds the user's edit-in-progress value; on
  // Save we diff against the loaded config and send a PATCH with
  // only the changed fields (matches the server's merge semantic).
  const [receipts, setReceipts] = useState<string>('')
  const [retentionDays, setRetentionDays] = useState<string>('')
  const [policyMode, setPolicyMode] = useState<string>('')
  const [requireCaller, setRequireCaller] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const cfg = await fetchTenantConfig(tenantId)
      setConfig(cfg)
      setReceipts(cfg.config.receipts ?? '')
      setRetentionDays(
        cfg.config.receipt_retention_days !== undefined
          ? String(cfg.config.receipt_retention_days)
          : '',
      )
      setPolicyMode(cfg.config.policy_mode ?? '')
      setRequireCaller(cfg.config.require_caller_identity === true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [tenantId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload()
  }, [reload])

  const buildPatch = () => {
    if (!config) return {}
    const patch: Record<string, unknown> = {}
    const cur = config.config
    // receipts (empty string = "don't set this field" — keeps the
    // current value or the global default).
    if (receipts && receipts !== cur.receipts) patch.receipts = receipts
    // retention_days (empty string = unchanged).
    if (retentionDays !== '') {
      const n = Number(retentionDays)
      if (!Number.isNaN(n) && n !== cur.receipt_retention_days) {
        patch.receipt_retention_days = n
      }
    }
    if (policyMode && policyMode !== cur.policy_mode) patch.policy_mode = policyMode
    if (requireCaller !== (cur.require_caller_identity === true)) {
      patch.require_caller_identity = requireCaller
    }
    return patch
  }

  const save = async () => {
    if (!config) return
    const patch = buildPatch()
    if (Object.keys(patch).length === 0) {
      toast.info('No changes to save')
      return
    }
    setSaving(true)
    try {
      const updated = await patchTenantConfig(tenantId, {
        ...patch,
        expected_version: config.version,
      })
      setConfig(updated)
      toast.success(
        `Saved tenant config (v${updated.version})`,
        {
          description: `Changed: ${Object.keys(patch).join(', ')}`,
        },
      )
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // If the server returned 409, re-read so the form reflects the
      // current state and the operator can re-apply intentionally.
      if (msg.includes('version mismatch') || msg.includes('409')) {
        toast.error('Concurrent edit detected — reloaded', { description: msg })
        await reload()
      } else {
        toast.error('Save failed', { description: msg })
      }
    } finally {
      setSaving(false)
    }
  }

  if (loading && !config) {
    return (
      <div className="mb-6 rounded-xl border border-theme-border bg-[var(--theme-card-bg)] p-4">
        <p className="text-xs text-theme-muted">Loading tenant config…</p>
      </div>
    )
  }
  if (error) {
    return (
      <div className="mb-6 rounded-xl border border-red-500/30 bg-red-500/5 p-4">
        <p className="text-xs text-red-400">Failed to load tenant config: {error}</p>
      </div>
    )
  }
  if (!config) return null

  const policyModeChanged = policyMode && policyMode !== (config.config.policy_mode ?? '')
  const enforceWarning =
    policyModeChanged && policyMode === 'enforce' ? (
      <p className="text-[11px] text-amber-300 mt-2">
        Switching to <strong>enforce</strong>: denied memories will be dropped from
        <code className="mx-1 px-1 rounded bg-[var(--theme-surface-1)]">/v1/context</code>
        and redacted memories will have their content replaced with
        <code className="mx-1 px-1 rounded bg-[var(--theme-surface-1)]">[REDACTED by policy]</code>.
        Audit a few days of <code>log_only</code> receipts first.
      </p>
    ) : null

  return (
    <div className="mb-6 rounded-xl border border-theme-border bg-[var(--theme-card-bg)] p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs uppercase tracking-wider text-theme-muted">
          Tenant configuration
        </h2>
        <span className="text-[10px] text-theme-muted">
          version {config.version}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
        <div>
          <label
            htmlFor="tcc-receipts"
            className="block text-[10px] uppercase tracking-wide text-theme-muted mb-1"
          >
            Receipts emission
          </label>
          <select
            id="tcc-receipts"
            value={receipts}
            onChange={(e) => setReceipts(e.target.value)}
            disabled={saving}
            className="w-full px-2 py-1.5 rounded-md border border-theme-border bg-[var(--theme-surface-1)] text-theme-primary focus:outline-none focus:border-accent"
          >
            <option value="">(unset — defaults to on_request)</option>
            <option value="on_request">on_request</option>
            <option value="always">always</option>
            <option value="never">never</option>
          </select>
        </div>

        <div>
          <label
            htmlFor="tcc-retention"
            className="block text-[10px] uppercase tracking-wide text-theme-muted mb-1"
          >
            Receipt retention (days, 0 = forever)
          </label>
          <input
            id="tcc-retention"
            type="number"
            min={0}
            value={retentionDays}
            onChange={(e) => setRetentionDays(e.target.value)}
            placeholder="(unset)"
            disabled={saving}
            className="w-full px-2 py-1.5 rounded-md border border-theme-border bg-[var(--theme-surface-1)] text-theme-primary focus:outline-none focus:border-accent"
          />
        </div>

        <div>
          <label
            htmlFor="tcc-policy-mode"
            className="block text-[10px] uppercase tracking-wide text-theme-muted mb-1"
          >
            Policy mode
          </label>
          <select
            id="tcc-policy-mode"
            value={policyMode}
            onChange={(e) => setPolicyMode(e.target.value)}
            disabled={saving}
            className="w-full px-2 py-1.5 rounded-md border border-theme-border bg-[var(--theme-surface-1)] text-theme-primary focus:outline-none focus:border-accent"
          >
            <option value="">(unset — defaults to log_only)</option>
            <option value="log_only">log_only</option>
            <option value="enforce">enforce</option>
          </select>
        </div>

        <div className="flex items-end pb-1">
          <label className="inline-flex items-center gap-2 text-xs text-theme-secondary cursor-pointer">
            <input
              type="checkbox"
              checked={requireCaller}
              onChange={(e) => setRequireCaller(e.target.checked)}
              disabled={saving}
            />
            Require caller identity (401 on anonymous)
          </label>
        </div>
      </div>

      {enforceWarning}

      <div className="flex justify-end gap-2 mt-3">
        <Button variant="ghost" size="sm" onClick={() => void reload()} disabled={saving}>
          Reset
        </Button>
        <Button variant="primary" size="sm" onClick={() => void save()} loading={saving}>
          Save changes
        </Button>
      </div>
    </div>
  )
}


function BundleDetail({ bundle }: { bundle: PolicyBundleDetail }) {
  return (
    <div className="space-y-4 text-xs">
      <dl className="grid grid-cols-2 gap-y-2 gap-x-4">
        <dt className="text-theme-muted">bundle_hash</dt>
        <dd className="font-mono break-anywhere">{bundle.bundle_hash}</dd>
        <dt className="text-theme-muted">tenant</dt>
        <dd className="font-mono">{bundle.tenant_id ?? '(global)'}</dd>
        <dt className="text-theme-muted">active</dt>
        <dd>
          <Badge variant={bundle.active ? 'success' : 'muted'}>
            {bundle.active ? 'active' : 'inactive'}
          </Badge>
        </dd>
        <dt className="text-theme-muted">created</dt>
        <dd>{formatRelativeTime(bundle.created_at)}</dd>
        <dt className="text-theme-muted">rule count</dt>
        <dd className="tabular-nums">{bundle.rules.length}</dd>
      </dl>

      <div>
        <h4 className="text-[11px] uppercase tracking-wider text-theme-muted mb-1">
          Rules ({bundle.rules.length})
        </h4>
        <ul className="space-y-2 max-h-72 overflow-y-auto pr-1">
          {bundle.rules.map((r) => (
            <li
              key={r.id}
              className="rounded border border-theme-border bg-[var(--theme-surface-1)] px-2 py-2"
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="font-mono text-theme-primary break-anywhere">{r.id}</span>
                <Badge
                  variant={r.action === 'deny' ? 'error' : 'warning'}
                >
                  {r.action}
                </Badge>
              </div>
              {r.description && (
                <p className="text-theme-secondary mb-1">{r.description}</p>
              )}
              <pre className="text-[11px] text-theme-muted whitespace-pre-wrap break-all bg-[var(--theme-bg)] rounded p-1">
                when: {JSON.stringify(r.when)}
              </pre>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h4 className="text-[11px] uppercase tracking-wider text-theme-muted mb-1">
          YAML content
        </h4>
        <pre className="text-[11px] text-theme-secondary whitespace-pre-wrap break-all bg-[var(--theme-surface-1)] rounded p-2 max-h-72 overflow-y-auto">
          {bundle.yaml_content}
        </pre>
      </div>
    </div>
  )
}


export function PolicyPage() {
  const [tenantFilter, setTenantFilter] = useState('')
  const [bundles, setBundles] = useState<PolicyBundleSummary[] | null>(null)
  const [activeBundle, setActiveBundle] = useState<ActivePolicyBundle | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastFetched, setLastFetched] = useState<Date | null>(null)

  const [selectedHash, setSelectedHash] = useState<string | null>(null)
  const [selectedBundle, setSelectedBundle] = useState<PolicyBundleDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)

  const [uploadOpen, setUploadOpen] = useState(false)
  const [uploadYaml, setUploadYaml] = useState('')
  const [uploadActivate, setUploadActivate] = useState(true)
  const [uploadRunning, setUploadRunning] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [bundlesResp, active] = await Promise.all([
        fetchPolicyBundles(tenantFilter || undefined),
        fetchActivePolicy(tenantFilter || undefined),
      ])
      setBundles(bundlesResp.bundles)
      setActiveBundle(active)
      setLastFetched(new Date())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load policy data')
    } finally {
      setLoading(false)
    }
  }, [tenantFilter])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadData()
  }, [loadData])

  useEffect(() => {
    if (!selectedHash) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedBundle(null)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDetailError(null)
      return
    }
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDetailLoading(true)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDetailError(null)
    // Scope the bundle detail fetch to the current tenant filter.
    // Post-#79 the same hash can live in multiple scopes, so a
    // detail fetch without tenant context may surface the wrong row
    // (or 404 with a disambiguation hint). The Policy page already
    // displays one tenant scope at a time, so `tenantFilter` is the
    // right disambiguator.
    fetchPolicyBundle(selectedHash, tenantFilter || null)
      .then((b) => !cancelled && setSelectedBundle(b))
      .catch((e) => {
        if (!cancelled) {
          setDetailError(
            e instanceof Error ? e.message : 'Failed to load bundle detail',
          )
        }
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedHash, tenantFilter])

  const runActivate = async (hash: string) => {
    try {
      // Same disambiguation rationale as fetchPolicyBundle above.
      await activatePolicyBundle(hash, tenantFilter || null)
      toast.success('Bundle activated')
      await loadData()
    } catch (e) {
      toast.error('Activate failed', {
        description: e instanceof Error ? e.message : String(e),
      })
    }
  }

  const runUpload = async () => {
    setUploadRunning(true)
    setUploadError(null)
    try {
      const result = await uploadPolicyBundle({
        yaml_content: uploadYaml,
        tenant_id: tenantFilter || null,
        activate: uploadActivate,
      })
      toast.success(
        `Uploaded bundle ${result.bundle_hash.slice(0, 12)}…`,
        {
          description: `${result.rule_count} rule(s), ${
            result.active ? 'activated' : 'inactive'
          }`,
        },
      )
      setUploadOpen(false)
      setUploadYaml('')
      await loadData()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setUploadError(msg)
      toast.error('Upload failed', { description: msg })
    } finally {
      setUploadRunning(false)
    }
  }

  return (
    <PullToRefresh onRefresh={loadData}>
      <div className="p-4 sm:p-6 max-w-7xl mx-auto">
        <PageHeader
          title="Sensitivity-label policy"
          description="Per-memory capability tags + bundled rules that the assembly path consults on every call. v1 ships log_only by default — flip tenant config to enforce after auditing the receipts."
          actions={
            <div className="flex items-center gap-2">
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  setUploadError(null)
                  setUploadOpen(true)
                }}
              >
                Upload bundle
              </Button>
              <RefreshControl
                lastFetched={lastFetched}
                onRefresh={() => void loadData()}
                loading={loading}
              />
            </div>
          }
        />

        <div className="flex flex-wrap gap-3 mb-4 items-center">
          <div className="w-64">
            <SearchInput
              value={tenantFilter}
              onChange={setTenantFilter}
              placeholder="tenant_id (blank = global)"
            />
          </div>
          <div className="flex-1" />
        </div>

        {/* Active bundle card */}
        {activeBundle ? (
          <div className="mb-6 rounded-xl border border-theme-border bg-[var(--theme-card-bg)] p-4">
            <p className="text-[11px] uppercase tracking-wider text-theme-muted mb-2">
              Active bundle for {tenantFilter || '(global scope)'}
            </p>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CopyableMono
                value={activeBundle.bundle_hash}
                display={`${activeBundle.bundle_hash.slice(0, 16)}…`}
                labelForA11y="active bundle hash"
                maxWidthClass="max-w-[20ch]"
              />
              <div className="flex items-center gap-3 text-xs text-theme-secondary">
                <span className="tabular-nums">
                  {activeBundle.rule_count} rule(s)
                </span>
                <Badge variant="success">live</Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedHash(activeBundle.bundle_hash)}
                >
                  View
                </Button>
              </div>
            </div>
          </div>
        ) : (
          !loading &&
          !error && (
            <div className="mb-6">
              <EmptyState
                title="No active bundle"
                description={
                  tenantFilter
                    ? `Tenant ${tenantFilter} has no active policy bundle — every memory falls through to default-allow.`
                    : 'No global active policy bundle. Upload one or activate an existing inactive bundle.'
                }
              />
            </div>
          )
        )}

        {/* Tenant configuration — receipts emission, retention,
            policy_mode enforce flip, require_caller_identity. Only
            renders when a tenant scope is selected: this surface
            doesn't have a "global tenant config" concept today (the
            JSONB sits in tenant_configs which is keyed on tenant_id;
            a NULL row would conflict with that semantic). Global
            defaults live in the server's env vars, not here. */}
        {tenantFilter && <TenantConfigCard tenantId={tenantFilter} />}

        {/* All bundles */}
        <h2 className="text-xs uppercase tracking-wider text-theme-muted mb-2 mt-6">
          All bundles
        </h2>
        {loading && !bundles && (
          <TableSkeleton
            rows={4}
            columns={4}
            columnWidths={['w-48', 'w-24', 'w-20', 'w-32']}
            ariaLabel="Loading policy bundles"
          />
        )}
        {error && (
          <ErrorState
            title="Failed to load policy bundles"
            message="The admin proxy could not return the policy bundle list."
            suggestion="Check that the Statewave backend is reachable and try again."
            technicalDetails={error}
            onRetry={loadData}
          />
        )}
        {bundles && bundles.length === 0 && !error && (
          <EmptyState
            title="No bundles uploaded"
            description="Upload a policy bundle to get started. Bundles are content-hashed and immutable; activation just flips which one is live."
          />
        )}
        {bundles && bundles.length > 0 && (
          <div className="rounded-xl border border-theme-border bg-[var(--theme-card-bg)]">
            <table className="w-full text-sm">
              <thead className="bg-[var(--theme-surface-1)] border-b border-theme-border">
                <tr>
                  <th className="text-left text-xs font-medium uppercase tracking-wide text-theme-muted px-4 py-2.5">
                    Hash
                  </th>
                  <th className="text-left text-xs font-medium uppercase tracking-wide text-theme-muted px-4 py-2.5">
                    Tenant
                  </th>
                  <th className="text-center text-xs font-medium uppercase tracking-wide text-theme-muted px-4 py-2.5">
                    Active
                  </th>
                  <th className="text-right text-xs font-medium uppercase tracking-wide text-theme-muted px-4 py-2.5">
                    Created
                  </th>
                  <th className="text-right text-xs font-medium uppercase tracking-wide text-theme-muted px-4 py-2.5">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {bundles.map((b) => (
                  <tr
                    key={b.bundle_hash}
                    className="border-b border-theme-border/50 last:border-0"
                  >
                    <td className="px-4 py-2.5">
                      <CopyableMono
                        value={b.bundle_hash}
                        display={`${b.bundle_hash.slice(0, 12)}…`}
                        labelForA11y="bundle hash"
                        maxWidthClass="max-w-[14ch]"
                      />
                    </td>
                    <td className="px-4 py-2.5 text-xs text-theme-secondary">
                      {b.tenant_id ?? <span className="text-theme-muted">(global)</span>}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {b.active ? (
                        <Badge variant="success">active</Badge>
                      ) : (
                        <Badge variant="muted">inactive</Badge>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right text-xs text-theme-muted">
                      {formatRelativeTime(b.created_at)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="inline-flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedHash(b.bundle_hash)}
                        >
                          View
                        </Button>
                        {!b.active && (
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => void runActivate(b.bundle_hash)}
                          >
                            Activate
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Bundle detail modal */}
        <Modal
          open={selectedHash !== null}
          onClose={() => setSelectedHash(null)}
          title="Policy bundle"
          description="Immutable bundle body. Receipts emitted while this was active record the hash above so audit replay is reproducible."
          size="md"
        >
          {detailLoading && <p className="text-xs text-theme-muted">Loading…</p>}
          {detailError && (
            <p className="text-xs text-red-400 break-anywhere">{detailError}</p>
          )}
          {selectedBundle && <BundleDetail bundle={selectedBundle} />}
          <div className="flex justify-end mt-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedHash(null)}
            >
              Close
            </Button>
          </div>
        </Modal>

        {/* Upload modal */}
        <Modal
          open={uploadOpen}
          onClose={() => !uploadRunning && setUploadOpen(false)}
          title="Upload policy bundle"
          description="Paste a YAML or JSON policy bundle. The server validates schema before storing; invalid bundles return 400 with the parser error."
          size="md"
        >
          <div className="space-y-3">
            <textarea
              value={uploadYaml}
              onChange={(e) => setUploadYaml(e.target.value)}
              placeholder={`version: 1\nrules:\n  - id: deny-pii-for-marketing\n    when:\n      memory_has_any_label: [pii]\n      caller_type: marketing_tool\n    action: deny`}
              className="w-full min-h-[200px] text-xs font-mono px-2 py-1.5 rounded-md border border-theme-border bg-[var(--theme-surface-1)] text-theme-primary focus:outline-none focus:border-accent"
              disabled={uploadRunning}
              aria-label="Policy YAML"
            />
            <label className="flex items-center gap-2 text-xs text-theme-secondary">
              <input
                type="checkbox"
                checked={uploadActivate}
                onChange={(e) => setUploadActivate(e.target.checked)}
                disabled={uploadRunning}
              />
              Activate immediately (deactivates the current bundle in
              the same scope)
            </label>
            {uploadError && (
              <p className="text-xs text-red-400 break-anywhere">{uploadError}</p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setUploadOpen(false)}
                disabled={uploadRunning}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                loading={uploadRunning}
                onClick={() => void runUpload()}
                disabled={!uploadYaml.trim()}
              >
                Upload
              </Button>
            </div>
          </div>
        </Modal>
      </div>
    </PullToRefresh>
  )
}
