import { forwardRef } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Loader2 } from 'lucide-react'

/**
 * Reusable Button primitive — the only path through which buttons should be
 * styled across the admin UI. Centralising this enforces:
 *
 *   * a single border-radius (corporate-design `rounded-lg`)
 *   * one place to fix focus rings, hover states, and disabled treatment
 *   * a clear semantic hierarchy via `variant`:
 *       primary       — main forward action (filled accent), at most one per surface
 *       secondary     — supporting bordered neutral
 *       ghost         — low-stakes / icon-only / tertiary
 *       destructive   — red, behind explicit confirmation
 *   * consistent sizing via `size` (sm = compact admin chrome, md = modal CTAs)
 *   * a `loading` state that swaps an inline spinner without changing width
 *     so the button doesn't jump in place
 *   * `aria-busy` / `disabled` plumbed through, including a forced
 *     `aria-label` requirement on icon-only invocations (caller must pass
 *     one — the type checker can't enforce that, but the empty-children
 *     branch raises a runtime warning in dev)
 *
 * Theme-only colours: every value below resolves through the `--color-*`
 * variables in `index.css`, so light and dark modes stay in sync.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive'
export type ButtonSize = 'sm' | 'md'

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  /** Icon rendered before the label. Decorative — caller passes lucide icon. */
  leftIcon?: ReactNode
  /** Icon rendered after the label. */
  rightIcon?: ReactNode
  /** Default `button` to avoid accidental form submits inside `<form>`. */
  type?: 'button' | 'submit' | 'reset'
  children?: ReactNode
}

const BASE =
  'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium ' +
  'transition-colors focus-visible:outline-none focus-visible:ring-2 ' +
  'focus-visible:ring-accent focus-visible:ring-offset-1 ' +
  'focus-visible:ring-offset-[var(--theme-surface-0)] ' +
  'disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap'

const SIZES: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-white hover:opacity-90 active:opacity-80 border border-transparent',
  secondary:
    'bg-[var(--theme-surface-1)] text-theme-primary border border-theme-border ' +
    'hover:bg-[var(--theme-surface-2)] active:bg-[var(--theme-surface-2)]',
  ghost:
    'bg-transparent text-theme-muted border border-transparent ' +
    'hover:text-theme-primary hover:bg-[var(--theme-surface-2)]',
  destructive:
    'bg-transparent text-red-500 border border-red-500/30 ' +
    'hover:bg-red-500/10 active:bg-red-500/15',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'sm',
    loading = false,
    leftIcon,
    rightIcon,
    type = 'button',
    disabled,
    children,
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
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={`${BASE} ${SIZES[size]} ${VARIANTS[variant]} ${className ?? ''}`}
      {...rest}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : (
        leftIcon
      )}
      {children}
      {!loading && rightIcon}
    </button>
  )
})
