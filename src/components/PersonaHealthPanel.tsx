/**
 * Read-only health panel for the 5 bundled demo personas.
 *
 * Mounts on /diagnostics. For each persona, surfaces:
 *   - episode + memory counts (after fresh import into an ephemeral subject)
 *   - embedding coverage (% of memories with vectors populated)
 *   - one row per probe query: pass (rank ≤ 10), warn (rank > 10), fail
 *     (not retrieved at all)
 *   - aggregate status badge
 *
 * The panel is a snapshot, not a live monitor. The backend caches the report
 * for 5 min; the "Re-run probes" button forces a fresh sweep.
 */

import { useEffect, useState } from 'react'
import {
  fetchPersonaHealth,
  type PersonaHealth,
  type PersonaHealthReport,
  type PersonaHealthStatus,
} from '../lib/api'
import { Button, SectionLabel } from './ui'

export function PersonaHealthPanel() {
  const [report, setReport] = useState<PersonaHealthReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = (force: boolean) => {
    setError(null)
    if (force) setRefreshing(true)
    else setLoading(true)
    fetchPersonaHealth({ force })
      .then((r) => setReport(r))
      .catch((err) => setError((err as Error).message))
      .finally(() => {
        setLoading(false)
        setRefreshing(false)
      })
  }

  useEffect(() => {
    // Defer the initial load to a microtask so the synchronous
    // setLoading/setError inside `load(false)` doesn't fire as part of
    // the same render frame as mount (lint: react-hooks/no-cascading-renders).
    queueMicrotask(() => load(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="rounded-xl border border-theme-border bg-[var(--theme-card-bg)] p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <SectionLabel>Demo personas</SectionLabel>
          <h2 className="mt-1 text-lg font-semibold text-theme-text">
            Bundled demo packs · retrieval probes
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-theme-muted">
            Each row imports a bundled demo pack into an ephemeral test
            subject, runs three retrieval probes for the persona's wow-moment
            recall, then deletes the test subject. Snapshot is cached
            server-side for 5 minutes.
          </p>
          {report?.fetched_at && (
            <p className="mt-1 text-xs text-theme-muted/80">
              Last probed: {new Date(report.fetched_at).toLocaleString()}
            </p>
          )}
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => load(true)}
          disabled={refreshing}
        >
          {refreshing ? 'Re-running…' : 'Re-run probes'}
        </Button>
      </div>

      <div className="mt-4">
        {loading && !report ? (
          <p className="text-sm text-theme-muted">Probing personas…</p>
        ) : error ? (
          <p className="text-sm text-red-400">Error: {error}</p>
        ) : report && Array.isArray(report.personas) && report.personas.length > 0 ? (
          <div className="space-y-3">
            {report.personas.map((p) => (
              <PersonaRow key={p.pack_id} persona={p} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-theme-muted">No personas reported.</p>
        )}
      </div>
    </div>
  )
}

function PersonaRow({ persona }: { persona: PersonaHealth }) {
  const cov = persona.embedding_coverage
  const covPct = cov === null ? '—' : `${Math.round(cov * 100)}%`
  return (
    <div className="rounded-lg border border-theme-border bg-[var(--theme-surface-1)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <StatusBadge status={persona.status} />
          <span className="font-medium text-theme-text">
            {persona.display_name}
          </span>
          <span className="font-mono text-xs text-theme-muted">{persona.pack_id}</span>
        </div>
        <span className="font-mono text-xs text-theme-muted">
          {persona.version ? `v${persona.version}` : '—'}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-theme-muted">
        <span>
          episodes: <span className="font-mono text-theme-text">{persona.episode_count ?? '—'}</span>
        </span>
        <span>
          memories: <span className="font-mono text-theme-text">{persona.memory_count ?? '—'}</span>
        </span>
        <span>
          embeddings: <span className="font-mono text-theme-text">{covPct}</span>
        </span>
      </div>
      {persona.error && (
        <p className="mt-2 text-xs text-red-400">Error: {persona.error}</p>
      )}
      {persona.probes.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs">
          {persona.probes.map((probe, i) => (
            <li key={i} className="flex items-start gap-2">
              <ProbeStatusIcon rank={probe.rank} pass={probe.pass} />
              <span className="flex-1 text-theme-text">
                {probe.query}
                <span className="ml-2 font-mono text-theme-muted">
                  {probe.rank === null
                    ? 'MISS'
                    : probe.pass
                      ? `rank ${probe.rank}`
                      : `rank ${probe.rank} (warn)`}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: PersonaHealthStatus }) {
  const styles: Record<PersonaHealthStatus, string> = {
    pass: 'bg-green-500/15 text-green-400 border border-green-500/30',
    warn: 'bg-amber-500/15 text-amber-400 border border-amber-500/30',
    fail: 'bg-red-500/15 text-red-400 border border-red-500/30',
    error: 'bg-red-500/15 text-red-400 border border-red-500/30',
    not_configured: 'bg-slate-500/15 text-slate-400 border border-slate-500/30',
  }
  const label: Record<PersonaHealthStatus, string> = {
    pass: 'PASS',
    warn: 'WARN',
    fail: 'FAIL',
    error: 'ERROR',
    not_configured: 'NOT CONFIGURED',
  }
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${styles[status]}`}
    >
      {label[status]}
    </span>
  )
}

function ProbeStatusIcon({ rank, pass }: { rank: number | null; pass: boolean }) {
  if (rank === null)
    return <span className="text-red-400" aria-label="miss">✗</span>
  if (pass) return <span className="text-green-400" aria-label="pass">✓</span>
  return <span className="text-amber-400" aria-label="warn">~</span>
}
