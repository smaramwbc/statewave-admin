import { useEffect, useState, useCallback } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import {
  SearchInput,
  FilterSelect,
  Pagination,
  EmptyState,
  ErrorState,
  HealthBadge,
  Badge,
  Modal,
  TableSkeleton,
  CopyableMono,
} from '../components/ui'
import {
  fetchSubjects,
  fetchTenants,
  previewBulkDelete,
  commitBulkDelete,
  fetchSubjectActivity,
  type SubjectListItem,
  type SubjectListParams,
  type BulkDeletePreview,
  type BulkDeleteResult,
  type ActivityDay,
} from '../lib/api'
import { MemoryActionsDrawer } from '../components/MemoryActionsDrawer'
import { SubjectRowActions } from '../components/SubjectRowActions'
import { ActionMenu, type ActionMenuItem } from '../components/ActionMenu'
import { PullToRefresh } from '../components/PullToRefresh'
import { RefreshControl } from '../components/RefreshControl'
import { Button, PageHeader } from '../components/ui'
import { Upload, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

const PAGE_SIZE = 50

/**
 * Page-header action bar for SubjectsPage.
 *
 *   - md+ (≥768px): inline toolbar — "Updated HH:MM:SS" + Refresh
 *     button + "Import / Restore…" + "Bulk delete…".
 *   - <md (phones): only the timestamp ("Updated HH:MM:SS") plus a ⋮
 *     kebab with Import / Bulk delete. The Refresh button is hidden
 *     because pull-to-refresh is the gesture there.
 *
 * The kebab pattern matches what each subject row already uses for
 * Clone / Export.
 */
function SubjectsHeaderActions({
  lastFetched,
  loading,
  onRefresh,
  onOpenImport,
  onOpenBulkDelete,
}: {
  lastFetched: Date | null
  loading: boolean
  onRefresh: () => void
  onOpenImport: () => void
  onOpenBulkDelete: () => void
}) {
  const items: ActionMenuItem[] = [
    {
      label: 'Import / Restore…',
      icon: <Upload className="h-3.5 w-3.5" aria-hidden="true" />,
      onSelect: onOpenImport,
      title: 'Restore Statewave Support, import demo agents, or import a .swmem archive',
      desktop: (
        <Button
          variant="secondary"
          size="sm"
          onClick={onOpenImport}
          leftIcon={<Upload className="h-3.5 w-3.5" aria-hidden="true" />}
          title="Restore Statewave Support, import demo agents, or import a .swmem archive"
        >
          Import / Restore…
        </Button>
      ),
    },
    {
      label: 'Bulk delete…',
      icon: <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />,
      onSelect: onOpenBulkDelete,
      destructive: true,
      title: 'Filtered bulk delete with preview before commit',
      desktop: (
        <Button
          variant="destructive"
          size="sm"
          onClick={onOpenBulkDelete}
          leftIcon={<Trash2 className="h-3.5 w-3.5" aria-hidden="true" />}
          title="Filtered bulk delete with preview before commit"
        >
          Bulk delete…
        </Button>
      ),
    },
  ]

  // Mobile mirrors the other pages (Overview, Jobs, Webhooks): the
  // RefreshControl renders just its "Updated HH:MM:SS" timestamp on
  // phones (the Refresh button is hidden by RefreshControl itself
  // under md:). The kebab carries Import / Bulk delete; pull-to-
  // refresh handles refresh.
  return (
    <div className="flex items-center gap-2">
      <RefreshControl lastFetched={lastFetched} onRefresh={onRefresh} loading={loading} />
      <ActionMenu items={items} label="Subjects page actions" />
    </div>
  )
}

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
  const [lastFetched, setLastFetched] = useState<Date | null>(null)
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
  // Match-all path: explicit opt-in to delete every subject in the workspace.
  // Disables the per-filter inputs and requires the operator to type a
  // confirmation phrase before commit. Backend mirrors this with `match_all`
  // on BulkDeleteFilter.
  const [bulkMatchAll, setBulkMatchAll] = useState(false)
  const [bulkMatchAllConfirm, setBulkMatchAllConfirm] = useState('')
  const MATCH_ALL_PHRASE = 'DELETE ALL'
  // Memory portability drawer (Stage 1+ — vendor-neutral). Lives at the
  // Subjects-page top so all platform-level memory operations are reachable
  // here, not from the Dashboard.
  const [showMemoryDrawer, setShowMemoryDrawer] = useState(false)

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
      setLastFetched(new Date())
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
    <PullToRefresh onRefresh={loadData}>
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Subjects"
        description="Browse and inspect subject memory, episodes, and health"
        actions={
          <SubjectsHeaderActions
            lastFetched={lastFetched}
            loading={loading}
            onRefresh={() => void loadData()}
            onOpenImport={() => setShowMemoryDrawer(true)}
            onOpenBulkDelete={() => {
              setBulkPrefix('')
              setBulkAgeDays('')
              setBulkTenant(tenantId || '')
              setBulkPreview(null)
              setBulkResult(null)
              setBulkError(null)
              setBulkMatchAll(false)
              setBulkMatchAllConfirm('')
              setShowBulkModal(true)
            }}
          />
        }
      />

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
      {error && !data && (
        <ErrorState
          title="Failed to load subjects"
          message="The admin proxy could not return the subject list."
          suggestion="Check that the Statewave backend is reachable and try again."
          technicalDetails={error}
          onRetry={loadData}
        />
      )}

      {/* Initial-load skeleton — only when there's nothing to show yet.
          Background refreshes keep `data` populated and rely on the header
          RefreshControl spinner instead of a blocking overlay. */}
      {!data && !error && loading && (
        <TableSkeleton
          rows={8}
          columns={7}
          columnWidths={['w-56', 'w-24', 'w-16', 'w-12', 'w-12', 'w-12', 'w-32']}
          ariaLabel="Loading subjects"
        />
      )}

      {data && data.subjects.length === 0 && (
        <EmptyState
          title={
            search || healthState || tenantId
              ? 'No subjects found'
              : 'No subjects yet'
          }
          description={
            search || healthState || tenantId
              ? 'Try adjusting your search or filters.'
              : 'Subjects appear when episodes are ingested or when you import a starter memory.'
          }
          primaryAction={
            !(search || healthState || tenantId) ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowMemoryDrawer(true)}
                leftIcon={<Upload className="h-3.5 w-3.5" aria-hidden="true" />}
              >
                Import / Restore…
              </Button>
            ) : undefined
          }
          action={
            (search || healthState || tenantId) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSearchParams(new URLSearchParams())}
              >
                Clear filters
              </Button>
            )
          }
        />
      )}

      {data && data.subjects.length > 0 && (
        <>
          {/* Mobile: stacked cards. A 7-column subject table is unreadable
              at 320–430px even with horizontal scroll — long subject IDs
              get clipped and the eye can't follow rows. Each subject
              becomes its own card with the ID as a tappable title, the
              health badge top-right, and a tight stats grid below. The
              row-action menu still surfaces clone / delete / etc. */}
          <ul className="md:hidden space-y-3" aria-label="Subjects">
            {data.subjects.map((subject) => (
              // Whole card is a tappable navigation surface to the
              // subject detail page — much easier to hit on a phone
              // than a small text link on the subject id. The kebab
              // menu, copy button, and any other interactive control
              // inside still work because they each call
              // `e.stopPropagation()` on their own click handlers, but
              // we also wrap them in a `data-no-link` container that
              // intercepts clicks before they reach the outer Link.
              <li key={subject.subject_id} className="relative">
                <Link
                  to={`/subjects/${encodeURIComponent(subject.subject_id)}`}
                  className="block rounded-xl border border-theme-border bg-[var(--theme-card-bg)] p-3 hover:border-accent/40 hover:bg-[var(--theme-surface-1)]/50 transition-colors focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none"
                  aria-label={`Open subject ${subject.subject_id}`}
                >
                  <div className="min-w-0 pr-12">
                    {/* Subject id renders on a single line and scrolls
                        horizontally on overflow. The pr-12 right pad
                        reserves space for the absolutely-positioned
                        copy + kebab cluster in the top-right corner of
                        the card. The HealthBadge no longer lives at
                        the top — it pairs with "Last activity" at the
                        bottom-right instead, so the chip and the
                        kebab never compete for the same corner. */}
                    <span
                      className="block text-theme-primary font-mono text-xs whitespace-nowrap overflow-x-auto [&::-webkit-scrollbar]:hidden [scrollbar-width:none]"
                      title={subject.subject_id}
                    >
                      {subject.subject_id}
                    </span>
                    {subject.tenant_id && (
                      <p
                        className="mt-0.5 text-[10px] font-mono text-theme-muted whitespace-nowrap overflow-x-auto [&::-webkit-scrollbar]:hidden [scrollbar-width:none]"
                        title={subject.tenant_id}
                      >
                        tenant: {subject.tenant_id}
                      </p>
                    )}
                  </div>
                  <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-md bg-[var(--theme-surface-1)] py-2">
                      <dt className="text-[10px] uppercase tracking-wider text-theme-muted">Memories</dt>
                      <dd className="text-sm font-semibold text-theme-primary tabular-nums">
                        {subject.memory_count.toLocaleString()}
                      </dd>
                    </div>
                    <div className="rounded-md bg-[var(--theme-surface-1)] py-2">
                      <dt className="text-[10px] uppercase tracking-wider text-theme-muted">Episodes</dt>
                      <dd className="text-sm font-semibold text-theme-primary tabular-nums">
                        {subject.episode_count.toLocaleString()}
                      </dd>
                    </div>
                    <div className="rounded-md bg-[var(--theme-surface-1)] py-2">
                      <dt className="text-[10px] uppercase tracking-wider text-theme-muted">Open</dt>
                      <dd className="text-sm font-semibold tabular-nums">
                        {subject.open_sessions > 0 ? (
                          <Badge variant="warning">{subject.open_sessions}</Badge>
                        ) : (
                          <span className="text-theme-muted">—</span>
                        )}
                      </dd>
                    </div>
                  </dl>
                  {/* Footer row — last activity left, health chip right. */}
                  <div className="mt-2 flex items-center justify-between gap-2">
                    {subject.last_episode_at ? (
                      <p className="text-[10px] text-theme-muted truncate">
                        Last activity: {new Date(subject.last_episode_at).toLocaleString()}
                      </p>
                    ) : (
                      <span />
                    )}
                    <HealthBadge state={subject.health_state} score={subject.health_score} />
                  </div>
                </Link>
                {/* Top-right cluster — copy + kebab only. The health
                    badge moved down to the footer row so the chip and
                    kebab never share the same corner pixels. */}
                <div
                  className="absolute top-2.5 right-2.5 flex items-center gap-1 z-10"
                  onClick={(e) => e.stopPropagation()}
                >
                  <CopyableMono
                    value={subject.subject_id}
                    labelForA11y="subject ID"
                    display=""
                  />
                  <SubjectRowActions
                    subjectId={subject.subject_id}
                    onCloneComplete={loadData}
                  />
                </div>
              </li>
            ))}
          </ul>

          {/* md+ : original table. The card uses overflow-x-auto so wide
              content can scroll horizontally; the sticky <thead> sticks to
              the top of <main>'s scroll viewport so column labels stay
              visible while the user scrolls past row 30. */}
          <div className="hidden md:block rounded-xl border border-theme-border bg-[var(--theme-card-bg)] overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-[var(--theme-surface-1)] border-b border-theme-border">
                <tr>
                  <th className="text-left text-xs font-medium uppercase tracking-wide text-theme-muted px-4 py-3">Subject ID</th>
                  <th className="text-left text-xs font-medium uppercase tracking-wide text-theme-muted px-4 py-3">Tenant</th>
                  <th className="text-left text-xs font-medium uppercase tracking-wide text-theme-muted px-4 py-3">Health</th>
                  <th className="text-right text-xs font-medium uppercase tracking-wide text-theme-muted px-4 py-3">Memories</th>
                  <th className="text-right text-xs font-medium uppercase tracking-wide text-theme-muted px-4 py-3">Episodes</th>
                  <th className="text-right text-xs font-medium uppercase tracking-wide text-theme-muted px-4 py-3">Open</th>
                  <th className="text-left text-xs font-medium uppercase tracking-wide text-theme-muted px-4 py-3">Last Activity</th>
                  <th className="text-left text-xs font-medium uppercase tracking-wide text-theme-muted px-4 py-3">7-day activity</th>
                  <th className="w-10 px-2 py-3" aria-label="Row actions"></th>
                </tr>
              </thead>
              <tbody>
                {data.subjects.map((subject) => (
                  <tr
                    key={subject.subject_id}
                    className="border-b border-theme-border/50 last:border-b-0 hover:bg-[var(--theme-surface-1)]/50 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Link
                          to={`/subjects/${encodeURIComponent(subject.subject_id)}`}
                          className="text-theme-primary hover:text-accent font-mono text-xs truncate transition-colors"
                          title={subject.subject_id}
                        >
                          {subject.subject_id}
                        </Link>
                        <CopyableMono
                          value={subject.subject_id}
                          labelForA11y="subject ID"
                          className="shrink-0"
                          // The link itself renders the visible text; we
                          // only need the copy affordance here.
                          display=""
                        />
                      </div>
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
                    <td className="px-4 py-3">
                      <MiniActivityHeatmap subjectId={subject.subject_id} />
                    </td>
                    <td className="px-2 py-2 text-right">
                      <SubjectRowActions
                        subjectId={subject.subject_id}
                        onCloneComplete={loadData}
                      />
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

          {/* Summary — matches Jobs/Webhooks footer */}
          <div className="mt-4 text-xs text-theme-muted text-right">
            Showing {data.subjects.length} of {data.total} subjects
          </div>
        </>
      )}

      {/* No blocking overlay during refresh — initial-load skeleton above
          handles the no-data case; subsequent refreshes keep current rows
          visible and rely on the header RefreshControl spinner. */}

      <Modal
        open={showBulkModal}
        onClose={() => { if (!bulkCommitting && !bulkPreviewing) setShowBulkModal(false) }}
        title="Bulk delete subjects"
      >
        <div className="space-y-4 text-sm">
          {!bulkResult && (
            <>
              <p className="text-theme-muted text-xs">
                Specify at least one filter, or use{' '}
                <span className="text-theme-secondary">Match every subject</span>{' '}
                below to wipe the entire workspace. Preview shows what will be
                deleted before you commit. Episodes, memories, and sessions for
                matched subjects are removed permanently.
              </p>
              <div className={`grid grid-cols-1 gap-3 ${bulkMatchAll ? 'opacity-40 pointer-events-none' : ''}`}>
                <label className="block">
                  <span className="block text-xs text-theme-muted mb-1">Subject ID prefix</span>
                  <input
                    type="text"
                    value={bulkPrefix}
                    onChange={(e) => { setBulkPrefix(e.target.value); setBulkPreview(null) }}
                    placeholder="e.g. demo_web_"
                    disabled={bulkMatchAll}
                    className="w-full px-3 py-2 text-sm font-mono rounded border border-theme-border bg-theme-surface-1 text-theme-primary focus:outline-none focus:border-accent/50 disabled:cursor-not-allowed"
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
                    disabled={bulkMatchAll}
                    className="w-full px-3 py-2 text-sm rounded border border-theme-border bg-theme-surface-1 text-theme-primary focus:outline-none focus:border-accent/50 disabled:cursor-not-allowed"
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

              {/* Match-all opt-in. Hides behind a checkbox + type-to-confirm
                  phrase so the destructive intent is verbal, not accidental. */}
              <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 space-y-2">
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={bulkMatchAll}
                    onChange={(e) => {
                      setBulkMatchAll(e.target.checked)
                      setBulkPreview(null)
                      setBulkMatchAllConfirm('')
                    }}
                    className="mt-0.5 accent-red-500"
                  />
                  <span className="text-xs">
                    <span className="font-medium text-red-400">
                      Match every subject in the workspace
                    </span>
                    <span className="block text-theme-muted mt-0.5">
                      Ignores the filters above and targets every subject — including
                      Statewave Support docs and any visitor memory subjects.
                      Cannot be undone.
                    </span>
                  </span>
                </label>
                {bulkMatchAll && (
                  <div className="pl-6 space-y-2">
                    <label className="block">
                      <span className="block text-[11px] text-theme-muted mb-1">
                        Type{' '}
                        <span className="font-mono text-red-400">
                          {MATCH_ALL_PHRASE}
                        </span>{' '}
                        to confirm
                      </span>
                      <input
                        type="text"
                        value={bulkMatchAllConfirm}
                        onChange={(e) => setBulkMatchAllConfirm(e.target.value)}
                        autoComplete="off"
                        spellCheck={false}
                        className="w-full px-3 py-1.5 text-sm font-mono rounded-lg border border-red-500/40 bg-theme-surface-1 text-theme-primary focus:outline-none focus:border-red-500/70"
                      />
                    </label>
                  </div>
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

              {/* Two-stage flow with one CTA at a time:
                  * State 1 (no preview): Preview matches is the only forward action
                  * State 2 (matched > 0): Delete becomes available alongside Re-preview
                  * State 3 (matched = 0): only Re-preview, no Delete to be disabled
                  This avoids the previous footgun where users saw a disabled Delete
                  button without context. The OS-level confirm() is gone — the
                  combined preview + match-all type-to-confirm gates already gate
                  destructive intent verbally. */}
              {(() => {
                const buildFilter = () =>
                  bulkMatchAll
                    ? { match_all: true }
                    : {
                        subject_id_prefix: bulkPrefix || undefined,
                        older_than_days: bulkAgeDays ? Number(bulkAgeDays) : undefined,
                        tenant_id: bulkTenant || undefined,
                      }

                const previewMatches = async () => {
                  setBulkPreviewing(true)
                  setBulkError(null)
                  try {
                    const pv = await previewBulkDelete(buildFilter())
                    setBulkPreview(pv)
                  } catch (err) {
                    setBulkError(err instanceof Error ? err.message : 'Preview failed')
                  } finally {
                    setBulkPreviewing(false)
                  }
                }

                const commit = async () => {
                  if (!bulkPreview || bulkPreview.matched === 0) return
                  if (bulkMatchAll && bulkMatchAllConfirm !== MATCH_ALL_PHRASE) return
                  setBulkCommitting(true)
                  setBulkError(null)
                  try {
                    const result = await commitBulkDelete(buildFilter(), bulkPreview.matched)
                    setBulkResult(result)
                    toast.success(`Deleted ${result.deleted_subjects} subjects`, {
                      description: `${result.deleted_episodes} episodes · ${result.deleted_memories} memories`,
                    })
                    void loadData()
                  } catch (err) {
                    const msg = err instanceof Error ? err.message : 'Delete failed'
                    setBulkError(msg)
                    toast.error('Bulk delete failed', { description: msg })
                  } finally {
                    setBulkCommitting(false)
                  }
                }

                const noFilterSet =
                  !bulkMatchAll && !bulkPrefix && !bulkAgeDays && !bulkTenant
                const previewLabel = bulkPreview ? 'Re-preview' : 'Preview matches'
                const showDelete = !!bulkPreview && bulkPreview.matched > 0
                const matchAllNotConfirmed =
                  bulkMatchAll && bulkMatchAllConfirm !== MATCH_ALL_PHRASE

                return (
                  <div className="flex justify-end items-center gap-2 pt-1">
                    {bulkPreview && bulkPreview.matched === 0 && (
                      <p className="text-xs text-theme-muted mr-auto">
                        Nothing matches this filter — adjust and re-preview.
                      </p>
                    )}
                    {showDelete && bulkMatchAll && matchAllNotConfirmed && (
                      <p className="text-xs text-amber-400 mr-auto">
                        Type{' '}
                        <span className="font-mono">{MATCH_ALL_PHRASE}</span>{' '}
                        above to enable Delete.
                      </p>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowBulkModal(false)}
                      disabled={bulkPreviewing || bulkCommitting}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={previewMatches}
                      loading={bulkPreviewing}
                      disabled={bulkPreviewing || bulkCommitting || noFilterSet}
                    >
                      {bulkPreviewing ? 'Previewing…' : previewLabel}
                    </Button>
                    {showDelete && (
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={commit}
                        loading={bulkCommitting}
                        disabled={bulkCommitting || matchAllNotConfirmed}
                      >
                        {bulkCommitting
                          ? 'Deleting…'
                          : `Delete ${bulkPreview.matched} subject${bulkPreview.matched === 1 ? '' : 's'}`}
                      </Button>
                    )}
                  </div>
                )
              })()}
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
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowBulkModal(false)}
                >
                  Close
                </Button>
              </div>
            </div>
          )}
        </div>
      </Modal>

      <MemoryActionsDrawer
        open={showMemoryDrawer}
        onClose={() => setShowMemoryDrawer(false)}
        onImportComplete={loadData}
      />
    </div>
    </PullToRefresh>
  )
}

// ─── Mini Activity Heatmap ────────────────────────────────────────────────────
// Shows 7 cells (1 per day, today on the right) colored by episode count.
// Lazy-loaded per row — fires on mount, non-blocking.

function MiniActivityHeatmap({ subjectId }: { subjectId: string }) {
  const [days, setDays] = useState<ActivityDay[] | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchSubjectActivity(subjectId, { days: 7 })
      .then((r) => { if (!cancelled) setDays(r.days.slice(-7)) })
      .catch(() => { if (!cancelled) setDays([]) })
    return () => { cancelled = true }
  }, [subjectId])

  if (days === null) {
    return (
      <div className="flex gap-0.5">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="w-3 h-3 rounded-[2px] bg-theme-surface-1 animate-pulse" />
        ))}
      </div>
    )
  }

  if (days.length === 0) {
    return <span className="text-[10px] text-theme-muted">—</span>
  }

  const maxCount = Math.max(...days.map((d) => d.episode_count), 1)

  function cellColor(count: number): string {
    if (count === 0) return 'bg-[var(--theme-surface-1)] opacity-50'
    const pct = count / maxCount
    if (pct < 0.25) return 'bg-emerald-500/25'
    if (pct < 0.5) return 'bg-emerald-500/50'
    if (pct < 0.75) return 'bg-emerald-500/75'
    return 'bg-emerald-500'
  }

  return (
    <div className="flex gap-0.5 items-center">
      {days.map((d) => (
        <div
          key={d.date}
          title={`${d.date}: ${d.episode_count} ep${d.episode_count !== 1 ? 's' : ''}`}
          className={`w-3 h-3 rounded-[2px] cursor-default ${cellColor(d.episode_count)}`}
        />
      ))}
    </div>
  )
}
