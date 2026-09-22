import { useId, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import clsx from 'clsx'
import './clock-picker.css'

type Phase = 'hours' | 'minutes'
type ClockGesture = { pointerId: number; phase: Phase; x: number; y: number; moved: boolean; labelValue: number | null }
const pad = (value: number) => String(value).padStart(2, '0')
const safeNumber = (value: string, maximum: number) => /^\d{1,2}$/.test(value) && Number(value) <= maximum ? Number(value) : 0
const positions = Array.from({ length: 12 }, (_, index) => index)

function pointStyle(position: number, radius: number): CSSProperties {
  const angle = position * Math.PI / 6
  return { left: `${50 + Math.sin(angle) * radius}%`, top: `${50 - Math.cos(angle) * radius}%` }
}

/** Civil hours and minutes stay as text until the enclosing picker confirms them. */
export function ClockPicker({ hours, minutes, onHoursChange, onMinutesChange }: {
  hours: string
  minutes: string
  onHoursChange: (hours: string) => void
  onMinutesChange: (minutes: string) => void
}) {
  const [phase, setPhase] = useState<Phase>('hours')
  const faceRef = useRef<HTMLDivElement>(null)
  const gestureRef = useRef<ClockGesture | null>(null)
  const suppressClickUntilRef = useRef(0)
  const id = useId()
  const selectedHour = safeNumber(hours, 23)
  const selectedMinute = safeNumber(minutes, 59)
  const selectedValue = phase === 'hours' ? selectedHour : selectedMinute
  const selectedAngle = phase === 'hours' ? (selectedHour % 12) * 30 : selectedMinute * 6
  const selectedRadius = phase === 'hours' && (selectedHour === 0 || selectedHour > 12) ? 26 : 41

  const select = (value: number, targetPhase: Phase = phase) => {
    if (targetPhase === 'hours') onHoursChange(pad(value))
    else onMinutesChange(pad(value))
  }

  const selectPoint = (clientX: number, clientY: number, targetPhase: Phase) => {
    const face = faceRef.current
    if (!face) return
    const bounds = face.getBoundingClientRect()
    const x = clientX - bounds.left - bounds.width / 2
    const y = clientY - bounds.top - bounds.height / 2
    // Near the center there is no meaningful angle. Keep the previous value.
    if (Math.hypot(x, y) < bounds.width * .12) return
    const angle = (Math.atan2(x, -y) + Math.PI * 2) % (Math.PI * 2)
    if (targetPhase === 'minutes') select(Math.round(angle / (Math.PI * 2) * 60) % 60, targetPhase)
    else {
      const tick = Math.round(angle / (Math.PI * 2) * 12) % 12
      const inner = Math.hypot(x, y) < bounds.width * .335
      select(inner ? tick === 0 ? 0 : tick + 12 : tick === 0 ? 12 : tick, targetPhase)
    }
  }

  const begin = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return
    event.preventDefault()
    const label = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-clock-value]') : null
    const labelValue = label ? Number(label.dataset.clockValue) : null
    gestureRef.current = { pointerId: event.pointerId, phase, x: event.clientX, y: event.clientY, moved: false, labelValue }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.currentTarget.focus({ preventScroll: true })
    if (labelValue !== null) select(labelValue)
    else selectPoint(event.clientX, event.clientY, phase)
  }

  const move = (event: PointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    if (!gesture.moved && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) < 4) return
    gesture.moved = true
    selectPoint(event.clientX, event.clientY, gesture.phase)
  }

  const finish = (event: PointerEvent<HTMLDivElement>, cancelled = false) => {
    const gesture = gestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    gestureRef.current = null
    suppressClickUntilRef.current = performance.now() + 500
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (cancelled) return
    if (gesture.moved || gesture.labelValue === null) selectPoint(event.clientX, event.clientY, gesture.phase)
    else select(gesture.labelValue, gesture.phase)
    if (gesture.phase === 'hours') setPhase('minutes')
  }

  const keyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    const maximum = phase === 'hours' ? 24 : 60
    let next: number
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = (selectedValue + 1) % maximum
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = (selectedValue + maximum - 1) % maximum
    else if (event.key === 'PageUp') next = (selectedValue + (phase === 'hours' ? 12 : 5)) % maximum
    else if (event.key === 'PageDown') next = (selectedValue + maximum - (phase === 'hours' ? 12 : 5)) % maximum
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = maximum - 1
    else if ((event.key === 'Enter' || event.key === ' ') && event.target === event.currentTarget) {
      event.preventDefault()
      if (phase === 'hours') setPhase('minutes')
      return
    } else return
    event.preventDefault()
    select(next)
  }

  const marker = (value: number, position: number, inner = false) => <button
    key={`${phase}-${value}`} type="button" tabIndex={-1} data-clock-value={value}
    className={clsx('planner-clock-number', inner && 'is-inner', selectedValue === value && 'is-selected')}
    style={pointStyle(position, inner ? 26 : 41)}
    aria-label={phase === 'hours' ? `${value} годин` : `${value} хвилин`}
    aria-pressed={selectedValue === value}
    onClick={event => {
      // Pointer selection is handled by the dial so dragging and tapping share
      // one value. Keep synthetic clicks from assistive technology functional.
      if (event.detail !== 0 && performance.now() < suppressClickUntilRef.current) return
      select(value)
      if (phase === 'hours') setPhase('minutes')
    }}
  >{pad(value)}</button>

  return <div className="planner-clock-picker">
    <div className="planner-clock-display">
      <div className="planner-clock-time" role="group" aria-label="Час">
        <button type="button" aria-label={`Години: ${hours || 'не вказано'}. Обрати години`} aria-pressed={phase === 'hours'} onClick={() => setPhase('hours')}>{hours.padStart(2, '0')}</button>
        <span aria-hidden="true">:</span>
        <button type="button" aria-label={`Хвилини: ${minutes || 'не вказано'}. Обрати хвилини`} aria-pressed={phase === 'minutes'} onClick={() => setPhase('minutes')}>{minutes.padStart(2, '0')}</button>
      </div>
    </div>
      <div ref={faceRef} className="planner-clock-face" role="group" tabIndex={0} aria-label={phase === 'hours' ? `Години: ${selectedHour}` : `Хвилини: ${selectedMinute}`} aria-describedby={`${id}-help`} onPointerDown={begin} onPointerMove={move} onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, true)} onLostPointerCapture={event => { if (event.target === event.currentTarget) finish(event, true) }} onKeyDown={keyboard}>
        <div aria-hidden="true" className="planner-clock-hand" style={{ '--clock-angle': `${selectedAngle}deg`, '--clock-reach': `${selectedRadius}%` } as CSSProperties}><span /></div>
        <span aria-hidden="true" className="planner-clock-center" />
        <div key={phase} className="planner-clock-markers">
        {phase === 'hours' ? <>
          {positions.map(position => marker(position === 0 ? 12 : position, position))}
          {positions.map(position => marker(position === 0 ? 0 : position + 12, position, true))}
        </> : <>
          {Array.from({ length: 60 }, (_, minute) => minute).filter(minute => minute % 5 !== 0).map(minute => <span key={minute} aria-hidden="true" className="planner-clock-tick" style={pointStyle(minute / 5, 41)} />)}
          {positions.map(position => marker(position * 5, position))}
        </>}
        </div>
      </div>
      <p id={`${id}-help`} className="sr-only">{phase === 'hours' ? 'Зовнішнє коло: 1–12, внутрішнє: 13–00.' : 'Переміщуйте стрілку для вибору точної хвилини.'} Клавіші зі стрілками змінюють значення на один. Enter переходить до хвилин.</p>
    <span role="status" className="sr-only">Обраний час: {hours || '—'}:{minutes || '—'}</span>
  </div>
}
