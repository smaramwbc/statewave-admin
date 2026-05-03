import { useEffect, useRef, useState, type ReactNode } from 'react'
import { RefreshCw } from 'lucide-react'

/**
 * Mobile pull-to-refresh wrapper.
 *
 * The admin shell scrolls inside `<main>`, not the document, so the
 * browser's native PWA pull-to-refresh never fires. This component owns
 * a small touch listener that watches the nearest scrollable ancestor
 * (the `<main>` element provided by the shell) and reports a refresh
 * gesture once the visitor pulls past a threshold.
 *
 * Behaviour locked down:
 *   - only activates on touch devices and only when the scrollable
 *     ancestor is at scrollTop === 0
 *   - rubber-banded translate so the indicator follows the finger
 *     without ever exceeding ~80px
 *   - threshold 70px → triggers `onRefresh` on touchend
 *   - while `onRefresh` is in flight the spinner stays visible
 *   - calls preventDefault on touchmove only when actively pulling so
 *     normal scrolling stays unblocked
 *   - desktop (no touch capability) is a no-op so the wrapper is safe
 *     to apply unconditionally
 */

interface PullToRefreshProps {
  onRefresh: () => Promise<void> | void
  /** Optional disable flag — useful while a modal owns the screen. */
  disabled?: boolean
  children: ReactNode
}

const PULL_THRESHOLD = 70 // px — finger travel beyond this triggers refresh
const PULL_MAX = 100 // px — rubber-banded ceiling so the indicator never floats away
const RUBBER_BAND = 0.45 // damping coefficient: out = in * RUBBER_BAND
const SPINNER_TOP = 16 // px — where the indicator parks while spinning

function findScrollContainer(node: HTMLElement | null): HTMLElement | Window {
  // Walk up the tree looking for an ancestor that owns the scroll. The
  // admin shell uses `<main className="overflow-auto">` so we expect a
  // hit there; falling back to window keeps the hook usable in tests
  // and on pages that don't have a scrolling main.
  let cur = node?.parentElement ?? null
  while (cur) {
    const style = window.getComputedStyle(cur)
    const oy = style.overflowY
    if ((oy === 'auto' || oy === 'scroll' || oy === 'overlay') && cur.scrollHeight > cur.clientHeight) {
      return cur
    }
    cur = cur.parentElement
  }
  return window
}

function getScrollTop(target: HTMLElement | Window): number {
  if (target === window) return window.scrollY
  return (target as HTMLElement).scrollTop
}

export function PullToRefresh({ onRefresh, disabled = false, children }: PullToRefreshProps) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const startYRef = useRef<number | null>(null)
  const activeRef = useRef(false)
  const [pullDistance, setPullDistance] = useState(0)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    if (disabled) return

    // Touch support gate. Mouse-only environments (desktop) shouldn't
    // get any of this — the existing Refresh button covers them.
    if (!('ontouchstart' in window) && !(navigator.maxTouchPoints > 0)) return

    const scrollContainer = findScrollContainer(wrapper)

    const onTouchStart = (e: TouchEvent) => {
      if (refreshing) return
      // Only initiate when the user is at the top of the scroll
      // viewport — otherwise the pull would compete with normal scroll.
      if (getScrollTop(scrollContainer) > 0) {
        startYRef.current = null
        activeRef.current = false
        return
      }
      startYRef.current = e.touches[0].clientY
      activeRef.current = false
    }

    const onTouchMove = (e: TouchEvent) => {
      if (refreshing) return
      const start = startYRef.current
      if (start == null) return
      const dy = e.touches[0].clientY - start
      if (dy <= 0) {
        // Upward swipe: not our gesture, let the browser scroll normally.
        if (activeRef.current) {
          activeRef.current = false
          setPullDistance(0)
        }
        return
      }
      // Once we know it's a downward pull while at scrollTop=0, claim
      // the gesture so the page doesn't scroll under our indicator. We
      // only call preventDefault when we're actively pulling past a
      // small dead zone so accidental finger jitter doesn't kill normal
      // taps / micro-scrolls.
      if (dy < 6) return
      if (e.cancelable) e.preventDefault()
      activeRef.current = true
      const eased = Math.min(dy * RUBBER_BAND, PULL_MAX)
      setPullDistance(eased)
    }

    const reset = () => {
      startYRef.current = null
      activeRef.current = false
      setPullDistance(0)
    }

    const onTouchEnd = async () => {
      if (refreshing) return
      const distance = pullDistance
      if (!activeRef.current || distance < PULL_THRESHOLD) {
        reset()
        return
      }
      setRefreshing(true)
      // Park the indicator at SPINNER_TOP while the refresh promise
      // resolves so it stays visible to the user as feedback.
      setPullDistance(SPINNER_TOP)
      try {
        await onRefresh()
      } finally {
        setRefreshing(false)
        reset()
      }
    }

    // passive:false on touchmove so we can call preventDefault inside
    // the active-pull branch. touchstart/end stay passive for perf.
    wrapper.addEventListener('touchstart', onTouchStart, { passive: true })
    wrapper.addEventListener('touchmove', onTouchMove, { passive: false })
    wrapper.addEventListener('touchend', onTouchEnd, { passive: true })
    wrapper.addEventListener('touchcancel', reset, { passive: true })
    return () => {
      wrapper.removeEventListener('touchstart', onTouchStart)
      wrapper.removeEventListener('touchmove', onTouchMove)
      wrapper.removeEventListener('touchend', onTouchEnd)
      wrapper.removeEventListener('touchcancel', reset)
    }
  }, [onRefresh, disabled, pullDistance, refreshing])

  const showIndicator = pullDistance > 0 || refreshing
  const ready = pullDistance >= PULL_THRESHOLD && !refreshing

  return (
    <div ref={wrapperRef} className="relative">
      {/* Indicator: a small chip that grows in opacity / rotation as
          the user pulls past the threshold. Sits absolutely positioned
          so it doesn't reflow the page underneath. */}
      <div
        aria-hidden={!showIndicator}
        className={`pointer-events-none absolute left-1/2 -translate-x-1/2 z-30 transition-opacity ${
          showIndicator ? 'opacity-100' : 'opacity-0'
        }`}
        style={{ top: Math.max(pullDistance - 32, 0) }}
      >
        <div
          className={`flex items-center gap-2 rounded-full border border-theme-border bg-[var(--theme-card-bg)] px-3 py-1.5 shadow-md text-xs ${
            ready || refreshing ? 'text-accent' : 'text-theme-muted'
          }`}
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`}
            style={
              refreshing
                ? undefined
                : { transform: `rotate(${Math.min(pullDistance * 4, 360)}deg)`, transition: 'transform 80ms linear' }
            }
            aria-hidden="true"
          />
          <span>{refreshing ? 'Refreshing…' : ready ? 'Release to refresh' : 'Pull to refresh'}</span>
        </div>
      </div>
      {/* The pulled content translates with the finger so it feels
          tactile. We avoid translating during a refresh — once the
          spinner parks, the page should stay put. */}
      <div
        style={{
          transform: pullDistance > 0 && !refreshing ? `translateY(${pullDistance}px)` : undefined,
          transition: pullDistance === 0 ? 'transform 200ms ease-out' : undefined,
        }}
      >
        {children}
      </div>
    </div>
  )
}
