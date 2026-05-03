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
// Each size is the *desktop* width; on phones the modal is a full-width
// bottom sheet so width here is irrelevant under sm:. The sm:- prefix
// is baked in so Tailwind's static analyzer sees real class names rather
// than interpolated strings (which it doesn't expand).
const SIZES = {
  sm: 'sm:max-w-md',
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-2xl',
  xl: 'sm:max-w-4xl',
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
      // Bottom-sheet on phones (<sm), centered card on tablet/desktop.
      // The sheet lives at `inset-x-0 bottom-0` with a top rounded edge
      // and `max-h-[92dvh]` so the body can scroll if its content is
      // tall. Centered geometry kicks back in at sm:+ via the standard
      // `m-auto` + size class, so existing modal call sites just work
      // on every viewport without further changes.
      className={`fixed z-50 text-left bg-[var(--theme-card-bg)] border border-theme-border shadow-2xl backdrop:bg-black/50 backdrop:backdrop-blur-sm p-0
        inset-x-0 bottom-0 mt-auto mb-0 mx-0 w-full max-w-full rounded-t-2xl rounded-b-none
        sm:inset-0 sm:m-auto ${SIZES[size]} sm:w-full sm:rounded-xl sm:rounded-b-xl`}
      onClick={(e) => {
        // Close on backdrop click
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="flex flex-col max-h-[92dvh] sm:max-h-[85vh] pb-[max(env(safe-area-inset-bottom),0px)]">
        {/* iOS-style grabber affordance — a small horizontal pill at the
            top of the sheet that signals "this is a sheet, you can
            dismiss it by swiping down or tapping outside." Hidden on
            sm+ where the modal is a centered card. */}
        <div aria-hidden className="sm:hidden flex justify-center pt-2 pb-1">
          <span className="block h-1 w-10 rounded-full bg-[var(--theme-surface-3)]" />
        </div>
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
