import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import clsx from 'clsx'
import { Button } from '../ui'
import { addDays, parseLocalDate, calendarDays, occursOnDate, selectAdjacentMonth, selectAdjacentWeek, calendarMarkerState } from '../../lib/planner'
import { useCalendarGestures } from '../../hooks/useCalendarGestures'
import { useLongPressAction } from '../../hooks/useLongPressAction'
import { usePressFeedback } from '../../hooks/usePressFeedback'
import { DateWheelPicker } from './DateWheelPicker'
import type { TaskOccurrence } from '../../types/planner'
import './planner-gestures.css'

export { calendarDays } from '../../lib/planner'

export const PlannerCalendar = memo(function PlannerCalendar({ month, today, selected, tasks, busy, expanded, onExpandedChange, onSelect, onMove }: {
  month: string; today: string; selected: string; tasks: TaskOccurrence[]; busy: boolean
  expanded: boolean; onExpandedChange: (expanded: boolean) => void
  onSelect: (date: string) => void; onMove: (task: TaskOccurrence, date: string) => void
}) {
  const days = useMemo(() => calendarDays(month), [month])
  const selectedWeek = Math.max(0, Math.floor(days.indexOf(selected) / 7))
  const byDay = useMemo(() => {
    const map = new Map<string, TaskOccurrence[]>()
    days.forEach(day => map.set(day, tasks.filter(task => occursOnDate(task, day))))
    map.forEach(items => items.sort((a, b) => Number(a.status === 'completed') - Number(b.status === 'completed') || (a.time ?? '99').localeCompare(b.time ?? '99')))
    return map
  }, [tasks, days])
  const [dragOver, setDragOver] = useState<string | null>(null)
  const [datePickerOpen, setDatePickerOpen] = useState(false)
  const todayAction = useLongPressAction({ onClick: () => onSelect(today), onLongPress: () => setDatePickerOpen(true) })
  const press = usePressFeedback()
  const periodTrack = useRef<HTMLDivElement>(null)
  const changePeriod = useCallback((delta: number) => {
    onSelect(expanded ? selectAdjacentMonth(selected, delta, today) : selectAdjacentWeek(selected, delta, today))
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      periodTrack.current?.animate([{ transform: `translateX(${delta * 12}px)` }, { transform: 'translateX(0)' }], { duration: 180, easing: 'ease-out' })
    }
  }, [expanded, onSelect, selected, today])
  const ref = useCalendarGestures<HTMLElement>({ expanded, onExpandedChange, onPeriodChange: changePeriod })
  const lastExpanded = useRef(expanded)
  useLayoutEffect(() => {
    if (lastExpanded.current === expanded) return
    lastExpanded.current = expanded
    const element = ref.current
    element?.classList.add('is-resizing')
    const timer = window.setTimeout(() => element?.classList.remove('is-resizing'), 220)
    return () => { window.clearTimeout(timer); element?.classList.remove('is-resizing') }
  }, [expanded, ref])
  const navigateDay = (event: KeyboardEvent<HTMLButtonElement>, date: string) => {
    const delta = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 } as Record<string, number | undefined>)[event.key]
    if (delta !== undefined) {
      event.preventDefault()
      const nextDate = addDays(date, delta)
      onSelect(nextDate)
      requestAnimationFrame(() => ref.current?.querySelector<HTMLButtonElement>(`[data-date="${nextDate}"]`)?.focus({ preventScroll: true }))
    } else if (event.key === 'PageUp' || event.key === 'PageDown') {
      event.preventDefault()
      const delta = event.key === 'PageDown' ? 1 : -1
      const nextDate = expanded ? selectAdjacentMonth(selected, delta, today) : selectAdjacentWeek(selected, delta, today)
      changePeriod(delta)
      requestAnimationFrame(() => ref.current?.querySelector<HTMLButtonElement>(`[data-date="${nextDate}"]`)?.focus({ preventScroll: true }))
    } else if (event.key === 'Home') {
      event.preventDefault(); onSelect(today)
      requestAnimationFrame(() => ref.current?.querySelector<HTMLButtonElement>(`[data-date="${today}"]`)?.focus({ preventScroll: true }))
    }
  }
  return (
    <section ref={ref} className={clsx('planner-calendar planner-week-calendar', expanded && 'is-expanded')} aria-label={expanded ? 'Календар на місяць' : 'Календар на тиждень'}>
      <div className="flex min-h-14 items-center justify-between gap-1">
        <button type="button" data-no-calendar-gesture {...press('month')} onClick={() => onExpandedChange(!expanded)} aria-expanded={expanded} aria-controls="planner-calendar-dates" className="planner-period-title">
          <span aria-live="polite">{parseLocalDate(month).toLocaleDateString('uk-UA', { month: 'long', year: 'numeric' }).replace(' р.', '')}</span>
        </button>
        <div className="flex shrink-0 items-center">
          <Button type="button" data-no-calendar-gesture variant="ghost" className="planner-calendar-control h-11 w-11 p-0" {...press('previous')} aria-label={expanded ? 'Попередній місяць' : 'Попередній тиждень'} onClick={() => changePeriod(-1)}><ChevronLeft size={19} /></Button>
          <Button type="button" data-no-calendar-gesture variant="ghost" className="planner-calendar-control min-h-11 select-none px-2 text-xs text-primary" {...press('today', todayAction)}
            style={{ WebkitTouchCallout: 'none' }} aria-label="Сьогодні · утримуйте, щоб обрати дату" aria-haspopup="dialog" aria-expanded={datePickerOpen} aria-keyshortcuts="Alt+ArrowDown">Сьогодні</Button>
          <Button type="button" data-no-calendar-gesture variant="ghost" className="planner-calendar-control h-11 w-11 p-0" {...press('next')} aria-label={expanded ? 'Наступний місяць' : 'Наступний тиждень'} onClick={() => changePeriod(1)}><ChevronRight size={19} /></Button>
        </div>
      </div>
      <div className="planner-calendar-period" ref={periodTrack}>
        <div className="planner-calendar-grid" aria-hidden="true">{['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'].map(day => <div key={day} className="planner-weekday">{day}</div>)}</div>
        <div id="planner-calendar-dates" className="planner-calendar-window" style={{ '--planner-selected-week': selectedWeek } as CSSProperties}>
          <div className="planner-calendar-grid planner-calendar-track" role="group" aria-label={expanded ? 'Дні місяця' : 'Дні тижня'}>
            {days.map((date, index) => {
              const items = byDay.get(date) ?? []
              const visible = expanded || Math.floor(index / 7) === selectedWeek
              return <button key={date} type="button" data-date={date} className={clsx('planner-calendar-day', expanded && date.slice(0, 7) !== month.slice(0, 7) && 'is-outside', date === today && 'is-today', date === selected && 'is-selected', dragOver === date && 'is-drag-over')}
                tabIndex={visible && date === selected ? 0 : -1} aria-hidden={!visible || undefined}
                aria-label={parseLocalDate(date).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' }) + ', планів: ' + items.length} aria-pressed={selected === date} aria-current={date === today ? 'date' : undefined}
                onClick={() => onSelect(date)} onKeyDown={event => navigateDay(event, date)}
                onDragEnter={event => { if (!busy && event.dataTransfer.types.includes('application/x-findossar-task')) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDragOver(date) } }}
                onDragOver={event => { if (!busy && event.dataTransfer.types.includes('application/x-findossar-task')) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDragOver(date) } }}
                onDragLeave={() => setDragOver(null)} onDrop={event => {
                  event.preventDefault(); setDragOver(null)
                  const id = event.dataTransfer.getData('application/x-findossar-task')
                  const task = tasks.find(item => item.id === id)
                  if (task && !busy && task.date !== date) onMove(task, date)
                }}>
                <span className="planner-date-number">{Number(date.slice(-2))}</span>
                <span className="planner-date-dots" aria-hidden="true">{items.map(task => ({ task, state: calendarMarkerState(task, date, today) }))
                  .filter((marker): marker is { task: TaskOccurrence; state: 'active' | 'inactive' } => marker.state !== null)
                  .sort((a, b) => Number(a.state === 'inactive') - Number(b.state === 'inactive'))
                  .slice(0, 3).map(({ task, state }) => <span key={task.id} style={{ backgroundColor: task.color, opacity: task.status === 'completed' ? .4 : state === 'inactive' ? .35 : 1 }} />)}</span>
              </button>
            })}
          </div>
        </div>
      </div>
      <button type="button" className="planner-calendar-handle" onClick={() => onExpandedChange(!expanded)} aria-label={expanded ? 'Згорнути до тижня' : 'Розгорнути місяць'} aria-expanded={expanded} aria-controls="planner-calendar-dates"><span /></button>
      <DateWheelPicker open={datePickerOpen} value={selected} onClose={() => setDatePickerOpen(false)} onSelect={date => {
        onSelect(date)
        setDatePickerOpen(false)
      }} />
    </section>
  )
})
