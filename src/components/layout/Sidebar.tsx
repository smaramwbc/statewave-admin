import { NavLink } from 'react-router-dom'
import { useTheme } from '../../lib/theme'

const navItems = [
  { to: '/', label: 'Overview', icon: '◉' },
  { to: '/subjects', label: 'Subjects', icon: '◎' },
  { to: '/jobs', label: 'Jobs', icon: '⚙' },
  { to: '/webhooks', label: 'Webhooks', icon: '↗' },
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
          {navItems.map((item) => (
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
                <span className="text-xs opacity-70">{item.icon}</span>
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      {/* Footer */}
      <div className="p-3 border-t border-theme-border">
        <p className="text-[10px] text-theme-muted text-center">Statewave Admin v0.8</p>
      </div>
    </aside>
  )
}
