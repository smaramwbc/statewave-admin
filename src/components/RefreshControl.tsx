/**
 * Shared "Updated HH:MM:SS · Refresh" header control.
 *
 * Extracted because four pages (Dashboard, Subjects, Jobs, Webhooks) all
 * render the same pattern next to their page title and we want them to
 * stay visually identical. Pages that auto-refresh on an interval just
 * pass `lastFetched` whenever the loader resolves.
 */

import type { MouseEventHandler } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from './ui/Button'

interface RefreshControlProps {
  /** Timestamp of the most recent successful load. `null` while a fresh page
   *  is still loading the first dataset. */
  lastFetched: Date | null
  /** Click handler — should re-run the same loader the page used initially. */
  onRefresh: MouseEventHandler<HTMLButtonElement>
  /** Disables the button (e.g. while a refetch is already in flight). */
  loading?: boolean
}

export function RefreshControl({ lastFetched, onRefresh, loading }: RefreshControlProps) {
  return (
    <div className="flex items-center gap-3">
      {lastFetched && (
        <span className="text-xs text-theme-muted tabular-nums">
          Updated {lastFetched.toLocaleTimeString()}
        </span>
      )}
      <Button
        variant="ghost"
        size="sm"
        onClick={onRefresh}
        loading={loading}
        leftIcon={<RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
        title="Refresh"
        aria-label="Refresh page data"
      >
        Refresh
      </Button>
    </div>
  )
}
