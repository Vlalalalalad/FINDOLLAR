import { useEffect, useRef, useState, type ButtonHTMLAttributes } from 'react'

/** Keep a very short pressed frame visible even when the action renders immediately. */
export function usePressFeedback() {
  const [pressed, setPressed] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clear = () => { if (timer.current) clearTimeout(timer.current); timer.current = null }
  useEffect(() => () => clear(), [])
  const bind = (key: string, original: ButtonHTMLAttributes<HTMLButtonElement> = {}) => ({
    ...original,
    'data-pressed': pressed === key ? 'true' : undefined,
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
      if (event.isPrimary && event.button === 0) { clear(); setPressed(key) }
      original.onPointerDown?.(event)
    },
    onPointerUp: (event: React.PointerEvent<HTMLButtonElement>) => {
      original.onPointerUp?.(event)
      clear()
      timer.current = setTimeout(() => setPressed(current => current === key ? null : current), 120)
    },
    onPointerCancel: (event: React.PointerEvent<HTMLButtonElement>) => {
      original.onPointerCancel?.(event)
      clear(); setPressed(null)
    },
    onPointerLeave: (event: React.PointerEvent<HTMLButtonElement>) => {
      original.onPointerLeave?.(event)
      clear(); setPressed(null)
    },
    onBlur: (event: React.FocusEvent<HTMLButtonElement>) => {
      original.onBlur?.(event)
      clear(); setPressed(null)
    },
  })
  return bind
}
