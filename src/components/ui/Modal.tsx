import { useEffect, useRef, useId } from 'react'
import { X } from 'lucide-react'
import { ErrorBoundary } from '../ErrorBoundary'
import { IconButton } from './IconButton'

/**
 * Modal sizes are pinned in this map (rather than a free-form className) so
 * every call site stays consistent. Width grows with content density:
 *   sm — short forms (passphrase, simple confirm)
 *   md — default; one-section forms (Clone, Export)
 *   lg — multi-section content (Memory actions drawer, with tabs)
 *   xl — only for full-bleed inspectors that genuinely need it
 */
const SIZES = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
} as const

export type ModalSize = keyof typeof SIZES

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  /** Optional secondary text rendered under the title — keeps the body
   *  free of "what is this modal" framing. */
  description?: string
  size?: ModalSize
  children: React.ReactNode
}

export function Modal({
  open,
  onClose,
  title,
  description,
  size = 'md',
  children,
}: ModalProps) {
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
      // dir + text-left are belt-and-suspenders against the dialog
      // inheriting an unexpected RTL or text-align value from a parent
      // (browser-vendor stylesheet or a future global CSS rule). Without
      // them, long monospace tokens such as visitor subject ids can render
      // with their tail wrapped to the right edge — which reads as RTL.
      dir="ltr"
      className={`fixed inset-0 z-50 m-auto ${SIZES[size]} w-full text-left rounded-xl border border-theme-border bg-[var(--theme-card-bg)] shadow-2xl backdrop:bg-black/50 backdrop:backdrop-blur-sm p-0`}
      onClick={(e) => {
        // Close on backdrop click
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-theme-border gap-4">
          <div className="min-w-0">
            <h2
              id={titleId}
              className="text-sm font-semibold text-theme-primary"
            >
              {title}
            </h2>
            {description && (
              <p className="text-xs text-theme-muted mt-0.5">{description}</p>
            )}
          </div>
          <IconButton
            aria-label="Close modal"
            icon={<X />}
            variant="ghost"
            size="md"
            onClick={onClose}
            className="-mr-1"
          />
        </div>
        {/* Body. `overflow-x-hidden` + `min-w-0` prevent a long mono token
            (subject ids, filenames) from forcing the dialog to grow wider
            than its size class — a 32rem-class modal must always lay out
            inside 32rem, which means children that contain unbreakable
            tokens have to use `break-all` themselves. */}
        <div className="px-5 py-4 overflow-y-auto overflow-x-hidden min-w-0">
          <ErrorBoundary level="modal">{children}</ErrorBoundary>
        </div>
      </div>
    </dialog>
  )
}
