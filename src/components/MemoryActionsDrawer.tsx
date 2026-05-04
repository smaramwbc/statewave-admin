import { useState, useEffect } from 'react'
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
  fetchSupportSubjectState,
  importMemoryPayload,
  type StarterPack,
  type StarterPackImportResult,
  type SupportReseedResult,
  type SupportSubjectState,
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
  // The body is split into a child component so it mounts on `open=true`
  // and unmounts on `open=false`. That gives us two release-grade
  // properties for free, without any setState-in-effect:
  //   * `activeTab` resets to "support" on every open via natural
  //     state initialisation (no reset effect, no key prop hack)
  //   * the starter-pack fetch is a pure mount effect — the canonical
  //     useEffect data-fetch pattern — instead of a prop-driven side
  //     effect that has to re-run guarded by `if (open)`
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Import / Restore memory"
      description="Restore Statewave Support, import a starter agent, or open an encrypted .swmem archive. The .swmem passphrase is never sent to Statewave; archives whose passphrases are lost cannot be recovered. Visitor memories are never touched."
      size="lg"
    >
      <DrawerBody onImportComplete={onImportComplete} />
    </Modal>
  )
}

function DrawerBody({ onImportComplete }: { onImportComplete?: () => void }) {
  // `packsLoading` initialises to `true` because the fetch always runs on
  // mount — so we never need a synchronous `setPacksLoading(true)` call
  // inside the effect (which is what the lint rule rightly objects to).
  // All result-side state changes happen inside promise callbacks, which
  // run after the effect body has returned.
  const [packs, setPacks] = useState<StarterPack[]>([])
  const [packsLoading, setPacksLoading] = useState(true)
  const [packsError, setPacksError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<TabId>('support')

  useEffect(() => {
    let cancelled = false
    listStarterPacks()
      .then((result) => {
        if (!cancelled) setPacks(result)
      })
      .catch((e) => {
        if (!cancelled) {
          setPacksError(e instanceof Error ? e.message : 'Failed to load starter packs.')
        }
      })
      .finally(() => {
        if (!cancelled) setPacksLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const supportPack = packs.find((p) => p.kind === 'support_docs')
  const demoPacks = packs.filter((p) => p.kind === 'demo_agent')

  return (
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
          { id: 'archive', label: 'Encrypted memory archive' },
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
              Upload an encrypted <code className="font-mono">.swmem</code>{' '}
              archive. Decryption happens entirely in your browser — the
              passphrase is never sent to Statewave. If the passphrase is
              lost, the archive cannot be recovered.
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

/** Renders a "2 hours ago" / "3 days ago" string from an ISO timestamp.
 *  Falls back to the raw date for anything older than ~6 days. Pure
 *  presentation helper — drift-tolerant so we don't drag in date-fns
 *  for one card. */
function formatRelative(iso: string | null | undefined): string | null {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return null
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  if (days <= 6) return `${days} day${days === 1 ? '' : 's'} ago`
  return new Date(iso).toLocaleDateString()
}

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
  const [state, setState] = useState<SupportSubjectState | null>(null)
  const [stateError, setStateError] = useState<string | null>(null)

  // Fetch state on mount and after every successful reseed so the
  // installed/bundled diff and the "last reseed" banner stay current
  // without requiring the parent drawer to remount the card.
  const refreshState = async () => {
    try {
      const s = await fetchSupportSubjectState()
      setState(s)
      setStateError(null)
    } catch (e) {
      setStateError(e instanceof Error ? e.message : 'Failed to load support state.')
    }
  }
  useEffect(() => {
    void refreshState()
  }, [])

  const run = async () => {
    setPhase('running')
    setError(null)
    try {
      // Manual restore via the drawer is always a force=true call. The
      // version-aware no-op path is for the container-restart auto-update;
      // an operator clicking Restore wants the action to actually happen
      // even when versions match.
      const r = await reseedStatewaveSupport(reason.trim() || undefined, { force: true })
      setResult(r)
      setPhase('success')
      toast.success(r.updated ? 'Statewave Support restored' : 'Already up to date', {
        description: r.updated
          ? `${r.imported_episodes} episodes · ${r.imported_memories} memories`
          : `Pack already at v${r.installed_version}.`,
      })
      onComplete?.()
      void refreshState()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Reseed failed.'
      setError(msg)
      setPhase('error')
      toast.error('Restore failed', { description: msg })
    }
  }

  // Drive label + variant from the version diff so the operator sees at a
  // glance whether they're refreshing or upgrading.
  const installed = state?.installed_version ?? null
  const bundled = state?.bundled_version ?? pack?.version ?? null
  const isUpToDate = state?.is_up_to_date ?? false
  const hasOperatorRows =
    (state?.operator_episode_count ?? 0) > 0 ||
    (state?.operator_memory_count ?? 0) > 0

  const ctaLabel = !state
    ? 'Restore Statewave Support'
    : installed === null
    ? 'Install support pack'
    : isUpToDate
    ? 'Restore Statewave Support'
    : `Update to v${bundled}`

  // When versions differ, raise the visual prominence of the action.
  const ctaVariant: 'primary' | 'secondary' =
    state && !isUpToDate && installed !== null ? 'primary' : 'secondary'

  return (
    <div className="rounded-xl border border-theme-border bg-[var(--theme-card-bg)] p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-theme-primary">
              Statewave Support docs pack
            </p>
            {state && installed !== null && (
              isUpToDate ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 text-[10px] font-medium text-emerald-500 tabular-nums">
                  Up to date
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 text-[10px] font-medium text-amber-400 tabular-nums">
                  Update available
                </span>
              )
            )}
          </div>
          {/* Version line: "installed v1.0.0 → available v1.2.0" or just one
              when both match. Falls back to pack manifest if the live state
              hasn't loaded yet. */}
          {state ? (
            <p className="text-xs text-theme-muted mt-1 tabular-nums">
              {installed === null ? (
                <>Available v{bundled} · not installed</>
              ) : isUpToDate ? (
                <>v{installed} · {state.owned_episode_count} episodes · {state.owned_memory_count} memories</>
              ) : (
                <>
                  Installed v{installed} → Available v{bundled} ·{' '}
                  {state.owned_episode_count} ep / {state.owned_memory_count} mem in subject today
                </>
              )}
            </p>
          ) : pack ? (
            <p className="text-xs text-theme-muted mt-1 tabular-nums">
              v{pack.version} · {pack.episode_count} episodes · {pack.memory_count} memories
            </p>
          ) : null}
          {state && hasOperatorRows && (
            <p className="text-xs text-theme-muted mt-1 tabular-nums">
              + {state.operator_episode_count} episode{state.operator_episode_count === 1 ? '' : 's'}{' '}
              and {state.operator_memory_count} memor{state.operator_memory_count === 1 ? 'y' : 'ies'}{' '}
              added by your team — preserved across restores.
            </p>
          )}
          {state?.last_reseed.imported_at && (
            <p className="text-xs text-theme-muted mt-2 leading-snug">
              <span className="text-theme-secondary">Last refreshed</span>{' '}
              {formatRelative(state.last_reseed.imported_at)}
              {state.last_reseed.reason && (
                <>
                  {' '}— <span className="italic">"{state.last_reseed.reason}"</span>
                </>
              )}
            </p>
          )}
        </div>
        <Button
          variant={ctaVariant}
          size="sm"
          onClick={() => setPhase('confirming')}
          disabled={loading || !pack}
          className="shrink-0"
        >
          {ctaLabel}
        </Button>
      </div>

      {stateError && (
        <p className="text-xs text-amber-400 mt-2">
          Couldn't load support pack state: {stateError}
        </p>
      )}

      {phase === 'confirming' && (
        <div className="mt-4 space-y-3 border-t border-theme-border/50 pt-4">
          <p className="text-xs text-theme-secondary leading-relaxed">
            {installed === null ? (
              <>This will seed the shared support subject from the bundled pack.</>
            ) : isUpToDate ? (
              <>This will reimport the bundled pack — even though the live subject is already at v{bundled}. Pack-owned rows will be replaced; operator-added rows are preserved.</>
            ) : (
              <>This will upgrade the shared support subject from v{installed} to v{bundled}. Pack-owned rows are replaced; any operator-added rows are preserved.</>
            )}{' '}
            Per-visitor memory subjects are never touched.
          </p>
          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-theme-muted font-medium">
              Reason for the audit log
            </span>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. quarterly refresh after docs revision"
              maxLength={200}
              className="mt-1 w-full px-3 py-1.5 text-sm bg-[var(--theme-surface-1)] border border-theme-border rounded-lg text-theme-primary placeholder:text-theme-muted focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
          </label>
          <p className="text-[10px] text-theme-muted leading-snug">
            Recorded on every reseeded row's metadata and shown above as the
            "last refreshed" line. Optional, max 200 characters.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setPhase('idle')}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={run}>
              {installed === null ? 'Seed' : isUpToDate ? 'Reimport' : `Update to v${bundled}`}
            </Button>
          </div>
        </div>
      )}

      {phase === 'running' && (
        <div className="mt-4 flex items-center gap-2 text-xs text-theme-secondary">
          <span className="inline-block w-3 h-3 rounded-full border-2 border-accent border-t-transparent animate-spin" />
          {installed === null ? 'Seeding…' : isUpToDate ? 'Reimporting…' : 'Upgrading…'}
        </div>
      )}

      {phase === 'success' && result && (
        <div className="mt-4 rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-3 flex items-start gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-xs text-emerald-500 font-medium">
              {result.updated
                ? `Rebuilt ${result.subject_id} at v${result.installed_version}`
                : `${result.subject_id} already at v${result.installed_version}`}
            </p>
            {result.updated && (
              <p className="text-xs text-theme-muted mt-1 tabular-nums">
                {result.imported_episodes} episodes · {result.imported_memories} memories
                {result.operator_episodes_preserved !== undefined &&
                 (result.operator_episodes_preserved + (result.operator_memories_preserved ?? 0) > 0) && (
                  <>
                    {' '}·{' '}
                    {result.operator_episodes_preserved + (result.operator_memories_preserved ?? 0)}{' '}
                    operator row{result.operator_episodes_preserved + (result.operator_memories_preserved ?? 0) === 1 ? '' : 's'} preserved
                  </>
                )}
              </p>
            )}
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
          Decrypted in your browser. Passphrase is never sent to Statewave; lost passphrases cannot be recovered.
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
