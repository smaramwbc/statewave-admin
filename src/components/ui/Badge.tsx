interface BadgeProps {
  children: React.ReactNode
  variant?: 'default' | 'success' | 'warning' | 'error' | 'muted'
  size?: 'sm' | 'md'
  dot?: boolean
}

const variantStyles: Record<string, string> = {
  default: 'bg-[var(--theme-surface-2)] text-theme-secondary',
  success: 'bg-emerald-500/10 text-emerald-400',
  warning: 'bg-amber-500/10 text-amber-400',
  error: 'bg-red-500/10 text-red-400',
  muted: 'bg-[var(--theme-surface-2)] text-theme-muted',
}

const dotColors: Record<string, string> = {
  default: 'bg-theme-muted',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  error: 'bg-red-500',
  muted: 'bg-theme-muted',
}

export function Badge({ children, variant = 'default', size = 'sm', dot }: BadgeProps) {
  const sizeClass = size === 'sm' ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-1'

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded font-medium ${sizeClass} ${variantStyles[variant]}`}
    >
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${dotColors[variant]}`} />}
      {children}
    </span>
  )
}

export function HealthBadge({ state, score }: { state: string | null; score?: number | null }) {
  if (!state) return <Badge variant="muted">—</Badge>

  const variant =
    state === 'healthy' ? 'success' : state === 'watch' || state === 'degraded' ? 'warning' : 'error'

  return (
    <Badge variant={variant} dot>
      {state}
      {score !== undefined && score !== null && (
        <span className="opacity-70 ml-0.5">({score})</span>
      )}
    </Badge>
  )
}
