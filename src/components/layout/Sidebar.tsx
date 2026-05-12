import { useEffect, useRef } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { LayoutDashboard, Database, Cog, Receipt, Shield, Webhook, Stethoscope, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useTheme } from '../../lib/theme'

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
}

const navItems: NavItem[] = [
  { to: '/', label: 'Overview', icon: LayoutDashboard },
  { to: '/subjects', label: 'Subjects', icon: Database },
  { to: '/jobs', label: 'Jobs', icon: Cog },
  { to: '/webhooks', label: 'Webhooks', icon: Webhook },
  { to: '/receipts', label: 'Receipts', icon: Receipt },
  { to: '/policy', label: 'Policy', icon: Shield },
  { to: '/diagnostics', label: 'Diagnostics', icon: Stethoscope },
]

interface SidebarProps {
  /**
   * On phones the sidebar is an off-canvas drawer; this controls its
   * visibility. On md+ it's a permanent column and the prop is ignored.
   */
  mobileOpen: boolean
  onClose: () => void
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

export function Sidebar({ mobileOpen, onClose }: SidebarProps) {
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

  const Logo = (
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

  const navList = (
    <ul className="space-y-0.5">
      {navItems.map((item) => {
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
  )

  const footer = (
    <div className="p-3 border-t border-theme-border">
      <p className="text-[10px] text-theme-muted text-center">Statewave Admin v0.8</p>
    </div>
  )

  return (
    <>
      {/* Desktop / md+ : in-flow column. Keeps the existing dashboard
          layout untouched on tablet and desktop. */}
      <aside className="hidden md:flex w-52 border-r border-theme-border bg-[var(--theme-card-bg)] flex-col flex-shrink-0">
        {Logo}
        <nav aria-label="Main navigation" className="flex-1 py-3 px-2">
          {navList}
        </nav>
        {footer}
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
          {navList}
        </nav>
        {footer}
      </aside>
    </>
  )
}
