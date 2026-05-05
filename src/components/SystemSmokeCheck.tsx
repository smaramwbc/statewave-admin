import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  fetchSmokeStatus,
  runSmokeCheck,
  type SmokeResult,
  type SmokeStatus,
  type SmokeStepStatus,
  type SmokeWebhookState,
} from '../lib/api'
import { StatusDot, StatusChip } from './StatusChip'
import { Button, SectionLabel } from './ui'

/**
 * "System smoke check" card on /diagnostics.
 *
 * Drives the first-admin-run flow:
 *   1. Reads /api/admin/smoke/status on mount.
 *   2. If the deployment has never run, auto-fires /api/admin/smoke/run once.
 *      A localStorage flag debounces the auto-fire so reloads during a slow
 *      run don't pile on duplicate requests; the server-side single-flight
 *      is the actual safety net.
 *   3. If a run is already in flight on the server (another operator/tab
 *      kicked it off), we transparently poll until it lands instead of
 *      flashing "not yet run".
 *   4. Operators can re-run the check manually with the action button.
 *
 * Failure here never blocks the rest of the page.
 */

const AUTOFIRE_KEY = 'sw_admin:smoke:autofired_v1'
const STATUS_POLL_INTERVAL_MS = 2000

function StepRow({
  label,
  status,
  detail,
  badge,
  footer,
}: {
  label: string
  status: SmokeStepStatus | 'pending'
  detail: string
  badge?: string
  footer?: ReactNode
}) {
  const dotStatus =
    status === 'ok'
      ? 'ok'
      : status === 'skipped'
        ? 'unknown'
        : status === 'pending'
          ? 'pending'
          : 'failed'
  return (
    <div className="flex items-start justify-between gap-3 text-xs">
      <div className="flex items-start gap-2 min-w-0">
        <span className="mt-1 shrink-0">
          <StatusDot status={dotStatus} />
        </span>
        <div className="min-w-0">
          <p className="text-theme-secondary font-medium">{label}</p>
          <p className="text-theme-muted leading-relaxed break-words">{detail}</p>
          {footer && <div className="mt-1.5">{footer}</div>}
        </div>
      </div>
      {badge && (
        <span className="text-[10px] uppercase tracking-wide text-theme-muted shrink-0">
          {badge}
        </span>
      )}
    </div>
  )
}

function overallChipStatus(s: SmokeResult['status']): string {
  switch (s) {
    case 'success':
      return 'ok'
    case 'running':
      return 'pending'
    case 'partial':
      return 'degraded'
    case 'disabled':
      return 'unknown'
    case 'never_run':
      return 'unknown'
    case 'failed':
    default:
      return 'error'
  }
}

function webhookBadge(state: SmokeWebhookState): string {
  switch (state) {
    case 'configured_delivered':
      return 'delivered'
    case 'configured_pending':
      return 'queued'
    case 'configured_failed':
      return 'failed'
    case 'not_configured':
      return 'not configured'
    case 'unknown':
    default:
      return ''
  }
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString()
}

export function SystemSmokeCheck() {
  const [status, setStatus] = useState<SmokeStatus | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const autofireRef = useRef(false)
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refresh = useCallback(async () => {
    try {
      const next = await fetchSmokeStatus()
      setStatus(next)
      setError(null)
      return next
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load smoke status'
      setError(msg)
      return null
    }
  }, [])

  const runOnce = useCallback(async () => {
    if (running) return
    setRunning(true)
    setError(null)
    try {
      const result = await runSmokeCheck()
      setStatus({
        enabled: true,
        has_run: true,
        is_running: false,
        subject_id: result.demo_job.subject_id,
        last_result: result,
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to run smoke check'
      setError(msg)
    } finally {
      setRunning(false)
    }
  }, [running])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const next = await refresh()
      if (cancelled || !next) return
      if (!next.enabled) return
      if (autofireRef.current) return
      // If a run is already in flight on the server (another operator
      // started it), we'll pick it up via the polling effect below — no
      // need to auto-fire a duplicate.
      if (next.is_running) return
      // Auto-fire only on the very first install AND only once per browser
      // session. The server is the source of truth; the localStorage flag
      // just avoids a tight reload loop while a slow run is in flight.
      if (next.has_run) return
      let alreadyAutofired = false
      try {
        alreadyAutofired = window.localStorage.getItem(AUTOFIRE_KEY) === '1'
      } catch {
        // Privacy mode / disabled storage — fall through, server still
        // single-flights the run.
      }
      if (alreadyAutofired) return
      autofireRef.current = true
      try {
        window.localStorage.setItem(AUTOFIRE_KEY, '1')
      } catch {
        // ignore — see above
      }
      await runOnce()
    })()
    return () => {
      cancelled = true
    }
  }, [refresh, runOnce])

  // Poll while the server reports a run in flight (started by another
  // operator/tab, or our own POST that we somehow lost track of). Stops
  // as soon as is_running flips false.
  useEffect(() => {
    const stop = () => {
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current)
        pollTimerRef.current = null
      }
    }
    if (!status?.is_running) {
      stop()
      return stop
    }
    pollTimerRef.current = setTimeout(() => {
      void refresh()
    }, STATUS_POLL_INTERVAL_MS)
    return stop
  }, [status, refresh])

  // ─── Render ──────────────────────────────────────────────────────────────
  const result = status?.last_result ?? null
  const isRunningOnServer = !!status?.is_running
  const overallStatus: SmokeResult['status'] = running || isRunningOnServer
    ? 'running'
    : status === null
      ? 'never_run'
      : !status.enabled
        ? 'disabled'
        : (result?.status ?? 'never_run')

  const headerLabel =
    overallStatus === 'success'
      ? 'All checks passed'
      : overallStatus === 'partial'
        ? 'Demo flow ok, webhook needs attention'
        : overallStatus === 'failed'
          ? 'Smoke check failed'
          : overallStatus === 'running'
            ? 'Running smoke check…'
            : overallStatus === 'disabled'
              ? 'Smoke check disabled'
              : 'Smoke check not yet run'

  const showWhatRuns = !result && status?.enabled !== false && !error

  return (
    <section>
      <SectionLabel>System smoke check</SectionLabel>
      <div className="rounded-xl border border-theme-border bg-[var(--theme-card-bg)] p-5">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-theme-primary">{headerLabel}</p>
            <p className="text-[11px] text-theme-muted mt-0.5">
              End-to-end probe: ingest a demo episode, compile it, verify
              webhook delivery.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <StatusChip status={overallChipStatus(overallStatus)} />
          </div>
        </div>

        {error && (
          <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400">
            <p className="font-medium">Could not contact the admin smoke endpoint</p>
            <p className="mt-1 text-theme-muted">{error}</p>
            <p className="mt-2 text-theme-muted">
              Confirm you are signed in and that the admin server is reachable.
            </p>
          </div>
        )}

        {!status?.enabled && status !== null && (
          <div className="rounded-lg border border-theme-border bg-[var(--theme-surface-1)] p-3 text-xs space-y-1.5">
            <p className="text-theme-secondary">
              First-run validation is turned off for this deployment.
            </p>
            <p className="text-theme-muted">
              Unset <code>ADMIN_SMOKE_DISABLED</code> on the admin server to
              re-enable it.
            </p>
          </div>
        )}

        {result && (
          <div className="space-y-3">
            <StepRow
              label="Backend readiness"
              status={result.backend.status}
              detail={result.backend.detail}
              badge={result.backend.readiness}
            />
            <StepRow
              label="Demo job"
              status={result.demo_job.status}
              detail={result.demo_job.detail}
              badge={
                result.demo_job.status === 'ok' && result.demo_job.memories_created !== null
                  ? `${result.demo_job.memories_created} memories`
                  : undefined
              }
              footer={
                result.demo_job.job_id ? (
                  <Link to="/jobs" className="text-[11px] text-accent hover:underline">
                    View compile job in /jobs →
                  </Link>
                ) : undefined
              }
            />
            <StepRow
              label="Demo webhook"
              status={result.demo_webhook.status}
              detail={result.demo_webhook.detail}
              badge={webhookBadge(result.demo_webhook.state)}
              footer={
                result.demo_webhook.state === 'configured_delivered' ||
                result.demo_webhook.state === 'configured_pending' ||
                result.demo_webhook.state === 'configured_failed' ? (
                  <Link to="/webhooks" className="text-[11px] text-accent hover:underline">
                    View in /webhooks →
                  </Link>
                ) : undefined
              }
            />
          </div>
        )}

        {showWhatRuns && (
          <div className="rounded-lg border border-theme-border bg-[var(--theme-surface-1)] p-3 text-xs space-y-2">
            <p className="text-theme-secondary">
              {isRunningOnServer || running
                ? 'Smoke check is running. This usually takes a few seconds.'
                : 'On first visit, Statewave automatically runs the smoke check. You can also start it manually below.'}
            </p>
            <details className="text-theme-muted">
              <summary className="cursor-pointer text-theme-secondary select-none">
                What runs?
              </summary>
              <ol className="mt-1.5 list-decimal pl-4 space-y-0.5 leading-relaxed">
                <li>
                  Confirms the Statewave backend is reachable and the admin
                  scope is valid.
                </li>
                <li>
                  Ingests a single demo episode under the dedicated{' '}
                  <code>statewave-demo:first-admin-run</code> subject and
                  triggers a compile job.
                </li>
                <li>
                  Inspects webhook stats to confirm delivery is wired up
                  (skipped cleanly when no webhook URL is configured).
                </li>
              </ol>
              <p className="mt-1.5">
                The demo subject is isolated and clearly labeled — safe to
                delete or re-run any time.
              </p>
            </details>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 mt-4 pt-3 border-t border-theme-border/50">
          <p className="text-[11px] text-theme-muted">
            Last run: {formatTimestamp(result?.finished_at ?? result?.started_at ?? null)}
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={runOnce}
            loading={running || isRunningOnServer}
            disabled={status?.enabled === false || isRunningOnServer}
            aria-label="Run smoke check again"
          >
            {running || isRunningOnServer ? 'Running…' : 'Run smoke check again'}
          </Button>
        </div>
      </div>
    </section>
  )
}
