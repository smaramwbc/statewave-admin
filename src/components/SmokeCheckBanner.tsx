import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle, Stethoscope } from 'lucide-react'
import { fetchSmokeStatus, type SmokeStatus } from '../lib/api'

/**
 * One-shot dashboard banner pointing to /diagnostics.
 *
 * The smoke check itself lives on the Diagnostics page. The banner is the
 * lightweight nudge that surfaces on the Dashboard when something needs
 * the operator's attention:
 *
 *   - has_run=false       → "System check pending · Run now →" (neutral)
 *   - status=failed/partial → "System check needs attention →" (amber)
 *   - status=success      → render nothing (cleanest dashboard)
 *
 * Failures keep the banner up so a regression after a green install
 * still reaches the Overview surface — but a healthy first-run install
 * never sees the banner again after the first auto-fire succeeds.
 *
 * Network errors and the disabled state both render nothing — the
 * banner is opportunistic, not load-blocking.
 */
export function SmokeCheckBanner() {
  const [status, setStatus] = useState<SmokeStatus | null>(null)
  const [errored, setErrored] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const next = await fetchSmokeStatus()
        if (!cancelled) setStatus(next)
      } catch {
        if (!cancelled) setErrored(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (errored || status === null) return null
  if (!status.enabled) return null

  const overall = status.last_result?.status ?? null
  const needsAttention = overall === 'failed' || overall === 'partial'
  const pending = !status.has_run && overall !== 'success'

  if (!pending && !needsAttention) return null

  const tone = needsAttention
    ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400'
    : 'border-theme-border bg-[var(--theme-card-bg)] text-theme-secondary'

  const Icon = needsAttention ? AlertCircle : Stethoscope
  const message = needsAttention
    ? 'System smoke check needs attention.'
    : 'First-run system check pending.'
  const cta = needsAttention ? 'View diagnostics →' : 'Run now →'

  return (
    <div
      className={`mb-6 rounded-xl border ${tone} px-4 py-2.5 flex items-center gap-3 text-xs`}
      role="status"
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="flex-1 truncate">{message}</span>
      <Link
        to="/diagnostics"
        className="shrink-0 font-medium hover:underline whitespace-nowrap"
      >
        {cta}
      </Link>
    </div>
  )
}
