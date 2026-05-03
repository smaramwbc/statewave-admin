import { forwardRef } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Loader2 } from 'lucide-react'

/**
 * IconButton — square, icon-only control for actions where the affordance
 * is the icon itself (modal close, kebab menu trigger, search clear,
 * inline copy).
 *
 * Why a separate primitive vs. `<Button>`:
 *   * `<Button>` is sized for text labels — its horizontal padding makes
 *     icon-only invocations look stretched and inconsistent with the
 *     compact admin chrome.
 *   * Square hit area (28/32px) keeps icon-only controls visually
 *     anchored to the row / table cell / modal header they belong to.
 *   * The accessible-name contract is enforced by the type: `aria-label`
 *     is required (callers can't fall back to "no name on an icon-only
 *     button"). The icon itself is rendered with `aria-hidden="true"`.
 *
 * Theme-only colours via the existing `--theme-*` variables; the global
 * `index.css` rule already applies `cursor: pointer` to every `<button>`
 * and the focus ring is honoured via `focus-visible`.
 */

export type IconButtonVariant = 'ghost' | 'secondary' | 'destructive'
export type IconButtonSize = 'xs' | 'sm' | 'md'

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'aria-label'> {
  /** Required so screen readers can announce the action — every icon-only
   *  button must have one, no exceptions. */
  'aria-label': string
  /** lucide icon (or any decorative ReactNode). Rendered inside the
   *  button with `aria-hidden="true"`. Ignored when `loading` is true. */
  icon: ReactNode
  variant?: IconButtonVariant
  size?: IconButtonSize
  loading?: boolean
  type?: 'button' | 'submit' | 'reset'
}

const BASE =
  'inline-flex items-center justify-center rounded-lg ' +
  'transition-colors focus-visible:outline-none focus-visible:ring-2 ' +
  'focus-visible:ring-accent focus-visible:ring-offset-1 ' +
  'focus-visible:ring-offset-[var(--theme-surface-0)] ' +
  'disabled:opacity-50 disabled:pointer-events-none shrink-0'

const SIZES: Record<IconButtonSize, string> = {
  xs: 'w-6 h-6 [&>svg]:h-3 [&>svg]:w-3',
  sm: 'w-7 h-7 [&>svg]:h-3.5 [&>svg]:w-3.5',
  md: 'w-9 h-9 [&>svg]:h-4 [&>svg]:w-4',
}

const VARIANTS: Record<IconButtonVariant, string> = {
  ghost:
    'bg-transparent text-theme-muted hover:text-theme-primary hover:bg-[var(--theme-surface-2)]',
  secondary:
    'bg-[var(--theme-surface-1)] text-theme-primary border border-theme-border ' +
    'hover:bg-[var(--theme-surface-2)]',
  destructive:
    'bg-transparent text-red-500 border border-red-500/30 ' +
    'hover:bg-red-500/10',
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    {
      'aria-label': ariaLabel,
      icon,
      variant = 'ghost',
      size = 'sm',
      loading = false,
      type = 'button',
      disabled,
      className,
      ...rest
    },
    ref,
  ) {
    const isDisabled = disabled || loading
    return (
      <button
        ref={ref}
        type={type}
        aria-label={ariaLabel}
        aria-busy={loading || undefined}
        disabled={isDisabled}
        className={`${BASE} ${SIZES[size]} ${VARIANTS[variant]} ${className ?? ''}`}
        {...rest}
      >
        {loading ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : (
          // Icon is decorative — the accessible name comes from the
          // button's aria-label. We wrap so callers can pass either a
          // single lucide element or arbitrary inline SVG.
          <span aria-hidden="true" className="inline-flex items-center justify-center">
            {icon}
          </span>
        )}
      </button>
    )
  },
)
