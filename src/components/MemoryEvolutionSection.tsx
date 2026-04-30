import { useEffect, useState } from 'react'
import { Badge } from './ui'
import { fetchMemoryRelated, relatedMemoryToListItem, type MemoryEvolutionResponse, type RelatedMemoryItem, type MemoryListItem } from '../lib/api'

interface MemoryEvolutionSectionProps {
  memoryId: string
  subjectId: string
  tenantId: string | null
  currentStatus: string
  onMemoryClick?: (memory: MemoryListItem) => void
}

function RelatedMemoryCard({
  memory,
  onClick,
}: {
  memory: RelatedMemoryItem
  onClick?: () => void
}) {
  const relationshipLabels: Record<string, { label: string; color: string }> = {
    supersedes: { label: 'Replaced this', color: 'text-green-400 bg-green-500/10' },
    superseded_by: { label: 'Replaced by this', color: 'text-amber-400 bg-amber-500/10' },
    sibling: { label: 'Related', color: 'text-blue-400 bg-blue-500/10' },
  }

  const rel = relationshipLabels[memory.relationship] || { label: memory.relationship, color: 'text-theme-muted bg-theme-surface-1' }

  return (
    <button
      onClick={onClick}
      className="w-full text-left p-3 rounded-lg border border-theme-border/50 hover:border-accent/40 hover:bg-accent/5 transition-all group"
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${rel.color}`}>
          {rel.label}
        </span>
        <Badge variant={memory.status === 'active' ? 'success' : 'muted'}>
          {memory.kind}
        </Badge>
        {memory.status === 'superseded' && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400">
            superseded
          </span>
        )}
        <span className="text-[10px] text-theme-muted ml-auto group-hover:text-accent transition-colors">
          View →
        </span>
      </div>
      <p className="text-xs text-theme-secondary line-clamp-2">{memory.content}</p>
      <p className="text-[10px] text-theme-muted mt-1.5">
        {new Date(memory.created_at).toLocaleString()}
      </p>
    </button>
  )
}

export function MemoryEvolutionSection({
  memoryId,
  subjectId,
  tenantId,
  currentStatus,
  onMemoryClick,
}: MemoryEvolutionSectionProps) {
  const [evolution, setEvolution] = useState<MemoryEvolutionResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const result = await fetchMemoryRelated(subjectId, memoryId, tenantId ?? undefined)
        if (!cancelled) {
          setEvolution(result)
          // Auto-expand if there's something interesting to show
          if (result.superseding_memory || result.superseded_memories.length > 0) {
            setExpanded(true)
          }
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load evolution')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    load()
    return () => { cancelled = true }
  }, [memoryId, subjectId, tenantId])

  // Count total related items - safely handle missing arrays
  const totalRelated = evolution
    ? (evolution.superseding_memory ? 1 : 0) +
      (evolution.superseded_memories?.length ?? 0) +
      (evolution.sibling_memories?.length ?? 0)
    : 0

  // Nothing to show yet
  if (loading) {
    return (
      <div className="pt-4 border-t border-theme-border/50">
        <p className="text-[10px] font-medium text-theme-muted uppercase tracking-wide mb-2">
          Memory Evolution
        </p>
        <div className="p-3 rounded-lg bg-[var(--theme-surface-1)] border border-theme-border/30">
          <p className="text-xs text-theme-muted">Loading evolution data…</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="pt-4 border-t border-theme-border/50">
        <p className="text-[10px] font-medium text-theme-muted uppercase tracking-wide mb-2">
          Memory Evolution
        </p>
        <div className="p-3 rounded-lg bg-red-500/5 border border-red-500/20">
          <p className="text-xs text-red-400">{error}</p>
        </div>
      </div>
    )
  }

  if (!evolution || totalRelated === 0) {
    return (
      <div className="pt-4 border-t border-theme-border/50">
        <p className="text-[10px] font-medium text-theme-muted uppercase tracking-wide mb-2">
          Memory Evolution
        </p>
        <div className="p-3 rounded-lg bg-[var(--theme-surface-1)] border border-theme-border/30">
          <p className="text-xs text-theme-muted">
            {currentStatus === 'active'
              ? 'This is the current active memory. No supersession history.'
              : 'No related memories found.'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="pt-4 border-t border-theme-border/50">
      {/* Header with toggle */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between group"
      >
        <p className="text-[10px] font-medium text-theme-muted uppercase tracking-wide">
          Memory Evolution
        </p>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-theme-muted">
            {totalRelated} related
          </span>
          <svg
            className={`w-3 h-3 text-theme-muted transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {expanded && (
        <div className="mt-3 space-y-3">
          {/* Superseding memory - most important for superseded memories */}
          {evolution.superseding_memory && (
            <div>
              <p className="text-[10px] text-theme-muted mb-1.5 flex items-center gap-1.5">
                <svg className="w-3 h-3 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                </svg>
                Current Understanding
              </p>
              <RelatedMemoryCard
                memory={evolution.superseding_memory}
                onClick={() => onMemoryClick?.(relatedMemoryToListItem(evolution.superseding_memory!))}
              />
            </div>
          )}

          {/* Superseded memories - what this memory replaced */}
          {(evolution.superseded_memories?.length ?? 0) > 0 && (
            <div>
              <p className="text-[10px] text-theme-muted mb-1.5 flex items-center gap-1.5">
                <svg className="w-3 h-3 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6" />
                </svg>
                Previous Understanding ({evolution.superseded_memories?.length ?? 0})
              </p>
              <div className="space-y-2">
                {(evolution.superseded_memories ?? []).map((m) => (
                  <RelatedMemoryCard
                    key={m.id}
                    memory={m}
                    onClick={() => onMemoryClick?.(relatedMemoryToListItem(m))}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Sibling memories */}
          {(evolution.sibling_memories?.length ?? 0) > 0 && (
            <div>
              <p className="text-[10px] text-theme-muted mb-1.5 flex items-center gap-1.5">
                <svg className="w-3 h-3 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
                Related Memories ({evolution.sibling_memories?.length ?? 0})
              </p>
              <div className="space-y-2">
                {(evolution.sibling_memories ?? []).slice(0, 3).map((m) => (
                  <RelatedMemoryCard
                    key={m.id}
                    memory={m}
                    onClick={() => onMemoryClick?.(relatedMemoryToListItem(m))}
                  />
                ))}
                {(evolution.sibling_memories?.length ?? 0) > 3 && (
                  <p className="text-[10px] text-theme-muted text-center py-1">
                    +{(evolution.sibling_memories?.length ?? 0) - 3} more related memories
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
