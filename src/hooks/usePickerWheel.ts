import { useLayoutEffect, useRef, type RefObject } from 'react'

type WheelInput = Pick<WheelEvent, 'deltaX' | 'deltaY' | 'deltaMode' | 'ctrlKey' | 'shiftKey' | 'cancelable' | 'defaultPrevented' | 'timeStamp' | 'preventDefault'>

/** Convert wheel notches to single selections, independent of OS scroll speed. */
export function createPickerWheelHandler(onStep: (direction: number) => void) {
  let remainder = 0
  let lastTime = -Infinity
  return (event: WheelInput) => {
    if (!event.cancelable || event.defaultPrevented || event.ctrlKey || event.shiftKey
      || !Number.isFinite(event.deltaY) || !event.deltaY || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return
    event.preventDefault()
    const direction = Math.sign(event.deltaY)
    if (event.timeStamp - lastTime > 200 || Math.sign(remainder) !== direction) remainder = 0
    lastTime = event.timeStamp
    // Line/page deltas and the usual 100/120px mouse notch represent one step.
    // Small precision-trackpad deltas accumulate instead of racing one row per event.
    if (event.deltaMode !== 0 || Math.abs(event.deltaY) >= 40) {
      remainder = 0
      onStep(direction)
      return
    }
    remainder += event.deltaY
    if (Math.abs(remainder) >= 40) {
      remainder -= direction * 40
      onStep(direction)
    }
  }
}

/** Touch dragging and its native momentum remain owned by the scroll surface. */
export function usePickerWheel(ref: RefObject<HTMLElement>, onStep: (direction: number) => void) {
  const stepRef = useRef(onStep)
  stepRef.current = onStep
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const handle = createPickerWheelHandler(direction => stepRef.current(direction))
    element.addEventListener('wheel', handle, { passive: false })
    return () => element.removeEventListener('wheel', handle)
  }, [ref])
}
