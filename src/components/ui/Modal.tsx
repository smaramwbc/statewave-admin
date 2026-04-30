import { useEffect, useRef, useId } from 'react'
import { ErrorBoundary } from '../ErrorBoundary'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
}

export function Modal({ open, onClose, title, children }: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const previousActiveElementRef = useRef<HTMLElement | null>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    if (open) {
      // Store the currently focused element before opening
      previousActiveElementRef.current = document.activeElement as HTMLElement
      dialog.showModal()
    } else {
      dialog.close()
      // Return focus to the element that triggered the modal
      if (previousActiveElementRef.current && typeof previousActiveElementRef.current.focus === 'function') {
        previousActiveElementRef.current.focus()
      }
    }
  }, [open])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    dialog.addEventListener('keydown', handleEscape)
    return () => dialog.removeEventListener('keydown', handleEscape)
  }, [onClose])

  if (!open) return null

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className="fixed inset-0 z-50 m-auto max-w-lg w-full rounded-xl border border-theme-border bg-[var(--theme-card-bg)] shadow-2xl backdrop:bg-black/50 backdrop:backdrop-blur-sm p-0"
      onClick={(e) => {
        // Close on backdrop click
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-theme-border">
          <h2 id={titleId} className="text-sm font-semibold text-theme-primary">{title}</h2>
          <button
            onClick={onClose}
            className="text-theme-muted hover:text-theme-primary transition-colors p-1 -mr-1"
            aria-label="Close modal"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        {/* Body */}
        <div className="px-5 py-4 overflow-y-auto">
          <ErrorBoundary level="modal">
            {children}
          </ErrorBoundary>
        </div>
      </div>
    </dialog>
  )
}
