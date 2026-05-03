import { NavLink } from 'react-router-dom'
import { LayoutDashboard, Database, Cog, Webhook } from 'lucide-react'
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
]

export function Sidebar() {
  const { resolvedTheme } = useTheme()

  return (
    <aside className="w-52 border-r border-theme-border bg-[var(--theme-card-bg)] flex flex-col">
      {/* Logo */}
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

      {/* Navigation */}
      <nav aria-label="Main navigation" className="flex-1 py-3 px-2">
        <ul className="space-y-0.5">
          {navItems.map((item) => {
            const Icon = item.icon
            return (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) =>
                    `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
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
      </nav>

      {/* Footer */}
      <div className="p-3 border-t border-theme-border">
        <p className="text-[10px] text-theme-muted text-center">Statewave Admin v0.8</p>
      </div>
    </aside>
  )
}
