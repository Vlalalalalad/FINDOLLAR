import { useCallback, useEffect, useRef, type MouseEvent, type PointerEvent } from 'react'
import { finishSwipe, startSwipe, swipeThreshold, swipeTravel, trackSwipe, type SwipeDirection, type SwipeDirections, type SwipeGesture } from '../lib/plannerGestures'

interface HorizontalSwipeOptions {
  /** Callers own error presentation. Returning the mutation promise blocks repeats. */
  onSwipe: (direction: SwipeDirection) => void | Promise<void>
  direction?: SwipeDirections
  enabled?: boolean
  resetKey?: string
}

/** Touch-only swipe; native vertical scroll and pinch zoom are never prevented. */
export function useHorizontalSwipe<T extends HTMLElement = HTMLDivElement>({ onSwipe, direction = 'both', enabled = true, resetKey }: HorizontalSwipeOptions) {
  const ref = useRef<T>(null)
  const gesture = useRef<SwipeGesture | null>(null)
  const frame = useRef<number | null>(null)
  const suppressClickUntil = useRef(0)
  const inFlight = useRef(false)
  const options = useRef({ onSwipe, direction, enabled })
  options.current = { onSwipe, direction, enabled }

  const reset = useCallback(() => {
    const current = gesture.current
    gesture.current = null
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = null
    const element = ref.current
    if (!element) return
    delete element.dataset.swipeActive
    delete element.dataset.swipeReady
    element.style.setProperty('--planner-swipe-x', '0px')
    element.style.setProperty('--planner-swipe-progress', '0')
    if (current && element.hasPointerCapture(current.pointerId)) element.releasePointerCapture(current.pointerId)
  }, [])

  const paint = useCallback(() => {
    if (frame.current !== null) return
    frame.current = requestAnimationFrame(() => {
      frame.current = null
      const element = ref.current
      const current = gesture.current
      if (!element || !current || current.axis !== 'horizontal') return
      const width = element.getBoundingClientRect().width
      const travel = swipeTravel(current.dx, width, options.current.direction)
      element.style.setProperty('--planner-swipe-x', `${travel}px`)
      element.style.setProperty('--planner-swipe-progress', String(Math.min(1, Math.abs(travel) / swipeThreshold(width))))
      element.dataset.swipeActive = 'true'
      if (finishSwipe(current, width, options.current.direction)) element.dataset.swipeReady = 'true'
      else delete element.dataset.swipeReady
    })
  }, [])

  useEffect(() => {
    reset()
    if (!enabled) return reset
    const cancel = () => {
      if (!gesture.current && frame.current === null) return
      if (gesture.current?.axis === 'horizontal') suppressClickUntil.current = Date.now() + 500
      reset()
    }
    window.addEventListener('scroll', cancel, { capture: true, passive: true })
    window.addEventListener('blur', cancel)
    document.addEventListener('visibilitychange', cancel)
    return () => {
      window.removeEventListener('scroll', cancel, true)
      window.removeEventListener('blur', cancel)
      document.removeEventListener('visibilitychange', cancel)
      reset()
    }
  }, [enabled, resetKey, reset])

  const onPointerDown = useCallback((event: PointerEvent<T>) => {
    // A second finger begins pinch zoom, cancelling any pending task action.
    if (gesture.current) { reset(); return }
    if (!options.current.enabled || inFlight.current || event.pointerType === 'mouse' || !event.isPrimary || event.button !== 0) return
    if ((event.target as Element).closest('[data-no-swipe]')) return
    suppressClickUntil.current = 0
    gesture.current = startSwipe(event.pointerId, event.clientX, event.clientY)
  }, [reset])

  const onPointerMove = useCallback((event: PointerEvent<T>) => {
    const current = gesture.current
    if (!current || current.pointerId !== event.pointerId) return
    if (!options.current.enabled) { reset(); return }
    const next = trackSwipe(current, event.clientX, event.clientY)
    gesture.current = next
    if (next.axis !== 'horizontal') return
    if (current.axis !== 'horizontal') {
      suppressClickUntil.current = Date.now() + 500
      // Capture only after direction is clear; scrolling is left to the browser.
      try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* Pointer may have been cancelled by the browser. */ }
    }
    paint()
  }, [paint, reset])

  const onPointerUp = useCallback((event: PointerEvent<T>) => {
    const current = gesture.current
    if (!current || current.pointerId !== event.pointerId) return
    const next = trackSwipe(current, event.clientX, event.clientY)
    const result = options.current.enabled ? finishSwipe(next, event.currentTarget.getBoundingClientRect().width, options.current.direction) : null
    if (next.axis === 'horizontal') suppressClickUntil.current = Date.now() + 500
    reset()
    if (result && !inFlight.current) {
      inFlight.current = true
      try {
        const pending = options.current.onSwipe(result)
        // The caller reports mutation failures; either outcome releases the guard.
        void Promise.resolve(pending).then(() => { inFlight.current = false }, () => { inFlight.current = false })
      } catch (error) {
        inFlight.current = false
        throw error
      }
    }
  }, [reset])

  const onPointerCancel = useCallback((event: PointerEvent<T>) => {
    if (gesture.current?.pointerId !== event.pointerId) return
    if (gesture.current.axis === 'horizontal') suppressClickUntil.current = Date.now() + 500
    reset()
  }, [reset])

  const onLostPointerCapture = useCallback((event: PointerEvent<T>) => {
    // Touch starts with implicit capture on the hit child. Its bubbled loss when
    // we deliberately capture the row must not cancel the horizontal gesture.
    if (event.target === event.currentTarget) onPointerCancel(event)
  }, [onPointerCancel])

  const onClickCapture = useCallback((event: MouseEvent<T>) => {
    // Keyboard activation has detail=0 and remains accessible after a gesture.
    if (event.detail !== 0 && Date.now() < suppressClickUntil.current) {
      event.preventDefault()
      event.stopPropagation()
      suppressClickUntil.current = 0
    }
  }, [])

  return { ref, bind: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onLostPointerCapture, onClickCapture } }
}
