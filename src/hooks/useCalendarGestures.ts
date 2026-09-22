import { useEffect, useRef } from 'react'

type Axis = 'pending' | 'horizontal' | 'vertical'
interface CalendarGestureOptions {
  expanded: boolean
  onExpandedChange: (expanded: boolean) => void
  enabled?: boolean
  onPeriodChange?: (delta: number) => void
}

function scrollParent(element: HTMLElement): HTMLElement {
  let parent = element.parentElement
  while (parent) {
    if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) return parent
    parent = parent.parentElement
  }
  return document.scrollingElement as HTMLElement ?? document.documentElement
}

/** Calendar gestures are scoped to their starting region, never the whole page. */
function useCalendarTouch<T extends HTMLElement>(options: CalendarGestureOptions, boundaryOnly: boolean) {
  const ref = useRef<T>(null)
  const latest = useRef(options)
  latest.current = options
  useEffect(() => {
    const element = ref.current
    if (!element || options.enabled === false) return
    let start: { x: number; y: number; id: number; axis: Axis; atTop: boolean; scrollable: boolean; expanded: boolean } | null = null
    let dx = 0
    let dy = 0
    let claimed = false
    let suppressUntil = 0
    let frame: number | null = null
    const reset = () => {
      start = null
      claimed = false
      if (frame !== null) cancelAnimationFrame(frame)
      frame = null
      element.style.removeProperty('--planner-calendar-pull')
      element.style.removeProperty('--planner-period-drag')
      delete element.dataset.calendarDragging
    }
    const cancel = () => { if (claimed) suppressUntil = Date.now() + 500; reset() }
    const onStart = (event: TouchEvent) => {
      if (event.touches.length !== 1 || (event.target as Element).closest('[data-no-calendar-gesture]')) { cancel(); return }
      const touch = event.touches[0]
      const scroll = scrollParent(element)
      start = { x: touch.clientX, y: touch.clientY, id: touch.identifier, axis: 'pending', atTop: scroll.scrollTop <= 1, scrollable: scroll.scrollHeight > scroll.clientHeight + 2, expanded: latest.current.expanded }
      dx = 0; dy = 0; claimed = false
    }
    const onMove = (event: TouchEvent) => {
      if (!start || event.touches.length !== 1) { cancel(); return }
      const touch = event.touches[0]
      if (touch.identifier !== start.id) return
      dx = touch.clientX - start.x
      dy = touch.clientY - start.y
      if (start.axis === 'pending') {
        if (Math.abs(dx) >= 12 && Math.abs(dx) > Math.abs(dy) * 1.35) start.axis = 'horizontal'
        else if (Math.abs(dy) >= 12) start.axis = 'vertical'
      }
      const expands = dy > 0 && !start.expanded
      const collapses = dy < 0 && start.expanded
      const verticalAllowed = start.axis === 'vertical' && (expands || collapses)
        && (!boundaryOnly || (start.atTop && (expands || !start.scrollable)))
      const horizontalAllowed = !boundaryOnly && start.axis === 'horizontal'
      if (!verticalAllowed && !horizontalAllowed) return
      // Do not take over a scroll which began away from its boundary. Pinch zoom
      // and vertical movement through the task list stay with the browser.
      if (!event.cancelable) { cancel(); return }
      event.preventDefault()
      claimed = true
      suppressUntil = Date.now() + 500
      if (frame === null) frame = requestAnimationFrame(() => {
        frame = null
        element.dataset.calendarDragging = 'true'
        element.style.setProperty('--planner-calendar-pull', `${Math.sign(dy) * Math.min(16, Math.abs(dy) * .15)}px`)
        element.style.setProperty('--planner-period-drag', horizontalAllowed ? `${Math.sign(dx) * Math.min(24, Math.abs(dx) * .2)}px` : '0px')
      })
    }
    const onEnd = (event: TouchEvent) => {
      const current = start
      if (!current || !Array.from(event.changedTouches).some(touch => touch.identifier === current.id)) return
      const didClaim = claimed
      const finalX = dx
      const finalY = dy
      reset()
      if (!didClaim) return
      suppressUntil = Date.now() + 500
      if (current.axis === 'horizontal' && Math.abs(finalX) >= 52) latest.current.onPeriodChange?.(finalX < 0 ? 1 : -1)
      else if (current.axis === 'vertical' && Math.abs(finalY) >= 56) latest.current.onExpandedChange(finalY > 0)
    }
    const onClick = (event: MouseEvent) => {
      if (event.detail !== 0 && Date.now() < suppressUntil) {
        event.preventDefault(); event.stopPropagation(); suppressUntil = 0
      }
    }
    element.addEventListener('touchstart', onStart, { passive: true })
    element.addEventListener('touchmove', onMove, { passive: false })
    element.addEventListener('touchend', onEnd, { passive: true })
    element.addEventListener('touchcancel', cancel, { passive: true })
    element.addEventListener('click', onClick, true)
    window.addEventListener('blur', cancel)
    document.addEventListener('visibilitychange', cancel)
    return () => {
      element.removeEventListener('touchstart', onStart)
      element.removeEventListener('touchmove', onMove)
      element.removeEventListener('touchend', onEnd)
      element.removeEventListener('touchcancel', cancel)
      element.removeEventListener('click', onClick, true)
      window.removeEventListener('blur', cancel)
      document.removeEventListener('visibilitychange', cancel)
      reset()
    }
  }, [boundaryOnly, options.enabled])
  return ref
}

export function useCalendarGestures<T extends HTMLElement = HTMLElement>(options: CalendarGestureOptions) {
  return useCalendarTouch<T>(options, false)
}

/** Attach to the day-list section. A list gesture never changes the period. */
export function useCalendarBoundaryPull<T extends HTMLElement = HTMLElement>(options: Omit<CalendarGestureOptions, 'onPeriodChange'>) {
  return useCalendarTouch<T>(options, true)
}
