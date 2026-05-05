import { PageHeader } from '../components/ui'
import { SystemSmokeCheck } from '../components/SystemSmokeCheck'
import { SelfHealingEval } from '../components/SelfHealingEval'

/**
 * Diagnostics — operator-facing health and readiness center.
 *
 * Today this hosts the first-admin-run smoke check and the Self-Healing
 * Eval card; future probes (webhook tester, connector validators,
 * embedding round-trip, per-tenant audits) land here too. Keeping these
 * on a dedicated route keeps the Dashboard focused on live operational
 * metrics instead of one-off self-tests.
 *
 * The smoke card auto-fires on the first visit a deployment has ever had
 * (server-side `has_run=false`). The dashboard surfaces a slim banner
 * pointing here while the check is pending or has not yet succeeded.
 */
export function DiagnosticsPage() {
  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Diagnostics"
        description="Run health checks against your Statewave deployment and see what needs attention."
      />
      <div className="space-y-8">
        <SystemSmokeCheck />
        <SelfHealingEval />
      </div>
    </div>
  )
}
