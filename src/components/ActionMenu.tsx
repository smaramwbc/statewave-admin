import { useEffect, useRef, useState, type ReactNode } from 'react'
import { MoreVertical } from 'lucide-react'
import { IconButton } from './ui'

/**
 * Page-level action menu with the same kebab (⋮) pattern as
 * SubjectRowActions, lifted into a reusable component so every list
 * page can collapse its toolbar into a single tap target on phones.
 *
 * Why this exists:
 *   On a phone the Subjects header was rendering "Updated · Refresh ·
 *   Import / Restore… · Bulk delete…" all in a row, which spilled past
 *   the right edge and made the right-most action invisible. The
 *   matching desktop layout fits because there's room. We follow the
 *   convention already established by SubjectRowActions: a single ⋮
 *   button with a real role="menu" dropdown.
 *
 * Behaviour:
 *   - md+ : items render inline (the parent wraps them in a flex row)
 *     using the supplied `desktop` slot. Default desktop layout simply
 *     renders each item as the IconButton/Button passed in `render`.
 *   - <md : a single ⋮ kebab opens a popover; each item becomes a
 *     menuitem. Closes on outside click, Escape, and item activation.
 *
 * Items can be `disabled`, can be marked as `destructive` for a red
 * tint, and can carry an optional leading icon.
 */

export interface ActionMenuItem {
  /** Stable label used as the menuitem text and aria fallback. */
  label: string
  /** Triggered when the item is activated. */
  onSelect: () => void
  /** Optional leading icon (rendered at 14px). */
  icon?: ReactNode
  /** Mark as destructive (red tint, kept at the bottom of the list). */
  destructive?: boolean
  disabled?: boolean
  /** Optional rich label for the desktop inline rendering — usually
   *  the original full-size button (e.g. with `Import / Restore…`
   *  text and styling). When omitted the desktop layout renders a
   *  plain button matching the menuitem styling. */
  desktop?: ReactNode
  /** Tooltip used on the kebab menuitem on mobile. */
  title?: string
}

interface ActionMenuProps {
  items: ActionMenuItem[]
  /** ARIA label for the kebab toggle. */
  label?: string
}

export function ActionMenu({ items, label = 'Actions' }: ActionMenuProps) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (items.length === 0) return null

  return (
    <>
      {/* md+ : inline layout. Each item that supplied a `desktop` node
          renders it verbatim; otherwise we render a default text button
          so callers can opt in gradually. */}
      <div className="hidden md:flex items-center gap-2">
        {items.map((item, i) =>
          item.desktop ? (
            <span key={i}>{item.desktop}</span>
          ) : (
            <button
              key={i}
              type="button"
              onClick={item.onSelect}
              disabled={item.disabled}
              title={item.title}
              className={`inline-flex items-center gap-1.5 rounded-lg border border-theme-border bg-[var(--theme-surface-1)] px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-[var(--theme-surface-2)] disabled:opacity-50 disabled:cursor-not-allowed ${
                item.destructive
                  ? 'text-red-400 hover:text-red-300'
                  : 'text-theme-secondary hover:text-theme-primary'
              }`}
            >
              {item.icon && <span className="text-theme-muted shrink-0">{item.icon}</span>}
              {item.label}
            </button>
          ),
        )}
      </div>

      {/* < md : kebab dropdown. */}
      <div ref={wrapperRef} className="relative md:hidden">
        <IconButton
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={open}
          icon={<MoreVertical />}
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation()
            setOpen((v) => !v)
          }}
        />
        {open && (
          <div
            role="menu"
            aria-label={label}
            className="absolute right-0 top-full mt-1 z-30 min-w-[200px] rounded-lg border border-theme-border bg-[var(--theme-card-bg)] shadow-lg py-1"
          >
            {items.map((item, i) => (
              <button
                key={i}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  if (item.disabled) return
                  setOpen(false)
                  item.onSelect()
                }}
                className={`w-full text-left px-3 py-2.5 text-sm transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed ${
                  item.destructive
                    ? 'text-red-400 hover:text-red-300 hover:bg-red-500/10'
                    : 'text-theme-secondary hover:text-theme-primary hover:bg-[var(--theme-surface-1)]'
                }`}
              >
                {item.icon && <span className="text-theme-muted shrink-0">{item.icon}</span>}
                {item.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
