export function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-xl border border-theme-border bg-[var(--theme-card-bg)] p-5">
      <p className="text-xs font-medium text-theme-muted uppercase tracking-wide mb-1">{label}</p>
      <p className="text-2xl font-semibold text-theme-primary tabular-nums">{value.toLocaleString()}</p>
      {sub && <p className="text-xs text-theme-muted mt-1">{sub}</p>}
    </div>
  )
}
