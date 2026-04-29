import { useEffect, useRef, useState } from 'react'

// ─── Types ───────────────────────────────────────────────────────────────────

interface MemoryGroup {
  kind: string
  count: number
}

interface MemoryOrbitVizProps {
  groups: MemoryGroup[]
  totalMemories: number
}

// ─── Color Palette (spectral, evenly spaced hues) ────────────────────────────

function groupColor(index: number, total: number): string {
  const hue = (index / total) * 360
  return `hsl(${hue}, 75%, 60%)`
}

function groupColorAlpha(index: number, total: number, alpha: number): string {
  const hue = (index / total) * 360
  return `hsla(${hue}, 75%, 60%, ${alpha})`
}

// ─── Particle ────────────────────────────────────────────────────────────────

interface Particle {
  angle: number
  radius: number
  speed: number
  size: number
  groupIndex: number
}

function createParticles(groups: MemoryGroup[], maxParticles: number): Particle[] {
  const particles: Particle[] = []
  const totalCount = groups.reduce((s, g) => s + g.count, 0)
  if (totalCount === 0) return particles

  for (let gi = 0; gi < groups.length; gi++) {
    const share = Math.max(1, Math.round((groups[gi].count / totalCount) * maxParticles))
    for (let i = 0; i < share && particles.length < maxParticles; i++) {
      particles.push({
        angle: Math.random() * Math.PI * 2,
        radius: 60 + Math.random() * 100,
        speed: 0.002 + Math.random() * 0.004,
        size: 2 + Math.random() * 2.5,
        groupIndex: gi,
      })
    }
  }
  return particles
}

// ─── Component ───────────────────────────────────────────────────────────────

export function MemoryOrbitViz({ groups, totalMemories }: MemoryOrbitVizProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const particlesRef = useRef<Particle[]>([])
  const animRef = useRef<number>(0)
  const [showTooltip, setShowTooltip] = useState(false)
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 })

  useEffect(() => {
    particlesRef.current = createParticles(groups, Math.min(groups.reduce((s, g) => s + g.count, 0), 200))
  }, [groups])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    ctx.scale(dpr, dpr)

    const cx = rect.width / 2
    const cy = rect.height / 2
    const totalGroups = groups.length || 1

    function draw() {
      ctx!.clearRect(0, 0, rect.width, rect.height)

      // Central circle
      const gradient = ctx!.createRadialGradient(cx, cy, 0, cx, cy, 40)
      gradient.addColorStop(0, 'rgba(99, 102, 241, 0.3)')
      gradient.addColorStop(1, 'rgba(99, 102, 241, 0.05)')
      ctx!.beginPath()
      ctx!.arc(cx, cy, 40, 0, Math.PI * 2)
      ctx!.fillStyle = gradient
      ctx!.fill()

      // Central ring
      ctx!.beginPath()
      ctx!.arc(cx, cy, 40, 0, Math.PI * 2)
      ctx!.strokeStyle = 'rgba(99, 102, 241, 0.4)'
      ctx!.lineWidth = 1.5
      ctx!.stroke()

      // Central text
      ctx!.fillStyle = 'rgba(248, 250, 252, 0.9)'
      ctx!.font = '600 16px Inter, sans-serif'
      ctx!.textAlign = 'center'
      ctx!.textBaseline = 'middle'
      ctx!.fillText(String(totalMemories), cx, cy - 4)
      ctx!.fillStyle = 'rgba(148, 163, 184, 0.7)'
      ctx!.font = '400 9px Inter, sans-serif'
      ctx!.fillText('memories', cx, cy + 12)

      // Orbit rings (faint)
      for (let r = 80; r <= 160; r += 40) {
        ctx!.beginPath()
        ctx!.arc(cx, cy, r, 0, Math.PI * 2)
        ctx!.strokeStyle = 'rgba(148, 163, 184, 0.06)'
        ctx!.lineWidth = 0.5
        ctx!.stroke()
      }

      // Particles
      for (const p of particlesRef.current) {
        p.angle += p.speed
        const x = cx + Math.cos(p.angle) * p.radius
        const y = cy + Math.sin(p.angle) * p.radius

        ctx!.beginPath()
        ctx!.arc(x, y, p.size, 0, Math.PI * 2)
        ctx!.fillStyle = groupColorAlpha(p.groupIndex, totalGroups, 0.8)
        ctx!.fill()

        // Glow
        ctx!.beginPath()
        ctx!.arc(x, y, p.size + 2, 0, Math.PI * 2)
        ctx!.fillStyle = groupColorAlpha(p.groupIndex, totalGroups, 0.15)
        ctx!.fill()
      }

      animRef.current = requestAnimationFrame(draw)
    }

    draw()
    return () => cancelAnimationFrame(animRef.current)
  }, [groups, totalMemories])

  const handleMouseEnter = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const cx = rect.width / 2
    const cy = rect.height / 2
    const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2)
    if (dist <= 45) {
      setShowTooltip(true)
      setTooltipPos({ x: e.clientX, y: e.clientY })
    }
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const cx = rect.width / 2
    const cy = rect.height / 2
    const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2)
    if (dist <= 45) {
      setShowTooltip(true)
      setTooltipPos({ x: e.clientX, y: e.clientY })
    } else {
      setShowTooltip(false)
    }
  }

  const handleMouseLeave = () => setShowTooltip(false)

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        className="w-full h-[320px]"
        onMouseEnter={handleMouseEnter}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      />

      {/* Tooltip */}
      {showTooltip && (
        <div
          className="fixed z-50 pointer-events-none px-3 py-2 rounded-lg bg-[var(--theme-surface-2)] border border-theme-border shadow-lg"
          style={{ left: tooltipPos.x + 12, top: tooltipPos.y - 40 }}
        >
          <p className="text-xs font-semibold text-theme-primary">{totalMemories} Memories</p>
          <div className="mt-1 space-y-0.5">
            {groups.map((g, i) => (
              <div key={g.kind} className="flex items-center gap-2 text-[10px] text-theme-muted">
                <span
                  className="w-2 h-2 rounded-full inline-block"
                  style={{ backgroundColor: groupColor(i, groups.length) }}
                />
                {g.kind}: {g.count}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-3 mt-3 justify-center">
        {groups.map((g, i) => (
          <div key={g.kind} className="flex items-center gap-1.5 text-[11px] text-theme-muted">
            <span
              className="w-2.5 h-2.5 rounded-full inline-block"
              style={{ backgroundColor: groupColor(i, groups.length) }}
            />
            <span className="capitalize">{g.kind}</span>
            <span className="text-theme-muted/60">({g.count})</span>
          </div>
        ))}
      </div>
    </div>
  )
}
