import { useEffect, useRef, type MouseEvent, type PointerEvent } from 'react'

type Gesture = {
  kind: 'touch' | 'pen'
  id: number
  pointerId?: number
  touchId?: number
  x: number
  y: number
  clientX: number
  clientY: number
  held: boolean
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
    // A cancelled touchstart normally has no compatibility click, but keep a
    // short guard for browsers that emit one after touchend. Never swallow a
    // later, unrelated mouse click on Profile.
    suppressClearTimer.current = setTimeout(() => { suppressClick.current = false }, 500)
  }

  const stop = () => {
    clearTimeout(timer.current)
    gesture.current = null
  }
  const start = (kind: Gesture['kind'], id: number, x: number, y: number, element: HTMLAnchorElement, fromPointer = false) => {
    if (gesture.current) return
    clearTimeout(suppressClearTimer.current)
    suppressClick.current = false
    gesture.current = { kind, id, pointerId: fromPointer ? id : undefined, touchId: kind === 'touch' && !fromPointer ? id : undefined, x, y, clientX: x, clientY: y, held: false, element }
    timer.current = setTimeout(() => {
      const current = gesture.current
      if (!current || current.kind !== kind || current.id !== id) return
      current.held = true
      suppressClick.current = true
      callbacks.current.onOpen(current.element.getBoundingClientRect())
      requestAnimationFrame(() => {
        const active = gesture.current
        if (active?.held) callbacks.current.onHover(callbacks.current.getActionAt(active.clientX, active.clientY))
      })
    }, 450)
  }

  useEffect(() => {
    const move = (kind: Gesture['kind'], id: number, x: number, y: number) => {
      const current = gesture.current
      if (!current || current.kind !== kind || current.id !== id) return false
      current.clientX = x
      current.clientY = y
      if (!current.held && Math.hypot(x - current.x, y - current.y) > 10) {
        suppressClick.current = true
        stop()
        releaseClickSuppressionSoon()
        return false
      }
      if (current.held) callbacks.current.onHover(callbacks.current.getActionAt(x, y))
      return current.held
    }
    const finish = (kind: Gesture['kind'], id: number, x: number, y: number) => {
      const current = gesture.current
      if (!current || current.kind !== kind || current.id !== id) return
      const selected = current.held ? callbacks.current.getActionAt(x, y) : null
      stop()
      callbacks.current.onHover(null)
      if (selected) callbacks.current.onSelect(selected)
    }
    const findTouch = (event: globalThis.TouchEvent, id: number) =>
      Array.from(event.changedTouches).find(touch => touch.identifier === id)
    const touchMove = (event: globalThis.TouchEvent) => {
      const current = gesture.current
      if (current?.kind !== 'touch' || current.touchId === undefined) return
      const touch = findTouch(event, current.touchId)
      if (touch && move('touch', current.id, touch.clientX, touch.clientY)) event.preventDefault()
    }
    const touchEnd = (event: globalThis.TouchEvent) => {
      const current = gesture.current
      if (current?.kind !== 'touch' || current.touchId === undefined) return
      const touch = findTouch(event, current.touchId)
      if (!touch) return
      const wasTap = !current.held && Math.hypot(touch.clientX - current.x, touch.clientY - current.y) <= 10
      const wasHeld = current.held
      const element = current.element
      finish('touch', current.id, touch.clientX, touch.clientY)
      if (wasHeld) releaseClickSuppressionSoon()
      // touchstart is cancelled to prevent Android's native link long-press
      // action from cancelling the drag; restore ordinary short-tap navigation.
      if (wasTap) element.click()
    }
    const pointerMove = (event: globalThis.PointerEvent) => {
      const current = gesture.current
      if (current?.pointerId !== event.pointerId) return
      if (event.pointerType === 'touch' && current.kind === 'touch') move('touch', current.id, event.clientX, event.clientY)
      if (event.pointerType === 'pen' && current.kind === 'pen') move('pen', current.id, event.clientX, event.clientY)
    }
    const pointerUp = (event: globalThis.PointerEvent) => {
      const current = gesture.current
      if (!current || current.pointerId !== event.pointerId) return
      const wasHeld = current.held
      const wasTap = current.kind === 'touch' && !wasHeld && Math.hypot(event.clientX - current.x, event.clientY - current.y) <= 10
      const element = current.element
      finish(current.kind, current.id, event.clientX, event.clientY)
      if (wasHeld) releaseClickSuppressionSoon()
      if (wasTap) element.click()
    }
    const interrupt = () => {
      if (!gesture.current) return
      suppressClick.current = true
      stop()
      callbacks.current.onHover(null)
      releaseClickSuppressionSoon()
    }
    const touchCancel = (event: globalThis.TouchEvent) => {
      if (gesture.current?.kind === 'touch' && gesture.current.touchId !== undefined
        && findTouch(event, gesture.current.touchId)) interrupt()
    }
    const pointerCancel = (event: globalThis.PointerEvent) => {
      const current = gesture.current
      if (current?.pointerId !== event.pointerId) return
      // Android can cancel the pointer stream while touch events continue.
      // Keep tracking that same finger through the touch fallback.
      if (current.kind === 'touch' && current.touchId !== undefined) current.pointerId = undefined
      else interrupt()
    }
    const touchStart = (event: globalThis.TouchEvent) => {
      if (event.touches.length !== 1) return
      const touch = event.touches[0]
      const element = trigger.current
      if (!element) return
      // React's touchstart listener is passive in Chromium. This native,
      // non-passive listener is needed so Android never takes over the hold
      // with a context menu/selection and sends touchcancel after menu open.
      event.preventDefault()
      if (gesture.current?.kind === 'touch') gesture.current.touchId = touch.identifier
      else start('touch', touch.identifier, touch.clientX, touch.clientY, element)
    }
    const element = trigger.current
    element?.addEventListener('touchstart', touchStart, { passive: false })
    window.addEventListener('touchmove', touchMove, { capture: true, passive: false })
    window.addEventListener('touchend', touchEnd, true)
    window.addEventListener('touchcancel', touchCancel, true)
    window.addEventListener('pointermove', pointerMove, true)
    window.addEventListener('pointerup', pointerUp, true)
    window.addEventListener('pointercancel', pointerCancel, true)
    window.addEventListener('blur', interrupt)
    document.addEventListener('visibilitychange', interrupt)
    return () => {
      element?.removeEventListener('touchstart', touchStart)
      window.removeEventListener('touchmove', touchMove, true)
      window.removeEventListener('touchend', touchEnd, true)
      window.removeEventListener('touchcancel', touchCancel, true)
      window.removeEventListener('pointermove', pointerMove, true)
      window.removeEventListener('pointerup', pointerUp, true)
      window.removeEventListener('pointercancel', pointerCancel, true)
      window.removeEventListener('blur', interrupt)
      document.removeEventListener('visibilitychange', interrupt)
      clearTimeout(suppressClearTimer.current)
      stop()
    }
  }, [])

  return {
    ref: trigger,
    onPointerDown: (event: PointerEvent<HTMLAnchorElement>) => {
      if ((event.pointerType === 'touch' || event.pointerType === 'pen') && event.isPrimary && event.button === 0) {
        start(event.pointerType, event.pointerId, event.clientX, event.clientY, event.currentTarget, true)
        try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* Window listeners still track the gesture. */ }
      }
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
