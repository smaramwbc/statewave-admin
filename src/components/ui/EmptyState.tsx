import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

/**
 * Empty-state primitives.
 *
 * The premium-admin polish pass moved EmptyState from "title + description
 * + one optional action" to a small CTA pattern: title, helper copy, an
 * optional icon, and a primary + secondary action. The optional `children`
 * slot lets a caller drop a code snippet or short help block under the
 * actions without us inventing a new component for it.
 *
 * Three variants exist:
 *   EmptyState     — full-page "no data ever" (Subjects/Jobs/Webhooks first run)
 *   NoResultsState — filter-context empty (search came back empty)
 *   InlineEmpty    — compact filler for tabs/sections inside a populated page
 */

interface EmptyStateProps {
  title: string
  description?: string
  /** Optional decorative icon. Defaults to a small "no data" mark. Pass
   *  any lucide icon if a more specific glyph is meaningful. */
  icon?: LucideIcon
  /** Primary CTA — usually the most-likely next step (e.g. "Import / Restore"). */
  primaryAction?: ReactNode
  /** Secondary CTA — e.g. "View docs", "Learn more". */
  secondaryAction?: ReactNode
  /** Optional extra content rendered under the actions. Use for code
   *  snippets, help text, or a list of suggestions. */
  children?: ReactNode
  /** Backwards-compat: older call sites passed a single `action` node.
   *  Treated as `primaryAction` if neither primary nor secondary is set. */
  action?: ReactNode
}

export function EmptyState({
  title,
  description,
  icon: Icon,
  primaryAction,
  secondaryAction,
  children,
  action,
}: EmptyStateProps) {
  // Resolve legacy `action` prop to the new layout slot when nothing else
  // was supplied. Lets the migration land without breaking existing call
  // sites that haven't been updated yet.
  const primary = primaryAction ?? (!secondaryAction ? action : undefined)

  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="w-12 h-12 rounded-full bg-[var(--theme-surface-2)] flex items-center justify-center mb-4">
        {Icon ? (
          <Icon className="h-5 w-5 text-theme-muted" aria-hidden="true" />
        ) : (
          <span className="text-xl text-theme-muted" aria-hidden="true">∅</span>
        )}
      </div>
      <h3 className="text-sm font-medium text-theme-primary mb-1">{title}</h3>
      {description && (
        <p className="text-xs text-theme-muted max-w-md leading-relaxed">{description}</p>
      )}
      {(primary || secondaryAction) && (
        <div className="mt-4 flex items-center gap-2">
          {primary}
          {secondaryAction}
        </div>
      )}
      {children && <div className="mt-4 max-w-md w-full text-left">{children}</div>}
    </div>
  )
}

interface NoResultsStateProps {
  title?: string
  filterSummary?: string
  onClearFilters?: () => void
}

/**
 * Empty state specifically for "no results match your filters" scenarios.
 * Shows filter context and a clear action.
 */
export function NoResultsState({
  title = 'No results found',
  filterSummary,
  onClearFilters,
}: NoResultsStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4">
      <div className="w-10 h-10 rounded-full bg-[var(--theme-surface-2)] flex items-center justify-center mb-3">
        <svg
          className="w-5 h-5 text-theme-muted"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
      </div>
      <h3 className="text-sm font-medium text-theme-primary mb-1">{title}</h3>
      {filterSummary && (
        <p className="text-xs text-theme-muted text-center max-w-sm mb-3">{filterSummary}</p>
      )}
      {onClearFilters && (
        <button
          type="button"
          onClick={onClearFilters}
          className="text-xs text-accent hover:text-accent-light transition-colors"
        >
          Clear filters
        </button>
      )}
    </div>
  )
}

interface InlineEmptyProps {
  message: string
}

/**
 * Compact empty state for sections, modals, and inline areas.
 */
export function InlineEmpty({ message }: InlineEmptyProps) {
  return (
    <div className="flex items-center justify-center gap-2 py-6 text-theme-muted">
      <span className="text-sm" aria-hidden="true">∅</span>
      <span className="text-xs">{message}</span>
    </div>
  )
}
