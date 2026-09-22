import { useLayoutEffect, useRef, type KeyboardEvent, type MouseEvent } from 'react'
import { usePickerWheel } from '../../hooks/usePickerWheel'
import './wheel-picker.css'

const pad = (value: number) => String(value).padStart(2, '0')
const modulo = (value: number, count: number) => ((value % count) + count) % count
const copies = 7
const middleCopy = Math.floor(copies / 2)

function TimeWheel({ value, count, label, onChange }: {
  value: string; count: number; label: string; onChange: (value: string) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const emitted = useRef(value)
  const frame = useRef(0)
  const settleTimer = useRef(0)
  const touching = useRef(false)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const publish = (number: number) => {
    const next = pad(modulo(number, count))
    if (next === emitted.current) return
    emitted.current = next
    onChangeRef.current(next)
  }
  const recenter = () => {
    const element = ref.current
    if (!element?.clientHeight) return
    const cycleHeight = count * element.clientHeight / 5
    // Equivalent copies have the same pixels, including the fractional offset
    // between rows. Normally rebase only after native momentum/snap settles.
    const next = middleCopy * cycleHeight + modulo(element.scrollTop, cycleHeight)
    if (Math.abs(next - element.scrollTop) > .5) element.scrollTop = next
  }
  const settle = () => {
    window.clearTimeout(settleTimer.current)
    if (touching.current || !ref.current?.clientHeight) return
    publish(Math.round(ref.current.scrollTop / (ref.current.clientHeight / 5)))
    recenter()
  }
  const scheduleSettle = () => {
    window.clearTimeout(settleTimer.current)
    // scrollend handles supported browsers; this also covers older Safari.
    settleTimer.current = window.setTimeout(settle, 180)
  }

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const position = () => {
      element.scrollTop = (middleCopy * count + Number(emitted.current)) * element.clientHeight / 5
    }
    position()
    const resize = new ResizeObserver(position)
    resize.observe(element)
    element.addEventListener('scrollend', settle)
    const release = () => {
      if (!touching.current) return
      touching.current = false
      scheduleSettle()
    }
    window.addEventListener('pointerup', release)
    window.addEventListener('pointercancel', release)
    return () => {
      resize.disconnect()
      element.removeEventListener('scrollend', settle)
      window.removeEventListener('pointerup', release)
      window.removeEventListener('pointercancel', release)
      cancelAnimationFrame(frame.current)
      window.clearTimeout(settleTimer.current)
    }
    // Scrolling owns position between external value changes, so its own React
    // updates cannot interrupt native touch momentum.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count])

  useLayoutEffect(() => {
    if (value === emitted.current || !ref.current) return
    emitted.current = value
    cancelAnimationFrame(frame.current)
    window.clearTimeout(settleTimer.current)
    ref.current.scrollTop = (middleCopy * count + Number(value)) * ref.current.clientHeight / 5
  }, [value, count])

  const choose = (number: number) => {
    const element = ref.current
    if (!element) return
    cancelAnimationFrame(frame.current)
    window.clearTimeout(settleTimer.current)
    const next = modulo(number, count)
    element.scrollTop = (middleCopy * count + next) * element.clientHeight / 5
    publish(next)
  }
  usePickerWheel(ref, direction => choose(Number(emitted.current) + direction))
  const scroll = () => {
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      const element = ref.current
      if (!element?.clientHeight) return
      const rowHeight = element.clientHeight / 5
      publish(Math.round(element.scrollTop / rowHeight))
      // Several full cycles provide runway for normal swipes and momentum.
      // Rebase an unusually long gesture before either end becomes visible.
      const cycleHeight = count * rowHeight
      if (element.scrollTop < cycleHeight || element.scrollTop >= (copies - 1) * cycleHeight) recenter()
    })
    scheduleSettle()
  }
  const keyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = Number(emitted.current)
    let next: number
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = current + 1
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = current - 1
    else if (event.key === 'PageDown') next = current + 5
    else if (event.key === 'PageUp') next = current - 5
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = count - 1
    else return
    event.preventDefault()
    choose(next)
  }
  const click = (event: MouseEvent<HTMLDivElement>) => {
    const option = (event.target as HTMLElement).closest<HTMLElement>('[data-wheel-index]')
    if (option && event.currentTarget.contains(option)) choose(Number(option.dataset.wheelIndex))
  }

  return <div className="planner-time-wheel-column">
    <span className="planner-time-wheel-label">{label}</span>
    <div className="planner-time-wheel-window">
      <div ref={ref} className="planner-time-wheel planner-time-wheel-loop" role="spinbutton" tabIndex={0}
        aria-label={label} aria-valuemin={0} aria-valuemax={count - 1} aria-valuenow={Number(value)} aria-valuetext={pad(Number(value))}
        onScroll={scroll} onKeyDown={keyboard} onClick={click}
        onPointerDown={() => { touching.current = true; window.clearTimeout(settleTimer.current) }}
        onPointerUp={() => { touching.current = false; scheduleSettle() }}
        onPointerCancel={() => { touching.current = false; scheduleSettle() }}>
        {Array.from({ length: count * copies }, (_, index) => <div key={index} className="planner-time-wheel-value" data-wheel-index={index}
          data-selected={Number(value) === index % count || undefined} aria-hidden="true">{pad(index % count)}</div>)}
      </div>
    </div>
  </div>
}

export function WheelPicker({ hours, minutes, onHoursChange, onMinutesChange }: {
  hours: string; minutes: string; onHoursChange: (hours: string) => void; onMinutesChange: (minutes: string) => void
}) {
  return <div className="planner-time-wheels" role="group" aria-label="Час барабанами">
    <TimeWheel value={hours} count={24} label="Години" onChange={onHoursChange} />
    <span className="planner-time-wheel-colon" aria-hidden="true">:</span>
    <TimeWheel value={minutes} count={60} label="Хвилини" onChange={onMinutesChange} />
    <span className="sr-only" role="status">Обраний час: {hours}:{minutes}</span>
  </div>
}
