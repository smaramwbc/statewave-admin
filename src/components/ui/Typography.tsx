import type { ReactNode } from 'react'

/**
 * Typography primitives — the canonical way to render page chrome.
 *
 * The admin UI ships in a tight, dense layout. We deliberately choose a
 * compact hierarchy and lock the sizes here so every page matches:
 *
 *   PageHeader        text-lg semibold + optional text-sm muted subtitle
 *   SectionLabel      text-xs uppercase tracking-wide muted   ("system status", "data")
 *   CardTitle         text-sm semibold                        (card / row heading)
 *   CardBody          text-sm muted                           (card descriptions)
 *
 * Table headers are inline (one-per-page) and stay as small Tailwind utility
 * classes inside their own table — extracting them into a component would
 * fight with column-specific alignment.
 */

interface PageHeaderProps {
  title: string
  description?: string
  /** Right-aligned controls (refresh, primary actions). Stays in the same
   *  row as the title on every page — that's the consistency the user
   *  asked for. */
  actions?: ReactNode
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  // The actions cluster (kebab on phones, full toolbar on desktop)
  // sits on the SAME row as the title at every viewport — the
  // description renders on the line below. On a phone screenshot from
  // a real user this read more naturally than stacking the kebab below
  // the description, where the affordance felt orphaned. The min-w-0
  // on the title lets it truncate cleanly when a long page name (e.g.
  // a subject id) would otherwise push the actions off-screen.
  return (
    <div className="mb-6">
      <div className="flex items-center justify-between gap-3 sm:gap-4">
        <h1 className="text-lg font-semibold text-theme-primary truncate min-w-0">
          {title}
        </h1>
        {actions && (
          <div className="flex items-center gap-2 flex-shrink-0">
            {actions}
          </div>
        )}
      </div>
      {description && (
        // Single line, but horizontally scrollable when the description
        // overflows its container — instead of clipping with an ellipsis
        // the user can swipe sideways to read the rest. Padded with -mx
        // bleed so the scroll touches the screen edge cleanly on phones,
        // and the native scrollbar is hidden because the text itself is
        // the affordance. The `title` attribute keeps the full string
        // available to assistive tech and pointer-hover. Outside-of-mobile
        // viewports there's almost always room for the full sentence, but
        // this still degrades nicely if a future page passes a very long
        // description.
        <p
          className="text-sm text-theme-muted mt-1 whitespace-nowrap overflow-x-auto -mx-1 px-1 [&::-webkit-scrollbar]:hidden [scrollbar-width:none]"
          title={description}
        >
          {description}
        </p>
      )}
    </div>
  )
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-xs font-semibold uppercase tracking-wide text-theme-muted mb-3">
      {children}
    </h2>
  )
}

export function CardTitle({ children }: { children: ReactNode }) {
  return <h3 className="text-sm font-semibold text-theme-primary">{children}</h3>
}

export function CardBody({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={`text-sm text-theme-muted ${className ?? ''}`}>{children}</p>
}
