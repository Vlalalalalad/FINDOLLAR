import { useLayoutEffect, useRef, type HTMLAttributes, type RefObject } from 'react'

type ComposerResizeOptions = {
  rootRef: RefObject<HTMLElement>
  descriptionRef: RefObject<HTMLTextAreaElement>
  open: boolean
  value: string
}

/** Grow the description in place; the fixed composer and toolbar keep their anchor. */
export function useComposerResize({ rootRef, descriptionRef, open, value }: ComposerResizeOptions) {
  const requestedHeight = useRef(0)
  const previousValue = useRef(value)
  const drag = useRef<{ pointerId: number; y: number; height: number } | null>(null)
  const applyRef = useRef<() => void>(() => {})

  useLayoutEffect(() => {
    if (!open || !descriptionRef.current) return
    const textarea = descriptionRef.current
    const root = rootRef.current
    const composer = root?.querySelector<HTMLElement>('.planner-composer')
    if (!root || !composer) return
    let frame = 0
    const apply = () => {
      const computed = getComputedStyle(composer)
      const currentHeight = textarea.getBoundingClientRect().height
      const fixedContentHeight = composer.scrollHeight - currentHeight
      const maxComposerHeight = parseFloat(computed.maxHeight)
      const rootStyle = getComputedStyle(root)
      const inset = parseFloat(rootStyle.getPropertyValue('--planner-keyboard-inset')) || 0
      const bottomGap = Math.max(8, (parseFloat(rootStyle.bottom) || 0) - inset)
      const viewportLimit = (window.visualViewport?.height ?? window.innerHeight) - bottomGap - 16
      const available = Math.max(32, Math.min(Number.isFinite(maxComposerHeight) ? maxComposerHeight : viewportLimit, viewportLimit) - fixedContentHeight - 2)
      // Temporarily measure at one line in this layout effect, before paint.
      textarea.style.height = '0px'
      const naturalHeight = Math.max(32, textarea.scrollHeight)
      const height = Math.min(available, Math.max(naturalHeight, requestedHeight.current))
      textarea.style.height = `${Math.round(height)}px`
      textarea.style.overflowY = naturalHeight > height + 1 ? 'auto' : 'hidden'
      root.style.setProperty('--planner-description-height', `${Math.round(height)}px`)
    }
    const update = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(apply) }
    applyRef.current = apply
    apply()
    const viewport = window.visualViewport
    const observer = new ResizeObserver(update)
    // Width, title wrapping, validation messages, and keyboard changes can all
    // alter the text space. Observe stable siblings, never the resized textarea.
    observer.observe(root)
    const title = composer.querySelector('.planner-composer-title')
    if (title) observer.observe(title)
    viewport?.addEventListener('resize', update)
    window.addEventListener('resize', update)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      viewport?.removeEventListener('resize', update)
      window.removeEventListener('resize', update)
      applyRef.current = () => {}
      drag.current = null
    }
  }, [open, rootRef, descriptionRef])

  useLayoutEffect(() => {
    // A successful batch creation leaves a fresh, compact text area.
    if (!value && previousValue.current) requestedHeight.current = 0
    previousValue.current = value
    applyRef.current()
  }, [open, value])

  const handleProps: HTMLAttributes<HTMLDivElement> = {
    role: 'separator',
    tabIndex: 0,
    'aria-label': 'Змінити висоту опису',
    'aria-orientation': 'horizontal',
    onPointerDown: event => {
      if (!open || !event.isPrimary || event.button !== 0 || !descriptionRef.current) return
      event.preventDefault()
      drag.current = { pointerId: event.pointerId, y: event.clientY, height: descriptionRef.current.getBoundingClientRect().height }
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    onPointerMove: event => {
      const active = drag.current
      if (!active || active.pointerId !== event.pointerId) return
      event.preventDefault()
      requestedHeight.current = Math.max(32, active.height + active.y - event.clientY)
      applyRef.current()
    },
    onPointerUp: event => {
      if (drag.current?.pointerId !== event.pointerId) return
      drag.current = null
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    },
    onPointerCancel: () => { drag.current = null },
    onLostPointerCapture: () => { drag.current = null },
    onKeyDown: event => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
      event.preventDefault()
      const currentHeight = descriptionRef.current?.getBoundingClientRect().height ?? 32
      requestedHeight.current = Math.max(32, currentHeight + (event.key === 'ArrowUp' ? 40 : -40))
      applyRef.current()
    },
  }
  return { handleProps }
}
