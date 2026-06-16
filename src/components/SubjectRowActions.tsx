import { useEffect, useRef, useState } from 'react'
import {
  CheckCircle2,
  CopyPlus,
  Download,
  MoreVertical,
} from 'lucide-react'
import { toast } from 'sonner'
import { Modal, Button, IconButton } from './ui'
import {
  cloneSubject,
  exportMemoryPayload,
  type CloneResult,
  type MemoryScope,
} from '../lib/api'
import { encryptSwmem } from '../lib/swmem'

/**
 * Per-subject row actions, surfaced as a kebab (⋮) icon with a dropdown.
 *
 * Why a kebab instead of inline buttons:
 *   * Two text buttons per row turn the right edge into visual noise — they
 *     look identical to the table data and have no affordance for being
 *     interactive. A single muted icon stays calm and gets prominent on
 *     row hover.
 *   * One column instead of three (action 1, action 2, …) — easy to add
 *     more actions later without growing the table.
 *   * Standard pattern users recognize from Notion, Linear, GitHub, etc.
 *
 * Dropdown uses `position: fixed` so it escapes the table's `overflow-x-auto`
 * stacking context that would otherwise clip an `absolute`-positioned child.
 * Position is recalculated from the button's bounding rect on every open.
 *
 * Currently exposes:
 *   * Clone   — POST /admin/memory/clone
 *   * Export  — POST /admin/memory/export then encrypt locally to .swmem
 */

interface SubjectRowActionsProps {
  subjectId: string
  onCloneComplete?: (newSubjectId: string) => void
}

export function SubjectRowActions({ subjectId, onCloneComplete }: SubjectRowActionsProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [modal, setModal] = useState<null | 'clone' | 'export'>(null)
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Close on outside click / Escape so the dropdown behaves like a real menu.
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      if (
        !btnRef.current?.contains(e.target as Node) &&
        !dropdownRef.current?.contains(e.target as Node)
      ) {
        setMenuOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const toggleMenu = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (menuOpen) {
      setMenuOpen(false)
    } else {
      const rect = btnRef.current?.getBoundingClientRect()
      if (rect) {
        // Position relative to viewport so the dropdown escapes any
        // overflow-clipping ancestor (e.g. the table's overflow-x-auto wrapper).
        setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
      }
      setMenuOpen(true)
    }
  }

  const choose = (action: 'clone' | 'export') => {
    setMenuOpen(false)
    setModal(action)
  }

  return (
    <>
      <IconButton
        ref={btnRef}
        aria-label={`Open subject actions for ${subjectId}`}
        icon={<MoreVertical className="h-3 w-3" />}
        variant="ghost"
        size="xs"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={toggleMenu}
      />
      {menuOpen && menuPos && (
        <div
          ref={dropdownRef}
          role="menu"
          style={{ top: menuPos.top, right: menuPos.right }}
          className="fixed z-50 min-w-[180px] rounded-lg border border-theme-border bg-[var(--theme-card-bg)] shadow-lg py-1"
        >
          <MenuItem onClick={() => choose('clone')} icon={<CopyPlus className="h-3.5 w-3.5" aria-hidden="true" />}>
            Clone subject
          </MenuItem>
          <MenuItem onClick={() => choose('export')} icon={<Download className="h-3.5 w-3.5" aria-hidden="true" />}>
            Export as .swmem
          </MenuItem>
        </div>
      )}
      <Modal
        open={modal === 'clone'}
        onClose={() => setModal(null)}
        title="Clone subject"
        description="Copies episodes and memories into a new subject. The original is left untouched."
      >
        <CloneSubjectForm
          sourceSubjectId={subjectId}
          onComplete={(targetId) => onCloneComplete?.(targetId)}
          onClose={() => setModal(null)}
        />
      </Modal>
      <Modal
        open={modal === 'export'}
        onClose={() => setModal(null)}
        title="Export subject"
        description="Builds an encrypted .swmem archive in your browser. The passphrase is never sent to the server."
      >
        <ExportSubjectForm subjectId={subjectId} onClose={() => setModal(null)} />
      </Modal>
    </>
  )
}

function MenuItem({
  onClick,
  icon,
  children,
}: {
  onClick: () => void
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="w-full text-left px-3 py-1.5 text-xs text-theme-secondary hover:text-theme-primary hover:bg-[var(--theme-surface-1)] transition-colors flex items-center gap-2"
    >
      <span className="text-theme-muted shrink-0">{icon}</span>
      {children}
    </button>
  )
}

// ─── Clone form ──────────────────────────────────────────────────────────────

function CloneSubjectForm({
  sourceSubjectId,
  onComplete,
  onClose,
}: {
  sourceSubjectId: string
  onComplete: (targetId: string) => void
  onClose: () => void
}) {
  const [targetId, setTargetId] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [scope, setScope] = useState<MemoryScope>('episodes_memories_sources')
  const [phase, setPhase] = useState<'idle' | 'running' | 'success' | 'error'>('idle')
  const [result, setResult] = useState<CloneResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setPhase('running')
    setError(null)
    try {
      const r = await cloneSubject({
        source_subject_id: sourceSubjectId,
        target_subject_id: targetId.trim() || undefined,
        target_display_name: displayName.trim() || undefined,
        clone_scope: scope,
      })
      setResult(r)
      setPhase('success')
      toast.success('Subject cloned', {
        description: `${r.target_subject_id} · ${r.episode_count} ep · ${r.memory_count} mem`,
      })
      onComplete(r.target_subject_id)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Clone failed.'
      setError(msg)
      setPhase('error')
      toast.error('Clone failed', { description: msg })
    }
  }

  if (phase === 'success' && result) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-emerald-500 flex items-center gap-1.5">
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          Subject cloned
        </p>
        <SubjectChip label="New subject" subjectId={result.target_subject_id} />
        <p className="text-xs text-theme-muted tabular-nums">
          {result.episode_count} episodes · {result.memory_count} memories
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
          <a
            href={`/subjects/${encodeURIComponent(result.target_subject_id)}`}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg font-medium px-3 py-1.5 text-xs bg-accent text-white hover:opacity-90 transition-colors"
          >
            Open clone
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-theme-muted leading-relaxed">
        Cloning creates an independent subject for experiments. The original
        subject is not changed.
      </p>
      <SubjectChip label="Source" subjectId={sourceSubjectId} />
      <Field label="Target subject ID (optional)">
        <input
          type="text"
          value={targetId}
          onChange={(e) => setTargetId(e.target.value)}
          placeholder="Auto-generated if empty"
          // Mirror the backend's subject-id regex so users see validation
          // failures before hitting the API.
          pattern="[A-Za-z0-9_.\-:]{1,128}"
          className="w-full px-3 py-1.5 text-sm bg-[var(--theme-surface-1)] border border-theme-border rounded-lg text-theme-primary placeholder:text-theme-muted focus:outline-none focus:ring-2 focus:ring-accent/40"
        />
      </Field>
      <Field label="Display name (optional)">
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className="w-full px-3 py-1.5 text-sm bg-[var(--theme-surface-1)] border border-theme-border rounded-lg text-theme-primary placeholder:text-theme-muted focus:outline-none focus:ring-2 focus:ring-accent/40"
        />
      </Field>
      <Field label="Clone scope">
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value as MemoryScope)}
          className="w-full px-3 py-1.5 text-sm bg-[var(--theme-surface-1)] border border-theme-border rounded-lg text-theme-primary focus:outline-none focus:ring-2 focus:ring-accent/40"
        >
          <option value="episodes_memories_sources">
            Episodes + memories + sources (default)
          </option>
          <option value="episodes_and_memories">Episodes + memories</option>
          <option value="episodes">Episodes only</option>
          <option value="memories">Memories only</option>
        </select>
      </Field>
      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-xs text-red-400">
          {/* Surface 409 / 404 / 400 backend errors verbatim — operators
              get the actual reason ("Subject 'foo' already has data")
              instead of a generic "Clone failed". */}
          {error}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onClose} disabled={phase === 'running'}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={submit}
          loading={phase === 'running'}
          disabled={
            // Block submit while in flight AND when the typed target id
            // fails the safe-character pattern. Empty is fine — the
            // backend auto-generates.
            phase === 'running' ||
            (targetId.length > 0 && !/^[A-Za-z0-9_.\-:]{1,128}$/.test(targetId))
          }
        >
          {phase === 'running' ? 'Cloning…' : 'Clone'}
        </Button>
      </div>
    </div>
  )
}

// ─── Export form ─────────────────────────────────────────────────────────────

function ExportSubjectForm({
  subjectId,
  onClose,
}: {
  subjectId: string
  onClose: () => void
}) {
  const [scope, setScope] = useState<MemoryScope>('episodes_memories_sources')
  const [passphrase, setPassphrase] = useState('')
  const [confirm, setConfirm] = useState('')
  const [phase, setPhase] = useState<'idle' | 'fetching' | 'encrypting' | 'success' | 'error'>(
    'idle',
  )
  const [error, setError] = useState<string | null>(null)
  const [filename, setFilename] = useState<string | null>(null)

  const submit = async () => {
    if (passphrase.length < 8) {
      setError('Passphrase must be at least 8 characters.')
      setPhase('error')
      return
    }
    if (passphrase !== confirm) {
      setError('Passphrase and confirmation do not match.')
      setPhase('error')
      return
    }
    setError(null)
    setPhase('fetching')
    try {
      const payload = await exportMemoryPayload({
        subject_ids: [subjectId],
        export_scope: scope,
      })
      setPhase('encrypting')
      const blob = await encryptSwmem(payload, passphrase)
      const ts = new Date().toISOString().replace(/[:.]/g, '-')
      const file = `${subjectId.replace(/[^A-Za-z0-9._-]/g, '_')}-${ts}.swmem`
      const url = URL.createObjectURL(new Blob([blob.buffer as ArrayBuffer]))
      const a = document.createElement('a')
      a.href = url
      a.download = file
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      setFilename(file)
      setPhase('success')
      toast.success('Encrypted archive downloaded', { description: file })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Export failed.'
      setError(msg)
      setPhase('error')
      toast.error('Export failed', { description: msg })
    }
  }

  if (phase === 'success' && filename) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-emerald-500 flex items-center gap-1.5">
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          Encrypted archive downloaded
        </p>
        {/* Filename on its own block with break-all so a long mono token
            (visitor subject ids in particular) wraps inside the modal
            instead of forcing horizontal overflow. */}
        <p
          className="text-xs font-mono text-theme-secondary bg-[var(--theme-surface-1)] border border-theme-border rounded-lg px-2.5 py-2 break-all"
          dir="ltr"
        >
          {filename}
        </p>
        <p className="text-xs text-theme-muted leading-relaxed">
          Keep the passphrase safe. Statewave cannot recover the export
          without it.
        </p>
        <div className="flex justify-end pt-1">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <SubjectChip label="Subject" subjectId={subjectId} />
      <Field label="Export scope">
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value as MemoryScope)}
          className="w-full px-3 py-1.5 text-sm bg-[var(--theme-surface-1)] border border-theme-border rounded-lg text-theme-primary focus:outline-none focus:ring-2 focus:ring-accent/40"
        >
          <option value="episodes_memories_sources">Episodes + memories + sources</option>
          <option value="episodes_and_memories">Episodes + memories</option>
          <option value="episodes">Episodes only</option>
          <option value="memories">Memories only</option>
        </select>
      </Field>
      <Field label="Passphrase">
        <input
          type="password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          autoComplete="new-password"
          minLength={8}
          className="w-full px-3 py-1.5 text-sm bg-[var(--theme-surface-1)] border border-theme-border rounded-lg text-theme-primary focus:outline-none focus:ring-2 focus:ring-accent/40"
        />
      </Field>
      <Field label="Confirm passphrase">
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          className="w-full px-3 py-1.5 text-sm bg-[var(--theme-surface-1)] border border-theme-border rounded-lg text-theme-primary focus:outline-none focus:ring-2 focus:ring-accent/40"
        />
      </Field>
      <p className="text-[10px] text-theme-muted leading-relaxed">
        Exports are encrypted before leaving Statewave. The passphrase is not
        sent to the server. Statewave cannot recover the export without it.
      </p>
      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-xs text-red-400">
          {error}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          disabled={phase === 'fetching' || phase === 'encrypting'}
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={submit}
          loading={phase === 'fetching' || phase === 'encrypting'}
          leftIcon={
            phase === 'idle' || phase === 'error' ? (
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
            ) : undefined
          }
        >
          {phase === 'fetching'
            ? 'Building payload…'
            : phase === 'encrypting'
              ? 'Encrypting…'
              : 'Export .swmem'}
        </Button>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-left text-xs font-medium text-theme-muted mb-1.5">
        {label}
      </label>
      {children}
    </div>
  )
}

/**
 * Renders a "<label>: <subject-id>" row where the subject id is rendered
 * in a monospace chip with `break-all` so a long visitor id (e.g.
 * `demo_web_<32 hex>__support-agent`) wraps cleanly inside the modal
 * instead of forcing the title or container to grow.
 */
function SubjectChip({ label, subjectId }: { label: string; subjectId: string }) {
  return (
    <div className="text-xs">
      <span className="text-theme-muted">{label}:</span>{' '}
      <span
        className="inline-block font-mono text-theme-secondary bg-[var(--theme-surface-1)] border border-theme-border rounded px-1.5 py-0.5 break-all align-middle"
        dir="ltr"
      >
        {subjectId}
      </span>
    </div>
  )
}
