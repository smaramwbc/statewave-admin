import { useState, useEffect, useCallback } from 'react'
import {
  CheckCircle2,
  XCircle,
  Upload,
  Lock,
  LifeBuoy,
  Bot,
  FileLock2,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Modal, Button, Tabs } from './ui'
import {
  listStarterPacks,
  importStarterPack,
  reseedStatewaveSupport,
  importMemoryPayload,
  type StarterPack,
  type StarterPackImportResult,
  type SupportReseedResult,
  type MemoryImportResult,
} from '../lib/api'
import {
  decryptSwmem,
  previewDecryptedPayload,
  SwmemError,
  type DecryptedSwmem,
} from '../lib/swmem'

/**
 * Subject-page drawer for platform-level memory actions, surfaced as three
 * tabs so each section gets the full modal width and the operator only
 * sees one task at a time:
 *
 *   support  — rebuild the shared `statewave-support-docs` subject from the
 *              bundled `statewave-support-agent` starter pack. Vendor-neutral
 *              (no GitHub Actions). Does NOT touch visitor memory subjects.
 *   agents   — import any of the 5 demo persona packs as a fresh
 *              tenant-owned subject.
 *   archive  — upload a `.swmem` file, decrypt it locally with the
 *              passphrase, preview, then ingest. The passphrase NEVER
 *              leaves the browser; decryption is pure WebCrypto.
 */

type TabId = 'support' | 'agents' | 'archive'

interface MemoryActionsDrawerProps {
  open: boolean
  onClose: () => void
  /** Called whenever a successful import/reseed completes — the caller is
   *  expected to refetch the Subjects list so the new subject appears. */
  onImportComplete?: () => void
}

export function MemoryActionsDrawer({
  open,
  onClose,
  onImportComplete,
}: MemoryActionsDrawerProps) {
  const [packs, setPacks] = useState<StarterPack[]>([])
  const [packsLoading, setPacksLoading] = useState(false)
  const [packsError, setPacksError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<TabId>('support')

  const loadPacks = useCallback(async () => {
    setPacksLoading(true)
    setPacksError(null)
    try {
      setPacks(await listStarterPacks())
    } catch (e) {
      setPacksError(e instanceof Error ? e.message : 'Failed to load starter packs.')
    } finally {
      setPacksLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) {
      void loadPacks()
      // Reset to the most-likely-needed tab on every open. Most operators
      // hit this drawer to restore Statewave Support (the original 404 use
      // case), so that's the default.
      setActiveTab('support')
    }
  }, [open, loadPacks])

  const supportPack = packs.find((p) => p.kind === 'support_docs')
  const demoPacks = packs.filter((p) => p.kind === 'demo_agent')

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Import / Restore memory"
      description="Restore Statewave Support, import a starter agent, or open an encrypted .swmem archive. Visitor memories are never touched."
      size="lg"
    >
      <div className="space-y-5">
        {packsError && (
          <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-xs text-red-400">
            {packsError}
          </div>
        )}

        <Tabs
          tabs={[
            { id: 'support', label: 'Statewave Support' },
            { id: 'agents', label: 'Demo agents', count: demoPacks.length },
            { id: 'archive', label: 'Memory archive' },
          ]}
          activeTab={activeTab}
          onTabChange={(id) => setActiveTab(id as TabId)}
        />

        {activeTab === 'support' && (
          <TabIntro
            icon={LifeBuoy}
            blurb={
              <>
                Restores the shared{' '}
                <span className="font-mono text-theme-secondary">statewave-support-docs</span>{' '}
                memory used for support-agent grounding. This does not reset
                visitor memories.
              </>
            }
          >
            <SupportRestoreCard
              pack={supportPack}
              loading={packsLoading}
              onComplete={onImportComplete}
            />
          </TabIntro>
        )}

        {activeTab === 'agents' && (
          <TabIntro
            icon={Bot}
            blurb="Sample starter memories for developer onboarding. Each import creates a new tenant-owned subject you can edit, reset, or extend."
          >
            {packsLoading && demoPacks.length === 0 ? (
              <p className="text-xs text-theme-muted">Loading starter packs…</p>
            ) : (
              <div className="rounded-xl border border-theme-border bg-[var(--theme-card-bg)] divide-y divide-theme-border/60">
                {demoPacks.map((p) => (
                  <DemoAgentRow key={p.pack_id} pack={p} onComplete={onImportComplete} />
                ))}
              </div>
            )}
          </TabIntro>
        )}

        {activeTab === 'archive' && (
          <TabIntro
            icon={FileLock2}
            blurb={
              <>
                Upload a <code className="font-mono">.swmem</code> file.
                Decryption happens entirely in your browser — your passphrase
                is never sent to the server.
              </>
            }
          >
            <SwmemImporter onComplete={onImportComplete} />
          </TabIntro>
        )}

        <div className="text-[10px] text-theme-muted leading-relaxed border-t border-theme-border/50 pt-3">
          Memory actions never reset visitor memories. Per-visitor{' '}
          <span className="font-mono">demo_web_*__statewave-support</span>{' '}
          subjects are untouched by every action above.
        </div>
      </div>
    </Modal>
  )
}

// ─── Tab panel wrapper (icon + intro blurb) ─────────────────────────────────

function TabIntro({
  icon: Icon,
  blurb,
  children,
}: {
  icon: LucideIcon
  blurb: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 text-xs text-theme-muted leading-relaxed">
        <span className="shrink-0 mt-0.5 inline-flex items-center justify-center w-7 h-7 rounded-lg bg-[var(--theme-surface-2)] text-theme-secondary">
          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
        <p className="flex-1">{blurb}</p>
      </div>
      {children}
    </div>
  )
}

// ─── Section A: Support restore card ─────────────────────────────────────────

function SupportRestoreCard({
  pack,
  loading,
  onComplete,
}: {
  pack: StarterPack | undefined
  loading: boolean
  onComplete?: () => void
}) {
  const [phase, setPhase] = useState<'idle' | 'confirming' | 'running' | 'success' | 'error'>(
    'idle',
  )
  const [reason, setReason] = useState('')
  const [result, setResult] = useState<SupportReseedResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    setPhase('running')
    setError(null)
    try {
      const r = await reseedStatewaveSupport(reason.trim() || undefined)
      setResult(r)
      setPhase('success')
      toast.success('Statewave Support restored', {
        description: `${r.imported_episodes} episodes · ${r.imported_memories} memories`,
      })
      onComplete?.()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Reseed failed.'
      setError(msg)
      setPhase('error')
      toast.error('Restore failed', { description: msg })
    }
  }

  return (
    <div className="rounded-xl border border-theme-border bg-[var(--theme-card-bg)] p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-theme-primary">
            Statewave Support docs pack
          </p>
          {pack && (
            <p className="text-xs text-theme-muted mt-1 tabular-nums">
              v{pack.version} · {pack.episode_count} episodes ·{' '}
              {pack.memory_count} memories
            </p>
          )}
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setPhase('confirming')}
          disabled={loading || !pack}
          className="shrink-0"
        >
          Restore Statewave Support
        </Button>
      </div>

      {phase === 'confirming' && (
        <div className="mt-4 space-y-3 border-t border-theme-border/50 pt-4">
          <p className="text-xs text-theme-secondary leading-relaxed">
            This will purge and rebuild the shared support subject from the
            bundled starter pack. Per-visitor memory subjects are not touched.
          </p>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (optional, max 200 chars)"
            maxLength={200}
            className="w-full px-3 py-1.5 text-sm bg-[var(--theme-surface-1)] border border-theme-border rounded-lg text-theme-primary placeholder:text-theme-muted focus:outline-none focus:ring-2 focus:ring-accent/40"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setPhase('idle')}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={run}>
              Restore
            </Button>
          </div>
        </div>
      )}

      {phase === 'running' && (
        <div className="mt-4 flex items-center gap-2 text-xs text-theme-secondary">
          <span className="inline-block w-3 h-3 rounded-full border-2 border-accent border-t-transparent animate-spin" />
          Rebuilding…
        </div>
      )}

      {phase === 'success' && result && (
        <div className="mt-4 rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-3 flex items-start gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-xs text-emerald-500 font-medium">
              Rebuilt {result.subject_id}
            </p>
            <p className="text-xs text-theme-muted mt-1 tabular-nums">
              {result.imported_episodes} episodes · {result.imported_memories} memories
            </p>
          </div>
        </div>
      )}

      {phase === 'error' && (
        <div className="mt-4 rounded-lg bg-red-500/10 border border-red-500/20 p-3 flex items-start gap-2">
          <XCircle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
          <p className="text-xs text-red-400 whitespace-pre-wrap">{error}</p>
        </div>
      )}
    </div>
  )
}

// ─── Section B: Demo agent row ──────────────────────────────────────────────

function DemoAgentRow({
  pack,
  onComplete,
}: {
  pack: StarterPack
  onComplete?: () => void
}) {
  const [phase, setPhase] = useState<'idle' | 'running' | 'success' | 'error'>('idle')
  const [result, setResult] = useState<StarterPackImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    setPhase('running')
    setError(null)
    try {
      const r = await importStarterPack({
        pack_id: pack.pack_id,
        conflict_strategy: 'create_copy',
      })
      setResult(r)
      setPhase('success')
      toast.success('Starter pack imported', {
        description: `${pack.display_name} → ${r.target_subject_id}`,
      })
      onComplete?.()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Import failed.'
      setError(msg)
      setPhase('error')
      toast.error('Import failed', { description: msg })
    }
  }

  // Single-column horizontal row layout. The grid-of-cards pattern from the
  // previous design wasted vertical space and clipped descriptions; rows are
  // easier to scan when there are >3 packs.
  return (
    <div className="flex items-center gap-4 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-theme-primary truncate">
            {pack.display_name}
          </p>
          <span className="text-[10px] text-theme-muted tabular-nums shrink-0">
            v{pack.version} · {pack.episode_count} ep · {pack.memory_count} mem
          </span>
        </div>
        <p className="text-xs text-theme-muted mt-0.5 leading-relaxed line-clamp-2">
          {pack.description}
        </p>
        {phase === 'success' && result && (
          <p className="text-[11px] text-emerald-500 mt-1 truncate flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="font-mono">{result.target_subject_id}</span>
          </p>
        )}
        {phase === 'error' && (
          <p
            className="text-[11px] text-red-400 mt-1 truncate flex items-center gap-1"
            title={error ?? ''}
          >
            <XCircle className="h-3 w-3 shrink-0" aria-hidden="true" />
            {error}
          </p>
        )}
      </div>
      <Button
        variant="secondary"
        size="sm"
        onClick={run}
        loading={phase === 'running'}
        className="shrink-0"
      >
        {phase === 'running' ? 'Importing…' : 'Import'}
      </Button>
    </div>
  )
}

// ─── Section C: .swmem importer ──────────────────────────────────────────────

function SwmemImporter({ onComplete }: { onComplete?: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [passphrase, setPassphrase] = useState('')
  const [phase, setPhase] = useState<
    'idle' | 'decrypting' | 'preview' | 'importing' | 'success' | 'error'
  >('idle')
  const [decrypted, setDecrypted] = useState<DecryptedSwmem | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<MemoryImportResult | null>(null)

  const reset = () => {
    setFile(null)
    setPassphrase('')
    setPhase('idle')
    setDecrypted(null)
    setError(null)
    setResult(null)
  }

  const decrypt = async () => {
    if (!file) return
    setPhase('decrypting')
    setError(null)
    try {
      const buf = new Uint8Array(await file.arrayBuffer())
      const dec = await decryptSwmem(buf, passphrase)
      setDecrypted(dec)
      setPhase('preview')
    } catch (e) {
      setError(e instanceof SwmemError ? e.message : 'Failed to decrypt .swmem.')
      setPhase('error')
    }
  }

  const ingest = async () => {
    if (!decrypted) return
    setPhase('importing')
    setError(null)
    try {
      // Note: passphrase is NOT included. Only the decrypted payload travels
      // to the server. We re-confirm this in tests.
      const r = await importMemoryPayload({
        payload: decrypted.payload,
        conflict_strategy: 'create_copy',
      })
      setResult(r)
      setPhase('success')
      toast.success('Archive imported', {
        description: `${r.imported_episodes} episodes · ${r.imported_memories} memories`,
      })
      onComplete?.()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Import failed.'
      setError(msg)
      setPhase('error')
      toast.error('Import failed', { description: msg })
    }
  }

  if (phase === 'success' && result) {
    return (
      <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-3 space-y-2">
        <p className="text-xs text-emerald-500 font-medium flex items-center gap-1.5">
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
          Imported {result.imported_episodes} episodes · {result.imported_memories} memories
        </p>
        <p className="text-[10px] text-theme-muted">
          New subject ids: {result.imported_subjects.join(', ') || '—'}
        </p>
        <button
          type="button"
          onClick={reset}
          className="text-[10px] text-accent hover:underline"
        >
          Import another
        </button>
      </div>
    )
  }

  if (phase === 'preview' && decrypted) {
    const summary = previewDecryptedPayload(decrypted.payload)
    return (
      <div className="rounded-xl border border-theme-border bg-[var(--theme-card-bg)] p-3 space-y-3">
        <p className="text-xs font-semibold text-theme-primary">Decrypted preview</p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
          <span className="text-theme-muted">Exported at</span>
          <span className="text-theme-secondary tabular-nums">
            {new Date(summary.exported_at).toLocaleString()}
          </span>
          <span className="text-theme-muted">Export scope</span>
          <span className="text-theme-secondary">{summary.export_scope}</span>
          <span className="text-theme-muted">Subjects</span>
          <span className="text-theme-secondary tabular-nums">{summary.subject_count}</span>
          <span className="text-theme-muted">Episodes</span>
          <span className="text-theme-secondary tabular-nums">{summary.episode_count}</span>
          <span className="text-theme-muted">Memories</span>
          <span className="text-theme-secondary tabular-nums">{summary.memory_count}</span>
        </div>
        {summary.original_subject_ids.length > 0 && (
          <p className="text-[10px] text-theme-muted">
            Original ids: {summary.original_subject_ids.join(', ')}
          </p>
        )}
        <p className="text-[10px] text-theme-muted">
          New subject ids will be generated by default to avoid collisions.
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={reset}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={ingest}>
            Import archive
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-theme-border bg-[var(--theme-card-bg)] p-3 space-y-3">
      <input
        type="file"
        accept=".swmem,application/octet-stream"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        className="block w-full text-xs text-theme-secondary file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border file:border-theme-border file:bg-[var(--theme-surface-1)] file:text-theme-primary file:text-xs hover:file:bg-[var(--theme-surface-2)]"
      />
      <input
        type="password"
        value={passphrase}
        onChange={(e) => setPassphrase(e.target.value)}
        placeholder="Passphrase"
        autoComplete="off"
        className="w-full px-3 py-1.5 text-sm bg-[var(--theme-surface-1)] border border-theme-border rounded-lg text-theme-primary placeholder:text-theme-muted focus:outline-none focus:ring-2 focus:ring-accent/40"
      />
      {error && (
        <p className="text-xs text-red-400">{error}</p>
      )}
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] text-theme-muted flex items-center gap-1">
          <Lock className="h-3 w-3" aria-hidden="true" />
          Passphrase is not sent to the server.
        </p>
        <Button
          variant="secondary"
          size="sm"
          onClick={decrypt}
          disabled={!file || !passphrase}
          loading={phase === 'decrypting'}
          leftIcon={<Upload className="h-3.5 w-3.5" aria-hidden="true" />}
        >
          {phase === 'decrypting' ? 'Decrypting…' : 'Decrypt & preview'}
        </Button>
      </div>
    </div>
  )
}
