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
  // Mobile gets pull-to-refresh (the PullToRefresh wrapper on each page
  // owns the gesture AND the spinning indicator), so the explicit
  // Refresh button is removed on phones. We do NOT add a separate
  // spinner here either — duplicating the indicator would put two
  // (sometimes three, with the desktop loading state) refresh icons
  // on screen at once during a pull. Just the timestamp is enough
  // chrome on a phone.
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
        className="hidden md:inline-flex"
      >
        Refresh
      </Button>
    </div>
  )
}
