import { useEffect, useRef, type ButtonHTMLAttributes } from 'react'

/** A normal button click and a deliberate hold share one control without stealing scroll. */
export function useLongPressAction({ onClick, onLongPress, disabled = false }: {
  onClick: () => void
  onLongPress: () => void
  disabled?: boolean
}) {
  const latest = useRef({ onClick, onLongPress, disabled })
  latest.current = { onClick, onLongPress, disabled }
  const press = useRef<{ pointerId: number; x: number; y: number; fired: boolean } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const suppressClick = useRef(false)
  const cancel = () => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
    press.current = null
  }
  useEffect(() => {
    const interrupt = () => { if (press.current) suppressClick.current = true; cancel() }
    window.addEventListener('blur', interrupt)
    document.addEventListener('visibilitychange', interrupt)
    return () => {
      window.removeEventListener('blur', interrupt)
      document.removeEventListener('visibilitychange', interrupt)
      cancel()
    }
  }, [])
  useEffect(() => { if (disabled) cancel() }, [disabled])

  const bind: ButtonHTMLAttributes<HTMLButtonElement> = {
    onPointerDown: event => {
      cancel()
      suppressClick.current = false
      if (latest.current.disabled || !event.isPrimary || event.button !== 0) return
      press.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, fired: false }
      timer.current = setTimeout(() => {
        timer.current = null
        if (!press.current || latest.current.disabled) return
        press.current.fired = true
        suppressClick.current = true
        latest.current.onLongPress()
      }, 480)
    },
    onPointerMove: event => {
      const active = press.current
      if (active?.pointerId !== event.pointerId || active.fired) return
      if (Math.hypot(event.clientX - active.x, event.clientY - active.y) > 10) {
        suppressClick.current = true
        cancel()
      }
    },
    onPointerUp: event => { if (press.current?.pointerId === event.pointerId) cancel() },
    onPointerLeave: () => { if (press.current) { suppressClick.current = true; cancel() } },
    onPointerCancel: () => { suppressClick.current = true; cancel() },
    onBlur: cancel,
    onClick: event => {
      if (latest.current.disabled) return
      // A keyboard/assistive click remains available after an interrupted hold.
      if (event.detail !== 0 && suppressClick.current) {
        event.preventDefault()
        event.stopPropagation()
        suppressClick.current = false
        return
      }
      latest.current.onClick()
    },
    onKeyDown: event => {
      if (latest.current.disabled || event.repeat) return
      if ((event.altKey && event.key === 'ArrowDown') || event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
        event.preventDefault()
        cancel()
        latest.current.onLongPress()
      }
    },
    onContextMenu: event => {
      event.preventDefault()
      if (latest.current.disabled || press.current?.fired || suppressClick.current) return
      suppressClick.current = true
      cancel()
      latest.current.onLongPress()
    },
  }
  return bind
}
