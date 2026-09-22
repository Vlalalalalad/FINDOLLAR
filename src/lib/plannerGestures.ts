export type SwipeAxis = 'pending' | 'horizontal' | 'vertical'
export type SwipeDirection = 'left' | 'right'
export type SwipeDirections = SwipeDirection | 'both'

export interface SwipeGesture {
  pointerId: number
  startX: number
  startY: number
  dx: number
  dy: number
  axis: SwipeAxis
}

/** Lock once: vertical intent always remains scrolling for the entire gesture. */
export function swipeAxis(dx: number, dy: number, current: SwipeAxis = 'pending'): SwipeAxis {
  if (current !== 'pending') return current
  const x = Math.abs(dx)
  const y = Math.abs(dy)
  if (x >= 10 && x > y * 1.3) return 'horizontal'
  if (y >= 10) return 'vertical'
  return 'pending'
}

export function startSwipe(pointerId: number, x: number, y: number): SwipeGesture {
  return { pointerId, startX: x, startY: y, dx: 0, dy: 0, axis: 'pending' }
}

export function trackSwipe(gesture: SwipeGesture, x: number, y: number): SwipeGesture {
  const dx = x - gesture.startX
  const dy = y - gesture.startY
  return { ...gesture, dx, dy, axis: swipeAxis(dx, dy, gesture.axis) }
}

export function swipeThreshold(width: number): number {
  return Math.min(72, Math.max(40, width * 0.24))
}

/** Full-swipe actions stay deliberate while remaining reachable with one thumb. */
export function deliberateLeftSwipeThreshold(width: number, directAction: boolean): number {
  return directAction
    ? Math.min(132, Math.max(48, width * .22))
    : Math.max(Math.min(144, Math.max(112, width * .4)) + 18, Math.min(216, width * .48))
}

export function finishSwipe(gesture: SwipeGesture | null, width: number, allowed: SwipeDirections = 'both', cancelled = false): SwipeDirection | null {
  if (!gesture || cancelled || gesture.axis !== 'horizontal' || Math.abs(gesture.dx) < swipeThreshold(width)) return null
  const direction = gesture.dx > 0 ? 'right' : 'left'
  return allowed === 'both' || direction === allowed ? direction : null
}

/** The revealed action follows the finger, with resistance beyond its threshold. */
export function swipeTravel(dx: number, width: number, allowed: SwipeDirections = 'both'): number {
  if ((allowed === 'right' && dx < 0) || (allowed === 'left' && dx > 0)) return 0
  const threshold = swipeThreshold(width)
  const distance = Math.abs(dx)
  const travel = distance <= threshold ? distance : threshold + Math.min(28, Math.sqrt(distance - threshold) * 2)
  return Math.sign(dx) * travel
}
