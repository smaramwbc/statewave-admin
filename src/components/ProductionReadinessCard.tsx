/**
 * Production-readiness dashboard card.
 *
 * The "what do I need to fix before turning this loose on production?"
 * surface. Combines two endpoints:
 *
 *   - GET /admin/readiness-check (backend self-check on `settings.*`)
 *   - GET /api/admin/readiness-check (admin server: admin auth, master
 *     key, proxy key)
 *
 * Both are rule-based, both return `{issues: [...]}`. We concatenate
 * them and group by severity. Each issue carries a `fix` descriptor —
 * the card turns that into a one-click action that either:
 *
 *   - Navigates to /settings?edit=<key>  (a setting-level fix)
 *   - Navigates to /settings?wizard=enable-auth (a multi-step fix)
 *   - Navigates to /settings?tab=admin (an admin-server field)
 *   - Shows a "Set this in your deployment env" copy snippet (env-only)
 *
 * Design choices:
 *
 *   - Hidden when zero issues. A clean dashboard rewards a clean setup,
 *     and the card never becomes background noise.
 *   - Critical issues are EXPANDED by default and shown in red. The
 *     operator can't miss them.
 *   - High / Medium / Low collapse into "+ N more" so a noisy laundry
 *     list doesn't bury the headline.
 *   - "Fix" CTAs are inline per row; there's no "scroll to find your
 *     way to settings" friction.
 *
 * The card never fetches both endpoints in series — both run in
 * parallel via Promise.allSettled and we render what landed.
 */
import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { AlertOctagon, AlertTriangle, Info, ShieldCheck, ChevronDown, ChevronRight, RefreshCw } from 'lucide-react'
import { Button, Badge, CopyableMono } from './ui'
import {
  fetchBackendReadiness,
  fetchAdminReadiness,
  restartBackend,
  waitForBackend,
  type ReadinessIssue,
  type IssueSeverity,
} from '../lib/settings'
import { useWizards } from '../lib/wizards'

/**
 * Lazy-init state backed by sessionStorage so the user's expand /
 * collapse choice survives across SPA route changes within a tab.
 *
 * Used here for the accordion + the "show lower severity items"
 * toggle so the operator's mental model — "I expanded the panel,
 * clicked Fix, cancelled, expect to see the same panel" — actually
 * holds. Without this the component unmounts when the user
 * navigates to /settings via a Fix button, and re-mounts collapsed
 * when they return.
 *
 * `sessionStorage` (not localStorage) on purpose: a fresh browser
 * tab should still default to "collapsed" so the dashboard top-of-
 * fold stays quiet on first visit. Persistence is per-tab,
 * lifetime-of-session.
 */
function useSessionPersistedBoolean(key: string, defaultValue: boolean) {
  const [value, setValue] = useState<boolean>(() => {
    try {
      const raw = globalThis.sessionStorage?.getItem(key)
      if (raw === 'true') return true
      if (raw === 'false') return false
    } catch {
      /* SSR / disabled storage / quota — fall through */
    }
    return defaultValue
  })
  useEffect(() => {
    try {
      globalThis.sessionStorage?.setItem(key, String(value))
    } catch {
      /* best-effort */
    }
  }, [key, value])
  return [value, setValue] as const
}

const SEVERITY_ORDER: Record<IssueSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
}

const SEVERITY_STYLE: Record<IssueSeverity, { bg: string; text: string; icon: typeof AlertOctagon; label: string }> = {
  critical: {
    bg: 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900',
    text: 'text-red-900 dark:text-red-200',
    icon: AlertOctagon,
    label: 'Critical',
  },
  high: {
    bg: 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900',
    text: 'text-amber-900 dark:text-amber-200',
    icon: AlertTriangle,
    label: 'High',
  },
  medium: {
    bg: 'bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-900',
    text: 'text-blue-900 dark:text-blue-200',
    icon: Info,
    label: 'Medium',
  },
  low: {
    bg: 'bg-[var(--theme-surface-1)] border-theme-border',
    text: 'text-theme-secondary',
    icon: Info,
    label: 'Low',
  },
}

interface IssueRowProps {
  issue: ReadinessIssue
}

function StagedBadge() {
  // Used on a row whose fix is already saved in the DB but is
  // waiting for a backend restart to actually apply. The amber tone
  // matches the "Restart required" banner on the Settings page so
  // an operator sees the same visual language across the app.
  return (
    <span
      className="
        inline-flex items-center gap-1 px-1.5 py-0.5 rounded
        text-[10px] font-medium uppercase tracking-wide
        bg-amber-100 dark:bg-amber-950/40
        text-amber-700 dark:text-amber-300
      "
      title="Fix is saved in the database — backend restart needed to activate it"
    >
      <RefreshCw className="w-3 h-3" />
      Pending restart
    </span>
  )
}

function IssueRow({ issue }: IssueRowProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const { openWizard } = useWizards()
  const style = SEVERITY_STYLE[issue.severity]
  const Icon = style.icon

  // Turn the `fix` descriptor into either a Fix-button (deep link) or a
  // "Set in env" hint with a copyable variable name. Env-only fixes
  // can't be repaired through the UI by design — surfacing the var
  // name + a copy button is the most useful affordance we can give.
  //
  // Behavioural split:
  //   * 'wizard' → opens the modal IN PLACE (no navigation). Cancel
  //     drops the operator back on the page they came from — no more
  //     "I clicked Fix and now I'm stranded on /settings" complaints.
  //   * 'setting' → navigates to /settings (the editor lives there) but
  //     passes `from: <current path>` via location.state so the
  //     Settings page can render a "← Back to <prev>" breadcrumb.
  //   * 'admin_tab' → same navigate-with-from pattern, lands on the
  //     Admin server tab.
  //   * 'env' → no UI fix is possible — render the var name in a
  //     copy chip so the operator can paste it into their deployment.
  let action: React.ReactNode = null
  if (issue.fix) {
    if (issue.fix.kind === 'setting') {
      const key = issue.fix.key
      action = (
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            navigate(`/settings?edit=${key}`, { state: { from: location.pathname } })
          }
        >
          Fix
        </Button>
      )
    } else if (issue.fix.kind === 'wizard') {
      const wizardId = issue.fix.id
      action = (
        <Button size="sm" onClick={() => openWizard(wizardId)}>
          Fix
        </Button>
      )
    } else if (issue.fix.kind === 'admin_tab') {
      action = (
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            navigate('/settings?tab=admin', { state: { from: location.pathname } })
          }
        >
          Open
        </Button>
      )
    } else if (issue.fix.kind === 'env' && issue.fix.env_var) {
      action = <CopyableMono value={issue.fix.env_var} />
    }
  }

  return (
    <div className={`p-3 rounded-md border ${style.bg} flex gap-3 items-start`}>
      <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${style.text}`} />
      <div className="flex-1 min-w-0">
        <div className={`text-sm font-medium ${style.text} flex flex-wrap items-center gap-2`}>
          <span>{issue.title}</span>
          {issue.fix_staged && <StagedBadge />}
        </div>
        <p className="text-xs text-theme-secondary mt-0.5 leading-relaxed">{issue.summary}</p>
      </div>
      {/* Hide the Fix button for staged issues — the fix is already
          saved; the next action is a restart, surfaced as a single
          CTA at the top of the card. Showing Fix here would let an
          operator open the editor and re-Save the same value, which
          is harmless but confusing. */}
      <div className="shrink-0">{!issue.fix_staged && action}</div>
    </div>
  )
}

export function ProductionReadinessCard() {
  const { applyCount } = useWizards()
  const [issues, setIssues] = useState<ReadinessIssue[] | null>(null)
  const [restarting, setRestarting] = useState(false)
  // Card is collapsed by default on a fresh tab — the dashboard's
  // top-of-fold stays visually quiet on first visit. After the
  // operator interacts (expands the panel, optionally shows the
  // lower-severity items) we remember those choices via
  // sessionStorage so a quick excursion to the Settings page and
  // back via a Fix → Cancel button doesn't reset what they were
  // looking at. localStorage would persist across browser restarts
  // which is too sticky for an at-a-glance state hint.
  const [expanded, setExpanded] = useSessionPersistedBoolean(
    'statewave-admin:readiness-card:expanded',
    false,
  )
  const [showLower, setShowLower] = useSessionPersistedBoolean(
    'statewave-admin:readiness-card:show-lower',
    false,
  )

  // `applyCount` from the wizards context bumps every time a wizard
  // commits a change (Enable-Auth → api_key staged, etc.). Re-running
  // the fetch when it changes is what makes a freshly-saved fix flip
  // its row from "Fix" to "Pending restart" without a manual refresh.
  // Also re-runs on initial mount.
  const fetchIssues = useCallback(async () => {
    const results = await Promise.allSettled([fetchBackendReadiness(), fetchAdminReadiness()])
    const merged: ReadinessIssue[] = []
    for (const r of results) {
      // Defensive: a fetch that 200s with an empty body or a stale
      // older deployment without the new endpoint would land here as
      // `fulfilled` with `value.issues` undefined. Iterate only when
      // the shape is what we expect — otherwise drop the half-result
      // and render what the other endpoint returned.
      if (r.status === 'fulfilled' && Array.isArray(r.value?.issues)) {
        merged.push(...r.value.issues)
      }
    }
    merged.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
    setIssues(merged)
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (cancelled) return
      await fetchIssues()
    })()
    return () => { cancelled = true }
  }, [fetchIssues, applyCount])

  const onRestart = async () => {
    setRestarting(true)
    try {
      const r = await restartBackend()
      // Same DOWN-then-UP pacing as the Settings page's restart
      // banner — without the brief sleep the first poll catches the
      // still-alive pre-exit process and clears the banner too soon.
      await new Promise((res) => setTimeout(res, Math.max(500, (r.exit_in_seconds ?? 2) * 1000)))
      await waitForBackend()
      await fetchIssues()
      toast.success('Backend restarted; staged fixes are now live.')
    } catch (e) {
      toast.error(`Restart failed: ${(e as Error).message}`)
    } finally {
      setRestarting(false)
    }
  }

  if (issues === null) {
    return <div className="rounded-lg border border-theme-border bg-[var(--theme-card-bg)] p-4 animate-pulse h-20" />
  }

  // Zero issues → tiny green chip, not a whole card. Keeps the
  // dashboard quiet when there's nothing to do.
  if (issues.length === 0) {
    return (
      <div className="flex items-center gap-2 text-xs text-green-700 dark:text-green-300">
        <ShieldCheck className="w-4 h-4" />
        <span>Production-readiness check: no issues found.</span>
      </div>
    )
  }

  const headline = issues.filter((i) => i.severity === 'critical' || i.severity === 'high')
  const lower = issues.filter((i) => i.severity === 'medium' || i.severity === 'low')
  const counts = {
    critical: issues.filter((i) => i.severity === 'critical').length,
    high: issues.filter((i) => i.severity === 'high').length,
    medium: issues.filter((i) => i.severity === 'medium').length,
    low: issues.filter((i) => i.severity === 'low').length,
  }
  // How many of the issues showing here are actually already-fixed-
  // but-waiting-on-restart. Drives the top-of-card restart prompt.
  const stagedCount = issues.filter((i) => i.fix_staged).length

  // Header is a `<button>` so it's keyboard-focusable + screen reader
  // says "expanded/collapsed". The whole row is the click target so
  // operators don't have to aim at a small chevron.
  return (
    <div className="rounded-lg border border-theme-border bg-[var(--theme-card-bg)]">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls="readiness-body"
        // `focus-visible:` (not `focus:`) so the ring only shows for
        // keyboard navigation (Tab key) — a mouse click that lands
        // focus on the button no longer leaves a violet halo behind
        // after expanding. Keyboard users still get the affordance.
        className="
          w-full p-4
          flex items-center gap-2
          text-left
          rounded-lg
          hover:bg-[var(--theme-surface-1)]
          focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30
          transition-colors
        "
      >
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-theme-muted shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-theme-muted shrink-0" />
        )}
        <ShieldCheck className="w-4 h-4 text-theme-muted shrink-0" />
        <h3 className="text-sm font-medium text-theme-primary">Production readiness</h3>
        <div className="flex gap-1.5 ml-auto flex-wrap justify-end">
          {counts.critical > 0 && <Badge variant="error">{counts.critical} critical</Badge>}
          {counts.high > 0 && <Badge variant="warning">{counts.high} high</Badge>}
          {counts.medium > 0 && <Badge variant="muted">{counts.medium} medium</Badge>}
          {counts.low > 0 && <Badge variant="muted">{counts.low} low</Badge>}
        </div>
      </button>
      {expanded && (
        <div id="readiness-body" className="px-4 pb-4 pt-0 space-y-2">
          {/* Staged-fix prompt. Shows the moment the operator has
              saved at least one fix that requires a restart — they
              can act on it without scrolling to the Settings page.
              Re-checks itself after `restartBackend()` completes so
              the prompt auto-hides when nothing is staged anymore. */}
          {stagedCount > 0 && (
            <div className="p-3 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-900 flex items-start gap-3">
              <RefreshCw className={`w-4 h-4 shrink-0 mt-0.5 text-amber-700 dark:text-amber-300 ${restarting ? 'animate-spin' : ''}`} />
              <div className="flex-1 text-sm text-amber-900 dark:text-amber-200">
                <p className="font-medium">
                  {stagedCount} fix{stagedCount === 1 ? ' is' : 'es are'} staged but waiting for a backend restart.
                </p>
                <p className="text-xs mt-0.5 leading-relaxed">
                  Your saved changes are in the database. The backend is still running the old configuration until it restarts.
                </p>
              </div>
              <div className="shrink-0">
                <Button size="sm" onClick={onRestart} disabled={restarting}>
                  {restarting ? 'Restarting…' : 'Restart backend now'}
                </Button>
              </div>
            </div>
          )}
          {headline.map((issue) => (
            <IssueRow key={issue.id} issue={issue} />
          ))}
          {lower.length > 0 && (
            <div className="pt-1">
              <button
                type="button"
                onClick={() => setShowLower((v) => !v)}
                className="text-xs text-theme-muted hover:text-theme-primary inline-flex items-center gap-1"
              >
                {showLower ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                {showLower ? 'Hide' : 'Show'} {lower.length} lower-severity item{lower.length === 1 ? '' : 's'}
              </button>
              {showLower && (
                <div className="mt-2 space-y-2">
                  {lower.map((issue) => (
                    <IssueRow key={issue.id} issue={issue} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
