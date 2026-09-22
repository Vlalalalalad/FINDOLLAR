import type { Task, TaskInput, TaskOccurrence } from '../../types/planner'
import { isValidDateKey } from '../../lib/planner'
import { COLOR_PRESETS } from '../ColorPicker'

export type Frequency = 'none' | 'daily' | 'weekly' | 'monthly' | 'weekdays'
export type Draft = {
  title: string
  description: string
  date: string
  endDate?: string
  time: string
  duration: string
  autoComplete: boolean
  status: TaskInput['status']
  priority: TaskInput['priority']
  color: string
  reminders: number[]
  frequency: Frequency
  interval: string
  weekdays: number[]
  until: string
  tags: string[]
}

export const REMINDERS = [
  { value: 0, label: 'У момент плану' },
  { value: 5, label: 'За 5 хв' },
  { value: 10, label: 'За 10 хв' },
  { value: 15, label: 'За 15 хв' },
  { value: 30, label: 'За 30 хв' },
  { value: 60, label: 'За 1 год' },
  { value: 1440, label: 'За 1 день' },
] as const
export const WEEKDAYS = [
  { value: 1, short: 'Пн', label: 'Понеділок' },
  { value: 2, short: 'Вт', label: 'Вівторок' },
  { value: 3, short: 'Ср', label: 'Середа' },
  { value: 4, short: 'Чт', label: 'Четвер' },
  { value: 5, short: 'Пт', label: 'П’ятниця' },
  { value: 6, short: 'Сб', label: 'Субота' },
  { value: 0, short: 'Нд', label: 'Неділя' },
]
export const PRIORITIES = [
  { value: 'none', label: 'Без пріоритету' },
  { value: 'low', label: 'Низький' },
  { value: 'medium', label: 'Середній' },
  { value: 'high', label: 'Високий' },
] as const

export function remindersLabel(reminders: number[]) {
  return reminders.length
    ? [...reminders].sort((a, b) => b - a).map(value => REMINDERS.find(item => item.value === value)?.label ?? `За ${value} хв`).join(', ')
    : 'Без нагадування'
}

export function draftRecurrence(draft: Draft): TaskInput['recurrence'] {
  return draft.frequency === 'none' ? null : {
    frequency: draft.frequency === 'weekdays' ? 'weekly' : draft.frequency,
    interval: Number(draft.interval),
    ...(draft.frequency === 'weekdays' ? { weekdays: [...draft.weekdays].sort((a, b) => a - b) } : {}),
    until: draft.until || null,
  }
}

function weekdayForDate(date: string) {
  return date ? new Date(`${date}T12:00:00`).getDay() : new Date().getDay()
}

export function toDraft(task?: Task | null, initialDate?: string | null): Draft {
  const recurrence = task?.recurrence
  return {
    title: task?.title ?? '',
    description: task?.description ?? '',
    date: task?.date ?? initialDate ?? '',
    endDate: task?.end_date ?? '',
    time: task?.time?.slice(0, 5) ?? '',
    duration: task?.duration_minutes ? String(task.duration_minutes) : '',
    autoComplete: task?.auto_complete ?? false,
    status: task?.status ?? 'planned',
    priority: task?.priority ?? 'none',
    color: task?.color ?? COLOR_PRESETS[0],
    reminders: [...(task?.reminders ?? [])],
    frequency: recurrence?.frequency === 'weekly' && recurrence.weekdays?.length
      ? 'weekdays'
      : recurrence?.frequency ?? 'none',
    interval: String(recurrence?.interval ?? 1),
    weekdays: [...(recurrence?.weekdays ?? [weekdayForDate(task?.date ?? initialDate ?? '')])],
    until: recurrence?.until ?? '',
    tags: [...(task?.tags ?? [])],
  }
}

export function validateDraft(draft: Draft, canEditRecurrence: boolean) {
  if (!draft.title.trim()) return 'Вкажіть назву плану.'
  if (draft.date && !isValidDateKey(draft.date)) return 'Вкажіть коректну дату.'
  if (draft.endDate && (!draft.date || !isValidDateKey(draft.endDate) || draft.endDate < draft.date)) return 'Завершення плану не може бути раніше початку.'
  if (draft.time && (!draft.date || !/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.time))) return 'Для часу плану потрібна коректна дата.'
  if (draft.autoComplete && (!draft.date || !draft.time)) return 'Для автоматичного виконання вкажіть дату й час.'
  if (draft.duration && (!Number.isSafeInteger(Number(draft.duration)) || Number(draft.duration) < 1 || Number(draft.duration) > 10080)) {
    return 'Вкажіть тривалість від 1 до 10 080 хвилин (7 днів).'
  }
  if (draft.reminders.length && !draft.date) return 'Оберіть дату для нагадувань або вимкніть їх.'
  if (canEditRecurrence && draft.frequency !== 'none') {
    if (!draft.date) return 'Оберіть дату початку повторень.'
    if (!Number.isSafeInteger(Number(draft.interval)) || Number(draft.interval) < 1 || Number(draft.interval) > 3650) return 'Інтервал повторення має бути цілим числом від 1 до 3650.'
    if (draft.frequency === 'weekdays' && !draft.weekdays.length) return 'Оберіть хоча б один день тижня.'
    if (draft.until && (!isValidDateKey(draft.until) || draft.until < draft.date)) return 'Кінцева дата не може бути раніше початку повторень.'
  }
  return null
}


export function draftInput(draft: Draft, plannedSeries = false): TaskInput {
  return {
    title: draft.title.trim(), description: draft.description.trim() || null,
    date: draft.date || null, end_date: draft.date && draft.endDate ? draft.endDate : null, time: draft.date ? draft.time || null : null,
    duration_minutes: draft.duration ? Number(draft.duration) : null,
    auto_complete: draft.autoComplete,
    status: plannedSeries ? 'planned' : draft.status, priority: draft.priority, color: draft.color,
    reminders: [...draft.reminders].sort((a, b) => a - b), recurrence: draftRecurrence(draft), tags: draft.tags,
  }
}

/** Recurrence exceptions contain only edits, so later series changes still apply. */
export function occurrenceChanges(occurrence: TaskOccurrence, input: TaskInput): Partial<TaskInput> {
  const original = { ...occurrence, end_date: occurrence.end_date ?? null, auto_complete: occurrence.auto_complete ?? false, title: occurrence.title.trim(), description: occurrence.description?.trim() || null,
    time: occurrence.time?.slice(0, 5) || null, reminders: [...occurrence.reminders].sort((a, b) => a - b), tags: occurrence.tags ?? [] }
  return Object.fromEntries(Object.entries(input).filter(([key, value]) =>
    key !== 'recurrence' && JSON.stringify(value) !== JSON.stringify(original[key as keyof TaskInput])
  )) as Partial<TaskInput>
}
