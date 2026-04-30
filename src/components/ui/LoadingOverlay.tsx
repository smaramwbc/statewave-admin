/**
 * Loading overlay shown during data refetch operations.
 * Use this when you already have data displayed and want to show
 * a non-blocking loading indicator for updates.
 */
export function LoadingOverlay({ message = 'Loading…' }: { message?: string }) {
  return (
    <div className="fixed inset-0 bg-[var(--theme-surface-0)]/50 flex items-center justify-center z-50">
      <div className="bg-[var(--theme-card-bg)] border border-theme-border rounded-lg px-6 py-4 flex items-center gap-3 shadow-lg">
        <div className="w-4 h-4 border-2 border-theme-border border-t-accent rounded-full animate-spin" />
        <span className="text-sm text-theme-secondary">{message}</span>
      </div>
    </div>
  )
}
