import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import {
  Badge,
  Button,
  CopyableMono,
  EmptyState,
  ErrorState,
  Modal,
  NoResultsState,
  PageHeader,
  SearchInput,
  TableSkeleton,
} from '../components/ui'
import { RefreshControl } from '../components/RefreshControl'
import { PullToRefresh } from '../components/PullToRefresh'
import {
  fetchReceipt,
  fetchReceipts,
  replayReceipt,
  type Receipt,
  type ReceiptListResponse,
  type ReceiptReplayResponse,
} from '../lib/api'
import { toast } from 'sonner'

const PAGE_SIZE = 50


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


function memoryCount(receipt: Receipt): number {
  return receipt.selected_entries.filter((e) => e.type === 'memory').length
}

function episodeCount(receipt: Receipt): number {
  return receipt.selected_entries.filter((e) => e.type === 'episode').length
}


function ReceiptRow({
  receipt,
  onSelect,
}: {
  receipt: Receipt
  onSelect: (id: string) => void
}) {
  return (
    <tr
      className="border-b border-theme-border/50 last:border-0 hover:bg-[var(--theme-surface-1)]/50 cursor-pointer"
      onClick={() => onSelect(receipt.receipt_id)}
    >
      <td className="px-4 py-3">
        <CopyableMono
          value={receipt.receipt_id}
          display={`${receipt.receipt_id.slice(0, 10)}…`}
          labelForA11y="receipt id"
          maxWidthClass="max-w-[12ch]"
        />
      </td>
      <td className="px-4 py-3 text-xs text-theme-secondary truncate max-w-[20ch]">
        {receipt.tenant_id ?? <span className="text-theme-muted">(none)</span>}
      </td>
      <td className="px-4 py-3 text-xs text-theme-secondary truncate max-w-[20ch]">
        {receipt.subject_id}
      </td>
      <td className="px-4 py-3 text-xs text-theme-primary truncate max-w-[30ch]">
        {receipt.task}
      </td>
      <td className="px-4 py-3 text-center">
        <Badge variant="muted">{receipt.mode}</Badge>
      </td>
      <td className="px-4 py-3 text-center text-xs tabular-nums">
        {memoryCount(receipt)}
      </td>
      <td className="px-4 py-3 text-center text-xs tabular-nums">
        {episodeCount(receipt)}
      </td>
      <td className="px-4 py-3 text-right text-xs text-theme-muted">
        {formatRelativeTime(receipt.created_at)}
      </td>
    </tr>
  )
}


type ReplayState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; result: ReceiptReplayResponse }
  | { status: 'error'; message: string }

function ReceiptDetail({
  receipt,
  replayState,
  onReplay,
}: {
  receipt: Receipt
  replayState: ReplayState
  onReplay: () => void
}) {
  const mems = receipt.selected_entries.filter((e) => e.type === 'memory')
  const eps = receipt.selected_entries.filter((e) => e.type === 'episode')

  // v0.9 (#159) — receipts carry an embedded policy_snapshot. Older
  // receipts don't, and the replay endpoint refuses them with 422.
  // Surface the snapshot status inline so the operator understands
  // why the button may be disabled.
  const rawPolicySnapshot = (receipt as unknown as { policy_snapshot?: unknown })
    .policy_snapshot as
    | { bundle_hash: string | null; bundle_yaml: string | null; captured_at?: string }
    | null
    | undefined
  const hasSnapshot = Boolean(rawPolicySnapshot)
  const hasActiveBundle = Boolean(rawPolicySnapshot?.bundle_yaml)

  return (
    <div className="space-y-4 text-xs">
      <dl className="grid grid-cols-2 gap-y-2 gap-x-4">
        <dt className="text-theme-muted">receipt_id</dt>
        <dd className="font-mono break-anywhere">{receipt.receipt_id}</dd>
        <dt className="text-theme-muted">mode</dt>
        <dd>{receipt.mode}</dd>
        <dt className="text-theme-muted">tenant_id</dt>
        <dd className="font-mono">{receipt.tenant_id ?? '—'}</dd>
        <dt className="text-theme-muted">subject_id</dt>
        <dd className="font-mono break-anywhere">{receipt.subject_id}</dd>
        <dt className="text-theme-muted">task</dt>
        <dd className="break-anywhere">{receipt.task}</dd>
        <dt className="text-theme-muted">as_of</dt>
        <dd>{receipt.as_of}</dd>
        <dt className="text-theme-muted">created_at</dt>
        <dd>{receipt.created_at}</dd>
        <dt className="text-theme-muted">parent</dt>
        <dd className="font-mono break-anywhere">
          {receipt.parent_receipt_id ?? '—'}
        </dd>
      </dl>

      <div>
        <h4 className="text-[11px] uppercase tracking-wider text-theme-muted mb-1">
          Output
        </h4>
        <dl className="grid grid-cols-2 gap-y-1 gap-x-4">
          <dt className="text-theme-muted">context_hash</dt>
          <dd className="font-mono break-anywhere">{receipt.output.context_hash}</dd>
          <dt className="text-theme-muted">size_bytes</dt>
          <dd className="tabular-nums">{receipt.output.context_size_bytes}</dd>
          <dt className="text-theme-muted">canon_version</dt>
          <dd>{receipt.output.canonicalization_version}</dd>
          <dt className="text-theme-muted">token_estimate</dt>
          <dd className="tabular-nums">{receipt.output.token_estimate}</dd>
        </dl>
      </div>

      <div>
        <h4 className="text-[11px] uppercase tracking-wider text-theme-muted mb-1">
          Policy
        </h4>
        <dl className="grid grid-cols-2 gap-y-1 gap-x-4">
          <dt className="text-theme-muted">bundle_hash</dt>
          <dd className="font-mono break-anywhere">
            {receipt.policy.policy_bundle_hash ?? '(none — #50 not yet wired)'}
          </dd>
          <dt className="text-theme-muted">mode</dt>
          <dd>{receipt.policy.mode}</dd>
          <dt className="text-theme-muted">filters_applied</dt>
          <dd className="tabular-nums">{receipt.policy.filters_applied.length}</dd>
          <dt className="text-theme-muted">filters_skipped</dt>
          <dd className="tabular-nums">{receipt.policy.filters_skipped.length}</dd>
        </dl>
      </div>

      {/* v0.9 #159 — replay panel. The policy_snapshot envelope is
          required for replay; we display its status either way so an
          operator can tell a pre-v0.9 receipt apart from a v0.9
          receipt that simply had no active bundle. */}
      <div>
        <h4 className="text-[11px] uppercase tracking-wider text-theme-muted mb-1">
          Replay
        </h4>
        <p className="text-theme-secondary mb-2">
          {hasSnapshot ? (
            hasActiveBundle ? (
              <>
                A policy snapshot is embedded on this receipt
                (captured at{' '}
                <span className="font-mono">
                  {rawPolicySnapshot?.captured_at ?? '—'}
                </span>
                ). Replay re-runs the original retrieval against{' '}
                <em>current</em> memories using this original bundle.
              </>
            ) : (
              <>
                Snapshot present, but no policy bundle was active at
                emission. Replay will run against current memories
                with the no-policy fallback.
              </>
            )
          ) : (
            <span className="text-theme-muted italic">
              Pre-v0.9 receipt — no policy snapshot captured.
              Replay is unavailable for this row.
            </span>
          )}
        </p>
        {hasSnapshot && (
          <Button
            size="sm"
            variant="primary"
            disabled={replayState.status === 'loading'}
            onClick={onReplay}
          >
            {replayState.status === 'loading'
              ? 'Replaying…'
              : 'Replay this receipt'}
          </Button>
        )}
        {replayState.status === 'error' && (
          <p className="mt-2 text-red-400 break-anywhere">
            {replayState.message}
          </p>
        )}
        {replayState.status === 'ok' && (
          <ReplayDiffPanel result={replayState.result} />
        )}
      </div>

      {mems.length > 0 && (
        <div>
          <h4 className="text-[11px] uppercase tracking-wider text-theme-muted mb-1">
            Selected memories ({mems.length})
          </h4>
          <ul className="space-y-1 max-h-72 overflow-y-auto pr-1">
            {mems.map((e) => (
              <li
                key={`${e.memory_id}-${e.rank}`}
                className="rounded border border-theme-border bg-[var(--theme-surface-1)] px-2 py-1.5 flex items-center gap-2"
              >
                <span className="text-theme-muted tabular-nums w-6 text-right">
                  #{e.rank}
                </span>
                <Badge
                  variant={
                    e.supersession_status === 'active'
                      ? 'success'
                      : e.supersession_status === 'superseded'
                        ? 'warning'
                        : 'error'
                  }
                >
                  {e.supersession_status}
                </Badge>
                <span className="text-theme-muted text-[10px]">{e.kind}</span>
                <span className="font-mono break-anywhere">{e.memory_id}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {eps.length > 0 && (
        <div>
          <h4 className="text-[11px] uppercase tracking-wider text-theme-muted mb-1">
            Selected episodes ({eps.length})
          </h4>
          <ul className="space-y-1 max-h-48 overflow-y-auto pr-1">
            {eps.map((e) => (
              <li
                key={`${e.episode_id}-${e.rank}`}
                className="rounded border border-theme-border bg-[var(--theme-surface-1)] px-2 py-1.5 flex items-center gap-2"
              >
                <span className="text-theme-muted tabular-nums w-6 text-right">
                  #{e.rank}
                </span>
                <Badge variant="muted">{e.source}</Badge>
                <span className="text-theme-muted text-[10px]">{e.event_type}</span>
                <span className="font-mono break-anywhere">{e.episode_id}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}


function ReplayDiffPanel({ result }: { result: ReceiptReplayResponse }) {
  const { diff, replay_receipt_id } = result
  const entriesChanged =
    diff.selected_entries.added.length + diff.selected_entries.removed.length
  const filtersChanged =
    diff.filters_applied.added.length + diff.filters_applied.removed.length

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-theme-border bg-[var(--theme-surface-1)] p-3">
      <div className="flex items-center gap-2">
        <Badge
          variant={diff.context_hash.changed ? 'warning' : 'success'}
        >
          {diff.context_hash.changed
            ? 'Output differs'
            : 'Output identical'}
        </Badge>
        <Badge variant={entriesChanged === 0 ? 'success' : 'warning'}>
          {entriesChanged === 0
            ? 'Same entries'
            : `${diff.selected_entries.added.length} added · ${diff.selected_entries.removed.length} removed`}
        </Badge>
        <Badge variant={filtersChanged === 0 ? 'success' : 'warning'}>
          {filtersChanged === 0
            ? 'Same filters'
            : `${diff.filters_applied.added.length} added · ${diff.filters_applied.removed.length} removed`}
        </Badge>
        <span className="ml-auto text-[10px] text-theme-muted">
          common: {diff.selected_entries.common}
        </span>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-y-1 gap-x-3">
        <dt className="text-theme-muted">replay receipt</dt>
        <dd className="font-mono break-anywhere">
          {replay_receipt_id ?? (
            <span className="text-theme-muted italic">
              (write failed — diff is still authoritative)
            </span>
          )}
        </dd>
        <dt className="text-theme-muted">original hash</dt>
        <dd className="font-mono break-anywhere">
          {diff.context_hash.original ?? '—'}
        </dd>
        <dt className="text-theme-muted">replay hash</dt>
        <dd className="font-mono break-anywhere">
          {diff.context_hash.replay ?? '—'}
        </dd>
      </dl>

      {diff.selected_entries.added.length > 0 && (
        <details className="text-[11px]">
          <summary className="cursor-pointer text-theme-secondary">
            Added entries ({diff.selected_entries.added.length})
          </summary>
          <ul className="mt-1 space-y-1 max-h-40 overflow-y-auto">
            {diff.selected_entries.added.map((entry, i) => (
              <li
                key={`add-${i}`}
                className="rounded border border-theme-border bg-[var(--theme-card-bg)] px-2 py-1 font-mono break-anywhere"
              >
                <Badge variant="success">added</Badge>{' '}
                <span className="text-theme-muted">{entry.type}</span>{' '}
                {entry.memory_id ?? entry.episode_id ?? '—'}
              </li>
            ))}
          </ul>
        </details>
      )}

      {diff.selected_entries.removed.length > 0 && (
        <details className="text-[11px]">
          <summary className="cursor-pointer text-theme-secondary">
            Removed entries ({diff.selected_entries.removed.length})
          </summary>
          <ul className="mt-1 space-y-1 max-h-40 overflow-y-auto">
            {diff.selected_entries.removed.map((entry, i) => (
              <li
                key={`rem-${i}`}
                className="rounded border border-theme-border bg-[var(--theme-card-bg)] px-2 py-1 font-mono break-anywhere"
              >
                <Badge variant="error">removed</Badge>{' '}
                <span className="text-theme-muted">{entry.type}</span>{' '}
                {entry.memory_id ?? entry.episode_id ?? '—'}
              </li>
            ))}
          </ul>
        </details>
      )}

      {filtersChanged > 0 && (
        <details className="text-[11px]">
          <summary className="cursor-pointer text-theme-secondary">
            Filters changed ({filtersChanged})
          </summary>
          <ul className="mt-1 space-y-1 max-h-40 overflow-y-auto">
            {diff.filters_applied.added.map((f, i) => (
              <li
                key={`f-add-${i}`}
                className="rounded border border-theme-border bg-[var(--theme-card-bg)] px-2 py-1"
              >
                <Badge variant="success">added</Badge>{' '}
                <span className="font-mono">{f.rule_id ?? '—'}</span>{' '}
                <span className="text-theme-muted">→ {f.action ?? '?'}</span>{' '}
                on {f.memory_id ?? '—'}
              </li>
            ))}
            {diff.filters_applied.removed.map((f, i) => (
              <li
                key={`f-rem-${i}`}
                className="rounded border border-theme-border bg-[var(--theme-card-bg)] px-2 py-1"
              >
                <Badge variant="error">removed</Badge>{' '}
                <span className="font-mono">{f.rule_id ?? '—'}</span>{' '}
                <span className="text-theme-muted">→ {f.action ?? '?'}</span>{' '}
                on {f.memory_id ?? '—'}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}


export function ReceiptsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const subjectFilter = searchParams.get('subject_id') ?? ''
  const tenantFilter = searchParams.get('tenant_id') ?? ''

  const [data, setData] = useState<ReceiptListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastFetched, setLastFetched] = useState<Date | null>(null)
  const [selectedReceiptId, setSelectedReceiptId] = useState<string | null>(null)
  const [selectedReceipt, setSelectedReceipt] = useState<Receipt | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [replayState, setReplayState] = useState<ReplayState>({ status: 'idle' })

  const hasFilter = Boolean(subjectFilter || tenantFilter)

  const updateParam = useCallback(
    (key: 'subject_id' | 'tenant_id', value: string | undefined) => {
      const next = new URLSearchParams(searchParams)
      if (value) next.set(key, value)
      else next.delete(key)
      setSearchParams(next)
    },
    [searchParams, setSearchParams],
  )

  const loadList = useCallback(async () => {
    if (!hasFilter) {
      setData(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const result = await fetchReceipts({
        subject_id: subjectFilter || undefined,
        tenant_id: tenantFilter || undefined,
        limit: PAGE_SIZE,
      })
      setData(result)
      setLastFetched(new Date())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load receipts')
    } finally {
      setLoading(false)
    }
  }, [hasFilter, subjectFilter, tenantFilter])

  useEffect(() => {
    // Same pattern as WebhooksPage's initial data fetch — the effect
    // is the synchronisation point between URL params and server data,
    // and the setState inside loadList() is the whole point.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadList()
  }, [loadList])

  // Detail fetch — separate from the list so opening one receipt doesn't
  // re-fetch the whole table.
  useEffect(() => {
    if (!selectedReceiptId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedReceipt(null)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDetailError(null)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setReplayState({ status: 'idle' })
      return
    }
    // New selection — clear any prior replay output so it doesn't
    // leak across receipts.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReplayState({ status: 'idle' })
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDetailLoading(true)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDetailError(null)
    fetchReceipt(selectedReceiptId)
      .then((r) => {
        if (!cancelled) setSelectedReceipt(r)
      })
      .catch((e) => {
        if (!cancelled) {
          setDetailError(
            e instanceof Error ? e.message : 'Failed to load receipt detail',
          )
        }
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedReceiptId])

  const closeDetail = () => setSelectedReceiptId(null)

  const handleReplay = useCallback(async () => {
    if (!selectedReceiptId) return
    setReplayState({ status: 'loading' })
    try {
      const result = await replayReceipt(selectedReceiptId)
      setReplayState({ status: 'ok', result })
      // The diff envelope itself is the success surface; a toast
      // keeps the modal anchored in the operator's attention.
      toast.success('Replay complete', {
        description: result.diff.context_hash.changed
          ? 'Output differs — see diff in the modal.'
          : 'Output identical to original.',
      })
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Replay failed'
      setReplayState({ status: 'error', message })
      toast.error('Replay failed', { description: message })
    }
  }, [selectedReceiptId])

  const rows = useMemo(() => data?.receipts ?? [], [data])

  return (
    <PullToRefresh onRefresh={loadList}>
      <div className="p-4 sm:p-6 max-w-7xl mx-auto">
        <PageHeader
          title="State-assembly receipts"
          description="Immutable audit artifact written each time a tenant emits one. Filter by subject or tenant to load."
          actions={
            <RefreshControl
              lastFetched={lastFetched}
              onRefresh={() => void loadList()}
              loading={loading}
            />
          }
        />

        <div className="flex flex-wrap gap-3 mb-4 items-center">
          <div className="w-64">
            <SearchInput
              value={subjectFilter}
              onChange={(v) => updateParam('subject_id', v || undefined)}
              placeholder="subject_id…"
            />
          </div>
          <div className="w-64">
            <SearchInput
              value={tenantFilter}
              onChange={(v) => updateParam('tenant_id', v || undefined)}
              placeholder="tenant_id…"
            />
          </div>
          <div className="flex-1" />
        </div>

        {/* Initial guidance — listing every receipt across every tenant by
            default would dump too much data; the admin endpoint requires at
            least one filter. */}
        {!hasFilter && (
          <EmptyState
            title="Pick a scope"
            description="Type a subject_id or tenant_id above to load receipts. Cross-fleet unscoped listing is intentionally not exposed."
          />
        )}

        {loading && !data && hasFilter && (
          <TableSkeleton
            rows={6}
            columns={8}
            columnWidths={['w-24', 'w-24', 'w-32', 'w-48', 'w-16', 'w-12', 'w-12', 'w-20']}
            ariaLabel="Loading receipts"
          />
        )}

        {error && (
          <ErrorState
            title="Failed to load receipts"
            message="The admin proxy could not return the receipts list."
            suggestion="Check that the Statewave backend is reachable and try again."
            technicalDetails={error}
            onRetry={loadList}
          />
        )}

        {!loading && !error && hasFilter && rows.length === 0 && (
          <NoResultsState
            title="No receipts found"
            filterSummary="No receipts match the current scope."
            onClearFilters={() => {
              updateParam('subject_id', undefined)
              updateParam('tenant_id', undefined)
            }}
          />
        )}

        {rows.length > 0 && (
          <div className="hidden md:block rounded-xl border border-theme-border bg-[var(--theme-card-bg)]">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-[var(--theme-surface-1)] border-b border-theme-border">
                  <tr>
                    <th className="text-left text-xs font-medium uppercase tracking-wide text-theme-muted px-4 py-2.5">ID</th>
                    <th className="text-left text-xs font-medium uppercase tracking-wide text-theme-muted px-4 py-2.5">Tenant</th>
                    <th className="text-left text-xs font-medium uppercase tracking-wide text-theme-muted px-4 py-2.5">Subject</th>
                    <th className="text-left text-xs font-medium uppercase tracking-wide text-theme-muted px-4 py-2.5">Task</th>
                    <th className="text-center text-xs font-medium uppercase tracking-wide text-theme-muted px-4 py-2.5">Mode</th>
                    <th className="text-center text-xs font-medium uppercase tracking-wide text-theme-muted px-4 py-2.5">Mems</th>
                    <th className="text-center text-xs font-medium uppercase tracking-wide text-theme-muted px-4 py-2.5">Eps</th>
                    <th className="text-right text-xs font-medium uppercase tracking-wide text-theme-muted px-4 py-2.5">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <ReceiptRow
                      key={r.receipt_id}
                      receipt={r}
                      onSelect={setSelectedReceiptId}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Mobile cards */}
        {rows.length > 0 && (
          <ul className="md:hidden space-y-3" aria-label="Receipts">
            {rows.map((r) => (
              <li
                key={r.receipt_id}
                className="rounded-xl border border-theme-border bg-[var(--theme-card-bg)] p-3"
              >
                <button
                  type="button"
                  onClick={() => setSelectedReceiptId(r.receipt_id)}
                  className="w-full text-left"
                >
                  <div className="flex items-center justify-between gap-2">
                    <CopyableMono
                      value={r.receipt_id}
                      display={`${r.receipt_id.slice(0, 12)}…`}
                      labelForA11y="receipt id"
                      maxWidthClass="max-w-full"
                    />
                    <Badge variant="muted">{r.mode}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-theme-primary break-anywhere">
                    {r.task}
                  </p>
                  <p className="mt-1 text-[11px] text-theme-muted">
                    {r.tenant_id ?? '(no tenant)'} · {r.subject_id}
                  </p>
                  <p className="mt-1 text-[11px] text-theme-muted">
                    {memoryCount(r)} mem · {episodeCount(r)} ep ·{' '}
                    {formatRelativeTime(r.created_at)}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}

        <Modal
          open={selectedReceiptId !== null}
          onClose={closeDetail}
          title="Receipt detail"
          description="Full body of the audit artifact, including selected entries and policy block."
          size="md"
        >
          {detailLoading && (
            <p className="text-xs text-theme-muted">Loading…</p>
          )}
          {detailError && (
            <p className="text-xs text-red-400 break-anywhere">{detailError}</p>
          )}
          {selectedReceipt && (
            <ReceiptDetail
              receipt={selectedReceipt}
              replayState={replayState}
              onReplay={handleReplay}
            />
          )}
          <div className="flex justify-end mt-4">
            <Button variant="ghost" size="sm" onClick={closeDetail}>
              Close
            </Button>
          </div>
        </Modal>
      </div>
    </PullToRefresh>
  )
}
