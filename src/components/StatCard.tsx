import { Link } from 'react-router-dom'

export function StatCard({ label, value, sub, to }: { label: string; value: string | number; sub?: string; to?: string }) {
  const content = (
    <>
      <p className="text-xs font-medium text-theme-muted uppercase tracking-wide mb-1">{label}</p>
      <p className="text-2xl font-semibold text-theme-primary tabular-nums">{typeof value === 'number' ? value.toLocaleString() : value}</p>
      {sub && <p className="text-xs text-theme-muted mt-1">{sub}</p>}
    </>
  )

  if (to) {
    return (
      <Link
        to={to}
        className="block rounded-xl border border-theme-border bg-[var(--theme-card-bg)] p-5 hover:border-accent/30 hover:bg-[var(--theme-surface-1)] transition-colors group"
      >
        {content}
        <p className="text-[10px] text-theme-muted mt-2 opacity-0 group-hover:opacity-100 transition-opacity">View all →</p>
      </Link>
    )
  }

  return (
    <div className="rounded-xl border border-theme-border bg-[var(--theme-card-bg)] p-5">
      {content}
    </div>
  )
}
