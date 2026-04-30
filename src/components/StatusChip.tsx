export function StatusDot({ status }: { status: string }) {
  const color =
    status === 'ok' || status === 'ready' || status === 'healthy'
      ? 'bg-emerald-500'
      : status === 'degraded' || status === 'watch' || status === 'at_risk'
        ? 'bg-amber-500'
        : status === 'unknown' || status === 'pending'
          ? 'bg-gray-400'
          : 'bg-red-500'
  return <span className={`inline-block w-2 h-2 rounded-full ${color}`} />
}

export function StatusChip({ status }: { status: string }) {
  const base = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium'
  const style =
    status === 'ok' || status === 'ready' || status === 'healthy'
      ? 'bg-emerald-500/10 text-emerald-400'
      : status === 'degraded' || status === 'watch' || status === 'at_risk'
        ? 'bg-amber-500/10 text-amber-400'
        : status === 'unknown' || status === 'pending'
          ? 'bg-gray-500/10 text-gray-400'
          : 'bg-red-500/10 text-red-400'
  return (
    <span className={`${base} ${style}`}>
      <StatusDot status={status} />
      {status}
    </span>
  )
}
