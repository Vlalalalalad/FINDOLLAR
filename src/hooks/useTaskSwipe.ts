import { useCallback, useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react'
import { deliberateLeftSwipeThreshold, startSwipe, swipeThreshold, trackSwipe, type SwipeGesture } from '../lib/plannerGestures'

const revealWidth = (width: number) => Math.min(144, Math.max(112, width * .4))
const revealThreshold = (width: number) => Math.min(48, Math.max(24, width * .1))
/** A row owns horizontal actions; pan-y and pinch zoom stay native. */
export function useTaskSwipe<T extends HTMLElement = HTMLDivElement>({ enabled, hasLeftActions, hasRightAction = true, resetKey, onToggle, onQuickActions, onSwipeLeft }: {
  enabled: boolean
  hasLeftActions: boolean
  hasRightAction?: boolean
  resetKey: string
  onToggle: () => void | Promise<void>
  onQuickActions?: () => void
  onSwipeLeft?: () => void
}) {
  const ref = useRef<T>(null)
  const [isRevealed, setRevealed] = useState(false)
  const revealed = useRef(false)
  const origin = useRef(0)
  const rowWidth = useRef(320)
  const gesture = useRef<SwipeGesture | null>(null)
  const frame = useRef<number | null>(null)
  const suppressUntil = useRef(0)
  const inFlight = useRef(false)
  const options = useRef({ enabled, hasLeftActions, hasRightAction, onToggle, onQuickActions, onSwipeLeft })
  options.current = { enabled, hasLeftActions, hasRightAction, onToggle, onQuickActions, onSwipeLeft }

  const settle = useCallback((open: boolean) => {
    const current = gesture.current
    gesture.current = null
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = null
    revealed.current = open
    setRevealed(open)
    const element = ref.current
    if (!element) return
    delete element.dataset.swipeActive
    delete element.dataset.swipeReady
    delete element.dataset.swipeSide
    element.style.setProperty('--planner-swipe-x', open ? `-${revealWidth(rowWidth.current)}px` : '0px')
    element.style.setProperty('--planner-swipe-progress', '0')
    if (current && element.hasPointerCapture(current.pointerId)) element.releasePointerCapture(current.pointerId)
  }, [])
  const closeActions = useCallback(() => settle(false), [settle])
  const paint = useCallback(() => {
    if (frame.current !== null) return
    frame.current = requestAnimationFrame(() => {
      frame.current = null
      const element = ref.current
      const current = gesture.current
      if (!element || current?.axis !== 'horizontal') return
      const width = rowWidth.current
      const distance = current.dx + origin.current
      const left = distance < 0 && options.current.hasLeftActions
      const threshold = left ? deliberateLeftSwipeThreshold(width, !!options.current.onSwipeLeft) : swipeThreshold(width)
      const absolute = Math.abs(distance)
      const resisted = absolute <= threshold ? absolute : threshold + Math.min(32, Math.sqrt(absolute - threshold) * 2)
      const travel = distance < 0 ? (left ? -resisted : 0) : options.current.hasRightAction ? resisted : 0
      element.style.setProperty('--planner-swipe-x', `${travel}px`)
      element.style.setProperty('--planner-swipe-progress', String(Math.min(1, Math.abs(travel) / threshold)))
      element.dataset.swipeActive = 'true'
      element.dataset.swipeSide = left ? 'left' : 'right'
      // A one-action note row never replaces Delete with a strong-swipe action.
      if (absolute >= threshold && (left ? !!options.current.onQuickActions : distance >= 0 && options.current.hasRightAction)) element.dataset.swipeReady = 'true'
      else delete element.dataset.swipeReady
    })
  }, [])
  useEffect(() => {
    settle(false)
    const cancel = () => {
      if (gesture.current?.axis === 'horizontal') suppressUntil.current = Date.now() + 500
      if (gesture.current || revealed.current) settle(false)
    }
    const otherRow = (event: Event) => { if ((event as CustomEvent).detail !== ref.current) cancel() }
    window.addEventListener('scroll', cancel, { capture: true, passive: true })
    window.addEventListener('blur', cancel)
    document.addEventListener('visibilitychange', cancel)
    document.addEventListener('planner-row-gesture', otherRow)
    return () => {
      window.removeEventListener('scroll', cancel, true)
      window.removeEventListener('blur', cancel)
      document.removeEventListener('visibilitychange', cancel)
      document.removeEventListener('planner-row-gesture', otherRow)
      settle(false)
    }
  }, [enabled, hasLeftActions, hasRightAction, resetKey, settle])

  const onPointerDown = useCallback((event: PointerEvent<T>) => {
    const target = event.target as Element
    const excluded = target.closest('[data-no-swipe]')
    // A row control keeps its tap action; clear horizontal intent belongs to the row.
    // Picker contents and the revealed action pane remain independent controls.
    if (excluded && excluded !== target.closest('[data-row-swipe-control]')) { suppressUntil.current = 0; return }
    if (gesture.current) { settle(false); return }
    if (!options.current.enabled || inFlight.current || event.pointerType === 'mouse' || !event.isPrimary || event.button !== 0) return
    document.dispatchEvent(new CustomEvent('planner-row-gesture', { detail: ref.current }))
    suppressUntil.current = 0
    rowWidth.current = Math.max(1, event.currentTarget.getBoundingClientRect().width)
    event.currentTarget.style.setProperty('--planner-reveal-width', `${revealWidth(rowWidth.current)}px`)
    origin.current = revealed.current ? -revealWidth(rowWidth.current) : 0
    gesture.current = startSwipe(event.pointerId, event.clientX, event.clientY)
  }, [settle])
  const onPointerMove = useCallback((event: PointerEvent<T>) => {
    const current = gesture.current
    if (!current || current.pointerId !== event.pointerId) return
    if (!options.current.enabled) { settle(false); return }
    const next = trackSwipe(current, event.clientX, event.clientY)
    gesture.current = next
    if (next.axis !== 'horizontal') return
    if (current.axis !== 'horizontal') {
      suppressUntil.current = Date.now() + 500
      try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* Native scrolling may already own the pointer. */ }
    }
    paint()
  }, [paint, settle])
  const onPointerUp = useCallback((event: PointerEvent<T>) => {
    const current = gesture.current
    if (!current || current.pointerId !== event.pointerId) return
    const next = trackSwipe(current, event.clientX, event.clientY)
    if (next.axis !== 'horizontal') { settle(revealed.current); return }
    suppressUntil.current = Date.now() + 500
    const width = rowWidth.current
    const distance = next.dx + origin.current
    const active = options.current.enabled && !inFlight.current
    const leftAction = options.current.onSwipeLeft ?? options.current.onQuickActions
    if (active && options.current.hasLeftActions && leftAction && distance <= -deliberateLeftSwipeThreshold(width, !!options.current.onSwipeLeft)) {
      settle(false)
      // Direct actions (note confirmation) always start with the row restored.
      leftAction()
    } else if (active && options.current.hasRightAction && distance >= swipeThreshold(width)) {
      settle(false)
      inFlight.current = true
      try {
        void Promise.resolve(options.current.onToggle()).then(() => { inFlight.current = false }, () => { inFlight.current = false })
      } catch (error) { inFlight.current = false; throw error }
    } else {
      settle(active && options.current.hasLeftActions && !options.current.onSwipeLeft && distance <= -revealThreshold(width))
    }
  }, [settle])
  const onPointerCancel = useCallback((event: PointerEvent<T>) => {
    if (gesture.current?.pointerId !== event.pointerId) return
    if (gesture.current.axis === 'horizontal') suppressUntil.current = Date.now() + 500
    settle(false)
  }, [settle])
  const onLostPointerCapture = useCallback((event: PointerEvent<T>) => {
    // Ignore the child's implicit capture loss when the row takes ownership.
    if (event.target === event.currentTarget) onPointerCancel(event)
  }, [onPointerCancel])
  const onClickCapture = useCallback((event: MouseEvent<T>) => {
    if (event.detail !== 0 && Date.now() < suppressUntil.current) {
      event.preventDefault(); event.stopPropagation(); suppressUntil.current = 0
    } else if (revealed.current && (event.target as Element).closest('.planner-timeline-open, .organization-row-open')) {
      event.preventDefault(); event.stopPropagation(); settle(false)
    }
  }, [settle])
  return { ref, isRevealed, closeActions, bind: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onLostPointerCapture, onClickCapture } }
}
