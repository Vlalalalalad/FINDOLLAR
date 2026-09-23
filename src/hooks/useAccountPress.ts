import { useEffect, useRef, type MouseEvent, type PointerEvent } from 'react'

type Gesture = {
  pointerId: number
  startX: number
  startY: number
  clientX: number
  clientY: number
  held: boolean
  dragTarget: string | null
  element: HTMLAnchorElement
}

/** A normal click remains a link; only touch/pen hold enters drag selection. */
export function useAccountPress({ onOpen, onHover, onSelect, getActionAt }: {
  onOpen: (anchor: DOMRect) => void
  onHover: (action: string | null) => void
  onSelect: (action: string) => void
  getActionAt: (x: number, y: number) => string | null
}) {
  const callbacks = useRef({ onOpen, onHover, onSelect, getActionAt })
  callbacks.current = { onOpen, onHover, onSelect, getActionAt }
  const trigger = useRef<HTMLAnchorElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const suppressClick = useRef(false)
  const suppressClearTimer = useRef<ReturnType<typeof setTimeout>>()

  const releaseClickSuppressionSoon = () => {
    clearTimeout(suppressClearTimer.current)
    suppressClearTimer.current = setTimeout(() => { suppressClick.current = false }, 500)
  }

  const stop = () => {
    clearTimeout(timer.current)
    const current = gesture.current
    gesture.current = null
    if (!current) return
    try {
      if (current.element.hasPointerCapture(current.pointerId)) current.element.releasePointerCapture(current.pointerId)
    } catch { /* The browser may already have released capture. */ }
  }

  const updateDragTarget = (current: Gesture, x: number, y: number) => {
    current.clientX = x
    current.clientY = y
    const next = callbacks.current.getActionAt(x, y)
    if (next === current.dragTarget) return
    current.dragTarget = next
    callbacks.current.onHover(next)
  }
  const start = (event: PointerEvent<HTMLAnchorElement>) => {
    if (gesture.current || !event.isPrimary || event.button !== 0
      || (event.pointerType !== 'touch' && event.pointerType !== 'pen')) return
    clearTimeout(suppressClearTimer.current)
    suppressClick.current = false
    const current: Gesture = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      clientX: event.clientX,
      clientY: event.clientY,
      held: false,
      dragTarget: null,
      element: event.currentTarget,
    }
    gesture.current = current
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* Window listeners still track this pointer. */ }
    timer.current = setTimeout(() => {
      if (gesture.current !== current) return
      current.held = true
      suppressClick.current = true
      callbacks.current.onOpen(current.element.getBoundingClientRect())
      requestAnimationFrame(() => {
        if (gesture.current === current && current.held) updateDragTarget(current, current.clientX, current.clientY)
      })
    }, 450)
  }

  useEffect(() => {
    const pointerMove = (event: globalThis.PointerEvent) => {
      const current = gesture.current
      if (!current || current.pointerId !== event.pointerId) return
      current.clientX = event.clientX
      current.clientY = event.clientY
      if (!current.held) {
        if (Math.hypot(event.clientX - current.startX, event.clientY - current.startY) <= 10) return
        suppressClick.current = true
        stop()
        releaseClickSuppressionSoon()
        return
      }
      updateDragTarget(current, event.clientX, event.clientY)
    }
    const pointerUp = (event: globalThis.PointerEvent) => {
      const current = gesture.current
      if (!current || current.pointerId !== event.pointerId) return
      if (!current.held) {
        stop()
        return
      }
      updateDragTarget(current, event.clientX, event.clientY)
      const selected = current.dragTarget
      stop()
      callbacks.current.onHover(null)
      releaseClickSuppressionSoon()
      if (selected) callbacks.current.onSelect(selected)
    }
    const interrupt = (pointerId?: number) => {
      const current = gesture.current
      if (!current || (pointerId !== undefined && current.pointerId !== pointerId)) return
      suppressClick.current = true
      stop()
      callbacks.current.onHover(null)
      releaseClickSuppressionSoon()
    }
    const pointerCancel = (event: globalThis.PointerEvent) => interrupt(event.pointerId)
    const blur = () => interrupt()
    const visibilityChange = () => { if (document.visibilityState !== 'visible') interrupt() }
    window.addEventListener('pointermove', pointerMove, true)
    window.addEventListener('pointerup', pointerUp, true)
    window.addEventListener('pointercancel', pointerCancel, true)
    window.addEventListener('blur', blur)
    document.addEventListener('visibilitychange', visibilityChange)
    return () => {
      window.removeEventListener('pointermove', pointerMove, true)
      window.removeEventListener('pointerup', pointerUp, true)
      window.removeEventListener('pointercancel', pointerCancel, true)
      window.removeEventListener('blur', blur)
      document.removeEventListener('visibilitychange', visibilityChange)
      clearTimeout(suppressClearTimer.current)
      stop()
    }
  }, [])

  return {
    ref: trigger,
    onPointerDown: start,
    onLostPointerCapture: (event: PointerEvent<HTMLAnchorElement>) => {
      const current = gesture.current
      if (!current || current.pointerId !== event.pointerId) return
      suppressClick.current = true
      stop()
      callbacks.current.onHover(null)
      releaseClickSuppressionSoon()
    },
    onClickCapture: (event: MouseEvent<HTMLAnchorElement>) => {
      if (event.detail !== 0 && suppressClick.current) {
        event.preventDefault()
        event.stopPropagation()
        suppressClick.current = false
      }
    },
    onContextMenu: (event: MouseEvent<HTMLAnchorElement>) => {
      if (gesture.current || window.matchMedia('(pointer: coarse)').matches) event.preventDefault()
    },
  }
}
