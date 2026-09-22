import { useId, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import clsx from 'clsx'
import { usePresence } from '../../hooks/usePresence'
import { useOverlayBack } from '../../hooks/useOverlayBack'
import './composer.css'

const sheetStack: string[] = []

/** Keep floating planner controls inside the visible viewport without resizing the page. */
export function usePlannerViewport(ref: RefObject<HTMLElement>, open: boolean) {
  useLayoutEffect(() => {
    if (!open) return
    const viewport = window.visualViewport
    const touchKeyboard = window.matchMedia('(any-pointer: coarse)').matches
    let baseline = Math.max(window.innerHeight, document.documentElement.clientHeight)
    let width = window.innerWidth
    let keyboardTravel = 0
    let frame = 0
    const apply = () => {
      const element = ref.current
      if (!element) return
      const height = viewport?.height ?? window.innerHeight
      const offset = viewport?.offsetTop ?? 0
      const inset = Math.max(0, window.innerHeight - height - offset)
      const editing = document.activeElement instanceof HTMLElement && document.activeElement.matches('textarea, input:not([type="checkbox"]):not([type="radio"]), [contenteditable="true"]')
      const unzoomed = Math.abs((viewport?.scale ?? 1) - 1) < .02
      // A browser resize, rotation, or pinch zoom is not a virtual keyboard.
      // Retain the baseline during dismissal so the anchor follows its retreat.
      if (Math.abs(window.innerWidth - width) > 64 || !unzoomed) {
        baseline = Math.max(window.innerHeight, document.documentElement.clientHeight)
        keyboardTravel = 0
      } else if (touchKeyboard && unzoomed && (editing || keyboardTravel > 0)) {
        keyboardTravel = Math.max(0, baseline - height - offset)
        if (height >= baseline - 1) keyboardTravel = 0
      } else {
        baseline = Math.max(window.innerHeight, document.documentElement.clientHeight)
        keyboardTravel = 0
      }
      width = window.innerWidth
      element.style.setProperty('--planner-keyboard-inset', `${inset}px`)
      element.style.setProperty('--planner-keyboard-travel', `${keyboardTravel}px`)
      element.style.setProperty('--planner-viewport-height', `${height}px`)
      element.style.setProperty('--planner-viewport-top', `${offset}px`)
      element.dataset.keyboard = keyboardTravel > 80 ? 'open' : 'closed'
    }
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(apply)
    }
    const focusIn = () => {
      // Composer autofocus runs in a layout effect. Resolve an already visible
      // keyboard in that same phase instead of painting the resting gap first.
      cancelAnimationFrame(frame)
      apply()
    }
    // Apply once before paint, especially when opening another picker over the
    // already visible keyboard. Resize events remain batched to one frame.
    apply()
    viewport?.addEventListener('resize', update)
    viewport?.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    document.addEventListener('focusin', focusIn)
    document.addEventListener('focusout', update)
    return () => {
      cancelAnimationFrame(frame)
      viewport?.removeEventListener('resize', update)
      viewport?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      document.removeEventListener('focusin', focusIn)
      document.removeEventListener('focusout', update)
    }
  }, [open, ref])
}

export interface PlannerSheetProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  contentRef?: RefObject<HTMLDivElement>
  initialFocusRef?: RefObject<HTMLElement>
  className?: string
  /** Tiny anchored menus can leave the composer's text field and IME intact. */
  preserveTextFocus?: boolean
  /** Keep the scrim mounted through click so one tap cannot close and reopen a trigger underneath. */
  scrimCloseOnClick?: boolean
}

/** Planner-only floating panels; nested pickers share a focus and Escape hierarchy. */
export function PlannerSheet({ open, onClose, title, children, footer, contentRef, initialFocusRef, className, preserveTextFocus = false, scrimCloseOnClick = false }: PlannerSheetProps) {
  const id = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const present = usePresence(open, 180)
  usePlannerViewport(rootRef, open)
  useOverlayBack(open, () => closeRef.current(), { keyboardRootRef: rootRef })

  useLayoutEffect(() => {
    if (open) rootRef.current?.removeAttribute('inert')
    else rootRef.current?.setAttribute('inert', '')
  }, [open, present])

  useLayoutEffect(() => {
    if (!open) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    sheetStack.push(id)
    const top = () => sheetStack[sheetStack.length - 1] === id
    rootRef.current?.style.setProperty('z-index', String(150 + sheetStack.length))
    const items = () => Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])') ?? [])
      .filter(element => element.getClientRects().length && !element.closest('[inert], [aria-hidden="true"]'))
    const frame = requestAnimationFrame(() => {
      if (!top() || preserveTextFocus) return
      ;(initialFocusRef?.current ?? dialogRef.current?.querySelector<HTMLElement>('[data-planner-autofocus], [data-task-title], [data-task-details], [data-delete-heading]') ?? dialogRef.current)?.focus({ preventScroll: true })
    })
    const handleKey = (event: KeyboardEvent) => {
      if (!top() || event.defaultPrevented) return
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); return }
      if (event.key !== 'Tab') return
      const focusables = items()
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (!first) { event.preventDefault(); return }
      const outside = !dialogRef.current?.contains(document.activeElement)
      if (event.shiftKey && (outside || document.activeElement === first)) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && (outside || document.activeElement === last)) { event.preventDefault(); first.focus() }
    }
    const handleFocus = (event: FocusEvent) => {
      // An anchored, non-modal menu must not pull focus out of the composer.
      // Its text field can remain focused while touch selects a menu action.
      if (preserveTextFocus) return
      if (top() && event.target instanceof Node && !dialogRef.current?.contains(event.target)) (items()[0] ?? dialogRef.current)?.focus({ preventScroll: true })
    }
    document.addEventListener('keydown', handleKey)
    document.addEventListener('focusin', handleFocus)
    return () => {
      cancelAnimationFrame(frame)
      const index = sheetStack.lastIndexOf(id)
      const wasTop = top()
      if (index >= 0) sheetStack.splice(index, 1)
      document.removeEventListener('keydown', handleKey)
      document.removeEventListener('focusin', handleFocus)
      const textField = previous?.matches('textarea, input, [contenteditable="true"]')
      // Restoring a text field after the user dismissed a mobile panel would
      // reopen the keyboard. A preserved field never lost focus in the first place.
      if (wasTop && previous?.isConnected && !preserveTextFocus
        && !(textField && window.matchMedia('(any-pointer: coarse)').matches)) previous.focus({ preventScroll: true })
    }
  }, [open, id, initialFocusRef, preserveTextFocus])

  if (!present) return null
  return createPortal(<div ref={rootRef} className="planner-sheet-layer" data-state={open ? 'open' : 'closed'} aria-hidden={!open} onPointerDownCapture={event => {
    if (preserveTextFocus && event.target instanceof Element
      && !event.target.closest('input, textarea, select, [contenteditable="true"]')) event.preventDefault()
  }} onKeyDown={event => {
    // Portals still bubble through their React parents. Consume Escape here so
    // a nested picker cannot also close its underlying composer or editor.
    if (event.key === 'Escape' && sheetStack[sheetStack.length - 1] === id && !event.defaultPrevented) {
      event.preventDefault()
      event.stopPropagation()
      closeRef.current()
    }
  }}>
    <div className="planner-sheet-scrim"
      onPointerDown={event => { if (!scrimCloseOnClick && event.target === event.currentTarget) onClose() }}
      onClick={event => { if (scrimCloseOnClick && event.target === event.currentTarget) onClose() }} />
    <section ref={dialogRef} tabIndex={-1} role="dialog" aria-modal={!preserveTextFocus} aria-labelledby={`${id}-heading`} className={clsx('planner-sheet', className)}>
      <header className="planner-sheet-heading"><h2 id={`${id}-heading`}>{title}</h2><button type="button" className="planner-icon-button" aria-label="Закрити" onClick={onClose}><X size={20} /></button></header>
      <div ref={contentRef} data-modal-scroll-container className="planner-sheet-body">{children}</div>
      {footer && <footer className="planner-sheet-footer">{footer}</footer>}
    </section>
  </div>, document.body)
}
