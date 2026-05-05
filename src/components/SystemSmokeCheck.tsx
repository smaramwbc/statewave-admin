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
 * "System smoke check" dashboard card.
 *
 * Drives the first-admin-run flow:
 *   1. Reads /api/admin/smoke/status on mount.
 *   2. If the deployment has never run, auto-fires /api/admin/smoke/run once.
 *      A localStorage flag debounces the auto-fire so reloads during a slow
 *      run don't pile on duplicate requests; the server-side single-flight
 *      is the actual safety net.
 *   3. Operators can re-run the check manually with the action button.
 *
 * Failure here never blocks the rest of the dashboard — the card just
 * surfaces the error with actionable next steps.
 */

const AUTOFIRE_KEY = 'sw_admin:smoke:autofired_v1'

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
      // Auto-fire only on the very first install AND only once per browser
      // session. The server is the source of truth; the localStorage flag
      // just avoids a tight reload loop while a slow run is in flight.
      if (next.has_run || next.is_running) return
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

  // ─── Render ──────────────────────────────────────────────────────────────
  const result = status?.last_result ?? null
  const overallStatus: SmokeResult['status'] = running
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

  return (
    <section>
      <SectionLabel>System smoke check</SectionLabel>
      <div className="rounded-xl border border-theme-border bg-[var(--theme-card-bg)] p-5">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-theme-primary">{headerLabel}</p>
            <p className="text-[11px] text-theme-muted mt-0.5">
              {status?.subject_id
                ? `Demo subject: ${status.subject_id}`
                : 'First-run validation against the connected Statewave backend.'}
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
          <p className="text-xs text-theme-muted">
            Smoke check is turned off via <code>ADMIN_SMOKE_DISABLED=true</code>.
            Unset it to re-enable the first-run validation.
          </p>
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

        {!result && status?.enabled !== false && !error && !running && (
          <p className="text-xs text-theme-muted">
            The smoke check will run automatically the first time an authenticated
            operator opens this dashboard. You can also trigger it manually below.
          </p>
        )}

        <div className="flex items-center justify-between gap-3 mt-4 pt-3 border-t border-theme-border/50">
          <p className="text-[11px] text-theme-muted">
            Last run: {formatTimestamp(result?.finished_at ?? result?.started_at ?? null)}
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={runOnce}
            loading={running}
            disabled={status?.enabled === false}
            aria-label="Run smoke check again"
          >
            {running ? 'Running…' : 'Run smoke check again'}
          </Button>
        </div>
      </div>
    </section>
  )
}
