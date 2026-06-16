import { useEffect, useState, useCallback } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
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
  fetchCompileJobs,
  purgeCompileJobs,
  type CompileJobListItem,
} from '../lib/api'
import { RefreshControl } from '../components/RefreshControl'
import { PullToRefresh } from '../components/PullToRefresh'
import { PageHeader } from '../components/ui'
import { AlertTriangle, Trash2 } from 'lucide-react'

const PAGE_SIZE = 50

const statusOptions = [
  { value: 'pending', label: 'Pending' },
  { value: 'running', label: 'Running' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
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

function formatDuration(startTime: string | null, endTime: string | null): string {
  if (!startTime) return '—'
  const start = new Date(startTime)
  const end = endTime ? new Date(endTime) : new Date()
  const diffSeconds = Math.floor((end.getTime() - start.getTime()) / 1000)

  if (diffSeconds < 1) return '<1s'
  if (diffSeconds < 60) return `${diffSeconds}s`
  if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m ${diffSeconds % 60}s`
  const hours = Math.floor(diffSeconds / 3600)
  const minutes = Math.floor((diffSeconds % 3600) / 60)
  return `${hours}h ${minutes}m`
}

function isStuck(job: CompileJobListItem): boolean {
  if (job.status !== 'running') return false
  if (!job.started_at) return false
  const started = new Date(job.started_at)
  const now = new Date()
  const diffMinutes = (now.getTime() - started.getTime()) / 1000 / 60
  return diffMinutes > 5 // Running for more than 5 minutes
}

// ─── Status Badge ────────────────────────────────────────────────────────────

function StatusBadge({ status, stuck }: { status: string; stuck?: boolean }) {
  const variants: Record<string, 'success' | 'warning' | 'error' | 'muted'> = {
    completed: 'success',
    running: 'warning',
    pending: 'muted',
    failed: 'error',
  }

  if (stuck) {
    return (
      <span className="inline-flex items-center gap-1">
        <Badge variant="warning">{status}</Badge>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 font-medium">
          STUCK
        </span>
      </span>
    )
  }

  return <Badge variant={variants[status] || 'muted'}>{status}</Badge>
}

// ─── Job Row ─────────────────────────────────────────────────────────────────

function JobRow({ job }: { job: CompileJobListItem }) {
  const stuck = isStuck(job)
  const [errorExpanded, setErrorExpanded] = useState(false)

  return (
    <tr className="border-b border-theme-border/50 last:border-0 hover:bg-[var(--theme-surface-1)]/50">
      {/* Job ID */}
      <td className="px-4 py-3">
        <CopyableMono
          value={job.job_id}
          labelForA11y="job ID"
          maxWidthClass="max-w-[14ch]"
        />
      </td>

      {/* Subject */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-1.5 min-w-0">
          <Link
            to={`/subjects/${encodeURIComponent(job.subject_id)}`}
            className="text-xs font-mono text-accent hover:text-accent-light hover:underline underline-offset-2 truncate"
            title={job.subject_id}
          >
            {job.subject_id}
          </Link>
          <CopyableMono
            value={job.subject_id}
            labelForA11y="subject ID"
            display=""
            className="shrink-0"
          />
        </div>
      </td>

      {/* Status */}
      <td className="px-4 py-3">
        <StatusBadge status={job.status} stuck={stuck} />
      </td>

      {/* Memories */}
      <td className="px-4 py-3 text-right">
        <span className="text-xs tabular-nums text-theme-secondary">
          {job.memories_created > 0 ? job.memories_created : '—'}
        </span>
      </td>

      {/* Duration */}
      <td className="px-4 py-3 text-right">
        <span className={`text-xs tabular-nums ${stuck ? 'text-amber-400' : 'text-theme-muted'}`}>
          {formatDuration(job.started_at, job.completed_at)}
        </span>
      </td>

      {/* Created */}
      <td className="px-4 py-3 text-right">
        <span className="text-xs text-theme-muted">{formatRelativeTime(job.created_at)}</span>
      </td>

      {/* Error */}
      <td className="px-4 py-3">
        {job.error ? (
          <div>
            <button
              onClick={() => setErrorExpanded(!errorExpanded)}
              className="text-xs text-red-400 hover:text-red-300 text-left max-w-[200px]"
            >
              {errorExpanded ? job.error : `${job.error.slice(0, 50)}${job.error.length > 50 ? '…' : ''}`}
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
 * Card-shaped rendering of a compile job for narrow viewports. The
 * desktop table compresses each row into one horizontal scan; on a
 * phone the same row gets the vertical breathing space it needs so the
 * job id, subject link, status badge, and stuck indicator can all
 * coexist legibly.
 */
function JobCard({ job }: { job: CompileJobListItem }) {
  const stuck = isStuck(job)
  const [errorExpanded, setErrorExpanded] = useState(false)
  // The whole card navigates to the subject detail (the most natural
  // "drill in" destination from a job). The error toggle and the copy
  // button sit on top of the card with their own click handlers and
  // stopPropagation so they don't fire the navigation.
  return (
    <li className="relative">
      <Link
        to={`/subjects/${encodeURIComponent(job.subject_id)}`}
        className="block rounded-xl border border-theme-border bg-[var(--theme-card-bg)] p-3 hover:border-accent/40 hover:bg-[var(--theme-surface-1)]/50 transition-colors focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none"
        aria-label={`Open subject ${job.subject_id}`}
      >
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-xs text-theme-primary truncate" title={job.job_id}>
              {job.job_id}
            </p>
            <div className="mt-1 flex items-center gap-1.5 min-w-0">
              <span className="text-[10px] uppercase tracking-wider text-theme-muted shrink-0">subject</span>
              <span className="text-xs font-mono text-accent truncate" title={job.subject_id}>
                {job.subject_id}
              </span>
            </div>
          </div>
          <StatusBadge status={job.status} stuck={stuck} />
        </div>
        <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-md bg-[var(--theme-surface-1)] py-2">
            <dt className="text-[10px] uppercase tracking-wider text-theme-muted">Memories</dt>
            <dd className="text-sm font-semibold text-theme-primary tabular-nums">
              {job.memories_created > 0 ? job.memories_created : '—'}
            </dd>
          </div>
          <div className="rounded-md bg-[var(--theme-surface-1)] py-2">
            <dt className="text-[10px] uppercase tracking-wider text-theme-muted">Duration</dt>
            <dd className={`text-sm font-semibold tabular-nums ${stuck ? 'text-amber-400' : 'text-theme-primary'}`}>
              {formatDuration(job.started_at, job.completed_at)}
            </dd>
          </div>
          <div className="rounded-md bg-[var(--theme-surface-1)] py-2">
            <dt className="text-[10px] uppercase tracking-wider text-theme-muted">Created</dt>
            <dd className="text-xs font-medium text-theme-secondary">
              {formatRelativeTime(job.created_at)}
            </dd>
          </div>
        </dl>
      </Link>
      {/* Out-of-link controls. Copy on the job id (top-right) and the
          error toggle (bottom). Both live outside the Link so the card
          navigation isn't accidentally fired by their clicks. */}
      <div
        className="absolute top-2.5 right-2.5 z-10"
        onClick={(e) => e.stopPropagation()}
      >
        <CopyableMono value={job.job_id} labelForA11y="job ID" display="" />
      </div>
      {job.error && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            setErrorExpanded((v) => !v)
          }}
          className="block w-full text-left text-[11px] text-red-400 hover:text-red-300 break-anywhere px-3 pb-3 -mt-1"
          aria-expanded={errorExpanded}
        >
          {errorExpanded ? job.error : `${job.error.slice(0, 80)}${job.error.length > 80 ? '…' : ''}`}
        </button>
      )}
    </li>
  )
}

// ─── Main Page ───────────────────────────────────────────────────────────────

// Statuses safe to bulk-delete. Mirrors the backend's TERMINAL_JOB_STATUSES —
// deleting `pending`/`running` rows would race the worker holding the job.
const TERMINAL_STATUSES = new Set(['completed', 'failed'])

export function JobsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [data, setData] = useState<{ jobs: CompileJobListItem[]; total: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastFetched, setLastFetched] = useState<Date | null>(null)
  const [cleanupOpen, setCleanupOpen] = useState(false)
  const [cleanupRunning, setCleanupRunning] = useState(false)
  const [cleanupError, setCleanupError] = useState<string | null>(null)

  // Extract params from URL
  const statusFilter = searchParams.get('status') || ''
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
        (updates.status !== undefined || updates.tenant !== undefined)
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
      const result = await fetchCompileJobs({
        status: statusFilter || undefined,
        tenant_id: tenantFilter || undefined,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      })
      setData({ jobs: result.jobs, total: result.total })
      setLastFetched(new Date())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load jobs')
    } finally {
      setLoading(false)
    }
  }, [statusFilter, tenantFilter, page])

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

  // Count stuck jobs
  const stuckCount = data?.jobs.filter(isStuck).length || 0

  // Cleanup is restricted to terminal statuses — deleting a running job would
  // strand the worker. We require at least one filter (status or tenant) so
  // an empty-filter click can't wipe the entire completed/failed history.
  const cleanupStatusValid =
    !!statusFilter && TERMINAL_STATUSES.has(statusFilter)
  const cleanupEnabled = cleanupStatusValid || !!tenantFilter
  const cleanupSummary = [
    cleanupStatusValid ? `status "${statusFilter}"` : null,
    tenantFilter ? `tenant "${tenantFilter}"` : null,
  ]
    .filter(Boolean)
    .join(' and ')
  const cleanupCrossTenant = cleanupEnabled && !tenantFilter

  const runCleanup = async () => {
    setCleanupRunning(true)
    setCleanupError(null)
    try {
      const { deleted } = await purgeCompileJobs({
        status: cleanupStatusValid ? statusFilter : undefined,
        tenant_id: tenantFilter || undefined,
      })
      setCleanupOpen(false)
      toast.success(
        deleted === 0
          ? 'No jobs matched'
          : `Deleted ${deleted} compile job${deleted === 1 ? '' : 's'}`,
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
        title="Compile Jobs"
        description="Monitor memory compilation jobs and identify failures"
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
                  ? `Delete jobs matching ${cleanupSummary}`
                  : 'Pick a terminal status (completed / failed) or tenant to enable cleanup'
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
            aria-label="Filter by job status"
          />
        </div>

        {(statusFilter || tenantFilter) && (
          <button
            type="button"
            onClick={() => updateParams({ status: undefined, tenant: undefined })}
            className="text-xs text-theme-muted hover:text-theme-primary transition-colors whitespace-nowrap"
          >
            Clear filters
          </button>
        )}

        {stuckCount > 0 && (
          <div className="px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 inline-flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
            <span className="text-xs text-amber-400 font-medium">
              {stuckCount} stuck job{stuckCount > 1 ? 's' : ''}
            </span>
          </div>
        )}

        <div className="flex-1" />
      </div>

      {/* Initial-load skeleton — keep current data on background refresh */}
      {loading && !data && (
        <TableSkeleton
          rows={6}
          columns={7}
          columnWidths={['w-32', 'w-40', 'w-20', 'w-12', 'w-12', 'w-20', 'w-32']}
          ariaLabel="Loading jobs"
        />
      )}

      {/* Error */}
      {error && (
        <ErrorState
          title="Failed to load jobs"
          message="The admin proxy could not return the compile-jobs list."
          suggestion="Check that the Statewave backend is reachable and try again."
          technicalDetails={error}
          onRetry={loadData}
        />
      )}

      {/* Empty - no data ever */}
      {!loading && !error && data?.jobs.length === 0 && !statusFilter && !tenantFilter && (
        <EmptyState
          title="No jobs yet"
          description="Compile, import, restore, and maintenance jobs will appear here when they run."
        />
      )}

      {/* Empty - filtered results */}
      {!loading && !error && data?.jobs.length === 0 && (statusFilter || tenantFilter) && (
        <NoResultsState
          title="No jobs found"
          filterSummary={`No jobs matching ${cleanupSummary || 'the current filter'}`}
          onClearFilters={() => updateParams({ status: undefined, tenant: undefined })}
        />
      )}

      {/* Mobile cards */}
      {data && data.jobs.length > 0 && (
        <ul className="md:hidden space-y-3" aria-label="Compile jobs">
          {data.jobs.map((job) => (
            <JobCard key={job.job_id} job={job} />
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

      {/* Jobs Table (md+) */}
      {data && data.jobs.length > 0 && (
        <div className="hidden md:block rounded-xl border border-theme-border bg-[var(--theme-card-bg)]">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-[var(--theme-surface-1)] border-b border-theme-border">
                <tr>
                  <th className="text-left text-xs font-medium uppercase tracking-wide text-theme-muted px-4 py-2.5">Job ID</th>
                  <th className="text-left text-xs font-medium uppercase tracking-wide text-theme-muted px-4 py-2.5">Subject</th>
                  <th className="text-left text-xs font-medium uppercase tracking-wide text-theme-muted px-4 py-2.5">Status</th>
                  <th className="text-right text-xs font-medium uppercase tracking-wide text-theme-muted px-4 py-2.5">Memories</th>
                  <th className="text-right text-xs font-medium uppercase tracking-wide text-theme-muted px-4 py-2.5">Duration</th>
                  <th className="text-right text-xs font-medium uppercase tracking-wide text-theme-muted px-4 py-2.5">Created</th>
                  <th className="text-left text-xs font-medium uppercase tracking-wide text-theme-muted px-4 py-2.5">Error</th>
                </tr>
              </thead>
              <tbody>
                {data.jobs.map((job) => (
                  <JobRow key={job.job_id} job={job} />
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
          Showing {data.jobs.length} of {data.total} jobs
        </div>
      )}

      <Modal
        open={cleanupOpen}
        onClose={() => {
          if (!cleanupRunning) setCleanupOpen(false)
        }}
        title="Delete compile jobs?"
        description={`This permanently deletes every job matching ${cleanupSummary || 'the current filter'} across all pages, not just the rows visible here.`}
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-xs text-theme-secondary">
            Only terminal jobs (completed, failed) are deleted — pending and
            running jobs are never touched. This cannot be undone.
          </p>
          {cleanupCrossTenant && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
              <AlertTriangle
                className="h-3.5 w-3.5 text-amber-400 mt-0.5 shrink-0"
                aria-hidden="true"
              />
              <p className="text-xs text-amber-300">
                No tenant filter set — this will delete jobs across <span className="font-semibold">every tenant</span>.
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
              Delete jobs
            </Button>
          </div>
        </div>
      </Modal>
    </div>
    </PullToRefresh>
  )
}
