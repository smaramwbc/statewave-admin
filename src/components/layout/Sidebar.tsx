import { useEffect, useRef, useState } from 'react'
import { NavLink, useLocation } from 'react-router'
import { LayoutDashboard, Database, Cog, Receipt, Shield, Settings, Tag, Webhook, Stethoscope, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useTheme } from '../../lib/theme'

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
}

// Three visual groups separated by a thin divider.
// Group 1: primary dashboard
// Group 2: core operational data (memory, pipeline)
// Group 3: administrative config
const NAV_GROUPS: NavItem[][] = [
  [
    { to: '/', label: 'Overview', icon: LayoutDashboard },
  ],
  [
    { to: '/subjects', label: 'Subjects', icon: Database },
    { to: '/jobs', label: 'Jobs', icon: Cog },
    { to: '/webhooks', label: 'Webhooks', icon: Webhook },
    { to: '/receipts', label: 'Receipts', icon: Receipt },
  ],
  [
    { to: '/policy', label: 'Policy', icon: Shield },
    { to: '/suggested-labels', label: 'Suggested labels', icon: Tag },
    { to: '/diagnostics', label: 'Diagnostics', icon: Stethoscope },
    { to: '/settings', label: 'Settings', icon: Settings },
  ],
]

interface SidebarProps {
  /**
   * On phones the sidebar is an off-canvas drawer; this controls its
   * visibility. On md+ it's a permanent column and the prop is ignored.
   */
  mobileOpen: boolean
  onClose: () => void
  /**
   * On md+ the sidebar can be toggled to a compact icons-only mode
   * via the hamburger button in Shell's header. Persists across
   * reloads (Shell handles the localStorage). Has no effect on
   * mobile — the drawer always shows full labels.
   */
  collapsed?: boolean
}

/**
 * Locks page scroll while the mobile drawer is open. Same trick the public
 * site uses: a data attribute on <html> + position: fixed on <body> with
 * the scrollY remembered so we can restore it on close. Plain
 * `overflow: hidden` doesn't hold under iOS Safari.
 */
function lockBodyScroll() {
  const scrollY = window.scrollY
  document.documentElement.dataset.scrollLock = 'true'
  document.body.style.position = 'fixed'
  document.body.style.top = `-${scrollY}px`
  document.body.style.left = '0'
  document.body.style.right = '0'
  document.body.style.width = '100%'
  return scrollY
}

function unlockBodyScroll(scrollY: number) {
  document.documentElement.removeAttribute('data-scroll-lock')
  document.body.style.position = ''
  document.body.style.top = ''
  document.body.style.left = ''
  document.body.style.right = ''
  document.body.style.width = ''
  window.scrollTo(0, scrollY)
}

/**
 * Icon-only nav item for the collapsed desktop sidebar.
 *
 * Renders a custom fixed-position tooltip to the right so the label is
 * always discoverable. Uses `position: fixed` (not `absolute`) so the
 * tooltip escapes the nav's `overflow-y: auto` clipping context — a plain
 * `title` attribute would rely on the browser's native tooltip which is
 * slow, unstyled, and inconsistent across platforms.
 */
function CompactNavItem({ to, label, icon: Icon, onClick }: NavItem & { onClick: () => void }) {
  const [tooltipPos, setTooltipPos] = useState<{ top: number; left: number } | null>(null)
  const liRef = useRef<HTMLLIElement>(null)

  return (
    <li ref={liRef}>
      <NavLink
        to={to}
        end={to === '/'}
        onClick={onClick}
        aria-label={label}
        onMouseEnter={() => {
          const rect = liRef.current?.getBoundingClientRect()
          if (rect) {
            setTooltipPos({ top: rect.top + rect.height / 2, left: rect.right + 8 })
          }
        }}
        onMouseLeave={() => setTooltipPos(null)}
        className={({ isActive }) =>
          `flex items-center justify-center px-0 min-h-11 py-2 rounded-lg text-sm transition-colors ${
            isActive
              ? 'bg-[var(--theme-surface-2)] text-theme-primary font-medium'
              : 'text-theme-secondary hover:bg-[var(--theme-surface-1)] hover:text-theme-primary'
          }`
        }
      >
        <Icon className="h-4 w-4 opacity-70 shrink-0" aria-hidden="true" />
      </NavLink>
      {tooltipPos && (
        <div
          role="tooltip"
          style={{
            position: 'fixed',
            top: tooltipPos.top,
            left: tooltipPos.left,
            transform: 'translateY(-50%)',
          }}
          className="z-50 px-2.5 py-1 text-xs font-medium text-theme-primary bg-[var(--theme-card-bg)] border border-theme-border rounded-md shadow-md pointer-events-none whitespace-nowrap"
        >
          {label}
        </div>
      )}
    </li>
  )
}

export function Sidebar({ mobileOpen, onClose, collapsed = false }: SidebarProps) {
  const { resolvedTheme } = useTheme()
  const location = useLocation()
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const lockedScrollRef = useRef<number | null>(null)

  // Body scroll lock + focus management while the mobile drawer is open.
  useEffect(() => {
    if (!mobileOpen) return
    lockedScrollRef.current = lockBodyScroll()
    const id = requestAnimationFrame(() => closeButtonRef.current?.focus())
    return () => {
      cancelAnimationFrame(id)
      if (lockedScrollRef.current !== null) {
        unlockBodyScroll(lockedScrollRef.current)
        lockedScrollRef.current = null
      }
    }
  }, [mobileOpen])

  // Close on Escape.
  useEffect(() => {
    if (!mobileOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [mobileOpen, onClose])

  // Close when the visitor navigates — the route change is the affordance
  // they wanted, no need to leave the drawer hanging around.
  const prevPathname = useRef(location.pathname)
  useEffect(() => {
    if (prevPathname.current !== location.pathname) {
      prevPathname.current = location.pathname
      if (mobileOpen) onClose()
    }
  }, [location.pathname, mobileOpen, onClose])

  // Logo flavours: in compact desktop mode we drop the wordmark + the
  // "Admin" badge so the column fits w-14 cleanly. The mobile drawer
  // always renders the full version regardless of `collapsed` since
  // there's no compact-on-mobile use case.
  const FullLogo = (
    <div className="h-14 px-4 flex items-center gap-2.5 border-b border-theme-border">
      <img
        src={resolvedTheme === 'dark' ? '/statewave_icon_dark.png' : '/statewave_icon_light.png'}
        alt="Statewave"
        className="h-6 w-6"
      />
      <span className="text-sm font-semibold text-theme-primary tracking-tight">Statewave</span>
      <span className="text-[10px] text-theme-muted bg-[var(--theme-surface-2)] px-1.5 py-0.5 rounded font-medium ml-auto">
        Admin
      </span>
    </div>
  )

  const CompactLogo = (
    <div className="h-14 flex items-center justify-center border-b border-theme-border">
      <img
        src={resolvedTheme === 'dark' ? '/statewave_icon_dark.png' : '/statewave_icon_light.png'}
        alt="Statewave Admin"
        title="Statewave Admin"
        className="h-6 w-6"
      />
    </div>
  )

  // Renders the nav groups with thin dividers between them.
  // In compact mode: uses CompactNavItem components with custom tooltips.
  // In expanded mode: shows full labels with the group dividers.
  const buildNavList = (compact: boolean) => (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      {NAV_GROUPS.map((group, gi) => (
        <div key={gi}>
          {gi > 0 && (
            <hr className={`border-theme-border ${compact ? 'mx-1 mb-2' : 'mx-1 mb-2'}`} />
          )}
          <ul className="space-y-0.5">
            {group.map((item) => {
              if (compact) {
                return (
                  <CompactNavItem
                    key={item.to}
                    {...item}
                    onClick={onClose}
                  />
                )
              }
              const Icon = item.icon
              return (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.to === '/'}
                    onClick={onClose}
                    className={({ isActive }) =>
                      `flex items-center gap-2.5 px-3 min-h-11 py-2 rounded-lg text-sm transition-colors ${
                        isActive
                          ? 'bg-[var(--theme-surface-2)] text-theme-primary font-medium'
                          : 'text-theme-secondary hover:bg-[var(--theme-surface-1)] hover:text-theme-primary'
                      }`
                    }
                  >
                    <Icon className="h-4 w-4 opacity-70 shrink-0" aria-hidden="true" />
                    {item.label}
                  </NavLink>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </div>
  )

  // `__ADMIN_VERSION__` is injected by Vite `define` for app builds; guard it
  // so test (vitest) / non-Vite environments that don't apply the define still
  // render rather than throw on an undefined global.
  const adminVersion =
    typeof __ADMIN_VERSION__ !== 'undefined' ? __ADMIN_VERSION__ : '0.0.0'

  const footer = (
    <div className="p-3 border-t border-theme-border">
      <p className="text-[10px] text-theme-muted text-center">Statewave Admin v{adminVersion}</p>
    </div>
  )

  // Footer in compact mode is reduced to just the version number,
  // centered, so the column doesn't lose its visual anchor.
  const compactFooter = (
    <div className="px-1 py-3 border-t border-theme-border">
      <p className="text-[9px] text-theme-muted text-center" title={`Statewave Admin v${adminVersion}`}>
        v{adminVersion}
      </p>
    </div>
  )

  return (
    <>
      {/* Desktop / md+ : in-flow column. Width swaps between w-52
          (full labels) and w-14 (icons only) based on `collapsed`.
          The CSS transition smooths the width change so toggling
          doesn't feel snappy — but `flex-shrink-0` keeps the
          column from being squeezed when content next to it grows.
          The hamburger in Shell's header is the only toggle. */}
      <aside
        className={`hidden md:flex border-r border-theme-border bg-[var(--theme-card-bg)] flex-col flex-shrink-0 transition-[width] duration-150 ease-out ${
          collapsed ? 'w-14' : 'w-52'
        }`}
      >
        {collapsed ? CompactLogo : FullLogo}
        <nav
          aria-label="Main navigation"
          className={`flex-1 py-3 ${collapsed ? 'px-1' : 'px-2'} overflow-y-auto`}
        >
          {buildNavList(collapsed)}
        </nav>
        {collapsed ? compactFooter : footer}
      </aside>

      {/* Mobile: off-canvas drawer + backdrop. Both live outside the
          desktop column so they only paint when `mobileOpen` is true. */}
      {mobileOpen && (
        <button
          type="button"
          aria-label="Dismiss navigation menu"
          tabIndex={-1}
          onClick={onClose}
          className="md:hidden fixed inset-0 z-40 bg-black/50 backdrop-blur-sm animate-in fade-in"
        />
      )}
      <aside
        id="admin-mobile-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Admin navigation"
        aria-hidden={!mobileOpen}
        className={`md:hidden fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] flex flex-col border-r border-theme-border bg-[var(--theme-card-bg)] shadow-2xl transform transition-transform duration-200 ease-out ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Mobile drawer header gets an explicit close affordance — desktop
            doesn't need one because the column is always there. */}
        <div className="h-14 px-4 flex items-center gap-2.5 border-b border-theme-border">
          <img
            src={resolvedTheme === 'dark' ? '/statewave_icon_dark.png' : '/statewave_icon_light.png'}
            alt="Statewave"
            className="h-6 w-6"
          />
          <span className="text-sm font-semibold text-theme-primary tracking-tight">Statewave</span>
          <span className="text-[10px] text-theme-muted bg-[var(--theme-surface-2)] px-1.5 py-0.5 rounded font-medium">
            Admin
          </span>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close navigation menu"
            className="ml-auto inline-flex items-center justify-center w-9 h-9 -mr-1 rounded-md text-theme-muted hover:text-theme-primary hover:bg-[var(--theme-surface-1)] transition-colors"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <nav aria-label="Main navigation" className="flex-1 py-3 px-2 overflow-y-auto">
          {buildNavList(false)}
        </nav>
        {footer}
      </aside>
    </>
  )
}
