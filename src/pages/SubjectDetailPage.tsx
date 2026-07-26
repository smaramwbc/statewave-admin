import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, Link, useSearchParams, useNavigate } from 'react-router'
import { AlertTriangle, Trash2, X, Search, Zap, GitBranch, Clock, Shield, ScatterChart, Receipt } from 'lucide-react'
import { toast } from 'sonner'
import { useTheme } from '../lib/theme'
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
  simulateRetrieval,
  fetchSubjectActivity,
  fetchCompilerTrace,
  fetchMemoryConflicts,
  fetchMemoryTimeline,
  runPolicySandbox,
  fetchMemoryClusters,
  fetchSubjectReceipts,
  fetchReceiptRegression,
  type SubjectDetailResponse,
  type MemoryListItem,
  type EpisodeListItem,
  type SessionListItem,
  type RetrievalSimulateResponse,
  type ActivityResponse,
  type CompilerTraceResponse,
  type ConflictsResponse,
  type MemoryTimelineEvent,
  type MemoryTimelineResponse,
  type PolicySandboxResponse,
  type MemoryClustersResponse,
  type ClusterPoint,
  type AdminReceiptListResponse,
  type RegressionResponse,
} from '../lib/api'

const PAGE_SIZE = 50

// Valid tab values for URL persistence
const VALID_TABS = ['overview', 'memories', 'episodes', 'sessions', 'retrieval', 'conflicts', 'timeline', 'policy', 'clusters', 'receipts'] as const
type TabId = (typeof VALID_TABS)[number]

// Groups collapse the 10 leaf-tab IDs into 4 top-level sections.
// The URL always stores the leaf tab ID so deep-links and browser
// history remain stable — the active group is always derived from it.
const GROUPS = [
  { id: 'overview',  label: 'Overview',  subtabs: ['overview'] as TabId[],                                            defaultTab: 'overview'  as TabId },
  { id: 'memories',  label: 'Memories',  subtabs: ['memories', 'retrieval', 'conflicts', 'timeline', 'clusters'] as TabId[], defaultTab: 'memories'  as TabId },
  { id: 'episodes',  label: 'Episodes',  subtabs: ['episodes', 'sessions'] as TabId[],                                defaultTab: 'episodes'  as TabId },
  { id: 'debug',     label: 'Debug',     subtabs: ['policy', 'receipts'] as TabId[],                                  defaultTab: 'policy'    as TabId },
] as const

type GroupId = (typeof GROUPS)[number]['id']

function tabToGroup(tab: TabId): GroupId {
  for (const g of GROUPS) {
    if ((g.subtabs as readonly TabId[]).includes(tab)) return g.id
  }
  return 'overview'
}

const SUBTAB_TOOLTIP: Partial<Record<TabId, string>> = {
  memories:  'Active and historical memories',
  retrieval: 'Test what a query would return',
  conflicts: 'Memories with contradictory content',
  timeline:  'Memory change history over time',
  clusters:  'Visual grouping by kind',
  episodes:  'Raw episode inputs',
  sessions:  'Grouped episode sessions',
  policy:    'Dry-run policy sandbox',
  receipts:  'Retrieval audit log',
}

function SubTabStrip({
  tabs,
  activeTab,
  onTabChange,
}: {
  tabs: { id: string; label: string; count?: number }[]
  activeTab: string
  onTabChange: (id: string) => void
}) {
  return (
    <div className="flex gap-1.5 mb-5 mt-1 flex-wrap">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onTabChange(t.id)}
          title={SUBTAB_TOOLTIP[t.id as TabId]}
          className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-[11px] font-medium transition-colors border ${
            activeTab === t.id
              ? 'bg-accent text-white border-accent'
              : 'bg-[var(--theme-surface-1)] text-theme-secondary hover:text-theme-primary border-theme-border'
          }`}
        >
          {t.label}
          {t.count !== undefined && t.count > 0 && (
            <span className={`tabular-nums ${activeTab === t.id ? 'text-white/80' : 'text-theme-muted'}`}>
              {t.count}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

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

  // Group tab change: navigate to the group's default sub-tab.
  // If already inside the group (e.g. on Retrieval), clicking the
  // Memories group tab does nothing — the sub-tab strip handles
  // intra-group navigation.
  const setActiveGroup = useCallback(
    (gid: string) => {
      const group = GROUPS.find((g) => g.id === gid)
      if (group && gid !== tabToGroup(
        (VALID_TABS.includes(searchParams.get('tab') as TabId)
          ? searchParams.get('tab') as TabId
          : 'overview')
      )) {
        updateParams({ tab: group.defaultTab === 'overview' ? null : group.defaultTab })
      }
    },
    [updateParams, searchParams]
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

  const activeGroup = tabToGroup(activeTab)
  const groupTabs = [
    { id: 'overview',  label: 'Overview' },
    { id: 'memories',  label: 'Memories', count: detail.summary.memory_count },
    { id: 'episodes',  label: 'Episodes', count: detail.summary.episode_count },
    { id: 'debug',     label: 'Debug' },
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

      {/* Group tabs — 4 top-level sections */}
      <Tabs tabs={groupTabs} activeTab={activeGroup} onTabChange={setActiveGroup} />

      {/* Tab Panels */}
      <TabPanel isActive={activeGroup === 'overview'}>
        <OverviewTab detail={detail} />
      </TabPanel>

      <TabPanel isActive={activeGroup === 'memories'}>
        <SubTabStrip
          tabs={[
            { id: 'memories',  label: 'Memories',  count: detail.summary.memory_count },
            { id: 'retrieval', label: 'Retrieval' },
            { id: 'conflicts', label: 'Conflicts' },
            { id: 'timeline',  label: 'Timeline' },
            { id: 'clusters',  label: 'Clusters' },
          ]}
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />
        {activeTab === 'memories' && (
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
        )}
        {activeTab === 'retrieval' && (
          <RetrievalTab subjectId={detail.subject_id} tenantId={detail.tenant_id} />
        )}
        {activeTab === 'conflicts' && (
          <ConflictsTab subjectId={detail.subject_id} tenantId={detail.tenant_id} />
        )}
        {activeTab === 'timeline' && (
          <TimelineTab subjectId={detail.subject_id} tenantId={detail.tenant_id} />
        )}
        {activeTab === 'clusters' && (
          <ClustersTab subjectId={detail.subject_id} tenantId={detail.tenant_id} />
        )}
      </TabPanel>

      <TabPanel isActive={activeGroup === 'episodes'}>
        <SubTabStrip
          tabs={[
            { id: 'episodes', label: 'Episodes', count: detail.summary.episode_count },
            { id: 'sessions', label: 'Sessions', count: detail.summary.session_count },
          ]}
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />
        {activeTab === 'episodes' && (
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
        )}
        {activeTab === 'sessions' && (
          <SessionsTab
            subjectId={detail.subject_id}
            tenantId={detail.tenant_id}
            onViewEpisodesForSession={handleViewEpisodesForSession}
          />
        )}
      </TabPanel>

      <TabPanel isActive={activeGroup === 'debug'}>
        <SubTabStrip
          tabs={[
            { id: 'policy',   label: 'Policy' },
            { id: 'receipts', label: 'Receipts' },
          ]}
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />
        {activeTab === 'policy' && (
          <PolicyTab subjectId={detail.subject_id} tenantId={detail.tenant_id} />
        )}
        {activeTab === 'receipts' && (
          <ReceiptsTab subjectId={detail.subject_id} tenantId={detail.tenant_id} />
        )}
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

      {/* Activity Heatmap */}
      <ActivityHeatmap subjectId={detail.subject_id} />

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
  const [provenanceMemory, setProvenanceMemory] = useState<MemoryListItem | null>(null)
  const [traceMemory, setTraceMemory] = useState<MemoryListItem | null>(null)
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
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setProvenanceMemory(memory)
                }}
                className="text-violet-400 hover:text-violet-300 underline underline-offset-2 decoration-dashed cursor-pointer"
              >
                Provenance →
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setTraceMemory(memory)
                }}
                className="text-sky-400 hover:text-sky-300 underline underline-offset-2 decoration-dashed cursor-pointer"
              >
                Trace →
              </button>
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

      {/* Provenance Modal */}
      {provenanceMemory && (
        <ProvenanceModal
          subjectId={subjectId}
          tenantId={tenantId}
          memoryId={provenanceMemory.id}
          onClose={() => setProvenanceMemory(null)}
        />
      )}

      {/* Compiler Trace Modal */}
      {traceMemory && (
        <CompilerTraceModal
          subjectId={subjectId}
          tenantId={tenantId}
          memoryId={traceMemory.id}
          onClose={() => setTraceMemory(null)}
        />
      )}
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
              <pre className="mt-2 p-3 rounded-lg bg-[var(--theme-surface-1)] text-xs text-theme-secondary whitespace-pre-wrap break-words">
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

// ─── Provenance Modal ─────────────────────────────────────────────────────────

function ProvenanceModal({
  subjectId,
  tenantId,
  memoryId,
  onClose,
}: {
  subjectId: string
  tenantId: string | null
  memoryId: string
  onClose: () => void
}) {
  const [data, setData] = useState<import('../lib/api').ProvenanceResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    import('../lib/api').then(({ fetchMemoryProvenance }) =>
      fetchMemoryProvenance(subjectId, memoryId, { tenantId: tenantId ?? undefined })
    ).then((r) => {
      if (!cancelled) { setData(r); setLoading(false) }
    }).catch((e) => {
      if (!cancelled) { setError(e instanceof Error ? e.message : 'Failed to load provenance'); setLoading(false) }
    })
    return () => { cancelled = true }
  }, [subjectId, memoryId, tenantId])

  return (
    <Modal open onClose={onClose} title="Memory Provenance">
      {loading && <LoadingState message="Loading provenance…" />}
      {error && (
        <div className="text-sm text-red-400 p-4">{error}</div>
      )}
      {data && (
        <div className="space-y-6 text-sm">
          {/* The memory itself */}
          <section>
            <h4 className="text-xs font-semibold text-theme-muted uppercase tracking-wide mb-2">
              Memory
            </h4>
            <div className="rounded-lg border border-violet-500/30 bg-violet-500/5 p-3 space-y-1.5">
              <div className="flex items-center gap-2">
                <Badge variant="muted">{data.memory.kind}</Badge>
                <span className="text-[10px] text-theme-muted font-mono">{data.memory.id.slice(0, 8)}</span>
                <span className="text-[10px] text-theme-muted ml-auto">
                  conf {(data.memory.confidence * 100).toFixed(0)}%
                </span>
              </div>
              <p className="text-theme-primary leading-relaxed">{data.memory.content}</p>
              {data.memory.summary && data.memory.summary !== data.memory.content && (
                <p className="text-xs text-theme-muted italic">{data.memory.summary}</p>
              )}
            </div>
          </section>

          {/* Source episodes */}
          <section>
            <h4 className="text-xs font-semibold text-theme-muted uppercase tracking-wide mb-2">
              Compiled from {data.source_episodes.length} episode{data.source_episodes.length !== 1 ? 's' : ''}
            </h4>
            {data.source_episodes.length === 0 ? (
              <p className="text-xs text-theme-muted">No source episodes recorded (pre-v0.9 memory).</p>
            ) : (
              <div className="space-y-2">
                {data.source_episodes.map((ep) => {
                  const text =
                    typeof ep.payload.text === 'string'
                      ? ep.payload.text
                      : typeof ep.payload.content === 'string'
                      ? ep.payload.content
                      : JSON.stringify(ep.payload).slice(0, 200)
                  return (
                    <div key={ep.id} className="rounded-lg border border-theme-border bg-[var(--theme-surface-1)] p-3 space-y-1">
                      <div className="flex items-center gap-2 text-[10px] text-theme-muted">
                        <span className="font-mono">{ep.id.slice(0, 8)}</span>
                        <Badge variant="muted">{ep.type}</Badge>
                        <span className="ml-auto">{new Date(ep.created_at).toLocaleString()}</span>
                      </div>
                      <p className="text-xs text-theme-secondary line-clamp-3">{text}</p>
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          {/* Sibling memories */}
          {data.sibling_memories.length > 0 && (
            <section>
              <h4 className="text-xs font-semibold text-theme-muted uppercase tracking-wide mb-2">
                {data.sibling_memories.length} sibling memor{data.sibling_memories.length !== 1 ? 'ies' : 'y'} from same source
              </h4>
              <div className="space-y-2">
                {data.sibling_memories.map((sib) => (
                  <div key={sib.id} className="rounded-lg border border-theme-border/60 bg-[var(--theme-card-bg)] p-3 space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="muted">{sib.kind}</Badge>
                      <span className="text-[10px] text-theme-muted font-mono">{sib.id.slice(0, 8)}</span>
                      {sib.status !== 'active' && <Badge variant="warning">{sib.status}</Badge>}
                    </div>
                    <p className="text-xs text-theme-secondary line-clamp-2">{sib.content}</p>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </Modal>
  )
}

// ─── Activity Heatmap (GitHub-style) ─────────────────────────────────────────

const HEATMAP_LEVELS = [
  'bg-[var(--theme-surface-1)] border border-[var(--theme-border)]/50',
  'bg-emerald-500/20',
  'bg-emerald-500/45',
  'bg-emerald-500/70',
  'bg-emerald-500',
] as const

function cellLevel(count: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (count === 0) return 0
  const pct = count / max
  if (pct < 0.15) return 1
  if (pct < 0.40) return 2
  if (pct < 0.70) return 3
  return 4
}

type HeatmapDay = { date: string; episode_count: number; memory_count: number }

function ActivityHeatmap({ subjectId }: { subjectId: string }) {
  const [activity, setActivity] = useState<ActivityResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [hoveredCell, setHoveredCell] = useState<{ day: HeatmapDay; x: number; y: number } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchSubjectActivity(subjectId, { days: 365 })
      .then((r) => { if (!cancelled) setActivity(r) })
      .catch(() => { /* non-fatal */ })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [subjectId])

  if (loading) {
    return (
      <section>
        <div className="h-4 w-48 rounded bg-theme-surface-1 animate-pulse mb-3" />
        <div className="h-[130px] rounded-xl border border-theme-border bg-[var(--theme-card-bg)] animate-pulse" />
      </section>
    )
  }

  if (!activity || !Array.isArray(activity.days) || activity.days.length === 0) return null

  const maxCount = Math.max(...activity.days.map((d) => d.episode_count), 1)
  const totalEpisodes = activity.days.reduce((s, d) => s + d.episode_count, 0)

  const days = activity.days
  const firstDay = new Date(days[0].date + 'T00:00:00Z')
  const dowOffset = firstDay.getUTCDay()
  const padded: (HeatmapDay | null)[] = [...Array(dowOffset).fill(null), ...(days as HeatmapDay[])]
  const weeks: (HeatmapDay | null)[][] = []
  for (let i = 0; i < padded.length; i += 7) weeks.push(padded.slice(i, i + 7))

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const DAYS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

  const monthLabels: (string | null)[] = weeks.map((week, wi) => {
    const first = week.find((d) => d !== null)
    if (!first) return null
    const m = new Date(first.date + 'T00:00:00Z').getUTCMonth()
    if (wi === 0) return MONTHS[m]
    const prevFirst = weeks[wi - 1].find((d) => d !== null)
    if (!prevFirst) return MONTHS[m]
    const pm = new Date(prevFirst.date + 'T00:00:00Z').getUTCMonth()
    return m !== pm ? MONTHS[m] : null
  })

  const ROW_LABELS = ['', 'Mon', '', 'Wed', '', 'Fri', '']

  function formatDate(dateStr: string): string {
    const d = new Date(dateStr + 'T00:00:00Z')
    return `${DAYS_FULL[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`
  }

  function activityLabel(lvl: 0 | 1 | 2 | 3 | 4): string {
    return ['No activity', 'Low activity', 'Some activity', 'Good activity', 'High activity'][lvl]
  }

  function handleCellEnter(e: React.MouseEvent<HTMLDivElement>, day: HeatmapDay) {
    const container = containerRef.current
    if (!container) return
    const cRect = container.getBoundingClientRect()
    const eRect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
    // Position tooltip above the cell, centred horizontally
    setHoveredCell({
      day,
      x: eRect.left - cRect.left + eRect.width / 2,
      y: eRect.top - cRect.top,
    })
  }

  return (
    <section>
      <h3 className="text-sm font-medium text-theme-primary mb-3">
        {totalEpisodes.toLocaleString()} episode{totalEpisodes !== 1 ? 's' : ''} in the last year
      </h3>
      {/* Outer wrapper: relative anchor for the tooltip (no overflow clip) */}
      <div
        ref={containerRef}
        className="relative"
        onMouseLeave={() => setHoveredCell(null)}
      >
        {/* Tooltip — lives outside the scroll container so it's never clipped */}
        {hoveredCell && (
          <div
            className="absolute z-30 pointer-events-none -translate-x-1/2 -translate-y-full rounded-lg border border-theme-border bg-[var(--theme-card-bg)] shadow-xl px-3 py-2.5 text-xs min-w-[180px]"
            style={{ left: hoveredCell.x, top: hoveredCell.y - 8 }}
          >
            <p className="font-medium text-theme-primary mb-1.5">{formatDate(hoveredCell.day.date)}</p>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-4">
                <span className="text-theme-muted">Episodes</span>
                <span className="font-medium text-theme-primary tabular-nums">{hoveredCell.day.episode_count}</span>
              </div>
              {hoveredCell.day.memory_count > 0 && (
                <div className="flex items-center justify-between gap-4">
                  <span className="text-theme-muted">Memories</span>
                  <span className="font-medium text-theme-primary tabular-nums">{hoveredCell.day.memory_count}</span>
                </div>
              )}
              {hoveredCell.day.episode_count > 0 && (
                <div className="mt-2 pt-1.5 border-t border-theme-border/50">
                  <div className="h-1.5 rounded-full bg-[var(--theme-surface-1)] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-emerald-500 transition-all"
                      style={{ width: `${Math.round((hoveredCell.day.episode_count / maxCount) * 100)}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-theme-muted mt-1">
                    {activityLabel(cellLevel(hoveredCell.day.episode_count, maxCount))}
                    {hoveredCell.day.episode_count > 1 && ` · ${((hoveredCell.day.episode_count / maxCount) * 100).toFixed(0)}% of peak`}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Inner scroll container — overflow-x only here */}
        <div className="rounded-xl border border-theme-border bg-[var(--theme-card-bg)] px-4 pt-3 pb-4 overflow-x-auto">
          <div className="flex gap-[3px] min-w-max">
            {/* Day-of-week label column */}
            <div className="flex flex-col gap-[3px] mr-1.5">
              <div className="h-4" />
              {ROW_LABELS.map((label, i) => (
                <div key={i} className="w-[11px] h-[11px] flex items-center justify-end">
                  <span className="text-[9px] text-theme-muted leading-none whitespace-nowrap -mr-0.5" style={{ minWidth: '26px', textAlign: 'right' }}>
                    {label}
                  </span>
                </div>
              ))}
            </div>

            {/* Week columns */}
            {weeks.map((week, wi) => (
              <div key={wi} className="flex flex-col gap-[3px]">
                <div className="h-4 flex items-end pb-0.5">
                  {monthLabels[wi] && (
                    <span className="text-[10px] text-theme-muted leading-none whitespace-nowrap">
                      {monthLabels[wi]}
                    </span>
                  )}
                </div>
                {week.map((day, di) =>
                  day === null ? (
                    <div key={di} className="w-[11px] h-[11px]" />
                  ) : (
                    <div
                      key={di}
                      onMouseEnter={(e) => handleCellEnter(e, day)}
                      className={`w-[11px] h-[11px] rounded-[2px] cursor-default hover:ring-1 hover:ring-emerald-500/60 hover:scale-125 transition-transform ${HEATMAP_LEVELS[cellLevel(day.episode_count, maxCount)]}`}
                    />
                  )
                )}
              </div>
            ))}
          </div>

          {/* Legend */}
          <div className="flex items-center justify-end gap-[3px] mt-3">
            <span className="text-[10px] text-theme-muted mr-1">Less</span>
            {([0, 1, 2, 3, 4] as const).map((lvl) => (
              <div key={lvl} className={`w-[11px] h-[11px] rounded-[2px] ${HEATMAP_LEVELS[lvl]}`} />
            ))}
            <span className="text-[10px] text-theme-muted ml-1">More</span>
          </div>
        </div>
      </div>
    </section>
  )
}

// ─── Retrieval Simulator Tab ──────────────────────────────────────────────────

function RetrievalTab({ subjectId, tenantId }: { subjectId: string; tenantId: string | null }) {
  const [query, setQuery] = useState('')
  const [tokenBudget, setTokenBudget] = useState(2000)
  const [limit, setLimit] = useState(15)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<RetrievalSimulateResponse | null>(null)

  async function run() {
    if (!query.trim()) return
    setLoading(true)
    try {
      const res = await simulateRetrieval(subjectId, query.trim(), {
        limit,
        tokenBudget,
        tenantId: tenantId ?? undefined,
      })
      setResult(res)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Retrieval simulation failed')
    } finally {
      setLoading(false)
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      run()
    }
  }

  return (
    <div className="space-y-5">
      {/* Explainer */}
      <div className="rounded-xl border border-theme-border bg-[var(--theme-card-bg)] p-4">
        <div className="flex gap-3 items-start">
          <Zap className="w-4 h-4 text-violet-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-theme-primary">Retrieval Simulator</p>
            <p className="text-xs text-theme-muted mt-0.5">
              Enter any query to see which memories would be recalled — ranked by semantic
              similarity — and whether each one fits inside your token budget. Useful for
              debugging &ldquo;why didn&apos;t the AI remember X?&rdquo;
            </p>
          </div>
        </div>
      </div>

      {/* Query controls */}
      <div className="rounded-xl border border-theme-border bg-[var(--theme-card-bg)] p-4 space-y-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-muted pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKey}
              placeholder="What does this user prefer for breakfast?"
              className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-theme-border bg-[var(--theme-surface-1)] text-theme-primary placeholder:text-theme-muted focus:outline-none focus:border-violet-500/50"
            />
          </div>
          <Button variant="primary" onClick={run} disabled={loading || !query.trim()}>
            {loading ? 'Simulating…' : 'Simulate'}
          </Button>
        </div>

        <div className="flex flex-wrap gap-4 text-xs text-theme-muted items-center">
          <label className="flex items-center gap-2">
            <span className="shrink-0">Token budget</span>
            <input
              type="number"
              min={100}
              max={32000}
              step={100}
              value={tokenBudget}
              onChange={(e) => setTokenBudget(Math.max(100, Math.min(32000, Number(e.target.value))))}
              className="w-20 px-2 py-1 rounded border border-theme-border bg-[var(--theme-surface-1)] text-theme-primary text-xs focus:outline-none focus:border-violet-500/50 tabular-nums"
            />
          </label>
          <label className="flex items-center gap-2">
            <span className="shrink-0">Max results</span>
            <input
              type="number"
              min={1}
              max={50}
              value={limit}
              onChange={(e) => setLimit(Math.max(1, Math.min(50, Number(e.target.value))))}
              className="w-16 px-2 py-1 rounded border border-theme-border bg-[var(--theme-surface-1)] text-theme-primary text-xs focus:outline-none focus:border-violet-500/50 tabular-nums"
            />
          </label>
        </div>
      </div>

      {/* Results */}
      {result && (
        <div className="space-y-3">
          {/* Summary bar */}
          <div className="flex flex-wrap gap-3 items-center text-xs text-theme-muted">
            {result.embedding_available ? (
              <>
                <span>
                  <strong className="text-theme-primary">{result.results.length}</strong>{' '}
                  result{result.results.length !== 1 ? 's' : ''} for{' '}
                  <em>&ldquo;{result.query}&rdquo;</em>
                </span>
                <span className="text-theme-border">|</span>
                <span>
                  <strong className="text-theme-primary tabular-nums">
                    ~{result.tokens_used.toLocaleString()}
                  </strong>{' '}
                  / {result.token_budget.toLocaleString()} tokens used
                </span>
                <span className="text-theme-border">|</span>
                <span>
                  {result.results.filter((r) => r.within_budget).length} within budget,{' '}
                  {result.results.filter((r) => !r.within_budget).length} truncated
                </span>
              </>
            ) : (
              <div className="w-full rounded-lg p-3 bg-amber-500/5 border border-amber-500/20 text-amber-400">
                {result.error}
              </div>
            )}
          </div>

          {result.embedding_available && result.results.length === 0 && (
            <div className="text-sm text-theme-muted text-center py-10">
              No active memories with embeddings found for this subject.
            </div>
          )}

          {result.results.map((item) => (
            <div
              key={item.memory_id}
              className={`rounded-xl border p-4 transition-colors ${
                item.within_budget
                  ? 'border-theme-border bg-[var(--theme-card-bg)]'
                  : 'border-theme-border/40 bg-[var(--theme-card-bg)] opacity-50'
              }`}
            >
              <div className="flex items-start gap-3">
                {/* Rank + similarity bar */}
                <div className="flex flex-col items-center gap-1.5 shrink-0 pt-0.5">
                  <span className="text-[10px] font-semibold text-theme-muted tabular-nums w-5 text-center">
                    #{item.rank}
                  </span>
                  <div className="w-1.5 rounded-full bg-theme-surface-1 overflow-hidden" style={{ height: '40px' }}>
                    <div
                      className="w-full rounded-full bg-violet-500 transition-all"
                      style={{ height: `${Math.round(item.similarity * 100)}%`, marginTop: `${100 - Math.round(item.similarity * 100)}%` }}
                    />
                  </div>
                  <span className="text-[9px] text-theme-muted tabular-nums">
                    {(item.similarity * 100).toFixed(0)}%
                  </span>
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="muted">{item.kind}</Badge>
                    {!item.within_budget && (
                      <Badge variant="warning">truncated</Badge>
                    )}
                    <span className="text-[10px] text-theme-muted font-mono">
                      ~{item.estimated_tokens} tokens
                    </span>
                    <span className="text-[10px] text-theme-muted ml-auto">
                      {new Date(item.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="text-sm text-theme-primary leading-relaxed line-clamp-3">
                    {item.content}
                  </p>
                  {item.summary && item.summary !== item.content && (
                    <p className="text-xs text-theme-muted italic line-clamp-1">{item.summary}</p>
                  )}
                  {/* Similarity score bar (horizontal) */}
                  <div className="flex items-center gap-2 pt-0.5">
                    <div className="flex-1 h-1 rounded-full bg-theme-surface-1 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-violet-500/70 transition-all"
                        style={{ width: `${Math.round(item.similarity * 100)}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-theme-muted tabular-nums w-10 text-right">
                      {item.similarity.toFixed(3)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Compiler Trace Modal ─────────────────────────────────────────────────────

function CompilerTraceModal({
  subjectId,
  tenantId,
  memoryId,
  onClose,
}: {
  subjectId: string
  tenantId: string | null
  memoryId: string
  onClose: () => void
}) {
  const [data, setData] = useState<CompilerTraceResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchCompilerTrace(subjectId, memoryId, { tenantId: tenantId ?? undefined })
      .then((r) => { if (!cancelled) { setData(r); setLoading(false) } })
      .catch((e) => { if (!cancelled) { setError(e.message); setLoading(false) } })
    return () => { cancelled = true }
  }, [subjectId, memoryId, tenantId])

  return (
    <Modal open onClose={onClose} title="Compiler Trace">
      {loading && <LoadingState rows={3} message="Loading trace…" />}
      {error && <p className="text-xs text-red-400">{error}</p>}
      {data && (
        <div className="space-y-5 text-sm">
          {/* Memory info */}
          <section className="rounded-lg border border-theme-border bg-[var(--theme-surface-1)] p-4 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="muted">{data.kind}</Badge>
              <Badge variant={data.status === 'active' ? 'success' : 'warning'}>{data.status}</Badge>
              <span className="text-[10px] text-theme-muted font-mono ml-auto">{data.memory_id.slice(0, 8)}</span>
            </div>
            <p className="text-theme-primary text-sm leading-relaxed">{data.content}</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-theme-muted pt-1 border-t border-theme-border/50">
              <span>Confidence: {(data.confidence * 100).toFixed(0)}%</span>
              <span>Created: {new Date(data.created_at).toLocaleString()}</span>
            </div>
          </section>

          {/* Compiler metadata */}
          <section>
            <h4 className="text-xs font-semibold text-theme-muted uppercase tracking-wide mb-2">
              Compiler metadata
            </h4>
            <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 p-3 space-y-1 text-xs">
              <div className="flex gap-2">
                <span className="text-theme-muted w-20 shrink-0">Compiler</span>
                <span className="text-sky-300 font-mono">{data.compiler}</span>
              </div>
              <div className="flex gap-2">
                <span className="text-theme-muted w-20 shrink-0">Model</span>
                <span className="text-sky-300 font-mono">{data.model ?? '(not recorded)'}</span>
              </div>
              <div className="flex gap-2">
                <span className="text-theme-muted w-20 shrink-0">Source eps</span>
                <span className="text-theme-secondary">{data.source_episode_count}</span>
              </div>
            </div>
          </section>

          {/* Reconstructed input */}
          <section>
            <h4 className="text-xs font-semibold text-theme-muted uppercase tracking-wide mb-2">
              Reconstructed input — {data.reconstructed_input.length} episode{data.reconstructed_input.length !== 1 ? 's' : ''}
            </h4>
            {data.reconstructed_input.length === 0 ? (
              <p className="text-xs text-theme-muted">No source episodes recorded (pre-v0.9 memory).</p>
            ) : (
              <div className="space-y-2">
                {data.reconstructed_input.map((ep) => (
                  <div key={ep.id} className="rounded-lg border border-theme-border bg-[var(--theme-card-bg)] p-3 space-y-1">
                    <div className="flex items-center gap-2 text-[10px] text-theme-muted">
                      <span className="font-mono">{ep.id.slice(0, 8)}</span>
                      <Badge variant="muted">{ep.type}</Badge>
                      <span className="text-theme-muted">{ep.source}</span>
                      <span className="ml-auto">{new Date(ep.created_at).toLocaleString()}</span>
                    </div>
                    <p className="text-xs text-theme-secondary">{ep.text_preview || '(no text content)'}</p>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </Modal>
  )
}

// ─── Conflicts Tab ────────────────────────────────────────────────────────────

function ConflictsTab({ subjectId, tenantId }: { subjectId: string; tenantId: string | null }) {
  const [threshold, setThreshold] = useState(0.85)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ConflictsResponse | null>(null)

  async function run() {
    setLoading(true)
    try {
      const res = await fetchMemoryConflicts(subjectId, {
        threshold,
        limit: 50,
        tenantId: tenantId ?? undefined,
      })
      setResult(res)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Conflict scan failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-theme-border bg-[var(--theme-card-bg)] p-4">
        <div className="flex gap-3 items-start">
          <GitBranch className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-theme-primary">Memory Conflict Detector</p>
            <p className="text-xs text-theme-muted mt-0.5">
              Scans all active memories by cosine similarity. Pairs above the threshold are potential
              duplicates or contradictions — review them to tune the compiler.
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 text-xs text-theme-muted">
          <span>Similarity threshold</span>
          <input
            type="number"
            min={0.5}
            max={1.0}
            step={0.01}
            value={threshold}
            onChange={(e) => setThreshold(parseFloat(e.target.value))}
            className="w-20 px-2 py-1 rounded border border-theme-border bg-[var(--theme-surface-1)] text-theme-primary text-xs focus:outline-none focus:border-amber-500/50 tabular-nums"
          />
        </label>
        <Button variant="primary" onClick={run} disabled={loading}>
          {loading ? 'Scanning…' : 'Scan for conflicts'}
        </Button>
      </div>

      {result && (
        <div className="space-y-3">
          <div className="flex gap-3 text-xs text-theme-muted flex-wrap">
            <span>Checked <strong className="text-theme-primary">{result.total_memories_checked}</strong> memories</span>
            <span className="text-theme-border">|</span>
            <span><strong className="text-amber-400">{result.pairs.length}</strong> pair{result.pairs.length !== 1 ? 's' : ''} above {(threshold * 100).toFixed(0)}%</span>
          </div>

          {!result.embedding_available && (
            <div className="rounded-lg p-3 bg-amber-500/5 border border-amber-500/20 text-xs text-amber-400">
              {result.error}
            </div>
          )}

          {result.pairs.length === 0 && result.embedding_available && (
            <EmptyState
              title="No conflicts found"
              description={`No memory pairs exceed ${(threshold * 100).toFixed(0)}% similarity.`}
            />
          )}

          {result.pairs.map((pair, i) => (
            <div key={i} className="rounded-xl border border-amber-500/20 bg-[var(--theme-card-bg)] p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="flex-1 h-1.5 rounded-full bg-theme-surface-1 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-amber-400 transition-all"
                    style={{ width: `${Math.round(pair.similarity * 100)}%` }}
                  />
                </div>
                <span className="text-xs font-semibold text-amber-400 tabular-nums w-12 text-right">
                  {(pair.similarity * 100).toFixed(1)}%
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="rounded-lg border border-theme-border p-3 space-y-1">
                  <div className="flex items-center gap-2">
                    <Badge variant="muted">{pair.memory_a_kind}</Badge>
                    <span className="text-[10px] text-theme-muted font-mono">{pair.memory_a_id.slice(0, 8)}</span>
                  </div>
                  <p className="text-xs text-theme-secondary">{pair.memory_a_content}</p>
                </div>
                <div className="rounded-lg border border-theme-border p-3 space-y-1">
                  <div className="flex items-center gap-2">
                    <Badge variant="muted">{pair.memory_b_kind}</Badge>
                    <span className="text-[10px] text-theme-muted font-mono">{pair.memory_b_id.slice(0, 8)}</span>
                  </div>
                  <p className="text-xs text-theme-secondary">{pair.memory_b_content}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Timeline Tab ─────────────────────────────────────────────────────────────

// ─── Timeline Strip ───────────────────────────────────────────────────────────

function TimelineStrip({
  events,
  selectedIdx,
  onSelect,
}: {
  events: MemoryTimelineEvent[]
  selectedIdx: number | null
  onSelect: (idx: number) => void
}) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)
  const [tooltipX, setTooltipX] = useState<number>(0)
  const containerRef = useRef<HTMLDivElement>(null)

  const dates = events.map((e) => new Date(e.date + 'T00:00:00Z').getTime())
  const minT = Math.min(...dates)
  const maxT = Math.max(...dates)
  const range = maxT === minT ? 1 : maxT - minT
  const maxAdded = Math.max(...events.map((e) => e.memories_added), 1)

  // Map event index → left% clamped to [3, 97] so dots don't clip the edges
  function leftPct(i: number) {
    return 3 + ((dates[i] - minT) / range) * 94
  }

  function dotRadius(ev: MemoryTimelineEvent) {
    // 5–11 px radius based on memories_added
    return 5 + Math.round((ev.memories_added / maxAdded) * 6)
  }

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  function fmtDate(s: string) {
    const d = new Date(s + 'T00:00:00Z')
    return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`
  }

  function handleDotEnter(e: React.MouseEvent<HTMLButtonElement>, idx: number) {
    const cRect = containerRef.current?.getBoundingClientRect()
    if (!cRect) return
    const dRect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setTooltipX(dRect.left - cRect.left + dRect.width / 2)
    setHoveredIdx(idx)
  }

  const hEv = hoveredIdx !== null ? events[hoveredIdx] : null

  return (
    <div ref={containerRef} className="relative select-none" style={{ height: '88px' }}>
      {/* Track line */}
      <div className="absolute left-0 right-0 top-[38px] h-px bg-theme-border" />

      {/* Dots */}
      {events.map((ev, i) => {
        const isSel = selectedIdx === i
        const isHov = hoveredIdx === i
        const r = dotRadius(ev)
        return (
          <button
            key={ev.date}
            onClick={() => onSelect(i)}
            onMouseEnter={(e) => handleDotEnter(e, i)}
            onMouseLeave={() => setHoveredIdx(null)}
            style={{
              left: `${leftPct(i)}%`,
              top: '38px',
              transform: 'translate(-50%, -50%)',
              width: r * 2,
              height: r * 2,
            }}
            className={`absolute rounded-full border-2 transition-all duration-150 focus:outline-none z-10 ${
              isSel
                ? 'bg-blue-500 border-blue-300 shadow-[0_0_12px_rgba(59,130,246,0.6)]'
                : isHov
                ? 'bg-blue-400/80 border-blue-300 scale-125'
                : 'bg-[var(--theme-card-bg)] border-blue-500/50 hover:border-blue-400 hover:bg-blue-500/15'
            }`}
          />
        )
      })}

      {/* Hover tooltip — floats above the dot */}
      {hEv && (
        <div
          className="absolute z-20 pointer-events-none -translate-x-1/2 rounded-lg border border-theme-border bg-[var(--theme-card-bg)] shadow-xl px-3 py-2 text-xs whitespace-nowrap"
          style={{ left: tooltipX, top: 0 }}
        >
          <p className="font-medium text-theme-primary">{fmtDate(hEv.date)}</p>
          <p className="text-theme-muted mt-0.5">
            +{hEv.memories_added} memor{hEv.memories_added !== 1 ? 'ies' : 'y'} · {hEv.cumulative_count} total
          </p>
        </div>
      )}

      {/* Axis labels */}
      <div className="absolute left-0 right-0 bottom-0 flex justify-between text-[10px] text-theme-muted">
        <span>{fmtDate(events[0].date)}</span>
        {events.length > 1 && <span>{fmtDate(events[events.length - 1].date)}</span>}
      </div>
    </div>
  )
}

// ─── Timeline Tab ─────────────────────────────────────────────────────────────

const TIMELINE_PAGE = 20

function TimelineTab({ subjectId, tenantId }: { subjectId: string; tenantId: string | null }) {
  const [data, setData] = useState<MemoryTimelineResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [snapshotIdx, setSnapshotIdx] = useState<number | null>(null)
  const [snapshotData, setSnapshotData] = useState<MemoryTimelineResponse | null>(null)
  const [snapshotLoading, setSnapshotLoading] = useState(false)
  const [visibleCount, setVisibleCount] = useState(TIMELINE_PAGE)
  const sentinelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchMemoryTimeline(subjectId, { tenantId: tenantId ?? undefined })
      .then((r) => { if (!cancelled) { setData(r); setLoading(false) } })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [subjectId, tenantId])

  const displayData = snapshotData ?? data

  // Reset page when the displayed snapshot changes
  useEffect(() => { setVisibleCount(TIMELINE_PAGE) }, [displayData])

  // Infinite scroll via IntersectionObserver
  useEffect(() => {
    const el = sentinelRef.current
    const total = displayData?.memories_at_snapshot.length ?? 0
    if (!el || visibleCount >= total) return
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setVisibleCount((c) => Math.min(c + TIMELINE_PAGE, total))
      },
      { rootMargin: '180px' },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [visibleCount, displayData])

  async function scrubTo(idx: number) {
    if (!data) return
    // Toggle off if same dot clicked again
    if (snapshotIdx === idx) {
      setSnapshotIdx(null)
      setSnapshotData(null)
      return
    }
    setSnapshotIdx(idx)
    const event = data.events[idx]
    if (!event) return
    setSnapshotLoading(true)
    try {
      const r = await fetchMemoryTimeline(subjectId, {
        snapshotAt: event.date + 'T23:59:59Z',
        tenantId: tenantId ?? undefined,
      })
      setSnapshotData(r)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Timeline fetch failed')
    } finally {
      setSnapshotLoading(false)
    }
  }

  if (loading) return <LoadingState rows={3} message="Loading timeline…" />

  if (!data || data.events.length === 0) {
    return <EmptyState title="No timeline data" description="No memories have been compiled yet for this subject." />
  }

  const selectedEvent = snapshotIdx !== null ? data.events[snapshotIdx] : null
  const allMemories = displayData?.memories_at_snapshot ?? []
  const visibleMemories = allMemories.slice(0, visibleCount)
  const displayLabel = selectedEvent
    ? `at ${selectedEvent.date}`
    : 'current'

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-theme-border bg-[var(--theme-card-bg)] p-4">
        <div className="flex gap-3 items-start">
          <Clock className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-theme-primary">Memory Timeline</p>
            <p className="text-xs text-theme-muted mt-0.5">
              Each dot is a compile event — size shows memories added. Click to travel back in time.
            </p>
          </div>
        </div>
      </div>

      {/* Timeline strip */}
      <div className="rounded-xl border border-theme-border bg-[var(--theme-card-bg)] px-6 pt-5 pb-4">
        <TimelineStrip events={data.events} selectedIdx={snapshotIdx} onSelect={scrubTo} />
      </div>

      {/* Memories list with infinite scroll */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <h3 className="text-sm font-medium text-theme-primary">
            Memories {displayLabel}
          </h3>
          {selectedEvent && (
            <span className="text-xs text-theme-muted">— {selectedEvent.cumulative_count} total</span>
          )}
          {snapshotIdx !== null && (
            <button
              onClick={() => { setSnapshotIdx(null); setSnapshotData(null) }}
              className="ml-auto text-xs text-accent hover:text-accent-light underline"
            >
              Reset to now
            </button>
          )}
        </div>

        {snapshotLoading ? (
          <LoadingState rows={2} message="Loading snapshot…" />
        ) : (
          <div className="space-y-2">
            {allMemories.length === 0 ? (
              <p className="text-xs text-theme-muted">No memories at this point.</p>
            ) : (
              <>
                {visibleMemories.map((m) => (
                  <div
                    key={m.id}
                    className="rounded-lg border border-theme-border bg-[var(--theme-card-bg)] p-3 space-y-1"
                  >
                    <div className="flex items-center gap-2">
                      <Badge variant={m.status === 'active' ? 'success' : 'warning'}>{m.kind}</Badge>
                      {m.status !== 'active' && <Badge variant="muted">{m.status}</Badge>}
                      <span className="text-[10px] text-theme-muted font-mono ml-auto">{m.id.slice(0, 8)}</span>
                    </div>
                    <p className="text-xs text-theme-secondary line-clamp-2">{m.content_preview}</p>
                  </div>
                ))}

                {/* Infinite scroll sentinel */}
                {visibleCount < allMemories.length && (
                  <div ref={sentinelRef} className="h-10 flex items-center justify-center">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-theme-border border-t-blue-400" />
                  </div>
                )}

                {visibleCount >= allMemories.length && allMemories.length > TIMELINE_PAGE && (
                  <p className="text-center text-[11px] text-theme-muted py-2">
                    All {allMemories.length} memories loaded
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Policy Sandbox Tab ───────────────────────────────────────────────────────

const DEFAULT_POLICY_YAML = `version: 1
metadata:
  name: sandbox-test
  description: "Test policy"
rules:
  # Deny any memory tagged with either PII label
  - id: block-pii
    when:
      memory_has_any_label: ["pii.email", "pii.phone"]
    action: deny

  # Redact only when BOTH labels are present
  - id: redact-sensitive-external
    when:
      memory_has_all_labels: ["sensitive", "external"]
    action: redact
`

function PolicyTab({ subjectId, tenantId }: { subjectId: string; tenantId: string | null }) {
  const [yaml, setYaml] = useState(DEFAULT_POLICY_YAML)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<PolicySandboxResponse | null>(null)

  async function run() {
    if (!yaml.trim()) return
    setLoading(true)
    try {
      const res = await runPolicySandbox(subjectId, yaml, { tenantId: tenantId ?? undefined })
      setResult(res)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Policy sandbox failed')
    } finally {
      setLoading(false)
    }
  }

  const actionColor = (action: string) => {
    if (action === 'allow') return 'text-emerald-400'
    if (action === 'deny') return 'text-red-400'
    return 'text-amber-400'
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-theme-border bg-[var(--theme-card-bg)] p-4">
        <div className="flex gap-3 items-start">
          <Shield className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-theme-primary">Policy Sandbox</p>
            <p className="text-xs text-theme-muted mt-0.5">
              Paste a YAML policy bundle and dry-run it against this subject's active memories.
              The live policy is never modified.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-theme-border bg-[var(--theme-card-bg)] p-4 space-y-3">
        <textarea
          value={yaml}
          onChange={(e) => setYaml(e.target.value)}
          rows={12}
          className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-theme-border bg-[var(--theme-surface-1)] text-theme-primary placeholder:text-theme-muted focus:outline-none focus:border-emerald-500/50 resize-y"
          placeholder="Paste YAML policy here…"
        />
        {/* Schema quick-reference */}
        <div className="rounded-lg bg-[var(--theme-surface-1)] border border-theme-border/50 px-3 py-2 text-[10px] text-theme-muted space-y-0.5 font-mono">
          <p className="font-sans font-medium text-theme-secondary mb-1 text-[11px]">Valid predicates inside <code className="font-mono">when:</code></p>
          <p><span className="text-blue-400">memory_has_any_label</span>: ["label-a", "label-b"]  <span className="text-theme-muted/60">— fires if any label matches</span></p>
          <p><span className="text-blue-400">memory_has_all_labels</span>: ["label-a", "label-b"]  <span className="text-theme-muted/60">— fires only if all labels match</span></p>
          <p className="pt-0.5">Actions: <span className="text-red-400">deny</span> · <span className="text-amber-400">redact</span></p>
        </div>
        <div className="flex justify-end">
          <Button variant="primary" onClick={run} disabled={loading || !yaml.trim()}>
            {loading ? 'Running…' : 'Run sandbox'}
          </Button>
        </div>
      </div>

      {result && (
        <div className="space-y-3">
          {result.error ? (
            <div className="rounded-lg p-3 bg-red-500/5 border border-red-500/20 text-xs text-red-400">
              {result.error}
            </div>
          ) : (
            <>
              <div className="flex gap-4 text-xs text-theme-muted flex-wrap">
                <span>Total: <strong className="text-theme-primary">{result.total_memories}</strong></span>
                <span className="text-theme-border">|</span>
                <span className="text-emerald-400"><strong>{result.allowed}</strong> allowed</span>
                <span className="text-red-400"><strong>{result.denied}</strong> denied</span>
                <span className="text-amber-400"><strong>{result.redacted}</strong> redacted</span>
              </div>
              <div className="space-y-2">
                {result.results.map((r) => (
                  <div
                    key={r.memory_id}
                    className={`rounded-lg border p-3 space-y-1 ${
                      r.action === 'allow'
                        ? 'border-theme-border/50 bg-[var(--theme-card-bg)]'
                        : r.action === 'deny'
                        ? 'border-red-500/20 bg-red-500/5'
                        : 'border-amber-500/20 bg-amber-500/5'
                    }`}
                  >
                    <div className="flex items-center gap-2 flex-wrap text-[10px]">
                      <Badge variant="muted">{r.kind}</Badge>
                      <span className={`font-semibold uppercase ${actionColor(r.action)}`}>{r.action}</span>
                      {r.rule_id && <span className="text-theme-muted font-mono">rule: {r.rule_id}</span>}
                      {r.matched_labels.length > 0 && (
                        <span className="text-theme-muted">labels: {r.matched_labels.join(', ')}</span>
                      )}
                      <span className="text-theme-muted font-mono ml-auto">{r.memory_id.slice(0, 8)}</span>
                    </div>
                    <p className="text-xs text-theme-secondary line-clamp-2">{r.content_preview}</p>
                    {r.sensitivity_labels.length > 0 && (
                      <div className="flex gap-1 flex-wrap">
                        {r.sensitivity_labels.map((l) => (
                          <span key={l} className="text-[9px] px-1.5 py-0.5 rounded bg-theme-surface-1 text-theme-muted font-mono">{l}</span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Clusters Tab ─────────────────────────────────────────────────────────────

// Kind → HSL config matching HeroBackground colour palette
const CLUSTER_KIND_COLOR: Record<string, { h: number; s: number }> = {
  profile_fact:    { h: 265, s: 85 },
  episode_summary: { h: 190, s: 90 },
  procedure:       { h: 160, s: 78 },
  artifact_ref:    { h: 22,  s: 92 },
}

function clusterHsl(kind: string, status: string, l: number, a: number): string {
  if (status !== 'active') return `hsla(220, 10%, 50%, ${a})`
  const c = CLUSTER_KIND_COLOR[kind] ?? { h: 265, s: 70 }
  return `hsla(${c.h}, ${c.s}%, ${l}%, ${a})`
}

function MemoryClusterCanvas({ points }: { points: ClusterPoint[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const frameRef = useRef<number>(0)
  const startTimeRef = useRef<number>(0)
  const ptRef = useRef(points)
  const startPosRef = useRef<{ x: number; y: number }[]>([])
  const hoveredIdxRef = useRef<number | null>(null)
  const isDarkRef = useRef<boolean>(false)
  const [tooltip, setTooltip] = useState<{ x: number; y: number; pt: ClusterPoint } | null>(null)
  const { resolvedTheme } = useTheme()

  useEffect(() => { isDarkRef.current = resolvedTheme === 'dark' }, [resolvedTheme])

  useEffect(() => {
    ptRef.current = points
    startPosRef.current = points.map(() => ({ x: Math.random(), y: Math.random() }))
    startTimeRef.current = 0
  }, [points])

  const draw = useCallback((time: number) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    if (startTimeRef.current === 0) startTimeRef.current = time
    const elapsed = (time - startTimeRef.current) * 0.001
    const raw = Math.min(elapsed / 1.8, 1)
    // Cubic ease-in-out
    const progress = raw < 0.5 ? 4 * raw ** 3 : 1 - (-2 * raw + 2) ** 3 / 2

    const r = canvas.getBoundingClientRect()
    const W = r.width, H = r.height
    const M = 32

    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.restore()

    const pts = ptRef.current
    const starts = startPosRef.current
    const dark = isDarkRef.current
    const hovIdx = hoveredIdxRef.current

    // Pre-compute current pixel positions for all particles
    const pos: { x: number; y: number }[] = pts.map((pt, i) => {
      const s = starts[i]
      const tx = ((pt.x + 1) / 2) * (W - M * 2) + M
      const ty = ((-pt.y + 1) / 2) * (H - M * 2) + M
      return { x: s.x * W + (tx - s.x * W) * progress, y: s.y * H + (ty - s.y * H) * progress }
    })

    // ── Pass 1: proximity edges (fade in after particles have mostly settled) ──
    if (progress > 0.55) {
      const edgeAlpha = (progress - 0.55) / 0.45  // 0→1 as progress 0.55→1
      const DIST_THRESH = Math.min(W, H) * 0.20    // ~20% of the smaller canvas dimension
      ctx.save()
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const dx = pos[i].x - pos[j].x
          const dy = pos[i].y - pos[j].y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist >= DIST_THRESH) continue
          const proximity = 1 - dist / DIST_THRESH
          const sameKind = pts[i].kind === pts[j].kind
          const bothActive = pts[i].status === 'active' && pts[j].status === 'active'
          // Same-kind active edges are coloured; cross-kind edges are neutral
          if (sameKind && bothActive) {
            ctx.strokeStyle = clusterHsl(pts[i].kind, pts[i].status, dark ? 65 : 45, proximity * edgeAlpha * 0.45)
            ctx.lineWidth = 0.9
          } else {
            const neutral = dark ? '140,150,170' : '120,130,150'
            ctx.strokeStyle = `rgba(${neutral}, ${proximity * edgeAlpha * 0.15})`
            ctx.lineWidth = 0.5
          }
          ctx.beginPath()
          ctx.moveTo(pos[i].x, pos[i].y)
          ctx.lineTo(pos[j].x, pos[j].y)
          ctx.stroke()
        }
      }
      ctx.restore()
    }

    // ── Pass 2: particles ─────────────────────────────────────────────────────
    for (let i = 0; i < pts.length; i++) {
      const pt = pts[i]
      const { x: px, y: py } = pos[i]

      const isHov = hovIdx === i
      const baseR = pt.status === 'active' ? 5.5 : 3.5
      const dotR = isHov ? baseR * 1.7 : baseR

      ctx.save()

      if (progress > 0.2) {
        const glowR = dotR * (3 + progress * 1.5)
        const g = ctx.createRadialGradient(px, py, 0, px, py, glowR)
        g.addColorStop(0, clusterHsl(pt.kind, pt.status, dark ? 70 : 55, 0.16 * progress))
        g.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.beginPath()
        ctx.arc(px, py, glowR, 0, Math.PI * 2)
        ctx.fillStyle = g
        ctx.fill()
      }

      ctx.beginPath()
      ctx.arc(px, py, dotR, 0, Math.PI * 2)
      ctx.fillStyle = isHov
        ? clusterHsl(pt.kind, pt.status, dark ? 92 : 30, 1)
        : clusterHsl(pt.kind, pt.status, dark ? 72 : 46, 0.8 + progress * 0.15)
      ctx.fill()

      if (isHov) {
        ctx.beginPath()
        ctx.arc(px, py, dotR + 5, 0, Math.PI * 2)
        ctx.strokeStyle = clusterHsl(pt.kind, pt.status, 62, 0.7)
        ctx.lineWidth = 1.5
        ctx.stroke()
      }

      ctx.restore()
    }

    frameRef.current = requestAnimationFrame(draw)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio, 2)
      const r = canvas.getBoundingClientRect()
      canvas.width = r.width * dpr
      canvas.height = r.height * dpr
      const ctx = canvas.getContext('2d')
      if (ctx) ctx.scale(dpr, dpr)
    }
    resize()
    window.addEventListener('resize', resize)
    frameRef.current = requestAnimationFrame(draw)
    return () => {
      window.removeEventListener('resize', resize)
      cancelAnimationFrame(frameRef.current)
    }
  }, [draw])

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const W = rect.width, H = rect.height, M = 32
    const pts = ptRef.current
    let found: number | null = null
    for (let i = 0; i < pts.length; i++) {
      const tx = ((pts[i].x + 1) / 2) * (W - M * 2) + M
      const ty = ((-pts[i].y + 1) / 2) * (H - M * 2) + M
      if (Math.sqrt((mx - tx) ** 2 + (my - ty) ** 2) <= 12) { found = i; break }
    }
    hoveredIdxRef.current = found
    setTooltip(found !== null ? { x: mx, y: my, pt: pts[found] } : null)
  }, [])

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => { hoveredIdxRef.current = null; setTooltip(null) }}
        className="w-full rounded-xl border border-theme-border bg-[var(--theme-card-bg)]"
        style={{ height: '460px', cursor: tooltip ? 'crosshair' : 'default' }}
      />
      {tooltip && (
        <div
          className="absolute z-20 pointer-events-none rounded-lg border border-theme-border bg-[var(--theme-card-bg)] shadow-xl p-3 text-xs w-[260px]"
          style={{
            left: tooltip.x + 14,
            top: Math.max(8, tooltip.y - 44),
          }}
        >
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <Badge variant="muted">{tooltip.pt.kind}</Badge>
            {tooltip.pt.status !== 'active' && (
              <Badge variant="warning">{tooltip.pt.status}</Badge>
            )}
            <span className="text-theme-muted font-mono">{tooltip.pt.memory_id.slice(0, 8)}</span>
          </div>
          <p className="text-theme-secondary leading-relaxed line-clamp-4 mb-2">
            {tooltip.pt.content_preview}
          </p>
          <div className="flex gap-3 text-theme-muted border-t border-theme-border/50 pt-1.5">
            <span>{(tooltip.pt.confidence * 100).toFixed(0)}% conf</span>
          </div>
        </div>
      )}
    </div>
  )
}

const CLUSTER_KIND_META = [
  { kind: 'profile_fact',    label: 'profile fact' },
  { kind: 'episode_summary', label: 'episode summary' },
  { kind: 'procedure',       label: 'procedure' },
  { kind: 'artifact_ref',    label: 'artifact ref' },
]

function ClustersTab({ subjectId, tenantId }: { subjectId: string; tenantId: string | null }) {
  const [data, setData] = useState<MemoryClustersResponse | null>(null)
  const [loading, setLoading] = useState(true)
  // null = all kinds visible; Set = only those kinds visible
  const [hiddenKinds, setHiddenKinds] = useState<Set<string>>(new Set())
  const [activeOnly, setActiveOnly] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchMemoryClusters(subjectId, { tenantId: tenantId ?? undefined })
      .then((r) => { if (!cancelled) { setData(r); setLoading(false) } })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [subjectId, tenantId])

  if (loading) return <LoadingState rows={2} message="Computing clusters…" />

  function toggleKind(kind: string) {
    setHiddenKinds((prev) => {
      const next = new Set(prev)
      if (next.has(kind)) next.delete(kind); else next.add(kind)
      return next
    })
  }

  const presentKinds = data
    ? new Set(data.points.map((p) => p.kind))
    : new Set<string>()

  const filteredPoints = data?.points.filter((p) => {
    if (hiddenKinds.has(p.kind)) return false
    if (activeOnly && p.status !== 'active') return false
    return true
  }) ?? []

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-theme-border bg-[var(--theme-card-bg)] p-4">
        <div className="flex gap-3 items-start">
          <ScatterChart className="w-4 h-4 text-purple-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-theme-primary">Memory Cluster View</p>
            <p className="text-xs text-theme-muted mt-0.5">
              PCA projection of memory embeddings to 2D. Nearby particles share semantic meaning.
              Hover to inspect.
            </p>
          </div>
        </div>
      </div>

      {(!data || !data.embedding_available) && (
        <div className="rounded-lg p-3 bg-amber-500/5 border border-amber-500/20 text-xs text-amber-400">
          {data?.error ?? 'Cluster view unavailable.'}
        </div>
      )}

      {data && data.embedding_available && data.points.length === 0 && (
        <EmptyState title="No embeddings" description="Compile this subject to generate memory embeddings." />
      )}

      {data && data.points.length > 0 && (
        <>
          {/* Filter chips */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] text-theme-muted uppercase tracking-wide mr-1">Show</span>
            {CLUSTER_KIND_META.filter(({ kind }) => presentKinds.has(kind)).map(({ kind, label }) => {
              const on = !hiddenKinds.has(kind)
              const c = CLUSTER_KIND_COLOR[kind]
              return (
                <button
                  key={kind}
                  onClick={() => toggleKind(kind)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] transition-all ${
                    on
                      ? 'border-transparent text-white'
                      : 'border-theme-border bg-transparent text-theme-muted opacity-50 hover:opacity-80'
                  }`}
                  style={on && c ? { backgroundColor: `hsl(${c.h}, ${c.s}%, 45%)` } : undefined}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ background: on && c ? 'rgba(255,255,255,0.7)' : `hsl(${c?.h ?? 265}, ${c?.s ?? 70}%, 62%)` }}
                  />
                  {label}
                </button>
              )
            })}

            {/* Divider */}
            <div className="w-px h-4 bg-theme-border/60 mx-1" />

            {/* Active only toggle */}
            <button
              onClick={() => setActiveOnly((v) => !v)}
              className={`px-2.5 py-1 rounded-full border text-[11px] transition-all ${
                activeOnly
                  ? 'border-emerald-500/60 text-emerald-400 bg-emerald-500/10'
                  : 'border-theme-border text-theme-muted hover:border-theme-border/80'
              }`}
            >
              Active only
            </button>

            {(hiddenKinds.size > 0 || activeOnly) && (
              <button
                onClick={() => { setHiddenKinds(new Set()); setActiveOnly(false) }}
                className="text-[10px] text-theme-muted hover:text-theme-secondary underline ml-1"
              >
                Reset
              </button>
            )}

            <span className="ml-auto text-[10px] text-theme-muted">
              {filteredPoints.length} / {data.points.length}
            </span>
          </div>

          <MemoryClusterCanvas points={filteredPoints} />
        </>
      )}
    </div>
  )
}

// ─── Receipts Tab ─────────────────────────────────────────────────────────────

function ReceiptsTab({ subjectId, tenantId }: { subjectId: string; tenantId: string | null }) {
  const [receipts, setReceipts] = useState<AdminReceiptListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [regression, setRegression] = useState<RegressionResponse | null>(null)
  const [regressionLoading, setRegressionLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchSubjectReceipts(subjectId, { limit: 50, tenantId: tenantId ?? undefined })
      .then((r) => { if (!cancelled) { setReceipts(r); setLoading(false) } })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [subjectId, tenantId])

  async function runRegression(receiptId: string) {
    setSelectedId(receiptId)
    setRegression(null)
    setRegressionLoading(true)
    try {
      const r = await fetchReceiptRegression(subjectId, receiptId, { tenantId: tenantId ?? undefined })
      setRegression(r)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Regression test failed')
    } finally {
      setRegressionLoading(false)
    }
  }

  if (loading) return <LoadingState rows={3} message="Loading receipts…" />

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-theme-border bg-[var(--theme-card-bg)] p-4">
        <div className="flex gap-3 items-start">
          <Receipt className="w-4 h-4 text-indigo-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-theme-primary">Retrieval Regression Tester</p>
            <p className="text-xs text-theme-muted mt-0.5">
              Select a historical receipt to diff its memory set against current state — showing what
              changed (dropped, new, stable) since that assembly.
            </p>
          </div>
        </div>
      </div>

      {(!receipts || receipts.items.length === 0) && (
        <EmptyState
          title="No receipts"
          description="Receipts are emitted by get_context calls. None recorded yet for this subject."
        />
      )}

      {receipts && receipts.items.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Receipt list */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-theme-muted uppercase tracking-wide">
              {receipts.total} receipt{receipts.total !== 1 ? 's' : ''}
            </h3>
            {receipts.items.map((r) => (
              <button
                key={r.receipt_id}
                onClick={() => runRegression(r.receipt_id)}
                className={`w-full text-left rounded-lg border p-3 transition-colors space-y-1 ${
                  selectedId === r.receipt_id
                    ? 'border-indigo-500/40 bg-indigo-500/5'
                    : 'border-theme-border bg-[var(--theme-card-bg)] hover:border-theme-border-hover'
                }`}
              >
                <div className="flex items-center gap-2 text-[10px] text-theme-muted">
                  <span className="font-mono text-theme-secondary">{r.receipt_id}</span>
                  <Badge variant="muted">{r.mode}</Badge>
                  <span className="ml-auto">{r.memory_count} mem</span>
                </div>
                <div className="text-[10px] text-theme-muted">
                  {new Date(r.as_of).toLocaleString()}
                  <span className="mx-1">·</span>
                  {(r.context_size_bytes / 1024).toFixed(1)} KB
                </div>
              </button>
            ))}
          </div>

          {/* Regression result */}
          <div>
            {regressionLoading && <LoadingState rows={3} message="Running regression…" />}
            {regression && !regressionLoading && (
              <div className="space-y-4">
                <div className="flex gap-4 text-xs text-theme-muted flex-wrap">
                  <span>as of {new Date(regression.receipt_as_of).toLocaleString()}</span>
                </div>

                {/* Stable */}
                <section>
                  <h4 className="text-xs font-semibold text-emerald-400 mb-2">
                    Stable ({regression.stable.length})
                  </h4>
                  {regression.stable.length === 0 ? (
                    <p className="text-xs text-theme-muted">—</p>
                  ) : (
                    <div className="space-y-1.5">
                      {regression.stable.map((m) => (
                        <div key={m.memory_id} className="rounded border border-emerald-500/20 bg-emerald-500/5 p-2">
                          <div className="flex items-center gap-2 text-[10px] mb-0.5">
                            <Badge variant="muted">{m.kind}</Badge>
                            <span className="font-mono text-theme-muted">{m.memory_id.slice(0, 8)}</span>
                          </div>
                          <p className="text-xs text-theme-secondary line-clamp-2">{m.content_preview}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                {/* Dropped */}
                <section>
                  <h4 className="text-xs font-semibold text-red-400 mb-2">
                    Dropped ({regression.dropped.length})
                  </h4>
                  {regression.dropped.length === 0 ? (
                    <p className="text-xs text-theme-muted">—</p>
                  ) : (
                    <div className="space-y-1.5">
                      {regression.dropped.map((m) => (
                        <div key={m.memory_id} className="rounded border border-red-500/20 bg-red-500/5 p-2">
                          <div className="flex items-center gap-2 text-[10px] mb-0.5">
                            <Badge variant="muted">{m.kind}</Badge>
                            <span className="font-semibold text-red-400">{m.change}</span>
                            <span className="font-mono text-theme-muted">{m.memory_id.slice(0, 8)}</span>
                          </div>
                          <p className="text-xs text-theme-secondary line-clamp-2">{m.content_preview}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                {/* New */}
                <section>
                  <h4 className="text-xs font-semibold text-blue-400 mb-2">
                    New since receipt ({regression.new_memories.length})
                  </h4>
                  {regression.new_memories.length === 0 ? (
                    <p className="text-xs text-theme-muted">—</p>
                  ) : (
                    <div className="space-y-1.5">
                      {regression.new_memories.map((m) => (
                        <div key={m.memory_id} className="rounded border border-blue-500/20 bg-blue-500/5 p-2">
                          <div className="flex items-center gap-2 text-[10px] mb-0.5">
                            <Badge variant="muted">{m.kind}</Badge>
                            <span className="font-mono text-theme-muted">{m.memory_id.slice(0, 8)}</span>
                            <span className="text-theme-muted ml-auto">{new Date(m.created_at).toLocaleDateString()}</span>
                          </div>
                          <p className="text-xs text-theme-secondary line-clamp-2">{m.content_preview}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
