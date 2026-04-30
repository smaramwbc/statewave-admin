import { useEffect, useState, useCallback } from 'react'
import { Modal, LoadingOverlay, Badge, EmptyState } from './ui'
import type { EpisodeListItem, MemoryListItem } from '../lib/api'

interface SourceEpisodesModalProps {
  memory: MemoryListItem | null
  subjectId: string
  tenantId: string | null
  onClose: () => void
  onEpisodeClick?: (episode: EpisodeListItem) => void
  onSessionClick?: (sessionId: string) => void
}

export function SourceEpisodesModal({
  memory,
  subjectId,
  tenantId,
  onClose,
  onEpisodeClick,
  onSessionClick,
}: SourceEpisodesModalProps) {
  const [episodes, setEpisodes] = useState<EpisodeListItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadSourceEpisodes = useCallback(async () => {
    if (!memory || memory.source_episode_ids.length === 0) return

    setLoading(true)
    setError(null)

    try {
      // Fetch episodes by IDs - we need to filter from the episodes list
      // For now, fetch all episodes and filter client-side
      // In a real implementation, we'd have a batch endpoint
      const { fetchSubjectEpisodes } = await import('../lib/api')
      const result = await fetchSubjectEpisodes(subjectId, {
        tenant_id: tenantId ?? undefined,
        limit: 200, // Get enough to find our source episodes
      })

      // Filter to just the source episodes
      const sourceEpisodes = result.episodes.filter((ep) =>
        memory.source_episode_ids.includes(ep.id)
      )

      // Sort by created_at ascending to show chronological order
      sourceEpisodes.sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      )

      setEpisodes(sourceEpisodes)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load source episodes')
    } finally {
      setLoading(false)
    }
  }, [memory, subjectId, tenantId])

  useEffect(() => {
    if (memory) {
      // Initial data fetch when memory changes - legitimate async data loading
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadSourceEpisodes()
    }
  }, [memory, loadSourceEpisodes])

  if (!memory) return null

  const foundCount = episodes.length
  const expectedCount = memory.source_episode_ids.length

  return (
    <Modal
      open={!!memory}
      onClose={onClose}
      title={`Source Episodes for Memory`}
    >
      <div className="space-y-4">
        {/* Memory context */}
        <div className="p-3 rounded-lg bg-[var(--theme-surface-1)] border border-theme-border/50">
          <div className="flex items-center gap-2 mb-2">
            <Badge variant={memory.status === 'active' ? 'success' : 'muted'}>
              {memory.kind}
            </Badge>
            <span className="text-[10px] text-theme-muted font-mono">{memory.id.slice(0, 12)}…</span>
          </div>
          <p className="text-sm text-theme-primary">{memory.content}</p>
        </div>

        {/* Loading/Error */}
        {loading && <LoadingOverlay message="Loading source episodes…" />}
        {error && (
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
            <p className="text-xs text-red-400">{error}</p>
          </div>
        )}

        {/* Episodes list */}
        {!loading && !error && (
          <>
            <p className="text-xs text-theme-muted">
              Showing {foundCount} of {expectedCount} source episode{expectedCount !== 1 ? 's' : ''}
              {foundCount < expectedCount && (
                <span className="text-amber-400"> (some may be outside the fetch window)</span>
              )}
            </p>

            {episodes.length === 0 ? (
              <EmptyState
                title="No episodes found"
                description="Source episodes may have been deleted or are not accessible"
              />
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {episodes.map((episode, index) => (
                  <div
                    key={episode.id}
                    className="rounded-lg border border-theme-border bg-[var(--theme-card-bg)] p-3 hover:border-theme-border-hover transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-theme-muted tabular-nums">#{index + 1}</span>
                        <Badge>{episode.type}</Badge>
                        <span className="text-[10px] text-theme-muted">{episode.source}</span>
                      </div>
                      <span className="text-[10px] text-theme-muted shrink-0">
                        {new Date(episode.created_at).toLocaleString()}
                      </span>
                    </div>

                    {episode.session_id && (
                      <p className="text-[10px] text-theme-muted mb-2">
                        Session:{' '}
                        {onSessionClick ? (
                          <button
                            onClick={() => onSessionClick(episode.session_id!)}
                            className="font-mono text-accent hover:text-accent-light underline underline-offset-2"
                          >
                            {episode.session_id}
                          </button>
                        ) : (
                          <span className="font-mono">{episode.session_id}</span>
                        )}
                      </p>
                    )}

                    <details className="group">
                      <summary className="text-[10px] text-theme-muted cursor-pointer hover:text-theme-secondary">
                        View payload
                      </summary>
                      <pre className="mt-2 p-2 rounded bg-[var(--theme-surface-1)] text-[10px] text-theme-secondary overflow-x-auto max-h-32">
                        {JSON.stringify(episode.payload, null, 2)}
                      </pre>
                    </details>

                    {onEpisodeClick && (
                      <button
                        onClick={() => onEpisodeClick(episode)}
                        className="mt-2 text-[10px] text-accent hover:text-accent-light underline underline-offset-2"
                      >
                        Open full details →
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}
