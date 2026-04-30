interface PaginationProps {
  currentPage: number
  totalPages: number
  totalItems: number
  onPageChange: (page: number) => void
}

export function Pagination({ currentPage, totalPages, totalItems, onPageChange }: PaginationProps) {
  if (totalPages <= 1) return null

  return (
    <nav aria-label="Pagination" className="flex items-center justify-between px-1 py-3">
      <p className="text-xs text-theme-muted">
        Page {currentPage} of {totalPages} · {totalItems.toLocaleString()} total
      </p>
      <div className="flex items-center gap-1" role="group" aria-label="Page navigation">
        <button
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage <= 1}
          aria-label="Go to previous page"
          className="px-2.5 py-1.5 text-xs rounded-md border border-theme-border text-theme-secondary hover:bg-[var(--theme-surface-1)] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          ← Prev
        </button>
        {totalPages <= 7 ? (
          // Show all pages
          Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
            <button
              key={page}
              onClick={() => onPageChange(page)}
              aria-label={`Go to page ${page}`}
              aria-current={page === currentPage ? 'page' : undefined}
              className={`min-w-[32px] px-2 py-1.5 text-xs rounded-md border ${
                page === currentPage
                  ? 'border-accent bg-accent/10 text-accent font-medium'
                  : 'border-theme-border text-theme-secondary hover:bg-[var(--theme-surface-1)]'
              }`}
            >
              {page}
            </button>
          ))
        ) : (
          // Show abbreviated pagination
          <>
            {[1, 2].map((page) => (
              <button
                key={page}
                onClick={() => onPageChange(page)}
                aria-label={`Go to page ${page}`}
                aria-current={page === currentPage ? 'page' : undefined}
                className={`min-w-[32px] px-2 py-1.5 text-xs rounded-md border ${
                  page === currentPage
                    ? 'border-accent bg-accent/10 text-accent font-medium'
                    : 'border-theme-border text-theme-secondary hover:bg-[var(--theme-surface-1)]'
                }`}
              >
                {page}
              </button>
            ))}
            {currentPage > 4 && <span className="px-1 text-theme-muted" aria-hidden="true">…</span>}
            {currentPage > 3 && currentPage < totalPages - 2 && (
              <button
                aria-label={`Current page, page ${currentPage}`}
                aria-current="page"
                className="min-w-[32px] px-2 py-1.5 text-xs rounded-md border border-accent bg-accent/10 text-accent font-medium"
              >
                {currentPage}
              </button>
            )}
            {currentPage < totalPages - 3 && <span className="px-1 text-theme-muted" aria-hidden="true">…</span>}
            {[totalPages - 1, totalPages].map((page) => (
              <button
                key={page}
                onClick={() => onPageChange(page)}
                aria-label={`Go to page ${page}`}
                aria-current={page === currentPage ? 'page' : undefined}
                className={`min-w-[32px] px-2 py-1.5 text-xs rounded-md border ${
                  page === currentPage
                    ? 'border-accent bg-accent/10 text-accent font-medium'
                    : 'border-theme-border text-theme-secondary hover:bg-[var(--theme-surface-1)]'
                }`}
              >
                {page}
              </button>
            ))}
          </>
        )}
        <button
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage >= totalPages}
          aria-label="Go to next page"
          className="px-2.5 py-1.5 text-xs rounded-md border border-theme-border text-theme-secondary hover:bg-[var(--theme-surface-1)] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Next →
        </button>
      </div>
    </nav>
  )
}
