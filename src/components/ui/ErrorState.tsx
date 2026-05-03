import { useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react'
import { Button } from './Button'

/**
 * Structured error states.
 *
 * The premium-admin polish pass restructured ErrorState from
 * "title + message + retry" to a fuller pattern: what broke (title),
 * what to try (suggestion), opaque retry, optional technical details
 * folded behind a disclosure, and an optional docs link. Operators get
 * a useful first read without us dumping raw stack traces into the UI.
 *
 * Two variants:
 *   ErrorState   — full-page error block (page-level loader failures)
 *   InlineError  — compact red strip for section / inline errors
 */

interface ErrorStateProps {
  title?: string
  /** Human-readable summary — what broke. */
  message: string
  /** What to try next (e.g. "Check that the backend is reachable" or
   *  "Verify the API key has admin scope"). Renders right under the
   *  message, not in the disclosure. */
  suggestion?: string
  /** Raw technical details (status codes, request ids, the underlying
   *  error message). Folded behind a disclosure so the page reads
   *  cleanly but the operator can dig in if they want. We deliberately
   *  do NOT recommend dumping the full error object here — pass a
   *  trimmed string or a short multi-line block. */
  technicalDetails?: string
  onRetry?: () => void
  /** External docs / runbook link. Opens in a new tab. */
  docsHref?: string
  docsLabel?: string
}

export function ErrorState({
  title = 'Something went wrong',
  message,
  suggestion,
  technicalDetails,
  onRetry,
  docsHref,
  docsLabel = 'Open the runbook',
}: ErrorStateProps) {
  const [detailsOpen, setDetailsOpen] = useState(false)
  return (
    <div
      className="flex flex-col items-center justify-center py-16 px-4 text-center"
      role="alert"
    >
      <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mb-4">
        <AlertTriangle className="h-5 w-5 text-red-400" aria-hidden="true" />
      </div>
      <h3 className="text-sm font-medium text-theme-primary mb-1">{title}</h3>
      <p className="text-xs text-theme-muted max-w-md leading-relaxed">{message}</p>
      {suggestion && (
        <p className="mt-2 text-xs text-theme-secondary max-w-md leading-relaxed">
          {suggestion}
        </p>
      )}
      <div className="mt-4 flex items-center gap-3">
        {onRetry && (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Try again
          </Button>
        )}
        {docsHref && (
          <a
            href={docsHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-accent hover:text-accent-light transition-colors"
          >
            {docsLabel}
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
        )}
      </div>
      {technicalDetails && (
        <div className="mt-4 max-w-md w-full text-left">
          <button
            type="button"
            onClick={() => setDetailsOpen((v) => !v)}
            aria-expanded={detailsOpen}
            className="inline-flex items-center gap-1 text-[11px] text-theme-muted hover:text-theme-secondary transition-colors"
          >
            {detailsOpen ? (
              <ChevronDown className="h-3 w-3" aria-hidden="true" />
            ) : (
              <ChevronRight className="h-3 w-3" aria-hidden="true" />
            )}
            Technical details
          </button>
          {detailsOpen && (
            <pre
              className="mt-2 p-3 rounded-lg bg-[var(--theme-surface-1)] border border-theme-border text-[11px] text-theme-secondary whitespace-pre-wrap break-all max-h-48 overflow-auto"
              dir="ltr"
            >
              {technicalDetails}
            </pre>
          )}
        </div>
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
 */
export function InlineError({ message, onRetry }: InlineErrorProps) {
  return (
    <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20" role="alert">
      <p className="text-xs text-red-400">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 text-xs text-red-400 underline underline-offset-2 hover:text-red-300"
        >
          Retry
        </button>
      )}
    </div>
  )
}
