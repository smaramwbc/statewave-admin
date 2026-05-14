import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Modal, Badge, Button } from './ui'
import { MemoryEvolutionSection } from './MemoryEvolutionSection'
import { setMemoryLabels } from '../lib/api'
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
  /** Fired after a successful label edit so the parent can refetch. */
  onMemoryUpdated?: (updated: MemoryListItem) => void
}

export function MemoryDetailModal({
  memory,
  subjectId,
  tenantId,
  fromContext,
  onClose,
  onViewSourceEpisodes,
  onNavigateToMemory,
  onMemoryUpdated,
}: MemoryDetailModalProps) {
  // Local-edit state for sensitivity labels. The input is a single
  // comma-separated string for entry ergonomics; the server normalizes
  // (dedup + lowercase + trim) so the canonical set comes back in the
  // response.
  const [labelInput, setLabelInput] = useState('')
  const [savingLabels, setSavingLabels] = useState(false)
  const [currentLabels, setCurrentLabels] = useState<string[]>([])

  // Reset local state when the modal opens onto a different memory so
  // stale labels from a prior memory don't leak across openings.
  useEffect(() => {
    const labels = memory?.sensitivity_labels ?? []
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCurrentLabels(labels)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLabelInput(labels.join(', '))
  }, [memory?.id])

  if (!memory) return null

  const saveLabels = async () => {
    setSavingLabels(true)
    try {
      const parsed = labelInput
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      const updated = await setMemoryLabels(memory.id, parsed, tenantId ?? undefined)
      setCurrentLabels(updated.sensitivity_labels ?? [])
      setLabelInput((updated.sensitivity_labels ?? []).join(', '))
      toast.success(
        (updated.sensitivity_labels ?? []).length === 0
          ? 'Labels cleared'
          : `Saved ${(updated.sensitivity_labels ?? []).length} label(s)`,
      )
      onMemoryUpdated?.(updated)
    } catch (e) {
      toast.error('Failed to save labels', {
        description: e instanceof Error ? e.message : String(e),
      })
    } finally {
      setSavingLabels(false)
    }
  }

  return (
    <Modal
      open={!!memory}
      onClose={onClose}
      title="Memory Details"
      // The "Viewing from" navigation context used to render as an
      // awkward boxed line right under the title. We promote it into
      // the modal's `description` slot so it renders inline with the
      // header where breadcrumb / context typically lives — same
      // surface a Mac sheet uses for "From: …". This keeps the body
      // free of meta chrome and the header's information density
      // honest.
      description={fromContext ? `Viewing from ${fromContext}` : undefined}
    >
      <div className="space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={memory.status === 'active' ? 'success' : 'muted'}>
              {memory.kind}
            </Badge>
            {memory.status === 'superseded' && (
              <Badge variant="warning">superseded</Badge>
            )}
          </div>
          <span className="text-xs text-theme-muted whitespace-nowrap">
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

        {/* Sensitivity labels (#50) — operator-supplied capability
            tags that the policy layer reads to decide deny/redact/
            allow per memory. The input is comma-separated for
            ergonomics; the server canonicalizes (dedup + lowercase +
            trim) before persisting so the on-the-wire vocabulary
            stays stable regardless of operator typing. */}
        <div className="pt-2 border-t border-theme-border/50">
          <p className="text-[10px] font-medium text-theme-muted uppercase tracking-wide mb-2">
            Sensitivity labels
          </p>
          <div className="flex flex-wrap gap-1.5 mb-2 min-h-[1.25rem]">
            {currentLabels.length === 0 ? (
              <span className="text-xs text-theme-muted italic">
                untagged — policy default-allow
              </span>
            ) : (
              currentLabels.map((l) => (
                <Badge key={l} variant="warning">
                  {l}
                </Badge>
              ))
            )}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={labelInput}
              onChange={(e) => setLabelInput(e.target.value)}
              placeholder="pii, financial, secret"
              className="flex-1 text-xs px-2 py-1.5 rounded-md border border-theme-border bg-[var(--theme-surface-1)] text-theme-primary focus:outline-none focus:border-accent"
              disabled={savingLabels}
              aria-label="Comma-separated sensitivity labels"
            />
            <Button
              variant="primary"
              size="sm"
              onClick={saveLabels}
              loading={savingLabels}
              disabled={
                savingLabels ||
                labelInput
                  .split(',')
                  .map((s) => s.trim().toLowerCase())
                  .filter(Boolean)
                  .sort()
                  .join(',') ===
                  currentLabels.slice().sort().join(',')
              }
            >
              Save
            </Button>
          </div>
          <p className="text-[10px] text-theme-muted mt-1">
            Comma-separated. Server normalizes (dedup, lowercase, trim).
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
