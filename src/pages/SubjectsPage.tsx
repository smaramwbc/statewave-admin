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
} from '../components/ui'
import { fetchSubjects, fetchTenants, type SubjectListItem, type SubjectListParams } from '../lib/api'

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
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-theme-primary">Subjects</h1>
        <p className="text-sm text-theme-muted mt-0.5">
          Browse and inspect subject memory, episodes, and health
        </p>
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
    </div>
  )
}
