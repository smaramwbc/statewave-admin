interface EmptyStateProps {
  title: string
  description?: string
  action?: React.ReactNode
}

/**
 * Full empty state for pages and tabs when there is no data.
 * Use for initial "no data ever" states.
 */
export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4">
      <div className="w-12 h-12 rounded-full bg-[var(--theme-surface-2)] flex items-center justify-center mb-4">
        <span className="text-xl text-theme-muted" aria-hidden="true">∅</span>
      </div>
      <h3 className="text-sm font-medium text-theme-primary mb-1">{title}</h3>
      {description && <p className="text-xs text-theme-muted text-center max-w-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
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
  onClearFilters 
}: NoResultsStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4">
      <div className="w-10 h-10 rounded-full bg-[var(--theme-surface-2)] flex items-center justify-center mb-3">
        <svg className="w-5 h-5 text-theme-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </div>
      <h3 className="text-sm font-medium text-theme-primary mb-1">{title}</h3>
      {filterSummary && (
        <p className="text-xs text-theme-muted text-center max-w-sm mb-3">{filterSummary}</p>
      )}
      {onClearFilters && (
        <button
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
 * Use when full EmptyState is too heavy.
 */
export function InlineEmpty({ message }: InlineEmptyProps) {
  return (
    <div className="flex items-center justify-center gap-2 py-6 text-theme-muted">
      <span className="text-sm" aria-hidden="true">∅</span>
      <span className="text-xs">{message}</span>
    </div>
  )
}
