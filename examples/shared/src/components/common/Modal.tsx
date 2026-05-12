import {
  type MutableRefObject,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

type ModalProps = {
  isOpen: boolean
  onClose: () => void
  title: string
  children: ReactNode
  /** When true, backdrop and header close controls do nothing (e.g. during async work). */
  preventClose?: boolean
}

type StackEntry = {
  id: number
  preventCloseRef: MutableRefObject<boolean>
  requestClose: () => void
}

const modalStack: StackEntry[] = []
let modalIdSeq = 0

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function isVisibleFocusable(el: HTMLElement): boolean {
  const style = window.getComputedStyle(el)
  if (style.visibility === 'hidden' || style.display === 'none') return false
  return !!(el.offsetWidth || el.offsetHeight || style.position === 'fixed')
}

function getFocusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(el => {
    if (el.closest('[aria-hidden="true"]')) return false
    return isVisibleFocusable(el)
  })
}

export default function Modal({ isOpen, onClose, title, children, preventClose = false }: ModalProps) {
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)
  const modalIdRef = useRef<number>(0)
  if (modalIdRef.current === 0) modalIdRef.current = ++modalIdSeq

  const preventCloseRef = useRef(preventClose)
  preventCloseRef.current = preventClose

  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  const requestClose = useCallback(() => {
    if (!preventCloseRef.current) onCloseRef.current()
  }, [])

  const [shellZ, setShellZ] = useState(50)

  useLayoutEffect(() => {
    if (!isOpen) return

    previouslyFocused.current = document.activeElement instanceof HTMLElement ? document.activeElement : null

    const depth = modalStack.length
    setShellZ(50 + depth)

    const entry: StackEntry = {
      id: modalIdRef.current,
      preventCloseRef,
      requestClose,
    }
    modalStack.push(entry)

    const dialog = dialogRef.current
    if (dialog) {
      const focusables = getFocusableElements(dialog)
      const candidate = focusables[0] ?? dialog
      if (candidate === dialog && !dialog.hasAttribute('tabindex')) {
        dialog.setAttribute('tabindex', '-1')
      }
      candidate.focus()
    }

    return () => {
      const idx = modalStack.findIndex(e => e.id === entry.id)
      if (idx >= 0) modalStack.splice(idx, 1)
      setShellZ(50)
      const prev = previouslyFocused.current
      previouslyFocused.current = null
      if (prev?.isConnected) prev.focus()
    }
  }, [isOpen, requestClose])

  useEffect(() => {
    if (!isOpen) return

    const onKeyDown = (e: KeyboardEvent) => {
      const top = modalStack[modalStack.length - 1]
      if (!top || top.id !== modalIdRef.current) return

      if (e.key === 'Escape') {
        if (top.preventCloseRef.current) {
          e.preventDefault()
          e.stopPropagation()
          return
        }
        e.preventDefault()
        e.stopPropagation()
        top.requestClose()
        return
      }

      if (e.key !== 'Tab') return

      const dialog = dialogRef.current
      if (!dialog) return

      const focusables = getFocusableElements(dialog)
      if (focusables.length === 0) {
        e.preventDefault()
        return
      }

      if (focusables.length === 1) {
        e.preventDefault()
        focusables[0].focus()
        return
      }

      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement as HTMLElement | null

      if (e.shiftKey) {
        if (active === first || !dialog.contains(active)) {
          e.preventDefault()
          last.focus()
        }
      } else if (active === last || !dialog.contains(active)) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [isOpen])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 flex items-center justify-center" style={{ zIndex: shellZ }}>
      {/* Backdrop: native button avoids div click handlers; tabIndex -1 keeps it out of the tab sequence */}
      <button
        type="button"
        tabIndex={-1}
        className={`absolute inset-0 bg-black bg-opacity-50 border-0 p-0 ${
          preventClose ? 'cursor-default' : 'cursor-pointer'
        }`}
        aria-label={preventClose ? 'Dialog backdrop' : 'Close dialog'}
        onClick={() => {
          if (!preventCloseRef.current) requestClose()
        }}
      />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative bg-white rounded-lg shadow-xl max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto outline-none"
      >
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h2 id={titleId} className="text-xl font-semibold text-gray-900">
            {title}
          </h2>
          <button
            type="button"
            onClick={requestClose}
            disabled={preventClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none disabled:opacity-40 disabled:cursor-not-allowed"
            aria-disabled={preventClose}
          >
            ×
          </button>
        </div>

        <div className="p-4">{children}</div>
      </div>
    </div>
  )
}
