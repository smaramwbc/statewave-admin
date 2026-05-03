import { forwardRef } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

/**
 * FilterChip — compact pill toggle for filter / status segmentation.
 *
 * Use for groups of mutually-distinct toggle states such as
 * "all / active / superseded" memory filters or session-tag filters on
 * the timeline page. Each chip is a real `<button>` carrying
 * `aria-pressed` so assistive tech announces the toggle state.
 *
 * Visual rules:
 *   * dense — small text + tight padding to fit admin chrome
 *   * selected = accent border + accent/10 surface tint + accent text
 *   * unselected = theme border + muted text + theme-surface-1 hover
 *   * an optional `count` renders as a small number after the label so
 *     the chip can carry "Active 12 / Archived 3"-style scannability
 *     without extra wrapper markup
 *
 * Theme-only colours via `--theme-*` variables; the global cursor +
 * focus-ring CSS already applies because this is a `<button>`.
 */

export interface FilterChipProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  selected: boolean
  /** Optional numeric badge after the label. Useful for "Active 12". */
  count?: number
  children: ReactNode
}

const BASE =
  'inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium ' +
  'rounded-full border transition-colors whitespace-nowrap ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ' +
  'focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--theme-surface-0)] ' +
  'disabled:opacity-50 disabled:pointer-events-none'

const SELECTED =
  'border-accent bg-accent/10 text-accent'

const UNSELECTED =
  'border-theme-border text-theme-secondary ' +
  'hover:bg-[var(--theme-surface-1)] hover:text-theme-primary'

export const FilterChip = forwardRef<HTMLButtonElement, FilterChipProps>(
  function FilterChip({ selected, count, children, className, ...rest }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        aria-pressed={selected}
        className={`${BASE} ${selected ? SELECTED : UNSELECTED} ${className ?? ''}`}
        {...rest}
      >
        <span>{children}</span>
        {count !== undefined && (
          <span
            className={`tabular-nums text-[10px] ${
              selected ? 'text-accent/80' : 'text-theme-muted'
            }`}
          >
            {count}
          </span>
        )}
      </button>
    )
  },
)
