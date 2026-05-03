/**
 * Skeleton — minimal shimmering placeholder block.
 *
 * Skeletons replace the full-page LoadingOverlay on initial loads so the
 * eventual layout is visible from the first frame and there's no visual
 * "reset" after data resolves. We deliberately keep the surface tint very
 * subtle (theme-surface-2 over surface-1) and the animation low-amplitude
 * so a partially-loaded page doesn't look noisy.
 *
 * `prefers-reduced-motion` is honored at the global CSS level
 * (index.css already shortens transitions/animations there) — the
 * `animate-pulse` class therefore degrades to a static block, which is
 * the correct fallback.
 */

interface SkeletonProps {
  /** Tailwind sizing/spacing on the skeleton block. Pass any width/height
   *  utility — `w-32 h-4` is the most common shape for a single line. */
  className?: string
  /** Accessible label for screen readers. Decorative-by-default since
   *  most skeletons sit inside a region that already announces "loading". */
  ariaLabel?: string
}

export function Skeleton({ className = '', ariaLabel }: SkeletonProps) {
  return (
    <div
      role={ariaLabel ? 'status' : undefined}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
      className={`bg-[var(--theme-surface-2)] rounded animate-pulse ${className}`}
    />
  )
}
