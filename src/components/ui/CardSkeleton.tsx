import { Skeleton } from './Skeleton'

/**
 * CardSkeleton — bordered card placeholder used by Dashboard system-status
 * cards while readiness/jobs/webhooks aggregations are still loading.
 * The header strip + 3-line body roughly matches StatusChip + check
 * rows so the swap to real content stays steady.
 */

interface CardSkeletonProps {
  /** Number of body lines inside the card. Default 3 matches the
   *  Dashboard's readiness/schema/jobs cards. */
  lines?: number
  className?: string
}

export function CardSkeleton({ lines = 3, className = '' }: CardSkeletonProps) {
  return (
    <div
      role="status"
      aria-label="Loading card"
      aria-busy="true"
      className={`rounded-xl border border-theme-border bg-[var(--theme-card-bg)] p-5 ${className}`}
    >
      <div className="flex items-center justify-between mb-3">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-4 w-12" />
      </div>
      <div className="space-y-2">
        {Array.from({ length: lines }).map((_, i) => (
          <div key={i} className="flex items-center justify-between">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-10" />
          </div>
        ))}
      </div>
    </div>
  )
}
