import { useEffect, useState, useCallback } from 'react'
import { useParams, Link, useSearchParams, useNavigate } from 'react-router-dom'
import { AlertTriangle, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  Tabs,
  TabPanel,
  LoadingState,
  ErrorState,
  Badge,
  HealthBadge,
  EmptyState,
  NoResultsState,
  Pagination,
  Modal,
  Button,
  Skeleton,
  CopyableMono,
  FilterChip,
  IconButton,
} from '../components/ui'
import { EpisodeDetailModal } from '../components/EpisodeDetailModal'
import { MemoryDetailModal } from '../components/MemoryDetailModal'
import { SourceEpisodesModal } from '../components/SourceEpisodesModal'
import {
  fetchSubjectDetail,
  fetchSubjectMemories,
  fetchSubjectEpisodes,
  fetchSubjectSessions,
  deleteSubject,
  type SubjectDetailResponse,
  type MemoryListItem,
  type EpisodeListItem,
  type SessionListItem,
} from '../lib/api'

const PAGE_SIZE = 50

// Valid tab values for URL persistence
const VALID_TABS = ['overview', 'memories', 'episodes', 'sessions'] as const
type TabId = (typeof VALID_TABS)[number]

export function SubjectDetailPage() {
  const { subjectId } = useParams<{ subjectId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const [detail, setDetail] = useState<SubjectDetailResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Delete-subject flow: type-to-confirm with the subject's own id as the
  // safety phrase. Native confirm() is too easy to dismiss; an explicit verbal
  // match makes accidental deletes very hard.
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deleteConfirmInput, setDeleteConfirmInput] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // URL-derived state with validation
  const urlTab = searchParams.get('tab')
  const activeTab: TabId = VALID_TABS.includes(urlTab as TabId) ? (urlTab as TabId) : 'overview'
  const sessionFilter = searchParams.get('session')
  
  // Memory tab URL state
  const memorySearch = searchParams.get('mq') ?? ''
  const memoryPage = Math.max(1, parseInt(searchParams.get('mp') ?? '1', 10))
  const memoryStatus = (['all', 'active', 'superseded'].includes(searchParams.get('ms') ?? '') 
    ? searchParams.get('ms') as 'all' | 'active' | 'superseded'
    : 'all')
  
  // Episode tab URL state
  const episodeSearch = searchParams.get('eq') ?? ''
  const episodePage = Math.max(1, parseInt(searchParams.get('ep') ?? '1', 10))

  // Update URL params helper
  const updateParams = useCallback(
    (updates: Record<string, string | null | undefined>) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        Object.entries(updates).forEach(([key, value]) => {
          if (value === null || value === undefined || value === '') {
            next.delete(key)
          } else {
            next.set(key, value)
          }
        })
        return next
      }, { replace: true })
    },
    [setSearchParams]
  )

  // Tab change handler
  const setActiveTab = useCallback(
    (tab: string) => {
      updateParams({ tab: tab === 'overview' ? null : tab })
    },
    [updateParams]
  )

  // Session filter change handler
  const setSessionFilter = useCallback(
    (sessionId: string | null) => {
      updateParams({ session: sessionId })
    },
    [updateParams]
  )

  // Memory tab state handlers
  const setMemorySearch = useCallback(
    (q: string) => updateParams({ mq: q || null, mp: null }),
    [updateParams]
  )
  const setMemoryPage = useCallback(
    (p: number) => updateParams({ mp: p > 1 ? String(p) : null }),
    [updateParams]
  )
  const setMemoryStatus = useCallback(
    (s: 'all' | 'active' | 'superseded') => updateParams({ ms: s === 'all' ? null : s, mp: null }),
    [updateParams]
  )

  // Episode tab state handlers  
  const setEpisodeSearch = useCallback(
    (q: string) => updateParams({ eq: q || null, ep: null }),
    [updateParams]
  )
  const setEpisodePage = useCallback(
    (p: number) => updateParams({ ep: p > 1 ? String(p) : null }),
    [updateParams]
  )

  // Handler to navigate to episodes tab with session filter
  const handleViewEpisodesForSession = useCallback((sessionId: string) => {
    updateParams({ tab: 'episodes', session: sessionId, ep: null })
  }, [updateParams])

  // Handler for session clicks from any tab
  const handleSessionClick = useCallback((sessionId: string) => {
    updateParams({ tab: 'episodes', session: sessionId, ep: null })
  }, [updateParams])

  const loadDetail = useCallback(async () => {
    if (!subjectId) return
    setLoading(true)
    setError(null)
    try {
      const result = await fetchSubjectDetail(subjectId)
      setDetail(result)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load subject')
    } finally {
      setLoading(false)
    }
  }, [subjectId])

  useEffect(() => {
    // Initial data fetch - legitimate async data loading pattern
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadDetail()
  }, [loadDetail])

  if (loading && !detail) {
    // Initial-load skeleton — matches the eventual header (back link,
    // title, badges, delete button) + tabs row + an overview area so the
    // page doesn't blank out and re-shape when the data arrives.
    return (
      <div className="p-4 sm:p-6 max-w-7xl mx-auto" aria-busy="true">
        <div className="mb-6">
          <Skeleton className="h-3 w-24 mb-2" />
          <div className="flex items-center gap-4">
            <Skeleton className="h-5 w-72" />
            <Skeleton className="h-5 w-16 rounded-full" />
            <div className="ml-auto" />
            <Skeleton className="h-7 w-28" />
          </div>
          <Skeleton className="h-3 w-64 mt-2" />
        </div>
        <Skeleton className="h-9 w-full mb-4 rounded-lg" />
        <div className="space-y-3">
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-32 w-full rounded-xl" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4 sm:p-6 max-w-7xl mx-auto">
        <ErrorState
          title="Failed to load subject"
          message="The admin proxy could not load this subject's overview, memories, episodes, or sessions."
          suggestion="Check that the subject id is correct and that the Statewave backend is reachable."
          technicalDetails={error}
          onRetry={loadDetail}
        />
      </div>
    )
  }

  if (!detail) return null

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'memories', label: 'Memories', count: detail.summary.memory_count },
    { id: 'episodes', label: 'Episodes', count: detail.summary.episode_count },
    { id: 'sessions', label: 'Sessions', count: detail.summary.session_count },
  ]

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      {/* Header.
          Mobile layout: back-link → title row → meta line → action row.
          The previous version put the (often long) subject id and the
          Delete button in the same flex-row with `break-all` on the id;
          at 320–390px the id collapsed to a single character per line
          while the Delete button stayed pinned right. We fix that by:
            * `break-words` (whole-token wrapping) instead of `break-all`
              (character-level) so the id wraps at underscores / dashes
              rather than mid-token,
            * truncating to 1 line on phones with the full id available
              via `title` and the dedicated copy button,
            * dropping the destructive button to its own row on phones
              so the title gets the full width. */}
      <div className="mb-6">
        <Link
          to="/subjects"
          className="text-xs text-theme-muted hover:text-theme-secondary transition-colors mb-2 inline-block"
        >
          ← Back to Subjects
        </Link>
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {/* Subject id is on a single line and horizontally scrollable
                instead of being clipped with an ellipsis — long ids
                (e.g. demo_web_<32hex>__statewave-support) are unique
                enough that the suffix matters, so swiping sideways is
                more useful than a "…" plus a hover tooltip the user
                can't easily activate on touch. The native scrollbar is
                hidden because the text + adjacent copy button are the
                affordance. */}
            <h1
              className="text-base sm:text-lg font-semibold text-theme-primary font-mono min-w-0 flex-1 whitespace-nowrap overflow-x-auto [&::-webkit-scrollbar]:hidden [scrollbar-width:none]"
              title={detail.subject_id}
            >
              {detail.subject_id}
            </h1>
            <CopyableMono
              value={detail.subject_id}
              labelForA11y="subject ID"
              display=""
              className="shrink-0"
            />
          </div>
          <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
            <HealthBadge state={detail.health?.state ?? null} score={detail.health?.score} />
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                setDeleteConfirmInput('')
                setDeleteError(null)
                setShowDeleteModal(true)
              }}
              leftIcon={<Trash2 className="h-3.5 w-3.5" aria-hidden="true" />}
              className="ml-auto sm:ml-0"
              title="Permanently delete all episodes and memories for this subject"
            >
              Delete subject
            </Button>
          </div>
        </div>
        <p className="text-xs sm:text-sm text-theme-muted mt-2 sm:mt-1 break-anywhere">
          {detail.tenant_id && (
            <>
              Tenant: <span className="font-mono">{detail.tenant_id}</span> ·{' '}
            </>
          )}
          {detail.summary.first_seen_at && (
            <>
              First seen: {new Date(detail.summary.first_seen_at).toLocaleDateString()} ·{' '}
            </>
          )}
          {detail.summary.last_activity_at && (
            <>
              Last activity: {new Date(detail.summary.last_activity_at).toLocaleString()}
            </>
          )}
        </p>
      </div>

      {/* Tabs */}
      <Tabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      {/* Tab Panels */}
      <TabPanel isActive={activeTab === 'overview'}>
        <OverviewTab detail={detail} />
      </TabPanel>
      <TabPanel isActive={activeTab === 'memories'}>
        <MemoriesTab 
          subjectId={detail.subject_id} 
          tenantId={detail.tenant_id}
          onSessionClick={handleSessionClick}
          searchQuery={memorySearch}
          onSearchChange={setMemorySearch}
          page={memoryPage}
          onPageChange={setMemoryPage}
          statusFilter={memoryStatus}
          onStatusFilterChange={setMemoryStatus}
        />
      </TabPanel>
      <TabPanel isActive={activeTab === 'episodes'}>
        <EpisodesTab 
          subjectId={detail.subject_id} 
          tenantId={detail.tenant_id}
          sessionFilter={sessionFilter}
          onSessionFilterChange={setSessionFilter}
          searchQuery={episodeSearch}
          onSearchChange={setEpisodeSearch}
          page={episodePage}
          onPageChange={setEpisodePage}
        />
      </TabPanel>
      <TabPanel isActive={activeTab === 'sessions'}>
        <SessionsTab
          subjectId={detail.subject_id}
          tenantId={detail.tenant_id}
          onViewEpisodesForSession={handleViewEpisodesForSession}
        />
      </TabPanel>

      <Modal
        open={showDeleteModal}
        onClose={() => { if (!deleting) setShowDeleteModal(false) }}
        title="Delete subject permanently"
      >
        <div className="space-y-4 text-sm">
          <p className="text-theme-primary">
            This will <strong>permanently delete</strong> all episodes and memories for{' '}
            <span className="font-mono text-red-400">{detail.subject_id}</span>. This cannot be undone.
          </p>
          <ul className="text-xs text-theme-muted list-disc pl-5 space-y-1">
            <li>{detail.summary.episode_count} episodes will be removed</li>
            <li>{detail.summary.memory_count} memories will be removed</li>
            {detail.summary.session_count > 0 && (
              <li>{detail.summary.session_count} sessions will be discarded</li>
            )}
            <li>A <code className="font-mono">subject.deleted</code> webhook will fire</li>
          </ul>
          <div>
            <label className="block text-xs text-theme-muted mb-1">
              To confirm, type the subject id:{' '}
              <span className="font-mono text-theme-secondary">{detail.subject_id}</span>
            </label>
            <input
              type="text"
              value={deleteConfirmInput}
              onChange={(e) => setDeleteConfirmInput(e.target.value)}
              autoFocus
              disabled={deleting}
              className="w-full px-3 py-2 text-sm font-mono rounded border border-theme-border bg-theme-surface-1 text-theme-primary focus:outline-none focus:border-red-500/50 disabled:opacity-60"
              placeholder={detail.subject_id}
            />
          </div>
          {deleteError && (
            <p className="text-xs text-red-400">{deleteError}</p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { if (!deleting) setShowDeleteModal(false) }}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              loading={deleting}
              disabled={deleteConfirmInput !== detail.subject_id}
              onClick={async () => {
                if (deleteConfirmInput !== detail.subject_id) return
                setDeleting(true)
                setDeleteError(null)
                try {
                  await deleteSubject(detail.subject_id, detail.tenant_id ?? undefined)
                  setShowDeleteModal(false)
                  toast.success('Subject deleted', {
                    description: detail.subject_id,
                  })
                  navigate('/subjects')
                } catch (err) {
                  const msg = err instanceof Error ? err.message : 'Delete failed'
                  setDeleteError(msg)
                  toast.error('Delete failed', { description: msg })
                } finally {
                  setDeleting(false)
                }
              }}
            >
              {deleting ? 'Deleting…' : 'Delete permanently'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

// ─── Overview Tab ────────────────────────────────────────────────────────────

function OverviewTab({ detail }: { detail: SubjectDetailResponse }) {
  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Episodes" value={detail.summary.episode_count} />
        <StatCard label="Memories" value={detail.summary.memory_count} />
        <StatCard label="Sessions" value={detail.summary.session_count} />
        <StatCard
          label="Health Score"
          value={detail.health?.score ?? '—'}
          sub={detail.health?.state}
        />
      </div>

      {/* Health Factors */}
      {detail.health && detail.health.factors.length > 0 && (
        <section>
          <h3 className="text-sm font-medium text-theme-primary mb-3">Health Factors</h3>
          <div className="rounded-xl border border-theme-border bg-[var(--theme-card-bg)] overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-theme-border bg-[var(--theme-surface-1)]">
                  <th className="text-left font-medium text-theme-muted px-4 py-2">Signal</th>
                  <th className="text-right font-medium text-theme-muted px-4 py-2">Impact</th>
                  <th className="text-left font-medium text-theme-muted px-4 py-2">Detail</th>
                </tr>
              </thead>
              <tbody>
                {detail.health.factors.map((f, i) => (
                  <tr key={i} className="border-b border-theme-border/50 last:border-0">
                    <td className="px-4 py-2 text-theme-secondary">{f.signal}</td>
                    <td className="px-4 py-2 text-right">
                      <span
                        className={`tabular-nums ${
                          f.impact > 0
                            ? 'text-emerald-400'
                            : f.impact < 0
                              ? 'text-red-400'
                              : 'text-theme-muted'
                        }`}
                      >
                        {f.impact > 0 ? '+' : ''}
                        {f.impact}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-theme-muted text-xs">{f.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* SLA Summary */}
      {detail.sla && (
        <section>
          <h3 className="text-sm font-medium text-theme-primary mb-3">SLA Metrics</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Total Sessions" value={detail.sla.total_sessions} />
            <StatCard label="Resolved" value={detail.sla.resolved_sessions} />
            <StatCard
              label="Avg First Response"
              value={
                detail.sla.avg_first_response_seconds
                  ? `${Math.round(detail.sla.avg_first_response_seconds)}s`
                  : '—'
              }
            />
            <StatCard
              label="Avg Resolution"
              value={
                detail.sla.avg_resolution_seconds
                  ? formatDuration(detail.sla.avg_resolution_seconds)
                  : '—'
              }
            />
          </div>
          {(detail.sla.first_response_breach_count > 0 ||
            detail.sla.resolution_breach_count > 0) && (
            <div className="mt-4 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
              <p className="text-xs text-amber-400">
                {detail.sla.first_response_breach_count > 0 &&
                  `${detail.sla.first_response_breach_count} first response breach(es). `}
                {detail.sla.resolution_breach_count > 0 &&
                  `${detail.sla.resolution_breach_count} resolution breach(es).`}
              </p>
            </div>
          )}
        </section>
      )}
    </div>
  )
}

// ─── Memories Tab ────────────────────────────────────────────────────────────

interface MemoriesTabProps {
  subjectId: string
  tenantId: string | null
  onSessionClick?: (sessionId: string) => void
  // URL-persisted state
  searchQuery: string
  onSearchChange: (query: string) => void
  page: number
  onPageChange: (page: number) => void
  statusFilter: 'all' | 'active' | 'superseded'
  onStatusFilterChange: (status: 'all' | 'active' | 'superseded') => void
}

function MemoriesTab({ 
  subjectId, 
  tenantId, 
  onSessionClick,
  searchQuery,
  onSearchChange,
  page,
  onPageChange,
  statusFilter,
  onStatusFilterChange,
}: MemoriesTabProps) {
  const [memories, setMemories] = useState<MemoryListItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [debouncedSearch, setDebouncedSearch] = useState(searchQuery)
  // Modal states - separate for each step in navigation
  const [detailMemory, setDetailMemory] = useState<MemoryListItem | null>(null)
  const [sourceEpisodesMemory, setSourceEpisodesMemory] = useState<MemoryListItem | null>(null)
  const [selectedEpisode, setSelectedEpisode] = useState<EpisodeListItem | null>(null)
  // Navigation context
  const [navigationContext, setNavigationContext] = useState<string | null>(null)

  // Debounce search input - update URL after delay
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery)
    }, 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

  const loadMemories = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await fetchSubjectMemories(subjectId, {
        tenant_id: tenantId ?? undefined,
        status: statusFilter,
        search: debouncedSearch || undefined,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      })
      setMemories(result.memories)
      setTotal(result.total)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load memories')
    } finally {
      setLoading(false)
    }
  }, [subjectId, tenantId, statusFilter, debouncedSearch, page])

  useEffect(() => {
    // Initial and reactive data fetch
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadMemories()
  }, [loadMemories])

  const totalPages = Math.ceil(total / PAGE_SIZE)

  if (error) {
    return (
      <ErrorState
        title="Failed to load memories"
        message="The admin proxy could not return this subject's memory list."
        suggestion="Try refreshing. If the failure persists, check the backend logs."
        technicalDetails={error}
        onRetry={loadMemories}
      />
    )
  }

  // Initial loading (no data yet)
  if (loading && memories.length === 0 && !debouncedSearch) {
    return <LoadingState rows={4} message="Loading memories…" />
  }

  if (!loading && memories.length === 0 && !debouncedSearch) {
    return (
      <EmptyState
        title="No memories compiled yet"
        description="Add episodes and run compile to generate memories for this subject."
      />
    )
  }

  return (
    <div>
      {/* Search and Filter */}
      <div className="mb-4 flex flex-col sm:flex-row gap-3">
        {/* Search input */}
        <div className="relative flex-1 max-w-sm">
          <input
            type="text"
            placeholder="Search memories…"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full px-3 py-1.5 pl-8 text-sm rounded-lg border border-theme-border bg-[var(--theme-input-bg)] text-theme-primary placeholder:text-theme-muted focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent"
          />
          <svg
            className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-theme-muted"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          {searchQuery && (
            <IconButton
              aria-label="Clear search"
              icon={<X />}
              variant="ghost"
              size="sm"
              onClick={() => onSearchChange('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2"
            />
          )}
        </div>
        {/* Status filter — pill toggles via the shared FilterChip primitive
            so all chip groups across the app stay visually identical and
            announce their pressed state consistently to assistive tech. */}
        <div
          className="flex gap-2"
          role="group"
          aria-label="Filter by memory status"
        >
          {(['all', 'active', 'superseded'] as const).map((status) => (
            <FilterChip
              key={status}
              selected={statusFilter === status}
              onClick={() => onStatusFilterChange(status)}
            >
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </FilterChip>
          ))}
        </div>
      </div>

      {/* Search results info */}
      {debouncedSearch && (
        <div className="mb-4 text-xs text-theme-muted">
          {total} result{total !== 1 ? 's' : ''} for "{debouncedSearch}"
          {total === 0 && (
            <button
              onClick={() => onSearchChange('')}
              className="ml-2 text-accent hover:text-accent-light underline underline-offset-2"
            >
              Clear search
            </button>
          )}
        </div>
      )}

      {/* Empty search results */}
      {!loading && memories.length === 0 && debouncedSearch && (
        <NoResultsState 
          title="No matches found" 
          filterSummary={`No memories match "${debouncedSearch}"`}
          onClearFilters={() => onSearchChange('')}
        />
      )}

      {/* Memories List */}
      <div className="space-y-3">
        {memories.map((memory) => (
          <div
            key={memory.id}
            className="rounded-xl border border-theme-border bg-[var(--theme-card-bg)] p-4 hover:border-theme-border-hover transition-colors cursor-pointer"
            onClick={() => {
              setDetailMemory(memory)
              setNavigationContext(null)
            }}
          >
            <div className="flex items-start justify-between gap-4 mb-2">
              <div className="flex items-center gap-2">
                <Badge variant={memory.status === 'active' ? 'success' : 'muted'}>
                  {memory.kind}
                </Badge>
                {memory.status === 'superseded' && (
                  <Badge variant="warning">superseded</Badge>
                )}
              </div>
              <span className="text-[10px] text-theme-muted font-mono">{memory.id.slice(0, 8)}</span>
            </div>
            <p className="text-sm text-theme-primary mb-2">{memory.content}</p>
            {memory.summary && (
              <p className="text-xs text-theme-muted mb-2">{memory.summary}</p>
            )}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-theme-muted">
              <span>Confidence: {(memory.confidence * 100).toFixed(0)}%</span>
              <span>Created: {new Date(memory.created_at).toLocaleString()}</span>
              {memory.source_episode_ids.length > 0 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setSourceEpisodesMemory(memory)
                  }}
                  className="text-accent hover:text-accent-light underline underline-offset-2 decoration-dashed cursor-pointer"
                >
                  {memory.source_episode_ids.length} source episode{memory.source_episode_ids.length !== 1 ? 's' : ''} →
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Pagination */}
      <Pagination
        currentPage={page}
        totalPages={totalPages}
        totalItems={total}
        onPageChange={onPageChange}
      />

      {/* Memory Detail Modal */}
      <MemoryDetailModal
        memory={detailMemory}
        subjectId={subjectId}
        tenantId={tenantId}
        fromContext={navigationContext ?? undefined}
        onClose={() => setDetailMemory(null)}
        onViewSourceEpisodes={(mem) => {
          setDetailMemory(null)
          setSourceEpisodesMemory(mem)
        }}
        onNavigateToMemory={(mem) => {
          setNavigationContext(`Memory ${detailMemory?.id.slice(0, 8)}…`)
          setDetailMemory(mem)
        }}
      />

      {/* Source Episodes Modal */}
      <SourceEpisodesModal
        memory={sourceEpisodesMemory}
        subjectId={subjectId}
        tenantId={tenantId}
        onClose={() => setSourceEpisodesMemory(null)}
        onEpisodeClick={(ep) => {
          setSourceEpisodesMemory(null)
          setSelectedEpisode(ep)
        }}
        onSessionClick={onSessionClick}
      />

      {/* Episode Detail Modal */}
      <EpisodeDetailModal
        episode={selectedEpisode}
        subjectId={subjectId}
        tenantId={tenantId}
        onClose={() => setSelectedEpisode(null)}
        onSessionClick={onSessionClick}
        onMemoryClick={(memory) => {
          setSelectedEpisode(null)
          setNavigationContext(`Episode ${selectedEpisode?.id.slice(0, 8)}…`)
          setDetailMemory(memory)
        }}
      />
    </div>
  )
}

// ─── Episodes Tab ────────────────────────────────────────────────────────────

interface EpisodesTabProps {
  subjectId: string
  tenantId: string | null
  sessionFilter?: string | null
  onSessionFilterChange?: (sessionId: string | null) => void
  // URL-persisted state
  searchQuery: string
  onSearchChange: (query: string) => void
  page: number
  onPageChange: (page: number) => void
}

function EpisodesTab({ 
  subjectId, 
  tenantId, 
  sessionFilter, 
  onSessionFilterChange,
  searchQuery,
  onSearchChange,
  page,
  onPageChange,
}: EpisodesTabProps) {
  const [episodes, setEpisodes] = useState<EpisodeListItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [debouncedSearch, setDebouncedSearch] = useState(searchQuery)
  const [selectedEpisode, setSelectedEpisode] = useState<EpisodeListItem | null>(null)
  const [selectedMemory, setSelectedMemory] = useState<MemoryListItem | null>(null)
  const [sourceEpisodesMemory, setSourceEpisodesMemory] = useState<MemoryListItem | null>(null)
  const [navigationContext, setNavigationContext] = useState<string | null>(null)

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery)
    }, 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

  const loadEpisodes = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await fetchSubjectEpisodes(subjectId, {
        tenant_id: tenantId ?? undefined,
        session_id: sessionFilter ?? undefined,
        search: debouncedSearch || undefined,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      })
      setEpisodes(result.episodes)
      setTotal(result.total)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load episodes')
    } finally {
      setLoading(false)
    }
  }, [subjectId, tenantId, sessionFilter, debouncedSearch, page])

  useEffect(() => {
    // Initial and reactive data fetch
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadEpisodes()
  }, [loadEpisodes])

  const totalPages = Math.ceil(total / PAGE_SIZE)

  if (error) {
    return (
      <ErrorState
        title="Failed to load episodes"
        message="The admin proxy could not return this subject's episode list."
        suggestion="Try refreshing. If the failure persists, check the backend logs."
        technicalDetails={error}
        onRetry={loadEpisodes}
      />
    )
  }

  // Initial loading (no data yet)
  if (loading && episodes.length === 0 && !debouncedSearch && !sessionFilter) {
    return <LoadingState rows={4} message="Loading episodes…" />
  }

  if (!loading && episodes.length === 0 && !debouncedSearch && !sessionFilter) {
    return (
      <EmptyState
        title="No episodes yet"
        description="Episodes appear as soon as the SDK ingests events for this subject."
      />
    )
  }

  // Helper to clear all filters
  const clearFilters = () => {
    onSearchChange('')
    onSessionFilterChange?.(null)
  }

  const hasActiveFilters = sessionFilter || debouncedSearch

  if (!loading && episodes.length === 0 && hasActiveFilters) {
    return (
      <NoResultsState 
        title="No episodes found" 
        filterSummary={sessionFilter ? `No episodes found for session "${sessionFilter}"` : `No episodes match "${debouncedSearch}"`}
        onClearFilters={clearFilters}
      />
    )
  }

  return (
    <div>
      {/* Search Input */}
      <div className="mb-4 flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <input
            type="text"
            placeholder="Search episodes…"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full px-3 py-1.5 pl-8 text-sm rounded-lg border border-theme-border bg-[var(--theme-input-bg)] text-theme-primary placeholder:text-theme-muted focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent"
          />
          <svg
            className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-theme-muted"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          {searchQuery && (
            <IconButton
              aria-label="Clear search"
              icon={<X />}
              variant="ghost"
              size="sm"
              onClick={() => onSearchChange('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2"
            />
          )}
        </div>
        {debouncedSearch && (
          <span className="text-xs text-theme-muted">
            {total} result{total !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Session Filter Banner */}
      {sessionFilter && (
        <div className="mb-4 p-3 rounded-lg bg-accent/5 border border-accent/20 flex items-center justify-between">
          <p className="text-xs text-accent">
            Filtered to session: <span className="font-mono">{sessionFilter}</span>
          </p>
          <button
            onClick={() => onSessionFilterChange?.(null)}
            className="text-xs text-accent hover:text-accent-light underline underline-offset-2"
          >
            Clear filter
          </button>
        </div>
      )}

      {/* Episodes Timeline */}
      <div className="space-y-2">
        {episodes.map((episode) => (
          <div
            key={episode.id}
            className="rounded-xl border border-theme-border bg-[var(--theme-card-bg)] p-4 hover:border-theme-border-hover transition-colors cursor-pointer"
            onClick={() => setSelectedEpisode(episode)}
          >
            <div className="flex items-start justify-between gap-4 mb-2">
              <div className="flex items-center gap-2">
                <Badge>{episode.type}</Badge>
                <span className="text-xs text-theme-muted">{episode.source}</span>
              </div>
              <span className="text-[10px] text-theme-muted">
                {new Date(episode.created_at).toLocaleString()}
              </span>
            </div>
            {episode.session_id && (
              <p className="text-[10px] text-theme-muted mb-2">
                Session:{' '}
                {!sessionFilter && onSessionFilterChange ? (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onSessionFilterChange(episode.session_id!)
                    }}
                    className="font-mono text-accent hover:text-accent-light underline underline-offset-2"
                  >
                    {episode.session_id}
                  </button>
                ) : (
                  <span className="font-mono">{episode.session_id}</span>
                )}
              </p>
            )}
            <details className="group" onClick={(e) => e.stopPropagation()}>
              <summary className="text-xs text-theme-muted cursor-pointer hover:text-theme-secondary">
                View payload
              </summary>
              <pre className="mt-2 p-3 rounded-lg bg-[var(--theme-surface-1)] text-xs text-theme-secondary overflow-x-auto">
                {JSON.stringify(episode.payload, null, 2)}
              </pre>
            </details>
          </div>
        ))}
      </div>

      {/* Pagination */}
      <Pagination
        currentPage={page}
        totalPages={totalPages}
        totalItems={total}
        onPageChange={onPageChange}
      />

      {/* Episode Detail Modal */}
      <EpisodeDetailModal
        episode={selectedEpisode}
        subjectId={subjectId}
        tenantId={tenantId}
        onClose={() => setSelectedEpisode(null)}
        onSessionClick={(sid) => {
          setSelectedEpisode(null)
          onSessionFilterChange?.(sid)
        }}
        onMemoryClick={(memory) => {
          setSelectedEpisode(null)
          setNavigationContext(`Episode ${selectedEpisode?.id.slice(0, 8)}…`)
          setSelectedMemory(memory)
        }}
      />

      {/* Memory Detail Modal (for reverse provenance navigation) */}
      <MemoryDetailModal
        memory={selectedMemory}
        subjectId={subjectId}
        tenantId={tenantId}
        fromContext={navigationContext ?? undefined}
        onClose={() => {
          setSelectedMemory(null)
          setNavigationContext(null)
        }}
        onViewSourceEpisodes={(mem) => {
          setSelectedMemory(null)
          setSourceEpisodesMemory(mem)
        }}
        onNavigateToMemory={(mem) => {
          setNavigationContext(`Memory ${selectedMemory?.id.slice(0, 8)}…`)
          setSelectedMemory(mem)
        }}
      />

      {/* Source Episodes Modal (from memory navigation) */}
      <SourceEpisodesModal
        memory={sourceEpisodesMemory}
        subjectId={subjectId}
        tenantId={tenantId}
        onClose={() => setSourceEpisodesMemory(null)}
        onEpisodeClick={(ep) => {
          setSourceEpisodesMemory(null)
          setSelectedEpisode(ep)
        }}
        onSessionClick={(sid) => {
          setSourceEpisodesMemory(null)
          onSessionFilterChange?.(sid)
        }}
      />
    </div>
  )
}

// ─── Sessions Tab ────────────────────────────────────────────────────────────

interface SessionsTabProps {
  subjectId: string
  tenantId: string | null
  onViewEpisodesForSession?: (sessionId: string) => void
}

function SessionsTab({ subjectId, tenantId, onViewEpisodesForSession }: SessionsTabProps) {
  const [sessions, setSessions] = useState<SessionListItem[]>([])
  const [stats, setStats] = useState<{ total: number; resolved: number; open: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadSessions = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await fetchSubjectSessions(subjectId, tenantId ?? undefined)
      setSessions(result.sessions)
      setStats({
        total: result.total_sessions,
        resolved: result.resolved_sessions,
        open: result.open_sessions,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load sessions')
    } finally {
      setLoading(false)
    }
  }, [subjectId, tenantId])

  useEffect(() => {
    // Initial data fetch
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadSessions()
  }, [loadSessions])

  if (error) {
    return (
      <ErrorState
        title="Failed to load sessions"
        message="The admin proxy could not return this subject's session list."
        suggestion="Try refreshing. If the failure persists, check the backend logs."
        technicalDetails={error}
        onRetry={loadSessions}
      />
    )
  }

  // Initial loading
  if (loading && sessions.length === 0) {
    return <LoadingState rows={3} message="Loading sessions…" />
  }

  if (!loading && sessions.length === 0) {
    return (
      <EmptyState
        title="No sessions yet"
        description="Sessions appear when conversations group multiple episodes together for this subject."
      />
    )
  }

  return (
    <div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <StatCard label="Total Sessions" value={stats.total} />
          <StatCard label="Resolved" value={stats.resolved} />
          <StatCard label="Open" value={stats.open} />
          <StatCard
            label="Resolution Rate"
            value={stats.total > 0 ? `${Math.round((stats.resolved / stats.total) * 100)}%` : '—'}
          />
        </div>
      )}

      {/* Sessions List */}
      <div className="space-y-2">
        {sessions.map((session) => (
          <div
            key={session.session_id}
            className="rounded-xl border border-theme-border bg-[var(--theme-card-bg)] p-4"
          >
            <div className="flex items-start justify-between gap-4 mb-3">
              <div className="flex items-center gap-2">
                <Badge variant={session.status === 'resolved' ? 'success' : 'muted'}>
                  {session.status}
                </Badge>
                <span className="text-xs font-mono text-theme-secondary">{session.session_id}</span>
              </div>
              <div className="flex items-center gap-3">
                <Link
                  to={`/subjects/${subjectId}/sessions/${session.session_id}/timeline${tenantId ? `?tenant_id=${tenantId}` : ''}`}
                  className="text-[10px] text-accent hover:text-accent-light underline underline-offset-2"
                >
                  View timeline →
                </Link>
                {onViewEpisodesForSession && (
                  <button
                    onClick={() => onViewEpisodesForSession(session.session_id)}
                    className="text-[10px] text-theme-muted hover:text-theme-secondary underline underline-offset-2"
                  >
                    Filter episodes
                  </button>
                )}
              </div>
            </div>

            {/* Timeline */}
            <div className="flex items-center gap-2 text-[10px] text-theme-muted mb-3">
              <span>Started: {new Date(session.first_message_at).toLocaleString()}</span>
              {session.resolved_at && (
                <>
                  <span>•</span>
                  <span>Resolved: {new Date(session.resolved_at).toLocaleString()}</span>
                </>
              )}
            </div>

            {/* Metrics */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[10px]">
              <div>
                <p className="text-theme-muted mb-0.5">First Response</p>
                <p className={`font-medium ${session.first_response_breached ? 'text-red-400' : 'text-theme-secondary'}`}>
                  {session.first_response_seconds != null
                    ? formatDuration(session.first_response_seconds)
                    : '—'}
                  {session.first_response_breached && <AlertTriangle className='inline h-3 w-3 ml-1' aria-label='SLA breached' />}
                </p>
              </div>
              <div>
                <p className="text-theme-muted mb-0.5">Resolution Time</p>
                <p className={`font-medium ${session.resolution_breached ? 'text-red-400' : 'text-theme-secondary'}`}>
                  {session.resolution_seconds != null
                    ? formatDuration(session.resolution_seconds)
                    : session.open_duration_seconds != null
                      ? `${formatDuration(session.open_duration_seconds)} (open)`
                      : '—'}
                  {session.resolution_breached && <AlertTriangle className='inline h-3 w-3 ml-1' aria-label='SLA breached' />}
                </p>
              </div>
              {session.first_response_at && (
                <div className="md:col-span-2">
                  <p className="text-theme-muted mb-0.5">First Response At</p>
                  <p className="text-theme-secondary">
                    {new Date(session.first_response_at).toLocaleString()}
                  </p>
                </div>
              )}
            </div>

            {/* Breach Warning */}
            {(session.first_response_breached || session.resolution_breached) && (
              <div className="mt-3 p-2 rounded-lg bg-amber-500/5 border border-amber-500/20">
                <p className="text-[10px] text-amber-400">
                  {session.first_response_breached && 'First response SLA breached. '}
                  {session.resolution_breached && 'Resolution SLA breached.'}
                </p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-xl border border-theme-border bg-[var(--theme-card-bg)] p-4">
      <p className="text-[10px] font-medium text-theme-muted uppercase tracking-wide mb-1">
        {label}
      </p>
      <p className="text-xl font-semibold text-theme-primary tabular-nums">
        {typeof value === 'number' ? value.toLocaleString() : value}
      </p>
      {sub && <p className="text-xs text-theme-muted mt-0.5 capitalize">{sub}</p>}
    </div>
  )
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  return `${(seconds / 3600).toFixed(1)}h`
}
