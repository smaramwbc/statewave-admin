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
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-lg font-semibold text-theme-primary">{title}</h1>
        {description && (
          <p className="text-sm text-theme-muted mt-0.5">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
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
