import { useEffect, useState, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import {
  FilterSelect,
  Pagination,
  EmptyState,
  NoResultsState,
  ErrorState,
  Badge,
  TableSkeleton,
  CopyableMono,
  Modal,
  Button,
  SearchInput,
} from '../components/ui'
import {
  fetchWebhookEvents,
  purgeWebhookEvents,
  type WebhookEventListItem,
} from '../lib/api'
import { RefreshControl } from '../components/RefreshControl'
import { PullToRefresh } from '../components/PullToRefresh'
import { PageHeader } from '../components/ui'
import { AlertTriangle, Trash2 } from 'lucide-react'

const PAGE_SIZE = 50

const statusOptions = [
  { value: 'pending', label: 'Pending' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'dead_letter', label: 'Dead Letter' },
]

const eventTypeOptions = [
  { value: 'episode.created', label: 'episode.created' },
  { value: 'memory.compiled', label: 'memory.compiled' },
  { value: 'memory.superseded', label: 'memory.superseded' },
  { value: 'subject.deleted', label: 'subject.deleted' },
]

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatRelativeTime(timestamp: string | null): string {
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

function isRetrying(event: WebhookEventListItem): boolean {
  return event.status === 'pending' && event.attempts > 0
}

function isStalled(event: WebhookEventListItem): boolean {
  if (event.status !== 'pending') return false
  if (!event.next_attempt_at) return false
  const nextAttempt = new Date(event.next_attempt_at)
  const now = new Date()
  // Stalled if next_attempt_at was more than 5 minutes ago
  return (now.getTime() - nextAttempt.getTime()) > 5 * 60 * 1000
}

// ─── Status Badge ────────────────────────────────────────────────────────────

function StatusBadge({ event }: { event: WebhookEventListItem }) {
  const stalled = isStalled(event)
  const retrying = isRetrying(event)

  const variants: Record<string, 'success' | 'warning' | 'error' | 'muted'> = {
    delivered: 'success',
    pending: 'warning',
    dead_letter: 'error',
  }

  if (stalled) {
    return (
      <span className="inline-flex items-center gap-1">
        <Badge variant="warning">{event.status}</Badge>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 font-medium">
          STALLED
        </span>
      </span>
    )
  }

  if (retrying) {
    return (
      <span className="inline-flex items-center gap-1">
        <Badge variant="warning">{event.status}</Badge>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 font-medium">
          RETRY
        </span>
      </span>
    )
  }

  return <Badge variant={variants[event.status] || 'muted'}>{event.status}</Badge>
}

// ─── Event Row ───────────────────────────────────────────────────────────────

function EventRow({ event }: { event: WebhookEventListItem }) {
  const [errorExpanded, setErrorExpanded] = useState(false)

  return (
    <tr className="border-b border-theme-border/50 last:border-0 hover:bg-[var(--theme-surface-1)]/50">
      {/* Event ID */}
      <td className="px-4 py-3">
        <CopyableMono
          value={event.id}
          display={`${event.id.slice(0, 8)}…`}
          labelForA11y="webhook event ID"
          maxWidthClass="max-w-[10ch]"
        />
      </td>

      {/* Event Type */}
      <td className="px-4 py-3">
        <code className="text-xs font-mono text-accent">{event.event}</code>
      </td>

      {/* Status */}
      <td className="px-4 py-3">
        <StatusBadge event={event} />
      </td>

      {/* Attempts */}
      <td className="px-4 py-3 text-center">
        <span className={`text-xs tabular-nums ${event.attempts >= event.max_attempts ? 'text-red-400' : 'text-theme-secondary'}`}>
          {event.attempts}/{event.max_attempts}
        </span>
      </td>

      {/* HTTP Status */}
      <td className="px-4 py-3 text-center">
        {event.http_status ? (
          <span className={`text-xs tabular-nums ${event.http_status >= 400 ? 'text-red-400' : event.http_status >= 200 && event.http_status < 300 ? 'text-emerald-400' : 'text-theme-muted'}`}>
            {event.http_status}
          </span>
        ) : (
          <span className="text-xs text-theme-muted">—</span>
        )}
      </td>

      {/* Next Retry */}
      <td className="px-4 py-3 text-right">
        <span className="text-xs text-theme-muted">
          {event.next_attempt_at ? formatRelativeTime(event.next_attempt_at) : '—'}
        </span>
      </td>

      {/* Created */}
      <td className="px-4 py-3 text-right">
        <span className="text-xs text-theme-muted">{formatRelativeTime(event.created_at)}</span>
      </td>

      {/* Error */}
      <td className="px-4 py-3">
        {event.last_error ? (
          <div>
            <button
              onClick={() => setErrorExpanded(!errorExpanded)}
              className="text-xs text-red-400 hover:text-red-300 text-left max-w-[200px]"
            >
              {errorExpanded ? event.last_error : `${event.last_error.slice(0, 50)}${event.last_error.length > 50 ? '…' : ''}`}
            </button>
          </div>
        ) : (
          <span className="text-xs text-theme-muted">—</span>
        )}
      </td>
    </tr>
  )
}

// ─── Mobile card ─────────────────────────────────────────────────────────────

/**
 * Card-shaped webhook event for narrow viewports. Same trade-off as
 * JobCard: the 8-column desktop table doesn't fit on a phone, so each
 * row gets vertical room to expose the event type, status, attempts,
 * HTTP code, and the (often long) error message.
 */
function EventCard({ event }: { event: WebhookEventListItem }) {
  const [errorExpanded, setErrorExpanded] = useState(false)
  const httpColor = event.http_status
    ? event.http_status >= 400
      ? 'text-red-400'
      : event.http_status >= 200 && event.http_status < 300
        ? 'text-emerald-400'
        : 'text-theme-muted'
    : 'text-theme-muted'
  return (
    <li className="rounded-xl border border-theme-border bg-[var(--theme-card-bg)] p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <code className="text-xs font-mono text-accent break-anywhere">{event.event}</code>
          <div className="mt-1">
            <CopyableMono
              value={event.id}
              display={`${event.id.slice(0, 12)}…`}
              labelForA11y="webhook event ID"
              maxWidthClass="max-w-full"
            />
          </div>
        </div>
        <StatusBadge event={event} />
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-md bg-[var(--theme-surface-1)] py-2">
          <dt className="text-[10px] uppercase tracking-wider text-theme-muted">Attempts</dt>
          <dd className={`text-sm font-semibold tabular-nums ${event.attempts >= event.max_attempts ? 'text-red-400' : 'text-theme-primary'}`}>
            {event.attempts}/{event.max_attempts}
          </dd>
        </div>
        <div className="rounded-md bg-[var(--theme-surface-1)] py-2">
          <dt className="text-[10px] uppercase tracking-wider text-theme-muted">HTTP</dt>
          <dd className={`text-sm font-semibold tabular-nums ${httpColor}`}>
            {event.http_status ?? '—'}
          </dd>
        </div>
        <div className="rounded-md bg-[var(--theme-surface-1)] py-2">
          <dt className="text-[10px] uppercase tracking-wider text-theme-muted">Created</dt>
          <dd className="text-xs font-medium text-theme-secondary">
            {formatRelativeTime(event.created_at)}
          </dd>
        </div>
      </dl>
      {event.next_attempt_at && (
        <p className="mt-2 text-[10px] text-theme-muted">
          Next retry: {formatRelativeTime(event.next_attempt_at)}
        </p>
      )}
      {event.last_error && (
        <button
          onClick={() => setErrorExpanded((v) => !v)}
          className="mt-2 w-full text-left text-[11px] text-red-400 hover:text-red-300 break-anywhere"
          aria-expanded={errorExpanded}
        >
          {errorExpanded ? event.last_error : `${event.last_error.slice(0, 80)}${event.last_error.length > 80 ? '…' : ''}`}
        </button>
      )}
    </li>
  )
}

// ─── Main Page ───────────────────────────────────────────────────────────────

// Statuses safe to bulk-delete. Mirrors the backend's TERMINAL_WEBHOOK_STATUSES
// — pending events may still be picked up by the delivery worker, so the UI
// hides the cleanup affordance for them.
const TERMINAL_STATUSES = new Set(['delivered', 'dead_letter'])

export function WebhooksPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [data, setData] = useState<{ events: WebhookEventListItem[]; total: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastFetched, setLastFetched] = useState<Date | null>(null)
  const [cleanupOpen, setCleanupOpen] = useState(false)
  const [cleanupRunning, setCleanupRunning] = useState(false)
  const [cleanupError, setCleanupError] = useState<string | null>(null)

  // Extract params from URL
  const statusFilter = searchParams.get('status') || ''
  const eventTypeFilter = searchParams.get('event') || ''
  const tenantFilter = searchParams.get('tenant') || ''
  const page = parseInt(searchParams.get('page') || '1', 10)

  const updateParams = useCallback(
    (updates: Record<string, string | undefined>) => {
      const newParams = new URLSearchParams(searchParams)
      Object.entries(updates).forEach(([key, value]) => {
        if (value) {
          newParams.set(key, value)
        } else {
          newParams.delete(key)
        }
      })
      // Reset to page 1 when filters change
      if (
        !updates.page &&
        (updates.status !== undefined ||
          updates.event !== undefined ||
          updates.tenant !== undefined)
      ) {
        newParams.delete('page')
      }
      setSearchParams(newParams)
    },
    [searchParams, setSearchParams]
  )

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await fetchWebhookEvents({
        status: statusFilter || undefined,
        event_type: eventTypeFilter || undefined,
        tenant_id: tenantFilter || undefined,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      })
      setData({ events: result.events, total: result.total })
      setLastFetched(new Date())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load webhook events')
    } finally {
      setLoading(false)
    }
  }, [statusFilter, eventTypeFilter, tenantFilter, page])

  useEffect(() => {
    // Initial and reactive data fetch
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData()
  }, [loadData])

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      loadData()
    }, 30000)
    return () => clearInterval(interval)
  }, [loadData])

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0

  // Count problem events
  const deadLetterCount = data?.events.filter(e => e.status === 'dead_letter').length || 0
  const stalledCount = data?.events.filter(isStalled).length || 0
  const problemCount = deadLetterCount + stalledCount

  // Cleanup is only safe for terminal statuses — `pending` retries may still
  // be in flight in the delivery worker. We require the operator to scope the
  // delete with at least one filter (status, event_type, or tenant) so an
  // empty-filter click can't wipe every delivered + dead-letter event in
  // one go. Tenant is also offered as a scope so cross-tenant purges are
  // never the "default" path.
  const cleanupStatusValid =
    !!statusFilter && TERMINAL_STATUSES.has(statusFilter)
  const cleanupEnabled =
    cleanupStatusValid || !!eventTypeFilter || !!tenantFilter
  const cleanupSummary = [
    cleanupStatusValid ? `status "${statusFilter}"` : null,
    eventTypeFilter ? `type "${eventTypeFilter}"` : null,
    tenantFilter ? `tenant "${tenantFilter}"` : null,
  ]
    .filter(Boolean)
    .join(' and ')
  const cleanupCrossTenant = cleanupEnabled && !tenantFilter

  const runCleanup = async () => {
    setCleanupRunning(true)
    setCleanupError(null)
    try {
      const { deleted } = await purgeWebhookEvents({
        status: cleanupStatusValid ? statusFilter : undefined,
        event_type: eventTypeFilter || undefined,
        tenant_id: tenantFilter || undefined,
      })
      setCleanupOpen(false)
      toast.success(
        deleted === 0
          ? 'No webhook events matched'
          : `Deleted ${deleted} webhook event${deleted === 1 ? '' : 's'}`,
        cleanupSummary ? { description: `Filter: ${cleanupSummary}` } : undefined,
      )
      await loadData()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Cleanup failed'
      setCleanupError(msg)
      toast.error('Cleanup failed', { description: msg })
    } finally {
      setCleanupRunning(false)
    }
  }

  return (
    <PullToRefresh onRefresh={loadData}>
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Webhook Events"
        description="Monitor webhook delivery and identify failures"
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="destructive"
              size="sm"
              leftIcon={<Trash2 className="h-3.5 w-3.5" />}
              disabled={!cleanupEnabled}
              onClick={() => {
                setCleanupError(null)
                setCleanupOpen(true)
              }}
              title={
                cleanupEnabled
                  ? `Delete events matching ${cleanupSummary}`
                  : 'Pick a terminal status (delivered / dead_letter) or event type to enable cleanup'
              }
            >
              Cleanup
            </Button>
            <RefreshControl
              lastFetched={lastFetched}
              onRefresh={() => void loadData()}
              loading={loading}
            />
          </div>
        }
      />

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <div className="flex-1 min-w-[200px] max-w-sm">
          <SearchInput
            value={tenantFilter}
            onChange={(v) => updateParams({ tenant: v || undefined })}
            placeholder="Filter by tenant…"
          />
        </div>

        <div className="w-40">
          <FilterSelect
            value={statusFilter}
            onChange={(v) => updateParams({ status: v || undefined })}
            options={statusOptions}
            placeholder="All statuses"
            aria-label="Filter by delivery status"
          />
        </div>

        <div className="w-44">
          <FilterSelect
            value={eventTypeFilter}
            onChange={(v) => updateParams({ event: v || undefined })}
            options={eventTypeOptions}
            placeholder="All event types"
            aria-label="Filter by event type"
          />
        </div>

        {(statusFilter || eventTypeFilter || tenantFilter) && (
          <button
            type="button"
            onClick={() => updateParams({ status: undefined, event: undefined, tenant: undefined })}
            className="text-xs text-theme-muted hover:text-theme-primary transition-colors whitespace-nowrap"
          >
            Clear filters
          </button>
        )}

        {problemCount > 0 && (
          <div className="px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 inline-flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 text-red-400" aria-hidden="true" />
            <span className="text-xs text-red-400 font-medium">
              {problemCount} problem event{problemCount > 1 ? 's' : ''} on this page
            </span>
          </div>
        )}

        <div className="flex-1" />
      </div>

      {/* Initial-load skeleton */}
      {loading && !data && (
        <TableSkeleton
          rows={6}
          columns={8}
          columnWidths={['w-20', 'w-32', 'w-20', 'w-12', 'w-12', 'w-24', 'w-24', 'w-32']}
          ariaLabel="Loading webhook events"
        />
      )}

      {/* Error */}
      {error && (
        <ErrorState
          title="Failed to load webhook events"
          message="The admin proxy could not return the webhook delivery list."
          suggestion="Check that the Statewave backend is reachable and try again."
          technicalDetails={error}
          onRetry={loadData}
        />
      )}

      {/* Empty - no data ever */}
      {!loading && !error && data?.events.length === 0 && !statusFilter && !eventTypeFilter && !tenantFilter && (
        <EmptyState
          title="No webhook events yet"
          description="Webhook delivery attempts will appear here after events are emitted."
        />
      )}

      {/* Empty - filtered results */}
      {!loading && !error && data?.events.length === 0 && (statusFilter || eventTypeFilter || tenantFilter) && (
        <NoResultsState
          title="No webhook events found"
          filterSummary={`No events matching ${cleanupSummary || 'the current filter'}`}
          onClearFilters={() => updateParams({ status: undefined, event: undefined, tenant: undefined })}
        />
      )}

      {/* Mobile cards */}
      {data && data.events.length > 0 && (
        <ul className="md:hidden space-y-3" aria-label="Webhook events">
          {data.events.map((event) => (
            <EventCard key={event.id} event={event} />
          ))}
          {totalPages > 1 && (
            <li className="pt-2">
              <Pagination
                currentPage={page}
                totalPages={totalPages}
                totalItems={data.total}
                onPageChange={(p) => updateParams({ page: p > 1 ? String(p) : undefined })}
              />
            </li>
          )}
        </ul>
      )}

      {/* Events Table (md+) */}
      {data && data.events.length > 0 && (
        <div className="hidden md:block rounded-xl border border-theme-border bg-[var(--theme-card-bg)]">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-[var(--theme-surface-1)] border-b border-theme-border">
                <tr>
                  <th className="text-left text-xs font-medium uppercase tracking-wide text-theme-muted px-4 py-2.5">ID</th>
                  <th className="text-left text-xs font-medium uppercase tracking-wide text-theme-muted px-4 py-2.5">Event Type</th>
                  <th className="text-left text-xs font-medium uppercase tracking-wide text-theme-muted px-4 py-2.5">Status</th>
                  <th className="text-center text-xs font-medium uppercase tracking-wide text-theme-muted px-4 py-2.5">Attempts</th>
                  <th className="text-center text-xs font-medium uppercase tracking-wide text-theme-muted px-4 py-2.5">HTTP</th>
                  <th className="text-right text-xs font-medium uppercase tracking-wide text-theme-muted px-4 py-2.5">Next Retry</th>
                  <th className="text-right text-xs font-medium uppercase tracking-wide text-theme-muted px-4 py-2.5">Created</th>
                  <th className="text-left text-xs font-medium uppercase tracking-wide text-theme-muted px-4 py-2.5">Error</th>
                </tr>
              </thead>
              <tbody>
                {data.events.map((event) => (
                  <EventRow key={event.id} event={event} />
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="border-t border-theme-border px-4 py-3">
              <Pagination
                currentPage={page}
                totalPages={totalPages}
                totalItems={data.total}
                onPageChange={(p) => updateParams({ page: p > 1 ? String(p) : undefined })}
              />
            </div>
          )}
        </div>
      )}

      {/* Summary */}
      {data && (
        <div className="mt-4 text-xs text-theme-muted text-right">
          Showing {data.events.length} of {data.total} events
        </div>
      )}

      <Modal
        open={cleanupOpen}
        onClose={() => {
          if (!cleanupRunning) setCleanupOpen(false)
        }}
        title="Delete webhook events?"
        description={`This permanently deletes every event matching ${cleanupSummary || 'the current filter'} across all pages, not just the rows visible here.`}
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-xs text-theme-secondary">
            Only terminal events (delivered, dead_letter) are deleted — pending
            retries are never touched. This cannot be undone.
          </p>
          {cleanupCrossTenant && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
              <AlertTriangle
                className="h-3.5 w-3.5 text-amber-400 mt-0.5 shrink-0"
                aria-hidden="true"
              />
              <p className="text-xs text-amber-300">
                No tenant filter set — this will delete events across <span className="font-semibold">every tenant</span>.
                Add a tenant filter first if you only want to scope this to one tenant.
              </p>
            </div>
          )}
          {cleanupError && (
            <p className="text-xs text-red-400 break-anywhere">{cleanupError}</p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCleanupOpen(false)}
              disabled={cleanupRunning}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              loading={cleanupRunning}
              onClick={() => void runCleanup()}
              leftIcon={<Trash2 className="h-3.5 w-3.5" />}
            >
              Delete events
            </Button>
          </div>
        </div>
      </Modal>
    </div>
    </PullToRefresh>
  )
}
