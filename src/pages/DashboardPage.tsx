import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { StatusDot, StatusChip } from '../components/StatusChip'
import { StatCard } from '../components/StatCard'
import { LoadingOverlay, ErrorState, Modal } from '../components/ui'
import { fetchDashboard, fetchUsage, type DashboardData, type UsageData, type UsageWindow } from '../lib/api'

// ─── Types ───────────────────────────────────────────────────────────────────

type CheckDetail = { name: string; status: string; detail: string; latency_ms: number }

// ─── Helpers ─────────────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-sm font-semibold text-theme-primary uppercase tracking-wide mb-3">{children}</h2>
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [usage, setUsage] = useState<UsageData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastFetched, setLastFetched] = useState<Date | null>(null)
  const [selectedCheck, setSelectedCheck] = useState<CheckDetail | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      console.info('[statewave-admin] Fetching dashboard data…')
      const [dashData, usageData] = await Promise.all([
        fetchDashboard(),
        fetchUsage().catch(() => null),
      ])
      setData(dashData)
      setUsage(usageData)
      console.info('[statewave-admin] Dashboard loaded:', {
        subjects: dashData.counts?.subjects,
        episodes: dashData.counts?.episodes,
        memories: dashData.counts?.memories,
      })
      setError(null)
      setLastFetched(new Date())
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : 'Failed to fetch'
      console.info('[statewave-admin] Fetch failed:', errMsg)
      setError(errMsg)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // Initial fetch and periodic refresh - legitimate async data fetching pattern
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchData()
    const interval = setInterval(fetchData, 30_000)
    return () => clearInterval(interval)
  }, [fetchData])

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-semibold text-theme-primary">Overview</h1>
          <p className="text-sm text-theme-muted mt-0.5">System health and usage summary</p>
        </div>
        <div className="flex items-center gap-3">
          {lastFetched && (
            <span className="text-xs text-theme-muted tabular-nums">
              Updated {lastFetched.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={fetchData}
            className="px-3 py-1.5 text-xs text-theme-muted hover:text-theme-primary border border-theme-border rounded-lg transition-colors"
            title="Refresh"
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      {error && !data && (
        <ErrorState 
          title="Failed to load dashboard" 
          message={error} 
          onRetry={fetchData} 
        />
      )}

      {data && (
        <div className="space-y-8">
          {/* System Status */}
          <section>
            <SectionTitle>System Status</SectionTitle>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Readiness */}
              <div className="rounded-xl border border-theme-border bg-[var(--theme-card-bg)] p-5">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-medium text-theme-muted uppercase tracking-wide">Readiness</p>
                  <StatusChip status={data.readiness.status} />
                </div>
                <div className="space-y-2">
                  {data.readiness.checks.map((c) => {
                    const hasError = c.status !== 'ok' && c.detail
                    return (
                      <div key={c.name} className="flex items-center justify-between text-xs gap-2">
                        <span className="flex items-center gap-2 text-theme-secondary shrink-0">
                          <StatusDot status={c.status} />
                          {c.name}
                        </span>
                        {c.latency_ms ? (
                          <span className="text-theme-muted">{c.latency_ms}ms</span>
                        ) : hasError ? (
                          <button
                            onClick={() => setSelectedCheck(c)}
                            className="text-amber-600 hover:text-amber-500 text-right truncate max-w-[120px] underline underline-offset-2 decoration-dashed cursor-pointer"
                            title="Click to view full error"
                          >
                            View error
                          </button>
                        ) : (
                          <span className="text-theme-muted">—</span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Schema */}
              <div className="rounded-xl border border-theme-border bg-[var(--theme-card-bg)] p-5">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-medium text-theme-muted uppercase tracking-wide">Schema</p>
                  <StatusChip status={data.migration.is_compatible ? 'ok' : 'degraded'} />
                </div>
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-theme-muted">Current</span>
                    <span className="text-theme-secondary font-mono">{data.migration.current_revision || '—'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-theme-muted">Expected</span>
                    <span className="text-theme-secondary font-mono">{data.migration.expected_head}</span>
                  </div>
                  {data.migration.pending_count > 0 && (
                    <p className="text-amber-400 mt-2">{data.migration.pending_count} pending migration(s)</p>
                  )}
                  </div>
                </div>

                {/* Jobs */}
                <div className="rounded-xl border border-theme-border bg-[var(--theme-card-bg)] p-5">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs font-medium text-theme-muted uppercase tracking-wide">Compile Jobs</p>
                    <StatusChip
                      status={
                        (data.jobs['failed'] || 0) > 0
                          ? 'degraded'
                          : (data.jobs['running'] || 0) > 10
                            ? 'degraded'
                            : 'ok'
                      }
                    />
                  </div>
                  <div className="space-y-1.5 text-xs">
                    {Object.entries(data.jobs).length === 0 ? (
                      <p className="text-theme-muted">No jobs recorded</p>
                    ) : (
                      Object.entries(data.jobs).map(([status, count]) => (
                        <Link
                          key={status}
                          to={`/jobs?status=${status}`}
                          className="flex justify-between hover:bg-[var(--theme-surface-1)] -mx-2 px-2 py-0.5 rounded transition-colors group"
                        >
                          <span className="text-theme-muted capitalize group-hover:text-theme-secondary transition-colors">{status}</span>
                          <span className={`tabular-nums group-hover:text-accent transition-colors ${
                            status === 'failed' && count > 0 ? 'text-red-400' :
                            status === 'running' && count > 5 ? 'text-amber-400' :
                            'text-theme-secondary'
                          }`}>{count}</span>
                        </Link>
                      ))
                    )}
                  </div>
                  {Object.entries(data.jobs).length > 0 && (
                    <Link
                      to="/jobs"
                      className="block text-[10px] text-theme-muted hover:text-accent mt-3 pt-2 border-t border-theme-border/50 transition-colors"
                    >
                      View all jobs →
                    </Link>
                  )}
                </div>
              </div>
            </section>

            {/* Data Counts */}
            <section>
              <SectionTitle>Data</SectionTitle>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <StatCard label="Subjects" value={data.counts.subjects} to="/subjects" />
                <StatCard label="Episodes" value={data.counts.episodes} />
                <StatCard label="Memories" value={data.counts.memories} />
              </div>
            </section>

            {/* Usage Metering */}
            {usage && (
              <section>
                <SectionTitle>Usage (rolling)</SectionTitle>
                <div className="rounded-xl border border-theme-border bg-[var(--theme-card-bg)] p-5">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-theme-muted">
                          <th className="text-left font-medium pb-2">Metric</th>
                          <th className="text-right font-medium pb-2">Today</th>
                          <th className="text-right font-medium pb-2">7 days</th>
                          <th className="text-right font-medium pb-2">30 days</th>
                          <th className="text-right font-medium pb-2">All time</th>
                        </tr>
                      </thead>
                      <tbody className="text-theme-secondary">
                        {([['Episodes', usage.episodes], ['Memories', usage.memories], ['Compile jobs', usage.compile_jobs], ['Webhooks', usage.webhooks]] as [string, UsageWindow][]).map(([label, w]) => (
                          <tr key={label} className="border-t border-theme-border/50">
                            <td className="py-1.5 text-theme-muted">{label}</td>
                            <td className="py-1.5 text-right tabular-nums">{w.today.toLocaleString()}</td>
                            <td className="py-1.5 text-right tabular-nums">{w['7d'].toLocaleString()}</td>
                            <td className="py-1.5 text-right tabular-nums">{w['30d'].toLocaleString()}</td>
                            <td className="py-1.5 text-right tabular-nums font-medium">{w.total.toLocaleString()}</td>
                          </tr>
                        ))}
                        <tr className="border-t border-theme-border/50">
                          <td className="py-1.5 text-theme-muted">Active subjects</td>
                          <td className="py-1.5 text-right text-theme-muted">—</td>
                          <td className="py-1.5 text-right tabular-nums">{usage.active_subjects['7d'].toLocaleString()}</td>
                          <td className="py-1.5 text-right tabular-nums">{usage.active_subjects['30d'].toLocaleString()}</td>
                          <td className="py-1.5 text-right tabular-nums font-medium">{usage.active_subjects.total.toLocaleString()}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            )}

            {/* Webhooks */}
            <section>
              <SectionTitle>Webhooks</SectionTitle>
              <div className="rounded-xl border border-theme-border bg-[var(--theme-card-bg)] p-5">
                {data.webhooks.total === 0 ? (
                  <p className="text-xs text-theme-muted">No webhook events recorded</p>
                ) : (
                  <>
                    <div className="grid grid-cols-3 gap-4 text-center">
                      <Link
                        to="/webhooks?status=delivered"
                        className="p-2 -m-2 rounded-lg hover:bg-[var(--theme-surface-1)] transition-colors group"
                      >
                        <p className="text-xl font-semibold text-theme-primary tabular-nums group-hover:text-accent transition-colors">{data.webhooks.delivered}</p>
                        <p className="text-xs text-theme-muted mt-0.5">Delivered</p>
                      </Link>
                      <Link
                        to="/webhooks?status=pending"
                        className="p-2 -m-2 rounded-lg hover:bg-[var(--theme-surface-1)] transition-colors group"
                      >
                        <p className={`text-xl font-semibold tabular-nums group-hover:text-accent transition-colors ${data.webhooks.pending > 0 ? 'text-amber-400' : 'text-theme-primary'}`}>
                          {data.webhooks.pending}
                        </p>
                        <p className="text-xs text-theme-muted mt-0.5">Pending</p>
                      </Link>
                      <Link
                        to="/webhooks?status=dead_letter"
                        className="p-2 -m-2 rounded-lg hover:bg-[var(--theme-surface-1)] transition-colors group"
                      >
                        <p className={`text-xl font-semibold tabular-nums group-hover:text-accent transition-colors ${data.webhooks.dead_letter > 0 ? 'text-red-400' : 'text-theme-primary'}`}>
                          {data.webhooks.dead_letter}
                        </p>
                        <p className="text-xs text-theme-muted mt-0.5">Dead Letter</p>
                      </Link>
                    </div>
                    <Link
                      to="/webhooks"
                      className="block text-[10px] text-theme-muted hover:text-accent mt-4 pt-3 border-t border-theme-border/50 transition-colors text-center"
                    >
                      View all webhooks →
                    </Link>
                  </>
                )}
              </div>
            </section>
          </div>
        )}

      {/* Loading overlay for initial load and refetch */}
      {loading && <LoadingOverlay message={data ? "Refreshing dashboard…" : "Loading dashboard…"} />}

      {/* Error detail modal */}
      <Modal
        open={!!selectedCheck}
        onClose={() => setSelectedCheck(null)}
        title={`Error: ${selectedCheck?.name ?? ''}`}
      >
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <StatusDot status={selectedCheck?.status ?? 'error'} />
            <span className="text-sm font-medium text-theme-primary capitalize">{selectedCheck?.name}</span>
          </div>
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
            <p className="text-xs font-mono text-red-400 whitespace-pre-wrap break-all leading-relaxed">
              {selectedCheck?.detail}
            </p>
          </div>
          <p className="text-xs text-theme-muted">
            This check failed during the last health probe. Review the error above and check your database or service configuration.
          </p>
        </div>
      </Modal>
    </div>
  )
}
