import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  Badge,
  Button,
  CopyableMono,
  ErrorState,
  FilterSelect,
  NoResultsState,
  PageHeader,
  Pagination,
  SearchInput,
  TableSkeleton,
} from '../components/ui'
import { RefreshControl } from '../components/RefreshControl'
import { PullToRefresh } from '../components/PullToRefresh'
import {
  fetchSuggestedLabels,
  promoteSuggestedLabels,
  type LabelCatalogueEntry,
  type SuggestedLabelMemoryItem,
  type SuggestedLabelsListResponse,
} from '../lib/api'

const PAGE_SIZE = 50

/**
 * Operator review surface for v0.9 auto-labeling (#158 / #160).
 *
 * Lists every memory carrying at least one detector-derived
 * `suggested_label` and exposes a per-memory promote action that
 * commits a subset of suggestions into the authoritative
 * `sensitivity_labels` column. The promote endpoint is review-only —
 * the server rejects ad-hoc label writes via this surface.
 *
 * Available regardless of whether auto-labeling is currently enabled
 * for new ingest: operators flipping the flag off still need to
 * triage legacy suggestions.
 */
export function SuggestedLabelsPage() {
  const [data, setData] = useState<SuggestedLabelsListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastFetched, setLastFetched] = useState<Date | null>(null)

  const [subjectFilter, setSubjectFilter] = useState('')
  const [tenantFilter, setTenantFilter] = useState('')
  const [labelFilter, setLabelFilter] = useState('')
  const [offset, setOffset] = useState(0)
  const [promoting, setPromoting] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const resp = await fetchSuggestedLabels({
        subject_id: subjectFilter || undefined,
        tenant_id: tenantFilter || undefined,
        label: labelFilter || undefined,
        limit: PAGE_SIZE,
        offset,
      })
      setData(resp)
      setLastFetched(new Date())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [subjectFilter, tenantFilter, labelFilter, offset])

  useEffect(() => {
    // The effect IS the synchronisation point between filter state
    // and server data; load() must run here. Same pattern as
    // ReceiptsPage / WebhooksPage.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  const catalogue: LabelCatalogueEntry[] = useMemo(
    () => data?.catalogue ?? [],
    [data],
  )

  const labelOptions = useMemo(
    () => [
      { value: '', label: 'All labels' },
      ...catalogue.map((entry) => ({ value: entry.label, label: entry.label })),
    ],
    [catalogue],
  )

  async function handlePromote(memory: SuggestedLabelMemoryItem, labels: string[]) {
    if (labels.length === 0) return
    setPromoting(memory.id)
    try {
      const result = await promoteSuggestedLabels(
        memory.id,
        labels,
        memory.tenant_id ?? undefined,
      )
      toast.success(
        `Promoted ${result.promoted.join(', ')} → sensitivity_labels`,
        {
          description: `Memory ${memory.id.slice(0, 8)}…`,
        },
      )
      // Reload — promoted labels move off the suggestions list and the
      // row may disappear from the page entirely.
      await load()
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to promote labels',
      )
    } finally {
      setPromoting(null)
    }
  }

  // ─── Render ──────────────────────────────────────────────────────────

  return (
    <PullToRefresh onRefresh={load}>
      <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
        <PageHeader
          title="Suggested labels"
          description="Review heuristic detector hints and promote them into authoritative sensitivity_labels."
          actions={
            <RefreshControl
              onRefresh={load}
              loading={loading}
              lastFetched={lastFetched}
            />
          }
        />

        {/* About strip — make the v0.9 contract visible so operators
            don't have to read the docs to know what promotion does. */}
        <div className="rounded-lg border border-theme-border bg-[var(--theme-surface-1)] px-4 py-3 text-xs text-theme-secondary">
          <p>
            Suggestions are <strong>advisory</strong>. The policy
            evaluator does not read this column; promotion is the
            explicit operator action that moves a label into the
            authoritative <code className="font-mono">sensitivity_labels</code> that the
            policy bundle consults at retrieval time.
          </p>
          <p className="mt-1.5 text-theme-muted">
            Promoted labels are recorded on the memory's metadata
            (<code className="font-mono">label_promotions</code>) so the audit trail
            is preserved per memory.
          </p>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput
            value={subjectFilter}
            onChange={(v) => {
              setOffset(0)
              setSubjectFilter(v)
            }}
            placeholder="Filter by subject_id"
          />
          <SearchInput
            value={tenantFilter}
            onChange={(v) => {
              setOffset(0)
              setTenantFilter(v)
            }}
            placeholder="Filter by tenant_id"
          />
          <FilterSelect
            value={labelFilter}
            onChange={(v) => {
              setOffset(0)
              setLabelFilter(v)
            }}
            options={labelOptions}
            aria-label="Filter by label"
          />
        </div>

        {/* Body */}
        {loading && !data && <TableSkeleton rows={6} />}
        {error && <ErrorState message={error} onRetry={load} />}
        {data && data.memories.length === 0 && !loading && (
          <NoResultsState
            title={
              labelFilter || subjectFilter || tenantFilter
                ? 'No memories match the current filters.'
                : 'No memories carry auto-labeling suggestions yet.'
            }
            filterSummary={
              labelFilter || subjectFilter || tenantFilter
                ? undefined
                : 'Enable STATEWAVE_AUTO_LABELING_ENABLED and run a compile to populate this view.'
            }
            onClearFilters={
              labelFilter || subjectFilter || tenantFilter
                ? () => {
                    setSubjectFilter('')
                    setTenantFilter('')
                    setLabelFilter('')
                    setOffset(0)
                  }
                : undefined
            }
          />
        )}

        {data && data.memories.length > 0 && (
          <>
            <SuggestionTable
              rows={data.memories}
              catalogue={catalogue}
              onPromote={handlePromote}
              promotingId={promoting}
            />

            <Pagination
              currentPage={Math.floor(data.offset / data.limit) + 1}
              totalPages={Math.max(1, Math.ceil(data.total / data.limit))}
              totalItems={data.total}
              onPageChange={(page) => setOffset((page - 1) * data.limit)}
            />
          </>
        )}
      </div>
    </PullToRefresh>
  )
}

// ─── Row ────────────────────────────────────────────────────────────────────

function SuggestionTable({
  rows,
  catalogue,
  onPromote,
  promotingId,
}: {
  rows: SuggestedLabelMemoryItem[]
  catalogue: LabelCatalogueEntry[]
  onPromote: (memory: SuggestedLabelMemoryItem, labels: string[]) => void
  promotingId: string | null
}) {
  return (
    <div className="rounded-lg border border-theme-border overflow-hidden bg-[var(--theme-card-bg)]">
      <table className="w-full text-sm">
        <thead className="bg-[var(--theme-surface-2)] text-xs uppercase tracking-wider text-theme-muted">
          <tr>
            <th className="px-4 py-2 text-left">Memory</th>
            <th className="px-4 py-2 text-left">Subject / tenant</th>
            <th className="px-4 py-2 text-left">Suggestions</th>
            <th className="px-4 py-2 text-left">Current sensitivity</th>
            <th className="px-4 py-2 text-right">Promote</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <SuggestionRow
              key={m.id}
              memory={m}
              catalogue={catalogue}
              onPromote={onPromote}
              isPromoting={promotingId === m.id}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SuggestionRow({
  memory,
  catalogue,
  onPromote,
  isPromoting,
}: {
  memory: SuggestedLabelMemoryItem
  catalogue: LabelCatalogueEntry[]
  onPromote: (memory: SuggestedLabelMemoryItem, labels: string[]) => void
  isPromoting: boolean
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const description = useMemo(() => {
    const lookup = new Map(catalogue.map((c) => [c.label, c.description]))
    return (label: string) => lookup.get(label) ?? ''
  }, [catalogue])

  function toggle(label: string) {
    const next = new Set(selected)
    if (next.has(label)) next.delete(label)
    else next.add(label)
    setSelected(next)
  }

  function selectAll() {
    setSelected(new Set(memory.suggested_labels))
  }

  return (
    <tr className="border-t border-theme-border/50 align-top">
      <td className="px-4 py-3 max-w-[28ch]">
        <CopyableMono
          value={memory.id}
          display={`${memory.id.slice(0, 8)}…`}
          labelForA11y="memory id"
          maxWidthClass="max-w-[12ch]"
        />
        <p className="mt-1 text-[11px] text-theme-muted truncate">
          {memory.kind} · {memory.content.slice(0, 60)}
          {memory.content.length > 60 ? '…' : ''}
        </p>
      </td>
      <td className="px-4 py-3 text-xs">
        <p className="font-mono break-anywhere">{memory.subject_id}</p>
        <p className="text-theme-muted">
          {memory.tenant_id ?? <span>(no tenant)</span>}
        </p>
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-col gap-1.5">
          {memory.suggested_labels.map((label) => (
            <label
              key={label}
              className="flex items-center gap-2 text-xs cursor-pointer"
              title={description(label)}
            >
              <input
                type="checkbox"
                checked={selected.has(label)}
                onChange={() => toggle(label)}
                disabled={isPromoting}
                className="accent-[var(--theme-primary)]"
              />
              <Badge variant="warning">{label}</Badge>
            </label>
          ))}
          {memory.suggested_labels.length > 1 && (
            <button
              type="button"
              onClick={selectAll}
              disabled={isPromoting}
              className="text-[10px] text-theme-muted hover:text-theme-primary self-start mt-0.5"
            >
              select all
            </button>
          )}
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-1.5">
          {memory.sensitivity_labels.length === 0 && (
            <span className="text-[11px] text-theme-muted italic">none</span>
          )}
          {memory.sensitivity_labels.map((label) => (
            <Badge key={label} variant="success">
              {label}
            </Badge>
          ))}
        </div>
      </td>
      <td className="px-4 py-3 text-right">
        <Button
          size="sm"
          variant="primary"
          disabled={selected.size === 0 || isPromoting}
          onClick={() => onPromote(memory, Array.from(selected))}
        >
          {isPromoting
            ? 'Promoting…'
            : `Promote${selected.size > 0 ? ` (${selected.size})` : ''}`}
        </Button>
      </td>
    </tr>
  )
}
