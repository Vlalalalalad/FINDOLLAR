import { useState, type ReactNode } from 'react'
import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, Clock3, List, Minus, Plus, Tag, X } from 'lucide-react'
import clsx from 'clsx'
import { addDays, addMonths, calendarDays, localDateKey, localTimeKey, parseLocalDate } from '../../lib/planner'
import { PlannerSheet } from './PlannerSheet'
import { ClockPicker } from './ClockPicker'
import { WheelPicker } from './WheelPicker'
import { useAuth } from '../../context/AuthContext'
import { readPlannerTimeMode, savePlannerTimeMode, type PlannerTimeMode } from '../../lib/plannerTimePreference'
import { MAX_PLAN_DURATION, rangeDuration, rangeEndDay, rangeFromDuration, timeRangeLabel } from '../../lib/plannerTimeRange'

export function plannerDateLabel(value: string | null) {
  if (!value) return 'Без дати'
  const today = localDateKey()
  if (value === today) return 'Сьогодні'
  if (value === addDays(today, 1)) return 'Завтра'
  return new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'short', ...(value.slice(0, 4) !== today.slice(0, 4) ? { year: 'numeric' } : {}) }).format(parseLocalDate(value))
}

export function ChoicePicker<T extends string>({ value, onChange, options, label, disabled = false, trigger, compact = false }: {
  value: T; onChange: (value: T) => void; options: readonly { value: T; label: string }[]; label?: string; disabled?: boolean; trigger?: ReactNode; compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  const selectedLabel = options.find(option => option.value === value)?.label ?? value
  const accessibleLabel = label ? `${label}: ${selectedLabel}` : selectedLabel
  return <>
    <button type="button" className={clsx('planner-parameter', compact && 'planner-parameter-compact')} disabled={disabled} aria-haspopup="dialog" aria-expanded={open} aria-label={accessibleLabel} onClick={() => setOpen(true)}>
      {trigger ?? (compact ? <ChevronDown size={17} aria-hidden="true" /> : <span>{selectedLabel}</span>)}{!compact && <ChevronDown size={14} aria-hidden="true" />}
    </button>
    <PlannerSheet open={open} title={label ?? 'Оберіть варіант'} onClose={() => setOpen(false)}>
      <div className="planner-choice-list">{options.map(option => <button key={option.value} type="button" aria-pressed={option.value === value} onClick={() => { onChange(option.value); setOpen(false) }}><span>{option.label}</span>{option.value === value && <Check size={18} />}</button>)}</div>
    </PlannerSheet>
  </>
}

const weekdays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд']
const months = Array.from({ length: 12 }, (_, index) => new Intl.DateTimeFormat('uk-UA', { month: 'long' }).format(new Date(2024, index, 1)))

export function DatePickerPanel({ value, onChange, allowEmpty = true, min, rangeStart, rangeEnd }: { value: string | null; onChange: (value: string | null) => void; allowEmpty?: boolean; min?: string; rangeStart?: string | null; rangeEnd?: string | null }) {
  const today = localDateKey()
  const [month, setMonth] = useState(() => `${(value ?? today).slice(0, 7)}-01`)
  const [jump, setJump] = useState(false)
  const [year, setYear] = useState(month.slice(0, 4))
  const [jumpMonth, setJumpMonth] = useState(Number(month.slice(5, 7)) - 1)
  const validYear = /^\d{4}$/.test(year) && Number(year) >= 1900 && Number(year) <= 9998
  const move = (direction: number) => { const next = addMonths(month, direction); if (next >= '1900-01-01' && next < '9999-01-01') setMonth(next) }
  const choose = (date: string | null) => { if (!date || !min || date >= min) onChange(date) }
  return <div className="planner-date-picker">
    <div className="planner-picker-shortcuts">
      <button type="button" disabled={!!min && today < min} onClick={() => choose(today)}>Сьогодні</button>
      <button type="button" disabled={!!min && addDays(today, 1) < min} onClick={() => choose(addDays(today, 1))}>Завтра</button>
      {allowEmpty && <button type="button" onClick={() => choose(null)}>Без дати</button>}
    </div>
    <div className="planner-picker-month"><button type="button" className="planner-icon-button" aria-label="Попередній місяць" onClick={() => move(-1)}><ChevronLeft size={18} /></button>
      <button type="button" className="planner-month-jump" aria-expanded={jump} onClick={() => { setJump(value => !value); setYear(month.slice(0, 4)); setJumpMonth(Number(month.slice(5, 7)) - 1) }}>{new Intl.DateTimeFormat('uk-UA', { month: 'long', year: 'numeric' }).format(parseLocalDate(month))}<ChevronDown size={14} /></button>
      <button type="button" className="planner-icon-button" aria-label="Наступний місяць" onClick={() => move(1)}><ChevronRight size={18} /></button>
    </div>
    {jump ? <div className="planner-date-jump">
      <label>Рік<input inputMode="numeric" maxLength={4} value={year} onChange={event => setYear(event.target.value.replace(/\D/g, ''))} /></label>
      <div className="planner-month-grid">{months.map((label, index) => <button key={label} type="button" aria-pressed={jumpMonth === index} onClick={() => setJumpMonth(index)}>{label}</button>)}</div>
      <button type="button" className="planner-solid-button" disabled={!validYear} onClick={() => { setMonth(`${year}-${String(jumpMonth + 1).padStart(2, '0')}-01`); setJump(false) }}>Перейти</button>
    </div> : <div className="planner-picker-days" role="group" aria-label="Оберіть дату" onKeyDown={event => { if (event.key === 'PageUp' || event.key === 'PageDown') { event.preventDefault(); move(event.key === 'PageUp' ? -1 : 1) } }}>
      {weekdays.map(day => <span key={day} className="planner-picker-weekday">{day}</span>)}
      {calendarDays(month).map(day => <button key={day} type="button" aria-label={new Intl.DateTimeFormat('uk-UA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(parseLocalDate(day))} aria-pressed={value === day} aria-current={today === day ? 'date' : undefined} disabled={!!min && day < min} className={clsx(day.slice(0, 7) !== month.slice(0, 7) && 'is-outside', rangeStart && rangeEnd && day >= rangeStart && day <= rangeEnd && 'is-in-range')} onClick={() => choose(day)}><span>{Number(day.slice(8))}</span></button>)}
    </div>}
  </div>
}

export function plannerDateRangeLabel(start: string, end: string) {
  const shortDate = (date: string) => new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'short' }).format(parseLocalDate(date)).replace(/\./g, '')
  return start.slice(0, 7) === end.slice(0, 7) ? `${Number(start.slice(8))}–${shortDate(end)}` : `${shortDate(start)}–${shortDate(end)}`
}

export function DatePicker({ value, onChange, allowEmpty = true, min, disabled = false, compact = false, endValue, onRangeChange }: { value: string | null; onChange: (value: string | null) => void; allowEmpty?: boolean; min?: string; disabled?: boolean; compact?: boolean; endValue?: string | null; onRangeChange?: (start: string | null, end: string | null) => void }) {
  const [open, setOpen] = useState(false)
  const [start, setStart] = useState<string | null>(value)
  const [end, setEnd] = useState<string | null>(endValue ?? null)
  const [endpoint, setEndpoint] = useState<'start' | 'end'>('start')
  const [range, setRange] = useState(false)
  const label = value && endValue ? plannerDateRangeLabel(value, endValue) : compact && value ? new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'short' }).format(parseLocalDate(value)).replace(/\./g, '') : plannerDateLabel(value)
  const commit = (date: string | null, finish: string | null) => {
    // A range that ends on its start date is the ordinary one-day case. Keep
    // it represented as one date so the compact composer never shows `5–5`.
    const normalizedFinish = finish && date && finish > date ? finish : null
    if (onRangeChange) onRangeChange(date, normalizedFinish); else onChange(date)
    setOpen(false)
  }
  return <><button type="button" disabled={disabled} className={clsx('planner-parameter', value && 'is-active', compact && (value ? 'planner-parameter-compact-date' : 'planner-parameter-compact'))} data-active={!!value} aria-label={`Дата: ${plannerDateLabel(value)}${endValue ? ` — ${plannerDateLabel(endValue)}` : ''}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => { setStart(value); setEnd(endValue ?? null); setRange(!!onRangeChange && !!endValue); setEndpoint('start'); setOpen(true) }}><CalendarDays size={16} aria-hidden="true" />{(!compact || value) && <span>{label}</span>}</button>
    <PlannerSheet open={open} title="Дата" onClose={() => setOpen(false)} footer={range ? <button type="button" className="planner-solid-button" disabled={!start || !end || end < start} onClick={() => commit(start, end)}>Готово</button> : undefined}>
      {!!onRangeChange && <div className="planner-date-endpoints" role="group" aria-label="Період плану">
        <button type="button" aria-pressed={endpoint === 'start'} aria-label="Дата початку" onClick={() => setEndpoint('start')}>{range ? plannerDateLabel(start) : 'Початок'}</button>
        {range ? <><span aria-hidden="true">–</span><button type="button" aria-pressed={endpoint === 'end'} aria-label="Дата завершення" onClick={() => setEndpoint('end')}>{plannerDateLabel(end)}</button><button type="button" aria-label="Прибрати дату завершення" onClick={() => { setEnd(null); setRange(false); setEndpoint('start'); if (endValue) commit(start, null) }}><X size={14} /></button></>
          : <button type="button" onClick={() => { const nextStart = start ?? localDateKey(); setStart(nextStart); setEnd(nextStart); setRange(true); setEndpoint('end') }}><Plus size={14} aria-hidden="true" />Кінець</button>}
      </div>}
      {open && <DatePickerPanel key={endpoint} value={range ? endpoint === 'end' ? end : start : value} allowEmpty={allowEmpty && !range} min={range && endpoint === 'end' ? start ?? min : min} rangeStart={range ? start : null} rangeEnd={range ? end : null} onChange={date => {
        if (!range) { commit(date, null); return }
        if (endpoint === 'end') setEnd(date)
        else { setStart(date); if (date && end && date > end) setEnd(date); setEndpoint('end') }
      }} />}
    </PlannerSheet></>
}

export function TimePicker({ value, onChange, duration = null, onDurationChange, autoComplete = false, onAutoCompleteChange, disabled = false, compact = false }: {
  value: string | null; onChange: (value: string | null) => void; duration?: number | null; onDurationChange?: (duration: number | null) => void; autoComplete?: boolean; onAutoCompleteChange?: (enabled: boolean) => void; disabled?: boolean; compact?: boolean
}) {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<PlannerTimeMode>(() => readPlannerTimeMode(user?.id))
  const [start, setStart] = useState(() => localTimeKey())
  const [end, setEnd] = useState<string | null>(null)
  const [extraDays, setExtraDays] = useState(0)
  const [endpoint, setEndpoint] = useState<'start' | 'end'>('start')
  const [autoCompleteDraft, setAutoCompleteDraft] = useState(false)
  const show = () => {
    const nextStart = value ?? localTimeKey()
    const range = duration ? rangeFromDuration(nextStart, duration) : null
    setStart(nextStart)
    setEnd(range?.end ?? null)
    setExtraDays(range?.extraDays ?? 0)
    setEndpoint('start')
    setAutoCompleteDraft(autoComplete)
    setMode(readPlannerTimeMode(user?.id))
    setOpen(true)
  }
  const chooseMode = (next: PlannerTimeMode) => { setMode(next); savePlannerTimeMode(next, user?.id) }
  const durationDraft = end ? rangeDuration(start, end, extraDays) : null
  const valid = durationDraft === null || durationDraft <= MAX_PLAN_DURATION
  const endDay = durationDraft ? rangeEndDay(start, durationDraft) : 0
  const selected = endpoint === 'end' && end ? end : start
  const updateTime = (hours: string, minutes: string) => {
    const next = `${hours}:${minutes}`
    if (endpoint === 'end') setEnd(next)
    else setStart(next)
  }
  const addEnd = () => {
    setEnd(rangeFromDuration(start, 60).end)
    setExtraDays(0)
    setEndpoint('end')
  }
  const resultLabel = value ? timeRangeLabel(value, duration) : '--:--'
  return <><button type="button" className={clsx('planner-parameter', value && 'is-active', compact && 'planner-parameter-compact')} data-active={!!value} disabled={disabled} aria-label={`Час: ${resultLabel}`} aria-haspopup="dialog" aria-expanded={open} onClick={show}><Clock3 size={16} aria-hidden="true" />{!compact && <span>{value ? resultLabel : 'Час'}</span>}</button>
    <PlannerSheet open={open} className={clsx('planner-time-sheet', !!end && 'has-range', !!onAutoCompleteChange && 'has-auto-complete')} title="Час" onClose={() => setOpen(false)} footer={<div className="planner-time-footer">
      <button type="button" className="planner-plain-button planner-time-clear" onClick={() => { onChange(null); onDurationChange?.(null); onAutoCompleteChange?.(false); setOpen(false) }}>Без конкретного часу</button>
      <button type="button" className="planner-solid-button" disabled={!valid} onClick={() => { onChange(start); onDurationChange?.(durationDraft); onAutoCompleteChange?.(autoCompleteDraft); setOpen(false) }}>Готово</button>
    </div>}>
      <div className="planner-time-toolbar">
        <div className="planner-time-endpoints" role="group" aria-label={end ? 'Часовий проміжок' : 'Один час'}>
          <button type="button" className="planner-time-endpoint" aria-label={`Початок: ${start}`} aria-pressed={endpoint === 'start'} onClick={() => setEndpoint('start')}>{start}</button>
          {!!onDurationChange && (end ? <><span className="planner-time-range-dash" aria-hidden="true">–</span><button type="button" className="planner-time-endpoint" aria-label={`Кінець: ${end}${endDay ? `, через ${endDay} дн.` : ''}`} aria-pressed={endpoint === 'end'} onClick={() => setEndpoint('end')}>{end}</button><button type="button" className="planner-time-remove-end" aria-label="Прибрати кінцевий час" onClick={() => { setEnd(null); setExtraDays(0); setEndpoint('start') }}><X size={14} aria-hidden="true" /></button></>
            : <button type="button" className="planner-time-add-end" onClick={addEnd}><Plus size={14} aria-hidden="true" /><span>Кінець</span></button>)}
        </div>
        <div className="planner-time-mode" role="group" aria-label="Спосіб вибору часу">
          <button type="button" aria-label="Циферблат" aria-pressed={mode === 'clock'} onClick={() => chooseMode('clock')}><Clock3 size={15} aria-hidden="true" /></button>
          <button type="button" aria-label="Барабани" aria-pressed={mode === 'wheel'} onClick={() => chooseMode('wheel')}><List size={15} aria-hidden="true" /></button>
        </div>
      </div>
      {open && <div className="planner-time-control" key={`${mode}:${endpoint}`} data-endpoint={endpoint}>{mode === 'clock'
        ? <ClockPicker hours={selected.slice(0, 2)} minutes={selected.slice(3, 5)} onHoursChange={hours => updateTime(hours, selected.slice(3, 5))} onMinutesChange={minutes => updateTime(selected.slice(0, 2), minutes)} />
        : <WheelPicker hours={selected.slice(0, 2)} minutes={selected.slice(3, 5)} onHoursChange={hours => updateTime(hours, selected.slice(3, 5))} onMinutesChange={minutes => updateTime(selected.slice(0, 2), minutes)} />}</div>}
      {end && <div className="planner-time-range-days" role="group" aria-label="День завершення">
        <button type="button" aria-label="На день раніше" disabled={extraDays === 0} onClick={() => setExtraDays(days => Math.max(0, days - 1))}><Minus size={14} aria-hidden="true" /></button>
        <span>{endDay ? `+${endDay} дн.` : 'Того ж дня'}</span>
        <button type="button" aria-label="На день пізніше" disabled={(durationDraft ?? 0) + 1440 > MAX_PLAN_DURATION} onClick={() => setExtraDays(days => days + 1)}><Plus size={14} aria-hidden="true" /></button>
      </div>}
      {!valid && <p className="planner-time-range-error" role="alert">Проміжок до 7 днів</p>}
      {!!onAutoCompleteChange && <button type="button" role="switch" aria-checked={autoCompleteDraft} className="planner-time-auto-complete" onClick={() => setAutoCompleteDraft(current => !current)}><span>Виконати автоматично</span><span className="planner-time-switch-track" aria-hidden="true"><span /></span></button>}
    </PlannerSheet></>
}

export function TagsPicker({ value, onChange, suggestions = [], disabled = false, compact = false }: { value: string[]; onChange: (value: string[]) => void; suggestions?: string[]; disabled?: boolean; compact?: boolean }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const add = () => { const tag = draft.trim().replace(/^#/, '').slice(0, 40); if (tag && value.length < 20 && !value.includes(tag)) onChange([...value, tag]); setDraft('') }
  return <><button type="button" disabled={disabled} className={clsx('planner-parameter', value.length > 0 && 'is-active', compact && 'planner-parameter-compact')} data-active={value.length > 0} aria-label={value.length ? `Мітки: ${value.join(', ')}` : 'Мітки'} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}><Tag size={16} aria-hidden="true" />{!compact && <span>{value.length ? value.length === 1 ? value[0] : `${value.length} мітки` : 'Мітка'}</span>}</button>
    <PlannerSheet open={open} title="Мітки" onClose={() => setOpen(false)}>
      <div className="planner-tag-input"><input aria-label="Нова мітка" value={draft} maxLength={40} placeholder="Назва мітки" onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); add() } }} /><button type="button" className="planner-icon-button" disabled={!draft.trim() || value.length >= 20} aria-label="Додати мітку" onClick={add}><Plus size={20} /></button></div>
      <div className="planner-picker-shortcuts mt-3">{value.map(tag => <button type="button" key={tag} aria-label={`Прибрати мітку ${tag}`} onClick={() => onChange(value.filter(item => item !== tag))}>#{tag}<X size={14} /></button>)}</div>
      {!!suggestions.filter(tag => !value.includes(tag)).length && <div className="planner-choice-list mt-3">{[...new Set(suggestions)].filter(tag => !value.includes(tag)).slice(0, 30).map(tag => <button type="button" key={tag} disabled={value.length >= 20} onClick={() => onChange([...value, tag])}>#{tag}<Plus size={16} /></button>)}</div>}
    </PlannerSheet></>
}
