import { Skeleton } from './Skeleton'

/**
 * StatSkeleton — placeholder for a `<StatCard>` (label + big number).
 * Sized to roughly match StatCard so the Dashboard's Data row doesn't
 * shift when real counts come in.
 */

export function StatSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading stat"
      aria-busy="true"
      className="rounded-xl border border-theme-border bg-[var(--theme-card-bg)] p-5"
    >
      <Skeleton className="h-3 w-16 mb-3" />
      <Skeleton className="h-7 w-24" />
    </div>
  )
}
