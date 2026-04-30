interface ErrorStateProps {
  title?: string
  message: string
  onRetry?: () => void
}

/**
 * Full error state for pages and tabs.
 * Use for primary errors that block the whole view.
 */
export function ErrorState({ title = 'Something went wrong', message, onRetry }: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4" role="alert">
      <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mb-4">
        <span className="text-xl text-red-400" aria-hidden="true">!</span>
      </div>
      <h3 className="text-sm font-medium text-theme-primary mb-1">{title}</h3>
      <p className="text-xs text-theme-muted text-center max-w-sm">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-4 px-4 py-2 text-xs font-medium text-accent hover:text-accent-light transition-colors"
        >
          Try again
        </button>
      )}
    </div>
  )
}

interface InlineErrorProps {
  message: string
  onRetry?: () => void
}

/**
 * Compact error state for sections, modals, and inline areas.
 * Use when full ErrorState is too heavy.
 */
export function InlineError({ message, onRetry }: InlineErrorProps) {
  return (
    <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20" role="alert">
      <p className="text-xs text-red-400">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-2 text-xs text-red-400 underline underline-offset-2 hover:text-red-300"
        >
          Retry
        </button>
      )}
    </div>
  )
}
