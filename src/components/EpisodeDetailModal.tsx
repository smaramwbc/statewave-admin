import { useEffect, useState, useCallback } from 'react'
import { Modal, Badge, InlineLoading, InlineError, InlineEmpty } from './ui'
import { fetchCitingMemories, type EpisodeListItem, type MemoryListItem } from '../lib/api'

interface EpisodeDetailModalProps {
  episode: EpisodeListItem | null
  subjectId: string
  tenantId: string | null
  onClose: () => void
  onSessionClick?: (sessionId: string) => void
  onMemoryClick?: (memory: MemoryListItem) => void
}

export function EpisodeDetailModal({
  episode,
  subjectId,
  tenantId,
  onClose,
  onSessionClick,
  onMemoryClick,
}: EpisodeDetailModalProps) {
  const [citingMemories, setCitingMemories] = useState<MemoryListItem[]>([])
  const [citingTotal, setCitingTotal] = useState(0)
  const [citingLoading, setCitingLoading] = useState(false)
  const [citingError, setCitingError] = useState<string | null>(null)

  const loadCitingMemories = useCallback(async () => {
    if (!episode) return

    setCitingLoading(true)
    setCitingError(null)

    try {
      const result = await fetchCitingMemories(subjectId, episode.id, {
        tenant_id: tenantId ?? undefined,
        limit: 50,
      })
      setCitingMemories(result.memories)
      setCitingTotal(result.total)
    } catch (e) {
      setCitingError(e instanceof Error ? e.message : 'Failed to load citing memories')
    } finally {
      setCitingLoading(false)
    }
  }, [episode, subjectId, tenantId])

  useEffect(() => {
    if (episode) {
      // Initial data fetch when episode changes - legitimate async data loading
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadCitingMemories()
    } else {
      // Reset state when modal closes
      setCitingMemories([])
      setCitingTotal(0)
      setCitingError(null)
    }
  }, [episode, loadCitingMemories])

  if (!episode) return null

  return (
    <Modal open={!!episode} onClose={onClose} title="Episode Details">
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Badge>{episode.type}</Badge>
            <span className="text-xs text-theme-muted">{episode.source}</span>
          </div>
          <span className="text-xs text-theme-muted">
            {new Date(episode.created_at).toLocaleString()}
          </span>
        </div>

        {/* ID */}
        <div>
          <p className="text-[10px] font-medium text-theme-muted uppercase tracking-wide mb-1">
            Episode ID
          </p>
          <p className="text-xs font-mono text-theme-secondary break-all">{episode.id}</p>
        </div>

        {/* Session */}
        {episode.session_id && (
          <div>
            <p className="text-[10px] font-medium text-theme-muted uppercase tracking-wide mb-1">
              Session
            </p>
            {onSessionClick ? (
              <button
                onClick={() => onSessionClick(episode.session_id!)}
                className="text-xs font-mono text-accent hover:text-accent-light underline underline-offset-2"
              >
                {episode.session_id}
              </button>
            ) : (
              <p className="text-xs font-mono text-theme-secondary">{episode.session_id}</p>
            )}
          </div>
        )}

        {/* Payload */}
        <div>
          <p className="text-[10px] font-medium text-theme-muted uppercase tracking-wide mb-2">
            Payload
          </p>
          <pre className="p-3 rounded-lg bg-[var(--theme-surface-1)] text-xs text-theme-secondary whitespace-pre-wrap break-words max-h-64 overflow-y-auto">
            {JSON.stringify(episode.payload, null, 2)}
          </pre>
        </div>

        {/* Metadata */}
        {Object.keys(episode.metadata).length > 0 && (
          <div>
            <p className="text-[10px] font-medium text-theme-muted uppercase tracking-wide mb-2">
              Metadata
            </p>
            <pre className="p-3 rounded-lg bg-[var(--theme-surface-1)] text-xs text-theme-secondary whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
              {JSON.stringify(episode.metadata, null, 2)}
            </pre>
          </div>
        )}

        {/* Provenance */}
        {Object.keys(episode.provenance).length > 0 && (
          <div>
            <p className="text-[10px] font-medium text-theme-muted uppercase tracking-wide mb-2">
              Provenance
            </p>
            <pre className="p-3 rounded-lg bg-[var(--theme-surface-1)] text-xs text-theme-secondary whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
              {JSON.stringify(episode.provenance, null, 2)}
            </pre>
          </div>
        )}

        {/* Divider */}
        <div className="border-t border-theme-border/50" />

        {/* Citing Memories (Reverse Provenance) */}
        <div>
          <p className="text-[10px] font-medium text-theme-muted uppercase tracking-wide mb-2">
            Cited by Memories
            {!citingLoading && (
              <span className="ml-2 text-theme-secondary">({citingTotal})</span>
            )}
          </p>

          {citingLoading && <InlineLoading message="Loading citing memories…" />}

          {citingError && <InlineError message={citingError} onRetry={loadCitingMemories} />}

          {!citingLoading && !citingError && citingMemories.length === 0 && (
            <InlineEmpty message="No memories cite this episode yet" />
          )}

          {!citingLoading && !citingError && citingMemories.length > 0 && (
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {citingMemories.map((memory) => (
                <div
                  key={memory.id}
                  className="rounded-lg border border-theme-border bg-[var(--theme-card-bg)] p-3 hover:border-theme-border-hover transition-colors"
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <Badge variant={memory.status === 'active' ? 'success' : 'muted'}>
                      {memory.kind}
                    </Badge>
                    {memory.status === 'superseded' && (
                      <Badge variant="warning">superseded</Badge>
                    )}
                    <span className="text-[10px] text-theme-muted font-mono ml-auto">
                      {memory.id.slice(0, 8)}…
                    </span>
                  </div>
                  <p className="text-xs text-theme-primary line-clamp-2">{memory.content}</p>
                  {onMemoryClick && (
                    <button
                      onClick={() => onMemoryClick(memory)}
                      className="mt-2 text-[10px] text-accent hover:text-accent-light underline underline-offset-2"
                    >
                      Open memory →
                    </button>
                  )}
                </div>
              ))}
              {citingTotal > citingMemories.length && (
                <p className="text-[10px] text-theme-muted text-center py-2">
                  Showing {citingMemories.length} of {citingTotal} citing memories
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
