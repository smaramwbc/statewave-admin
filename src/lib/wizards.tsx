/**
 * Global wizard registry.
 *
 * Why: the Enable-Auth / Enable-Admin-Auth modals used to live inside
 * SettingsPage. That meant any other surface (the dashboard's
 * Production-readiness card, the auth-disabled banner) could only
 * reach a wizard by first NAVIGATING to /settings — clicking Cancel
 * then stranded the operator on a page they never asked to visit.
 *
 * This provider hoists both wizards above the route tree so any
 * surface can trigger them with `openWizard('enable-admin-auth')`
 * and the modal opens IN PLACE. Cancel closes it without touching
 * the URL, so the operator stays exactly where they were.
 *
 * Deep-link query params (`?wizard=...`) still work — the provider
 * picks them up on mount, fires the wizard, and strips the param so
 * a browser refresh doesn't re-open it. This keeps the
 * "/dashboard?wizard=enable-admin-auth" pattern functional for any
 * static link or external nudge.
 *
 * `applyCount` is a refetch nudge: every page that displays
 * settings-derived state subscribes to it and re-fetches when a
 * wizard reports an apply. That replaces the per-page `onApplied`
 * callback chain — the wizard no longer needs to know who's
 * listening.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { useSearchParams } from 'react-router'
import { EnableAuthWizard } from '../components/EnableAuthWizard'
import { EnableAdminAuthWizard } from '../components/EnableAdminAuthWizard'

export type WizardId = 'enable-auth' | 'enable-admin-auth'

interface WizardsContextValue {
  /** Open a wizard by id. Idempotent — opening the same wizard twice
   *  is a no-op; opening a different one swaps the modal. */
  openWizard: (id: WizardId) => void
  /** Close whatever wizard is currently open. Called by the modal's
   *  own dismiss/cancel actions; surfaces that opened the wizard
   *  shouldn't need to call this. */
  closeWizard: () => void
  /** What's currently open, or null. Mostly for tests + a11y. */
  current: WizardId | null
  /** Monotonic counter bumped each time a wizard reports an apply.
   *  Pages with settings-derived state subscribe to it via useEffect
   *  to refetch. */
  applyCount: number
}

const WizardsContext = createContext<WizardsContextValue | null>(null)

export function useWizards(): WizardsContextValue {
  const ctx = useContext(WizardsContext)
  if (ctx === null) {
    throw new Error(
      'useWizards must be used within <WizardsProvider>. ' +
        'WizardsProvider lives inside BrowserRouter — make sure your ' +
        'component sits below it in the tree.',
    )
  }
  return ctx
}

const VALID_IDS: ReadonlySet<string> = new Set<WizardId>([
  'enable-auth',
  'enable-admin-auth',
])

export function WizardsProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<WizardId | null>(null)
  const [applyCount, setApplyCount] = useState(0)
  const [searchParams, setSearchParams] = useSearchParams()

  // Deep-link handler — `?wizard=<id>` opens the matching wizard once
  // on mount (or whenever the URL changes), then we strip the param
  // so a refresh doesn't re-fire. Unknown ids are silently ignored
  // rather than logged to console — a stale link from an old version
  // of the app should fail closed without UI noise.
  useEffect(() => {
    const wizard = searchParams.get('wizard')
    if (wizard && VALID_IDS.has(wizard)) {
      setCurrent(wizard as WizardId)
      searchParams.delete('wizard')
      setSearchParams(searchParams, { replace: true })
    }
  }, [searchParams, setSearchParams])

  const openWizard = useCallback((id: WizardId) => {
    setCurrent(id)
  }, [])

  const closeWizard = useCallback(() => {
    setCurrent(null)
  }, [])

  const notifyApplied = useCallback(() => {
    setApplyCount((n) => n + 1)
  }, [])

  return (
    <WizardsContext.Provider
      value={{ openWizard, closeWizard, current, applyCount }}
    >
      {children}
      <EnableAuthWizard
        open={current === 'enable-auth'}
        onClose={closeWizard}
        onApplied={notifyApplied}
      />
      <EnableAdminAuthWizard
        open={current === 'enable-admin-auth'}
        onClose={closeWizard}
      />
    </WizardsContext.Provider>
  )
}
