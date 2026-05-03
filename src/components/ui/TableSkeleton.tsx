import { Skeleton } from './Skeleton'

/**
 * TableSkeleton — N skeleton rows × M skeleton cells matching the
 * eventual table layout. Sized to feel like real rows so the
 * skeleton-to-data swap doesn't shift the page.
 *
 * Uses a single `<table>` with synthetic `<tr>` rows rather than divs
 * so it inherits the same column widths Tailwind would apply to the
 * eventual content. Pages can still wrap this in their own
 * border/rounded card.
 */

interface TableSkeletonProps {
  rows?: number
  columns?: number
  /** Optional column widths in Tailwind classes, e.g. ['w-48', 'w-24', ...].
   *  Defaults to a generic mix when omitted. */
  columnWidths?: string[]
  ariaLabel?: string
}

const DEFAULT_WIDTHS = ['w-56', 'w-24', 'w-20', 'w-12', 'w-12', 'w-32']

export function TableSkeleton({
  rows = 8,
  columns = 6,
  columnWidths,
  ariaLabel = 'Loading rows',
}: TableSkeletonProps) {
  const widths = columnWidths ?? DEFAULT_WIDTHS
  return (
    <div
      role="status"
      aria-label={ariaLabel}
      aria-busy="true"
      className="rounded-xl border border-theme-border bg-[var(--theme-card-bg)] overflow-hidden"
    >
      <table className="w-full text-sm">
        <tbody>
          {Array.from({ length: rows }).map((_, r) => (
            <tr
              key={r}
              className="border-b border-theme-border/50 last:border-b-0"
            >
              {Array.from({ length: columns }).map((_, c) => (
                <td key={c} className="px-4 py-3">
                  <Skeleton className={`h-4 ${widths[c % widths.length]}`} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
