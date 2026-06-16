import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Copy, Check, ExternalLink, Tag, Clock, Shield, FileText } from 'lucide-react'
import { Modal, Badge, Button } from './ui'
import { MemoryEvolutionSection } from './MemoryEvolutionSection'
import { setMemoryLabels } from '../lib/api'
import type { MemoryListItem } from '../lib/api'

interface MemoryDetailModalProps {
  memory: MemoryListItem | null
  subjectId?: string
  tenantId?: string | null
  fromContext?: string
  onClose: () => void
  onViewSourceEpisodes?: (memory: MemoryListItem) => void
  onNavigateToMemory?: (memory: MemoryListItem) => void
  onMemoryUpdated?: (updated: MemoryListItem) => void
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  function copy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <button
      onClick={copy}
      className="ml-1.5 inline-flex items-center text-theme-muted hover:text-theme-secondary transition-colors"
      title="Copy to clipboard"
    >
      {copied
        ? <Check className="w-3 h-3 text-emerald-400" />
        : <Copy className="w-3 h-3" />}
    </button>
  )
}

function ConfidenceMeter({ value }: { value: number }) {
  const pct = Math.round(value * 100)
  const color = pct >= 80 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-400' : 'bg-red-400'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-[var(--theme-surface-1)] overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-medium tabular-nums text-theme-secondary w-8 text-right">{pct}%</span>
    </div>
  )
}

function SectionHeading({ icon: Icon, children }: { icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 mb-2">
      <Icon className="w-3.5 h-3.5 text-theme-muted" />
      <span className="text-[10px] font-semibold uppercase tracking-widest text-theme-muted">{children}</span>
    </div>
  )
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
  const [labelInput, setLabelInput] = useState('')
  const [savingLabels, setSavingLabels] = useState(false)
  const [currentLabels, setCurrentLabels] = useState<string[]>([])
  const [editingLabels, setEditingLabels] = useState(false)

  useEffect(() => {
    const labels = memory?.sensitivity_labels ?? []
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCurrentLabels(labels)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLabelInput(labels.join(', '))
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEditingLabels(false)
  }, [memory?.id])

  if (!memory) return null

  const saveLabels = async () => {
    setSavingLabels(true)
    try {
      const parsed = labelInput.split(',').map((s) => s.trim()).filter(Boolean)
      const updated = await setMemoryLabels(memory.id, parsed, tenantId ?? undefined)
      setCurrentLabels(updated.sensitivity_labels ?? [])
      setLabelInput((updated.sensitivity_labels ?? []).join(', '))
      setEditingLabels(false)
      toast.success(
        (updated.sensitivity_labels ?? []).length === 0
          ? 'Labels cleared'
          : `Saved ${(updated.sensitivity_labels ?? []).length} label(s)`,
      )
      onMemoryUpdated?.(updated)
    } catch (e) {
      toast.error('Failed to save labels', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setSavingLabels(false)
    }
  }

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })

  return (
    <Modal
      open={!!memory}
      onClose={onClose}
      title="Memory Details"
      size="xl"
      description={fromContext ? `From ${fromContext}` : undefined}
    >
      {/* ── Top status bar ───────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 pb-4 mb-4 border-b border-theme-border">
        <Badge variant={memory.status === 'active' ? 'success' : 'muted'}>
          {memory.kind.replace(/_/g, ' ')}
        </Badge>
        {memory.status === 'superseded' && <Badge variant="warning">superseded</Badge>}
        <div className="ml-auto flex items-center gap-3 min-w-[160px]">
          <span className="text-[10px] text-theme-muted uppercase tracking-wide">Confidence</span>
          <div className="flex-1 min-w-[100px]">
            <ConfidenceMeter value={memory.confidence} />
          </div>
        </div>
      </div>

      {/* ── Two-column body ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Left — primary content (2/3) */}
        <div className="lg:col-span-2 space-y-5">

          {/* Content */}
          <div>
            <SectionHeading icon={FileText}>Content</SectionHeading>
            <p className="text-sm text-theme-primary leading-relaxed rounded-lg bg-[var(--theme-surface-1)] px-4 py-3 border border-theme-border/50">
              {memory.content}
            </p>
          </div>

          {/* Summary */}
          {memory.summary && (
            <div>
              <SectionHeading icon={FileText}>Summary</SectionHeading>
              <p className="text-sm text-theme-secondary leading-relaxed">{memory.summary}</p>
            </div>
          )}

          {/* Source episodes */}
          {memory.source_episode_ids.length > 0 && onViewSourceEpisodes && (
            <button
              onClick={() => onViewSourceEpisodes(memory)}
              className="inline-flex items-center gap-1.5 text-xs text-accent hover:text-accent-light"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              View {memory.source_episode_ids.length} source episode{memory.source_episode_ids.length !== 1 ? 's' : ''}
            </button>
          )}
        </div>

        {/* Right — metadata sidebar (1/3) */}
        <div className="space-y-5">

          {/* Memory ID */}
          <div>
            <SectionHeading icon={FileText}>Memory ID</SectionHeading>
            <div className="flex items-start gap-1 rounded-lg bg-[var(--theme-surface-1)] px-3 py-2 border border-theme-border/50">
              <span className="text-[11px] font-mono text-theme-secondary break-all leading-relaxed flex-1">
                {memory.id}
              </span>
              <CopyButton text={memory.id} />
            </div>
          </div>

          {/* Timestamps */}
          <div>
            <SectionHeading icon={Clock}>Timestamps</SectionHeading>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between gap-2">
                <span className="text-theme-muted shrink-0">Created</span>
                <span className="text-theme-secondary text-right">{fmt(memory.created_at)}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-theme-muted shrink-0">Valid from</span>
                <span className="text-theme-secondary text-right">{fmt(memory.valid_from)}</span>
              </div>
              {memory.valid_to && (
                <div className="flex justify-between gap-2">
                  <span className="text-theme-muted shrink-0">Valid to</span>
                  <span className="text-theme-secondary text-right">{fmt(memory.valid_to)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Sensitivity labels */}
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <Shield className="w-3.5 h-3.5 text-theme-muted" />
              <span className="text-[10px] font-semibold uppercase tracking-widest text-theme-muted flex-1">Labels</span>
              {!editingLabels && (
                <button
                  onClick={() => setEditingLabels(true)}
                  className="text-[10px] text-accent hover:text-accent-light"
                >
                  <Tag className="w-3 h-3 inline mr-0.5" />Edit
                </button>
              )}
            </div>

            {editingLabels ? (
              <div className="space-y-2">
                <input
                  type="text"
                  value={labelInput}
                  onChange={(e) => setLabelInput(e.target.value)}
                  placeholder="pii, financial, secret"
                  autoFocus
                  className="w-full text-xs px-2.5 py-2 rounded-lg border border-theme-border bg-[var(--theme-surface-1)] text-theme-primary focus:outline-none focus:border-accent"
                  disabled={savingLabels}
                  aria-label="Comma-separated sensitivity labels"
                  onKeyDown={(e) => { if (e.key === 'Enter') saveLabels(); if (e.key === 'Escape') setEditingLabels(false) }}
                />
                <p className="text-[10px] text-theme-muted">Comma-separated · server deduplicates &amp; lowercases</p>
                <div className="flex gap-2">
                  <Button variant="primary" size="sm" onClick={saveLabels} loading={savingLabels}
                    disabled={savingLabels || labelInput.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean).sort().join(',') === currentLabels.slice().sort().join(',')}>
                    Save
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => { setEditingLabels(false); setLabelInput(currentLabels.join(', ')) }}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5 min-h-[1.5rem]">
                {currentLabels.length === 0 ? (
                  <span className="text-xs text-theme-muted italic">untagged — default allow</span>
                ) : (
                  currentLabels.map((l) => (
                    <Badge key={l} variant="warning">{l}</Badge>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Memory Evolution — full width ─────────────────────────────────── */}
      {subjectId && (
        <div className="mt-6 pt-5 border-t border-theme-border">
          <MemoryEvolutionSection
            memoryId={memory.id}
            subjectId={subjectId}
            tenantId={tenantId ?? null}
            currentStatus={memory.status}
            onMemoryClick={onNavigateToMemory}
          />
        </div>
      )}
    </Modal>
  )
}
