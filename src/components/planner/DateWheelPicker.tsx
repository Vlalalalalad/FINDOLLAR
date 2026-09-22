import { useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { PlannerSheet } from './PlannerSheet'
import { usePickerWheel } from '../../hooks/usePickerWheel'
import {
  changeWheelDate, cyclicValue, dateForWheels, daysInWheelMonth, wheelDateKey, wheelNeighborhood,
  DATE_WHEEL_MAX_YEAR, DATE_WHEEL_MIDDLE, DATE_WHEEL_MIN_YEAR,
} from './dateWheel'
import './date-wheel-picker.css'

const monthNames = ['Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень', 'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень']
const pad = (value: number) => String(value).padStart(2, '0')

function DateWheel({ value, min, max, label, format = String, onChange }: {
  value: number; min: number; max: number; label: string; format?: (value: number) => string; onChange: (value: number) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [view, setView] = useState({ anchor: value })
  const anchor = useRef(value)
  const emitted = useRef(value)
  const pendingPosition = useRef<number | null>(null)
  const latest = useRef({ min, max, onChange })
  latest.current = { min, max, onChange }
  const frame = useRef(0)
  const timer = useRef(0)
  const touching = useRef(false)
  const bounds = useRef({ min, max })

  const publish = (number: number) => {
    const next = cyclicValue(number, latest.current.min, latest.current.max)
    if (next === emitted.current) return
    emitted.current = next
    latest.current.onChange(next)
  }
  const position = (nextAnchor: number, fraction = 0) => {
    anchor.current = cyclicValue(nextAnchor, latest.current.min, latest.current.max)
    pendingPosition.current = DATE_WHEEL_MIDDLE + fraction
    setView({ anchor: anchor.current })
  }
  const settle = () => {
    window.clearTimeout(timer.current)
    const element = ref.current
    if (touching.current || !element?.clientHeight || pendingPosition.current !== null) return
    const offset = element.scrollTop / (element.clientHeight / 5) - DATE_WHEEL_MIDDLE
    const whole = Math.round(offset)
    publish(anchor.current + whole)
    if (whole) position(anchor.current + whole, offset - whole)
  }
  const scheduleSettle = () => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(settle, 180)
  }

  // Commit the rebased labels and equivalent scroll position together before
  // paint. Echoed selection changes never reset the native scrolling momentum.
  useLayoutEffect(() => {
    const element = ref.current
    if (!element || pendingPosition.current === null) return
    element.scrollTop = pendingPosition.current * element.clientHeight / 5
    pendingPosition.current = null
  }, [view])

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    element.scrollTop = DATE_WHEEL_MIDDLE * element.clientHeight / 5
    const observer = new ResizeObserver(() => position(emitted.current))
    observer.observe(element)
    const release = () => {
      if (!touching.current) return
      touching.current = false
      scheduleSettle()
    }
    element.addEventListener('scrollend', settle)
    window.addEventListener('pointerup', release)
    window.addEventListener('pointercancel', release)
    return () => {
      observer.disconnect()
      element.removeEventListener('scrollend', settle)
      window.removeEventListener('pointerup', release)
      window.removeEventListener('pointercancel', release)
      cancelAnimationFrame(frame.current)
      window.clearTimeout(timer.current)
    }
    // Event callbacks read current values from refs, not an old render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useLayoutEffect(() => {
    if (value === emitted.current && min === bounds.current.min && max === bounds.current.max) return
    bounds.current = { min, max }
    emitted.current = value
    cancelAnimationFrame(frame.current)
    window.clearTimeout(timer.current)
    position(value)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, min, max])

  const choose = (next: number) => {
    cancelAnimationFrame(frame.current)
    window.clearTimeout(timer.current)
    publish(next)
    position(emitted.current)
  }
  usePickerWheel(ref, direction => choose(emitted.current + direction))
  const scroll = () => {
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      const element = ref.current
      if (!element?.clientHeight || pendingPosition.current !== null) return
      const offset = element.scrollTop / (element.clientHeight / 5) - DATE_WHEEL_MIDDLE
      const whole = Math.round(offset)
      publish(anchor.current + whole)
      // Replenish runway only near an edge; normal swipes use native inertia.
      if (Math.abs(offset) > DATE_WHEEL_MIDDLE - 10) position(anchor.current + whole, offset - whole)
    })
    scheduleSettle()
  }
  const keyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    const delta = ({ ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1, PageDown: 5, PageUp: -5 } as Record<string, number | undefined>)[event.key]
    if (delta !== undefined) { event.preventDefault(); choose(emitted.current + delta) }
    else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); choose(event.key === 'Home' ? min : max) }
  }
  const click = (event: MouseEvent<HTMLDivElement>) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>('[data-date-wheel-value]')
    if (row && event.currentTarget.contains(row)) choose(Number(row.dataset.dateWheelValue))
  }

  return <div className="planner-date-wheel-column">
    <span className="planner-date-wheel-label">{label}</span>
    <div className="planner-date-wheel-window">
      <div ref={ref} className="planner-date-wheel" role="spinbutton" tabIndex={0}
        aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} aria-valuetext={format(value)}
        onScroll={scroll} onKeyDown={keyboard} onClick={click}
        onPointerDown={() => { touching.current = true; window.clearTimeout(timer.current) }}
        onPointerUp={() => { touching.current = false; scheduleSettle() }}
        onPointerCancel={() => { touching.current = false; scheduleSettle() }}>
        {wheelNeighborhood(view.anchor, min, max).map((number, index) => <div key={index} className="planner-date-wheel-value"
          data-date-wheel-value={number} data-selected={number === value || undefined} aria-hidden="true">{format(number)}</div>)}
      </div>
    </div>
  </div>
}

export function DateWheelPicker({ open, value, onClose, onSelect }: {
  open: boolean; value: string; onClose: () => void; onSelect: (date: string) => void
}) {
  const [date, setDate] = useState(() => dateForWheels(value))
  useLayoutEffect(() => { if (open) setDate(dateForWheels(value)) }, [open, value])
  return <PlannerSheet open={open} onClose={onClose} title="Перейти до дати" className="planner-date-wheel-sheet"
    footer={<button type="button" className="planner-solid-button" onClick={() => onSelect(wheelDateKey(date))}>Перейти</button>}>
    <div className="planner-date-wheels" role="group" aria-label="Дата барабанами">
      <DateWheel label="День" value={date.day} min={1} max={daysInWheelMonth(date.year, date.month)} format={pad}
        onChange={day => setDate(current => changeWheelDate(current, 'day', day))} />
      <DateWheel label="Місяць" value={date.month} min={1} max={12} format={month => monthNames[month - 1]}
        onChange={month => setDate(current => changeWheelDate(current, 'month', month))} />
      <DateWheel label="Рік" value={date.year} min={DATE_WHEEL_MIN_YEAR} max={DATE_WHEEL_MAX_YEAR}
        onChange={year => setDate(current => changeWheelDate(current, 'year', year))} />
    </div>
  </PlannerSheet>
}
