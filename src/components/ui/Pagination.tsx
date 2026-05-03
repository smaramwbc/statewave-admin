import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from './Button'

/**
 * Pagination — page-number control used at the bottom of every list view.
 *
 * Internally, all clickable elements route through a single `<PageButton>`
 * helper or the shared `<Button>` primitive so the previous/page/next
 * controls stay visually consistent and respond uniformly to theme +
 * cursor changes. The component preserves the ARIA contract:
 *
 *   * `<nav aria-label="Pagination">` wraps the whole control
 *   * the active page carries `aria-current="page"`
 *   * previous/next/page buttons each have an `aria-label`
 *   * disabled prev/next are not focus traps (Button handles this)
 */

interface PaginationProps {
  currentPage: number
  totalPages: number
  totalItems: number
  onPageChange: (page: number) => void
}

interface PageButtonProps {
  page: number
  isActive: boolean
  onPageChange: (page: number) => void
}

function PageButton({ page, isActive, onPageChange }: PageButtonProps) {
  // Page-number buttons stay raw to keep their square aspect — Button is
  // sized for label text and would force them wider. They share the same
  // rounded-lg / theme-surface conventions as the rest of the app.
  return (
    <button
      type="button"
      onClick={() => onPageChange(page)}
      aria-label={`Go to page ${page}`}
      aria-current={isActive ? 'page' : undefined}
      className={`min-w-[32px] px-2 py-1.5 text-xs rounded-lg border transition-colors ${
        isActive
          ? 'border-accent bg-accent/10 text-accent font-medium'
          : 'border-theme-border text-theme-secondary hover:bg-[var(--theme-surface-1)]'
      }`}
    >
      {page}
    </button>
  )
}

function Ellipsis() {
  return (
    <span className="px-1 text-theme-muted" aria-hidden="true">
      …
    </span>
  )
}

export function Pagination({
  currentPage,
  totalPages,
  totalItems,
  onPageChange,
}: PaginationProps) {
  if (totalPages <= 1) return null

  // Build the list of pages we want to render. Either every page (when
  // totalPages is small) or first-two / current / last-two with ellipses.
  // Computing the slice up front lets the JSX stay flat.
  const pageButtons: Array<{ page: number; key: string } | { kind: 'ellipsis'; key: string }> = []
  if (totalPages <= 7) {
    for (let p = 1; p <= totalPages; p++) {
      pageButtons.push({ page: p, key: `p${p}` })
    }
  } else {
    pageButtons.push({ page: 1, key: 'p1' }, { page: 2, key: 'p2' })
    if (currentPage > 4) pageButtons.push({ kind: 'ellipsis', key: 'el1' })
    if (currentPage > 3 && currentPage < totalPages - 2) {
      pageButtons.push({ page: currentPage, key: `p${currentPage}` })
    }
    if (currentPage < totalPages - 3) pageButtons.push({ kind: 'ellipsis', key: 'el2' })
    pageButtons.push(
      { page: totalPages - 1, key: `p${totalPages - 1}` },
      { page: totalPages, key: `p${totalPages}` },
    )
  }

  return (
    <nav
      aria-label="Pagination"
      className="flex items-center justify-between px-1 py-3"
    >
      <p className="text-xs text-theme-muted">
        Page {currentPage} of {totalPages} · {totalItems.toLocaleString()} total
      </p>
      <div className="flex items-center gap-1" role="group" aria-label="Page navigation">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage <= 1}
          aria-label="Go to previous page"
          leftIcon={<ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />}
        >
          Prev
        </Button>
        {pageButtons.map((entry) =>
          'kind' in entry ? (
            <Ellipsis key={entry.key} />
          ) : (
            <PageButton
              key={entry.key}
              page={entry.page}
              isActive={entry.page === currentPage}
              onPageChange={onPageChange}
            />
          ),
        )}
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage >= totalPages}
          aria-label="Go to next page"
          rightIcon={<ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />}
        >
          Next
        </Button>
      </div>
    </nav>
  )
}
