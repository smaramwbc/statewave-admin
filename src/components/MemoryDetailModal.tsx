import { Modal, Badge } from './ui'
import { MemoryEvolutionSection } from './MemoryEvolutionSection'
import type { MemoryListItem } from '../lib/api'

interface MemoryDetailModalProps {
  memory: MemoryListItem | null
  subjectId?: string
  tenantId?: string | null
  /** Optional context label showing where the user navigated from */
  fromContext?: string
  onClose: () => void
  onViewSourceEpisodes?: (memory: MemoryListItem) => void
  onNavigateToMemory?: (memory: MemoryListItem) => void
}

export function MemoryDetailModal({
  memory,
  subjectId,
  tenantId,
  fromContext,
  onClose,
  onViewSourceEpisodes,
  onNavigateToMemory,
}: MemoryDetailModalProps) {
  if (!memory) return null

  return (
    <Modal open={!!memory} onClose={onClose} title="Memory Details">
      <div className="space-y-5">
        {/* Navigation context */}
        {fromContext && (
          <div className="text-[10px] text-theme-muted bg-[var(--theme-surface-1)] px-2 py-1 rounded -mt-2">
            Viewing from: <span className="text-theme-secondary">{fromContext}</span>
          </div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Badge variant={memory.status === 'active' ? 'success' : 'muted'}>
              {memory.kind}
            </Badge>
            {memory.status === 'superseded' && (
              <Badge variant="warning">superseded</Badge>
            )}
          </div>
          <span className="text-xs text-theme-muted">
            Confidence: {(memory.confidence * 100).toFixed(0)}%
          </span>
        </div>

        {/* ID */}
        <div>
          <p className="text-[10px] font-medium text-theme-muted uppercase tracking-wide mb-1">
            Memory ID
          </p>
          <p className="text-xs font-mono text-theme-secondary break-all">{memory.id}</p>
        </div>

        {/* Content */}
        <div>
          <p className="text-[10px] font-medium text-theme-muted uppercase tracking-wide mb-2">
            Content
          </p>
          <p className="text-sm text-theme-primary">{memory.content}</p>
        </div>

        {/* Summary */}
        {memory.summary && (
          <div>
            <p className="text-[10px] font-medium text-theme-muted uppercase tracking-wide mb-2">
              Summary
            </p>
            <p className="text-xs text-theme-secondary">{memory.summary}</p>
          </div>
        )}

        {/* Timestamps */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-[10px] font-medium text-theme-muted uppercase tracking-wide mb-1">
              Valid From
            </p>
            <p className="text-xs text-theme-secondary">
              {new Date(memory.valid_from).toLocaleString()}
            </p>
          </div>
          {memory.valid_to && (
            <div>
              <p className="text-[10px] font-medium text-theme-muted uppercase tracking-wide mb-1">
                Valid To
              </p>
              <p className="text-xs text-theme-secondary">
                {new Date(memory.valid_to).toLocaleString()}
              </p>
            </div>
          )}
        </div>

        <div>
          <p className="text-[10px] font-medium text-theme-muted uppercase tracking-wide mb-1">
            Created
          </p>
          <p className="text-xs text-theme-secondary">
            {new Date(memory.created_at).toLocaleString()}
          </p>
        </div>

        {/* Source Episodes Link */}
        {memory.source_episode_ids.length > 0 && onViewSourceEpisodes && (
          <div className="pt-2 border-t border-theme-border/50">
            <button
              onClick={() => onViewSourceEpisodes(memory)}
              className="text-xs text-accent hover:text-accent-light underline underline-offset-2"
            >
              View {memory.source_episode_ids.length} source episode{memory.source_episode_ids.length !== 1 ? 's' : ''} →
            </button>
          </div>
        )}

        {/* Memory Evolution Section */}
        {subjectId && (
          <MemoryEvolutionSection
            memoryId={memory.id}
            subjectId={subjectId}
            tenantId={tenantId ?? null}
            currentStatus={memory.status}
            onMemoryClick={onNavigateToMemory}
          />
        )}
      </div>
    </Modal>
  )
}
