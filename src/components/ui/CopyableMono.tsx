import { useState } from 'react'
import { Copy, Check } from 'lucide-react'
import { toast } from 'sonner'

/**
 * CopyableMono — a monospace-rendered identifier with a copy button.
 *
 * Use this for any value an operator might need to paste somewhere else:
 * subject ids, episode/memory/webhook UUIDs, request ids. The visible
 * text stays selectable so you can still drag-select if you prefer; the
 * copy button is for one-click convenience.
 *
 * Visual rules:
 *   * monospace, theme-secondary text colour by default
 *   * `truncate` when given a `maxWidthClass`, otherwise break-all so a
 *     long token never blows the layout horizontally
 *   * the copy button shows a Copy icon by default and switches to Check
 *     for a beat after a successful copy
 *   * accessible name on the button is `aria-label` or
 *     `Copy {labelForA11y}` — required so the icon-only control is
 *     readable by assistive tech
 */

interface CopyableMonoProps {
  /** The actual value copied to the clipboard. */
  value: string
  /** What to render visibly. Defaults to `value`; pass a shorter version
   *  if you want to show a head/tail elision while still copying full. */
  display?: string
  /** Tailwind class that limits how wide the visible text can grow before
   *  truncating, e.g. `max-w-[200px]`. Omit to let the value wrap. */
  maxWidthClass?: string
  /** Human-readable identifier kind, used in the button's accessible name
   *  and the toast description. e.g. `subject ID`, `episode ID`. */
  labelForA11y?: string
  /** Additional classes on the wrapping span (typography overrides etc.). */
  className?: string
  /** Visual emphasis. `subtle` = muted text, no background; `chip` = boxed
   *  monospace pill that stands out against surrounding text. */
  variant?: 'subtle' | 'chip'
}

export function CopyableMono({
  value,
  display,
  maxWidthClass,
  labelForA11y,
  className = '',
  variant = 'subtle',
}: CopyableMonoProps) {
  const [copied, setCopied] = useState(false)

  const onCopy = async () => {
    try {
      // Prefer the modern async API; fall back to legacy in older
      // environments (or when the page is served over plain http).
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value)
      } else {
        legacyCopy(value)
      }
      setCopied(true)
      toast.success('Copied', { description: labelForA11y ?? value })
      // Reset the icon after a short beat so the affordance returns.
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Copy failed', {
        description: 'Your browser blocked clipboard access.',
      })
    }
  }

  const valueClasses =
    variant === 'chip'
      ? 'font-mono text-theme-secondary bg-[var(--theme-surface-1)] border border-theme-border rounded px-1.5 py-0.5'
      : 'font-mono text-theme-secondary'

  return (
    <span
      className={`group inline-flex items-center gap-1.5 align-middle ${className}`}
      dir="ltr"
    >
      <span
        className={`${valueClasses} ${maxWidthClass ?? ''} ${
          maxWidthClass ? 'truncate' : 'break-all'
        }`}
        title={value}
      >
        {display ?? value}
      </span>
      {/* Raw <button> on purpose: this is an inline-with-text micro
          affordance (20×20px) that fades in on row hover. IconButton's
          smallest size (28px) would push the surrounding mono token
          off baseline, and IconButton doesn't carry the opacity-reveal
          behaviour. The accessibility contract is preserved via the
          required aria-label below. */}
      <button
        type="button"
        onClick={onCopy}
        aria-label={`Copy ${labelForA11y ?? 'value'}`}
        className="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded text-theme-muted hover:text-theme-primary hover:bg-[var(--theme-surface-2)] opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 transition-opacity"
      >
        {copied ? (
          <Check className="h-3 w-3 text-emerald-500" aria-hidden="true" />
        ) : (
          <Copy className="h-3 w-3" aria-hidden="true" />
        )}
      </button>
    </span>
  )
}

/** Legacy clipboard write for very old browsers / non-secure contexts.
 *  Mounted as a hidden textarea, selected, exec-copy'd, removed. */
function legacyCopy(value: string) {
  const ta = document.createElement('textarea')
  ta.value = value
  ta.setAttribute('readonly', '')
  ta.style.position = 'absolute'
  ta.style.left = '-9999px'
  document.body.appendChild(ta)
  ta.select()
  try {
    document.execCommand('copy')
  } finally {
    document.body.removeChild(ta)
  }
}
