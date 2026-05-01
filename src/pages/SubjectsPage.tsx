import { useEffect, useState, useCallback } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import {
  SearchInput,
  FilterSelect,
  Pagination,
  EmptyState,
  LoadingOverlay,
  ErrorState,
  HealthBadge,
  Badge,
  Modal,
} from '../components/ui'
import {
  fetchSubjects,
  fetchTenants,
  previewBulkDelete,
  commitBulkDelete,
  type SubjectListItem,
  type SubjectListParams,
  type BulkDeletePreview,
  type BulkDeleteResult,
} from '../lib/api'

const PAGE_SIZE = 50

const healthOptions = [
  { value: 'healthy', label: 'Healthy' },
  { value: 'watch', label: 'Watch' },
  { value: 'degraded', label: 'Degraded' },
  { value: 'critical', label: 'Critical' },
]

const sortOptions = [
  { value: 'last_activity', label: 'Last activity' },
  { value: 'subject_id', label: 'Subject ID' },
  { value: 'episode_count', label: 'Episodes' },
  { value: 'memory_count', label: 'Memories' },
]

export function SubjectsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [data, setData] = useState<{ subjects: SubjectListItem[]; total: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tenantOptions, setTenantOptions] = useState<{ value: string; label: string }[]>([])
  // Bulk-delete dialog state. Two phases: filter input → preview → confirm.
  const [showBulkModal, setShowBulkModal] = useState(false)
  const [bulkPrefix, setBulkPrefix] = useState('')
  const [bulkAgeDays, setBulkAgeDays] = useState('')
  const [bulkTenant, setBulkTenant] = useState('')
  const [bulkPreview, setBulkPreview] = useState<BulkDeletePreview | null>(null)
  const [bulkPreviewing, setBulkPreviewing] = useState(false)
  const [bulkCommitting, setBulkCommitting] = useState(false)
  const [bulkError, setBulkError] = useState<string | null>(null)
  const [bulkResult, setBulkResult] = useState<BulkDeleteResult | null>(null)

  // Extract params from URL
  const search = searchParams.get('search') || ''
  const healthState = searchParams.get('health') || ''
  const tenantId = searchParams.get('tenant') || ''
  const sortBy = (searchParams.get('sort') as SubjectListParams['sort_by']) || 'last_activity'
  const page = parseInt(searchParams.get('page') || '1', 10)

  // Load available tenants on mount
  useEffect(() => {
    fetchTenants().then((tenants) => {
      setTenantOptions(tenants.map((t) => ({ value: t, label: t })))
    }).catch(() => {
      // Ignore errors loading tenants
    })
  }, [])

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
      if (!updates.page && (updates.search !== undefined || updates.health !== undefined || updates.tenant !== undefined)) {
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
      const result = await fetchSubjects({
        search: search || undefined,
        tenant_id: tenantId || undefined,
        health_state: healthState || undefined,
        sort_by: sortBy,
        sort_order: 'desc',
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      })
      setData({ subjects: result.subjects, total: result.total })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load subjects')
    } finally {
      setLoading(false)
    }
  }, [search, tenantId, healthState, sortBy, page])

  useEffect(() => {
    // Initial and reactive data fetch for subject list
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData()
  }, [loadData])

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-theme-primary">Subjects</h1>
          <p className="text-sm text-theme-muted mt-0.5">
            Browse and inspect subject memory, episodes, and health
          </p>
        </div>
        <button
          onClick={() => {
            setBulkPrefix('')
            setBulkAgeDays('')
            setBulkTenant(tenantId || '')
            setBulkPreview(null)
            setBulkResult(null)
            setBulkError(null)
            setShowBulkModal(true)
          }}
          className="text-xs px-3 py-1.5 rounded border border-red-500/30 text-red-500 hover:bg-red-500/10 transition-colors whitespace-nowrap"
          title="Filtered bulk delete with preview before commit"
        >
          Bulk delete…
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="flex-1 min-w-[200px] max-w-md">
          <SearchInput
            value={search}
            onChange={(v) => updateParams({ search: v || undefined })}
            placeholder="Search by subject ID…"
          />
        </div>
        {tenantOptions.length > 0 && (
          <div className="w-40">
            <FilterSelect
              value={tenantId}
              onChange={(v) => updateParams({ tenant: v || undefined })}
              options={tenantOptions}
              placeholder="All tenants"
              aria-label="Filter by tenant"
            />
          </div>
        )}
        <div className="w-40">
          <FilterSelect
            value={healthState}
            onChange={(v) => updateParams({ health: v || undefined })}
            options={healthOptions}
            placeholder="All health"
            aria-label="Filter by health state"
          />
        </div>
        <div className="w-44">
          <FilterSelect
            value={sortBy}
            onChange={(v) => updateParams({ sort: v })}
            options={sortOptions}
            placeholder="Sort by"
            allowClear={false}
            aria-label="Sort subjects by"
          />
        </div>
      </div>

      {/* Results */}
      {error && !data && <ErrorState message={error} onRetry={loadData} />}

      {data && data.subjects.length === 0 && (
        <EmptyState
          title="No subjects found"
          description={
            search || healthState || tenantId
              ? 'Try adjusting your search or filters'
              : 'Subjects will appear here when episodes are ingested'
          }
          action={
            (search || healthState || tenantId) && (
              <button
                onClick={() => setSearchParams(new URLSearchParams())}
                className="text-xs text-accent hover:text-accent-light"
              >
                Clear filters
              </button>
            )
          }
        />
      )}

      {data && data.subjects.length > 0 && (
        <>
          {/* Table */}
          <div className="rounded-xl border border-theme-border bg-[var(--theme-card-bg)] overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-theme-border bg-[var(--theme-surface-1)]">
                  <th className="text-left font-medium text-theme-muted px-4 py-3">Subject ID</th>
                  <th className="text-left font-medium text-theme-muted px-4 py-3">Tenant</th>
                  <th className="text-left font-medium text-theme-muted px-4 py-3">Health</th>
                  <th className="text-right font-medium text-theme-muted px-4 py-3">Memories</th>
                  <th className="text-right font-medium text-theme-muted px-4 py-3">Episodes</th>
                  <th className="text-right font-medium text-theme-muted px-4 py-3">Open</th>
                  <th className="text-left font-medium text-theme-muted px-4 py-3">Last Activity</th>
                </tr>
              </thead>
              <tbody>
                {data.subjects.map((subject) => (
                  <tr
                    key={subject.subject_id}
                    className="border-b border-theme-border/50 last:border-b-0 hover:bg-[var(--theme-surface-1)]/50 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <Link
                        to={`/subjects/${encodeURIComponent(subject.subject_id)}`}
                        className="text-theme-primary hover:text-accent font-medium transition-colors"
                      >
                        {subject.subject_id}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-theme-muted text-xs font-mono">
                        {subject.tenant_id || '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <HealthBadge state={subject.health_state} score={subject.health_score} />
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-theme-secondary">
                      {subject.memory_count.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-theme-secondary">
                      {subject.episode_count.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {subject.open_sessions > 0 ? (
                        <Badge variant="warning">{subject.open_sessions}</Badge>
                      ) : (
                        <span className="text-theme-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-theme-muted text-xs">
                      {subject.last_episode_at
                        ? new Date(subject.last_episode_at).toLocaleString()
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <Pagination
            currentPage={page}
            totalPages={totalPages}
            totalItems={data.total}
            onPageChange={(p) => updateParams({ page: String(p) })}
          />
        </>
      )}

      {/* Loading overlay for initial load and refetch */}
      {loading && <LoadingOverlay message={data ? "Loading subjects…" : "Loading subjects…"} />}

      <Modal
        open={showBulkModal}
        onClose={() => { if (!bulkCommitting && !bulkPreviewing) setShowBulkModal(false) }}
        title="Bulk delete subjects"
      >
        <div className="space-y-4 text-sm">
          {!bulkResult && (
            <>
              <p className="text-theme-muted text-xs">
                Specify at least one filter. Preview shows what will be deleted before you commit.
                Episodes, memories, and sessions for matched subjects are removed permanently.
              </p>
              <div className="grid grid-cols-1 gap-3">
                <label className="block">
                  <span className="block text-xs text-theme-muted mb-1">Subject ID prefix</span>
                  <input
                    type="text"
                    value={bulkPrefix}
                    onChange={(e) => { setBulkPrefix(e.target.value); setBulkPreview(null) }}
                    placeholder="e.g. demo_web_"
                    className="w-full px-3 py-2 text-sm font-mono rounded border border-theme-border bg-theme-surface-1 text-theme-primary focus:outline-none focus:border-accent/50"
                  />
                </label>
                <label className="block">
                  <span className="block text-xs text-theme-muted mb-1">Inactive for at least N days</span>
                  <input
                    type="number"
                    min="0"
                    value={bulkAgeDays}
                    onChange={(e) => { setBulkAgeDays(e.target.value); setBulkPreview(null) }}
                    placeholder="e.g. 30"
                    className="w-full px-3 py-2 text-sm rounded border border-theme-border bg-theme-surface-1 text-theme-primary focus:outline-none focus:border-accent/50"
                  />
                </label>
                {tenantOptions.length > 0 && (
                  <label className="block">
                    <span className="block text-xs text-theme-muted mb-1">Tenant (optional)</span>
                    <FilterSelect
                      value={bulkTenant}
                      onChange={(v) => { setBulkTenant(v); setBulkPreview(null) }}
                      options={tenantOptions}
                      placeholder="Any tenant"
                      aria-label="Filter by tenant"
                    />
                  </label>
                )}
              </div>

              {bulkPreview && (
                <div className="rounded border border-theme-border bg-theme-surface-1 p-3">
                  <div className="flex items-baseline justify-between mb-2">
                    <p className="text-sm text-theme-primary">
                      Matches: <span className="font-mono text-red-400">{bulkPreview.matched}</span>{' '}
                      subjects
                    </p>
                    <p className="text-xs text-theme-muted">
                      {bulkPreview.total_episodes} episodes · {bulkPreview.total_memories} memories
                    </p>
                  </div>
                  {bulkPreview.matched > 0 ? (
                    <div className="max-h-40 overflow-y-auto text-[11px] font-mono text-theme-secondary space-y-0.5">
                      {bulkPreview.sample.map((s) => (
                        <div key={s.subject_id} className="flex justify-between gap-3">
                          <span className="truncate">{s.subject_id}</span>
                          <span className="text-theme-muted whitespace-nowrap">
                            {s.episode_count}e / {s.memory_count}m
                          </span>
                        </div>
                      ))}
                      {bulkPreview.matched > bulkPreview.sample.length && (
                        <div className="text-theme-muted italic pt-1">
                          …and {bulkPreview.matched - bulkPreview.sample.length} more
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-theme-muted">No subjects match this filter.</p>
                  )}
                </div>
              )}

              {bulkError && <p className="text-xs text-red-400">{bulkError}</p>}

              <div className="flex justify-end gap-2 pt-1">
                <button
                  onClick={() => setShowBulkModal(false)}
                  disabled={bulkPreviewing || bulkCommitting}
                  className="px-3 py-1.5 text-xs rounded border border-theme-border text-theme-secondary hover:bg-theme-surface-1 disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    setBulkPreviewing(true)
                    setBulkError(null)
                    try {
                      const filter = {
                        subject_id_prefix: bulkPrefix || undefined,
                        older_than_days: bulkAgeDays ? Number(bulkAgeDays) : undefined,
                        tenant_id: bulkTenant || undefined,
                      }
                      const pv = await previewBulkDelete(filter)
                      setBulkPreview(pv)
                    } catch (err) {
                      setBulkError(err instanceof Error ? err.message : 'Preview failed')
                    } finally {
                      setBulkPreviewing(false)
                    }
                  }}
                  disabled={bulkPreviewing || bulkCommitting || (!bulkPrefix && !bulkAgeDays && !bulkTenant)}
                  className="px-3 py-1.5 text-xs rounded border border-theme-border text-theme-primary hover:bg-theme-surface-1 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {bulkPreviewing ? 'Previewing…' : 'Preview matches'}
                </button>
                <button
                  onClick={async () => {
                    if (!bulkPreview || bulkPreview.matched === 0) return
                    if (!window.confirm(
                      `Delete ${bulkPreview.matched} subjects (${bulkPreview.total_episodes} episodes, ${bulkPreview.total_memories} memories)? This is permanent.`
                    )) return
                    setBulkCommitting(true)
                    setBulkError(null)
                    try {
                      const filter = {
                        subject_id_prefix: bulkPrefix || undefined,
                        older_than_days: bulkAgeDays ? Number(bulkAgeDays) : undefined,
                        tenant_id: bulkTenant || undefined,
                      }
                      const result = await commitBulkDelete(filter, bulkPreview.matched)
                      setBulkResult(result)
                      // Refresh the subjects list since some are gone now
                      void loadData()
                    } catch (err) {
                      setBulkError(err instanceof Error ? err.message : 'Delete failed')
                    } finally {
                      setBulkCommitting(false)
                    }
                  }}
                  disabled={bulkCommitting || !bulkPreview || bulkPreview.matched === 0}
                  className="px-3 py-1.5 text-xs rounded bg-red-500/20 border border-red-500/40 text-red-300 hover:bg-red-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {bulkCommitting ? 'Deleting…' : `Delete ${bulkPreview?.matched ?? ''} subjects`}
                </button>
              </div>
            </>
          )}

          {bulkResult && (
            <div className="space-y-3">
              <div className="rounded border border-green-500/30 bg-green-500/10 p-3">
                <p className="text-sm text-green-400">
                  Deleted {bulkResult.deleted_subjects} subjects ·{' '}
                  {bulkResult.deleted_episodes} episodes ·{' '}
                  {bulkResult.deleted_memories} memories
                </p>
                {bulkResult.failed.length > 0 && (
                  <p className="text-xs text-red-400 mt-2">
                    Failed for {bulkResult.failed.length} subject(s):{' '}
                    <span className="font-mono">{bulkResult.failed.slice(0, 5).join(', ')}</span>
                    {bulkResult.failed.length > 5 && '…'}
                  </p>
                )}
              </div>
              <div className="flex justify-end">
                <button
                  onClick={() => setShowBulkModal(false)}
                  className="px-3 py-1.5 text-xs rounded border border-theme-border text-theme-secondary hover:bg-theme-surface-1"
                >
                  Close
                </button>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  )
}
