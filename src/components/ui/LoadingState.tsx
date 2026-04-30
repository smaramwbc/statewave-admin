interface LoadingStateProps {
  rows?: number
  message?: string
}

/**
 * Skeleton loading state for lists and tables.
 * Use for initial tab/section loads where you want non-blocking feedback.
 */
export function LoadingState({ rows = 5, message }: LoadingStateProps) {
  return (
    <div className="space-y-2" role="status" aria-label={message || 'Loading'}>
      {message && (
        <p className="text-xs text-theme-muted text-center py-4">{message}</p>
      )}
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-12 rounded-lg bg-[var(--theme-surface-1)] animate-pulse"
          style={{ opacity: 1 - i * 0.15 }}
          aria-hidden="true"
        />
      ))}
    </div>
  )
}

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg'
}

/**
 * Simple spinning indicator.
 */
export function LoadingSpinner({ size = 'md' }: LoadingSpinnerProps) {
  const sizeClass = {
    sm: 'w-4 h-4',
    md: 'w-6 h-6',
    lg: 'w-8 h-8',
  }[size]

  return (
    <div 
      className={`${sizeClass} border-2 border-theme-border border-t-accent rounded-full animate-spin`}
      role="status"
      aria-label="Loading"
    />
  )
}

interface InlineLoadingProps {
  message?: string
}

/**
 * Compact inline loading indicator for sections, modals, and small areas.
 * Use when LoadingOverlay is too heavy and you need a centered loading state.
 */
export function InlineLoading({ message = 'Loading…' }: InlineLoadingProps) {
  return (
    <div className="flex items-center justify-center gap-2 py-8" role="status">
      <div className="w-4 h-4 border-2 border-theme-border border-t-accent rounded-full animate-spin" />
      <span className="text-xs text-theme-muted">{message}</span>
    </div>
  )
}
