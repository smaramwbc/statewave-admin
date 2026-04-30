import { useEffect, useState, useCallback } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import {
  FilterSelect,
  Pagination,
  EmptyState,
  NoResultsState,
  LoadingOverlay,
  ErrorState,
  Badge,
} from '../components/ui'
import { fetchCompileJobs, type CompileJobListItem } from '../lib/api'

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
        <code className="text-xs font-mono text-theme-secondary">{job.job_id}</code>
      </td>

      {/* Subject */}
      <td className="px-4 py-3">
        <Link
          to={`/subjects/${encodeURIComponent(job.subject_id)}`}
          className="text-xs font-mono text-accent hover:text-accent-light hover:underline underline-offset-2"
        >
          {job.subject_id.length > 30 ? `${job.subject_id.slice(0, 30)}…` : job.subject_id}
        </Link>
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

// ─── Main Page ───────────────────────────────────────────────────────────────

export function JobsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [data, setData] = useState<{ jobs: CompileJobListItem[]; total: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Extract params from URL
  const statusFilter = searchParams.get('status') || ''
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
      if (!updates.page && updates.status !== undefined) {
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
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      })
      setData({ jobs: result.jobs, total: result.total })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load jobs')
    } finally {
      setLoading(false)
    }
  }, [statusFilter, page])

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

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-theme-primary">Compile Jobs</h1>
        <p className="text-sm text-theme-muted mt-0.5">
          Monitor memory compilation jobs and identify failures
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <div className="w-40">
          <FilterSelect
            value={statusFilter}
            onChange={(v) => updateParams({ status: v || undefined })}
            options={statusOptions}
            placeholder="All statuses"
            aria-label="Filter by job status"
          />
        </div>

        {stuckCount > 0 && (
          <div className="px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <span className="text-xs text-amber-400 font-medium">
              ⚠ {stuckCount} stuck job{stuckCount > 1 ? 's' : ''}
            </span>
          </div>
        )}

        <div className="flex-1" />

        <button
          onClick={() => loadData()}
          disabled={loading}
          className="px-3 py-1.5 text-xs text-theme-muted hover:text-theme-secondary border border-theme-border rounded-lg hover:bg-[var(--theme-surface-1)] transition-colors disabled:opacity-50"
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {/* Loading */}
      {loading && !data && <LoadingOverlay message="Loading jobs…" />}

      {/* Error */}
      {error && <ErrorState message={error} onRetry={loadData} />}

      {/* Empty - no data ever */}
      {!loading && !error && data?.jobs.length === 0 && !statusFilter && (
        <EmptyState
          title="No jobs found"
          description="No compile jobs recorded yet"
        />
      )}

      {/* Empty - filtered results */}
      {!loading && !error && data?.jobs.length === 0 && statusFilter && (
        <NoResultsState
          title="No jobs found"
          filterSummary={`No jobs with status "${statusFilter}"`}
          onClearFilters={() => updateParams({ status: undefined })}
        />
      )}

      {/* Jobs Table */}
      {data && data.jobs.length > 0 && (
        <div className="rounded-xl border border-theme-border bg-[var(--theme-card-bg)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-theme-border bg-[var(--theme-surface-1)]">
                  <th className="text-left font-medium text-theme-muted px-4 py-2.5 text-xs">Job ID</th>
                  <th className="text-left font-medium text-theme-muted px-4 py-2.5 text-xs">Subject</th>
                  <th className="text-left font-medium text-theme-muted px-4 py-2.5 text-xs">Status</th>
                  <th className="text-right font-medium text-theme-muted px-4 py-2.5 text-xs">Memories</th>
                  <th className="text-right font-medium text-theme-muted px-4 py-2.5 text-xs">Duration</th>
                  <th className="text-right font-medium text-theme-muted px-4 py-2.5 text-xs">Created</th>
                  <th className="text-left font-medium text-theme-muted px-4 py-2.5 text-xs">Error</th>
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
          Showing {data.jobs.length} of {data.total} jobs · Auto-refreshes every 30s
        </div>
      )}
    </div>
  )
}
