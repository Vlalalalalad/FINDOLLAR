import type { Task, TaskOccurrence, TaskOverride, TaskPriority, TaskRecurrence, TaskReminderEvent } from '../types/planner'

const DAY_MS = 86_400_000
export const REMINDER_OPTIONS = [0, 5, 10, 15, 30, 60, 1440] as const
export const TASK_COLORS = ['#6366f1', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6'] as const
/** Date-only reminders fire at 09:00 in the device's current time zone. */
export const DATE_ONLY_REMINDER_TIME = '09:00'

export function localDateKey(date: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${String(date.getFullYear()).padStart(4, '0')}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function localTimeKey(date: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function isValidDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  if (year < 1 || month < 1 || month > 12 || day < 1) return false
  const test = new Date(0)
  test.setUTCFullYear(year, month, 0)
  return day <= test.getUTCDate()
}

export function isValidTime(value: unknown): value is string {
  return typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)
}

export function parseLocalDate(value: string): Date {
  if (!isValidDateKey(value)) throw new RangeError(`Invalid calendar date: ${value}`)
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(0)
  date.setFullYear(year, month - 1, day)
  date.setHours(0, 0, 0, 0)
  return date
}

/** UTC is used only to count civil days, never to parse or store task dates. */
function dayNumber(value: string): number {
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  date.setUTCHours(0, 0, 0, 0)
  return date.getTime() / DAY_MS
}

/** A range is one plan identity, visible on each inclusive civil day. */
export function occursOnDate(task: Pick<Task, 'date' | 'end_date'>, date: string): boolean {
  return !!task.date && isValidDateKey(task.date) && isValidDateKey(date)
    && task.date <= date && date <= (task.end_date && isValidDateKey(task.end_date) && task.end_date >= task.date ? task.end_date : task.date)
}

export function shiftPlanDate(task: Pick<Task, 'date' | 'end_date'>, date: string | null): Pick<Task, 'date' | 'end_date'> {
  if (date !== null && !isValidDateKey(date)) throw new RangeError(`Invalid calendar date: ${date}`)
  if (task.end_date === undefined) return { date }
  const end_date = date && task.date && task.end_date && isValidDateKey(task.date) && isValidDateKey(task.end_date)
    ? addDays(date, Math.max(0, dayNumber(task.end_date) - dayNumber(task.date))) : null
  if (end_date && !isValidDateKey(end_date)) throw new RangeError('Invalid calendar range')
  return { date, end_date }
}

function rangeSpan(task: Pick<Task, 'date' | 'end_date'>): number {
  return task.date && task.end_date && isValidDateKey(task.date) && isValidDateKey(task.end_date)
    ? Math.max(0, dayNumber(task.end_date) - dayNumber(task.date)) : 0
}

function overlapsRange(task: Pick<Task, 'date' | 'end_date'>, start: string, end: string): boolean {
  return !!task.date && isValidDateKey(task.date) && task.date <= end
    && (task.end_date && isValidDateKey(task.end_date) && task.end_date >= task.date ? task.end_date : task.date) >= start
}

function rangeLowerBound(start: string, span: number): string {
  return addDays(start, -Math.min(span, dayNumber(start) - dayNumber('0001-01-01')))
}

export function addDays(value: string, count: number): string {
  const date = parseLocalDate(value)
  date.setHours(12)
  date.setDate(date.getDate() + Math.trunc(count))
  return localDateKey(date)
}

/** Always call with the original anchor to retain Jan 31 -> Feb 28 -> Mar 31. */
export function addMonths(value: string, count: number): string {
  const date = parseLocalDate(value)
  const desiredDay = date.getDate()
  date.setHours(12)
  date.setDate(1)
  date.setMonth(date.getMonth() + Math.trunc(count))
  const end = new Date(date)
  end.setMonth(end.getMonth() + 1, 0)
  date.setDate(Math.min(desiredDay, end.getDate()))
  return localDateKey(date)
}

export function startOfMonth(value: string): string {
  return `${value.slice(0, 7)}-01`
}

export function endOfMonth(value: string): string {
  return addDays(addMonths(startOfMonth(value), 1), -1)
}

export function startOfCalendarWeek(value: string): string {
  return addDays(value, -((parseLocalDate(value).getDay() + 6) % 7))
}

export function calendarDays(month: string): string[] {
  const start = startOfCalendarWeek(startOfMonth(month))
  // Six stable rows prevent layout shifts when changing months.
  return Array.from({ length: 42 }, (_, index) => addDays(start, index))
}

function validRule(rule: TaskRecurrence): boolean {
  return ['daily', 'weekly', 'monthly'].includes(rule.frequency)
    && Number.isInteger(rule.interval) && rule.interval >= 1
    && (rule.until === null || isValidDateKey(rule.until))
}

/** Only expands the requested inclusive range; work is independent of series age. */
export function recurrenceDates(task: Pick<Task, 'date' | 'recurrence'>, start: string, end: string, limit = Infinity): string[] {
  const anchor = task.date
  const maximum = limit === Infinity ? Infinity : Math.max(0, Number.isFinite(limit) ? Math.floor(limit) : 0)
  if (!maximum || !anchor || !isValidDateKey(anchor) || !isValidDateKey(start) || !isValidDateKey(end) || start > end) return []
  const rule = task.recurrence
  if (!rule) return anchor >= start && anchor <= end ? [anchor] : []
  if (!validRule(rule)) return []
  const lower = anchor > start ? anchor : start
  const upper = rule.until && rule.until < end ? rule.until : end
  if (lower > upper) return []
  const result: string[] = []
  if (rule.frequency === 'daily') {
    const firstIndex = Math.max(0, Math.ceil((dayNumber(lower) - dayNumber(anchor)) / rule.interval))
    const lastIndex = Math.floor((dayNumber(upper) - dayNumber(anchor)) / rule.interval)
    for (let index = firstIndex; index <= lastIndex && result.length < maximum; index++) result.push(addDays(anchor, index * rule.interval))
  } else if (rule.frequency === 'weekly') {
    const weekAnchor = startOfCalendarWeek(anchor)
    const weekdays = [...new Set((rule.weekdays?.length ? rule.weekdays : [parseLocalDate(anchor).getDay()])
      .filter(day => Number.isInteger(day) && day >= 0 && day <= 6))]
      .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
    const stride = 7 * rule.interval
    const firstIndex = Math.max(0, Math.floor((dayNumber(lower) - dayNumber(weekAnchor)) / stride))
    const lastIndex = Math.floor((dayNumber(upper) - dayNumber(weekAnchor)) / stride)
    if (!weekdays.length) return []
    for (let index = firstIndex; index <= lastIndex && result.length < maximum; index++) {
      for (const weekday of weekdays) {
        const date = addDays(weekAnchor, index * stride + ((weekday + 6) % 7))
        if (date >= lower && date <= upper) result.push(date)
        if (result.length === maximum) return result
      }
    }
  } else {
    const anchorMonth = Number(anchor.slice(0, 4)) * 12 + Number(anchor.slice(5, 7))
    const monthIndex = (date: string) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - anchorMonth
    const firstIndex = Math.max(0, Math.floor(monthIndex(lower) / rule.interval))
    const lastIndex = Math.floor(monthIndex(upper) / rule.interval)
    for (let index = firstIndex; index <= lastIndex && result.length < maximum; index++) {
      const date = addMonths(anchor, index * rule.interval)
      if (date >= lower && date <= upper) result.push(date)
    }
  }
  return result
}

/** Count an inclusive range arithmetically, without expanding its occurrences. */
export function recurrenceCount(task: Pick<Task, 'date' | 'recurrence'>, start: string, end: string): number {
  const anchor = task.date
  if (!anchor || !isValidDateKey(anchor) || !isValidDateKey(start) || !isValidDateKey(end) || start > end) return 0
  const rule = task.recurrence
  if (!rule) return anchor >= start && anchor <= end ? 1 : 0
  if (!validRule(rule)) return 0
  const lower = anchor > start ? anchor : start
  const upper = rule.until && rule.until < end ? rule.until : end
  if (lower > upper) return 0
  if (rule.frequency === 'daily') {
    const first = Math.ceil((dayNumber(lower) - dayNumber(anchor)) / rule.interval)
    const last = Math.floor((dayNumber(upper) - dayNumber(anchor)) / rule.interval)
    return Math.max(0, last - first + 1)
  }
  if (rule.frequency === 'weekly') {
    const weekAnchor = dayNumber(startOfCalendarWeek(anchor))
    const lowerDay = dayNumber(lower)
    const upperDay = dayNumber(upper)
    const stride = 7 * rule.interval
    const weekdays = new Set((rule.weekdays?.length ? rule.weekdays : [parseLocalDate(anchor).getDay()])
      .filter(day => Number.isInteger(day) && day >= 0 && day <= 6))
    let count = 0
    for (const weekday of weekdays) {
      const firstDay = weekAnchor + ((weekday + 6) % 7)
      const first = Math.max(0, Math.ceil((lowerDay - firstDay) / stride))
      const last = Math.floor((upperDay - firstDay) / stride)
      count += Math.max(0, last - first + 1)
    }
    return count
  }
  const monthNumber = (date: string) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7))
  const anchorMonth = monthNumber(anchor)
  let first = Math.max(0, Math.floor((monthNumber(lower) - anchorMonth) / rule.interval))
  let last = Math.floor((monthNumber(upper) - anchorMonth) / rule.interval)
  if (addMonths(anchor, first * rule.interval) < lower) first++
  if (last >= 0 && addMonths(anchor, last * rule.interval) > upper) last--
  return Math.max(0, last - first + 1)
}

function makeOccurrence(task: Task, originalDate: string | null, override?: TaskOverride): TaskOccurrence {
  const occurrence: TaskOccurrence = {
    ...task,
    date: originalDate,
    ...(task.end_date !== undefined ? { end_date: originalDate && task.date && task.end_date ? addDays(originalDate, rangeSpan(task)) : null } : {}),
    // A recurring template stays planned. Completion belongs to one override.
    status: task.recurrence || override ? 'planned' : task.status,
    taskId: task.id,
    occurrenceDate: originalDate,
    // Persisted exceptions keep their original identity even after a series edit.
    isRecurring: !!task.recurrence || !!override,
  }
  if (override) {
    if (override.patch.date !== undefined && override.patch.end_date === undefined) Object.assign(occurrence, shiftPlanDate(occurrence, override.patch.date))
    // Explicit fields keep malformed external JSON from replacing identity or recurrence.
    for (const key of ['title', 'description', 'date', 'end_date', 'manual_order', 'time', 'duration_minutes', 'auto_complete', 'priority', 'color', 'reminders', 'tags'] as const) {
      if (override.patch[key] !== undefined) (occurrence as unknown as Record<string, unknown>)[key] = override.patch[key]
    }
    if (override.status) {
      occurrence.status = override.status
      occurrence.completed_at = override.status === 'completed' ? override.completed_at ?? override.updated_at : null
    }
    occurrence.updated_at = override.updated_at
  }
  occurrence.id = `${task.id}:${originalDate ?? 'undated'}`
  return occurrence
}

function indexOverrides(overrides: readonly TaskOverride[]): Map<string, Map<string, TaskOverride>> {
  const overridesByTask = new Map<string, Map<string, TaskOverride>>()
  for (const override of overrides) {
    if (!isValidDateKey(override.occurrence_date)) continue
    let dates = overridesByTask.get(override.task_id)
    if (!dates) overridesByTask.set(override.task_id, dates = new Map())
    const existing = dates.get(override.occurrence_date)
    if (!existing || override.updated_at > existing.updated_at || (override.updated_at === existing.updated_at && override.id > existing.id)) {
      dates.set(override.occurrence_date, override)
    }
  }
  return overridesByTask
}

function uniqueTasks(tasks: readonly Task[]): Task[] {
  const result = new Map<string, Task>()
  for (const task of tasks) {
    const previous = result.get(task.id)
    if (!previous || task.updated_at >= previous.updated_at) result.set(task.id, task)
  }
  return [...result.values()]
}

/**
 * Include undated tasks for list views; calendar callers group only non-null dates.
 * Sparse exceptions survive series edits and moves outside their original range.
 * The original date remains the stable completion/edit/delete identity.
 */
export function expandTasks(tasks: readonly Task[], overrides: readonly TaskOverride[], start: string, end: string): TaskOccurrence[] {
  if (!isValidDateKey(start) || !isValidDateKey(end) || start > end) return []
  const overridesByTask = indexOverrides(overrides)
  const result = new Map<string, TaskOccurrence>()
  for (const task of uniqueTasks(tasks)) {
    const exceptions = overridesByTask.get(task.id)
    const dates = new Set<string | null>(task.date ? task.recurrence
      ? recurrenceDates(task, rangeLowerBound(start, rangeSpan(task)), end)
      : overlapsRange(task, start, end) ? [task.date] : [] : [null])
    if (exceptions) {
      for (const [originalDate, override] of exceptions) {
        const effective = makeOccurrence(task, originalDate, override)
        // A series edit must never erase already-saved completion or edit history.
        if (effective.date === null || overlapsRange(effective, start, end)) dates.add(originalDate)
      }
    }
    for (const date of dates) {
      const override = date ? exceptions?.get(date) : undefined
      if (override?.deleted) continue
      const occurrence = makeOccurrence(task, date, override)
      if (occurrence.date !== null && !overlapsRange(occurrence, start, end)) continue
      result.set(occurrence.id, occurrence)
    }
  }
  return [...result.values()]
}

export function occurrenceDateTime(occurrence: Pick<TaskOccurrence, 'date' | 'time'>, fallbackTime = DATE_ONLY_REMINDER_TIME): Date | null {
  if (!occurrence.date || !isValidDateKey(occurrence.date)) return null
  const time = occurrence.time || fallbackTime
  if (!isValidTime(time)) return null
  const date = parseLocalDate(occurrence.date)
  const [hours, minutes] = time.split(':').map(Number)
  // Native local components handle DST gaps using the first valid local instant.
  date.setHours(hours, minutes, 0, 0)
  return date
}

export function isOverdue(occurrence: Pick<TaskOccurrence, 'date' | 'end_date' | 'time' | 'status'>, now = new Date()): boolean {
  if (occurrence.status === 'completed' || !occurrence.date || !isValidDateKey(occurrence.date)) return false
  const date = occurrence.end_date && isValidDateKey(occurrence.end_date) && occurrence.end_date >= occurrence.date ? occurrence.end_date : occurrence.date
  if (!occurrence.time) return date < localDateKey(now)
  const dueAt = occurrenceDateTime({ ...occurrence, date })
  return dueAt !== null && dueAt.getTime() < now.getTime()
}

/** Duration extends the civil clock, including midnight and local DST changes. */
export function occurrenceEndTime(occurrence: Pick<TaskOccurrence, 'date' | 'end_date' | 'time' | 'duration_minutes'>): Date | null {
  if (!occurrence.date || !isValidDateKey(occurrence.date) || !isValidTime(occurrence.time)) return null
  const duration = occurrence.duration_minutes ?? 0
  if (!Number.isSafeInteger(duration) || duration < 0 || duration > 10080) return null
  const end = parseLocalDate(occurrence.end_date && isValidDateKey(occurrence.end_date) && occurrence.end_date >= occurrence.date ? occurrence.end_date : occurrence.date)
  const [hours, minutes] = occurrence.time.split(':').map(Number)
  // Add duration before resolving the local instant, matching the displayed
  // civil end time and PostgreSQL even when the start falls in a DST gap.
  end.setHours(hours, minutes + duration, 0, 0)
  // PostgreSQL resolves a repeated wall-clock time to its later occurrence.
  // Match that conservative choice so the client and atomic RPC agree.
  const tomorrow = new Date(end.getTime() + DAY_MS)
  const repeatedMinutes = tomorrow.getTimezoneOffset() - end.getTimezoneOffset()
  if (repeatedMinutes > 0) {
    const later = new Date(end.getTime() + repeatedMinutes * 60_000)
    if (localDateKey(later) === localDateKey(end) && later.getHours() === end.getHours() && later.getMinutes() === end.getMinutes()) return later
  }
  return end
}

export function shouldAutoComplete(occurrence: TaskOccurrence, now = new Date()): boolean {
  if (!occurrence.auto_complete || occurrence.status !== 'planned') return false
  const end = occurrenceEndTime(occurrence)
  return end !== null && end.getTime() <= now.getTime()
}

/** Bounded catch-up: only due candidates, never an unbounded future series. */
export function selectAutoCompleteCandidates(tasks: readonly Task[], overrides: readonly TaskOverride[], now = new Date(), limit = 8): TaskOccurrence[] {
  const maximum = Math.max(0, Math.min(64, Math.floor(limit)))
  if (!maximum) return []
  const today = localDateKey(now)
  const indexed = indexOverrides(overrides)
  const candidates: TaskOccurrence[] = []
  for (const task of uniqueTasks(tasks)) {
    const exceptions = indexed.get(task.id)
    if (task.auto_complete && task.time && task.date) {
      if (task.recurrence) {
        const dates = recurrenceDates(task, task.date, today, maximum + (exceptions?.size ?? 0))
        let added = 0
        for (const date of dates) {
          if (exceptions?.has(date)) continue
          const occurrence = makeOccurrence(task, date)
          if (shouldAutoComplete(occurrence, now)) { candidates.push(occurrence); if (++added >= maximum) break }
        }
      } else if (!exceptions?.has(task.date)) {
        const occurrence = makeOccurrence(task, task.date)
        if (shouldAutoComplete(occurrence, now)) candidates.push(occurrence)
      }
    }
    for (const [date, override] of exceptions ?? []) {
      if (override.deleted) continue
      const occurrence = makeOccurrence(task, date, override)
      if (shouldAutoComplete(occurrence, now)) candidates.push(occurrence)
    }
  }
  return candidates.sort((a, b) => occurrenceEndTime(a)!.getTime() - occurrenceEndTime(b)!.getTime() || a.id.localeCompare(b.id)).slice(0, maximum)
}

export function sortOccurrences(occurrences: readonly TaskOccurrence[], now = new Date()): TaskOccurrence[] {
  const priorityRank = { high: 0, medium: 1, low: 2, none: 3 }
  const rank = (task: TaskOccurrence) => task.status === 'completed' ? 3 : isOverdue(task, now) ? 0 : task.time && task.date ? 1 : 2
  const manual = (value?: number | null) => typeof value === 'number' && Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER
  return [...occurrences].sort((a, b) => {
    const completed = Number(a.status === 'completed') - Number(b.status === 'completed')
    if (completed) return completed
    if (a.status === 'completed') return (Date.parse(b.completed_at ?? b.updated_at) || 0) - (Date.parse(a.completed_at ?? a.updated_at) || 0) || a.id.localeCompare(b.id)
    return priorityRank[a.priority] - priorityRank[b.priority]
    || manual(a.manual_order) - manual(b.manual_order)
    || rank(a) - rank(b)
    || (a.date ?? '9999-12-31').localeCompare(b.date ?? '9999-12-31')
    || (a.time ?? '23:59').localeCompare(b.time ?? '23:59')
    || a.created_at.localeCompare(b.created_at)
    || a.id.localeCompare(b.id)
  })
}

/** Select the representative day from where the target week sits relative to today. */
export function selectAdjacentWeek(selected: string, delta: number, today = localDateKey()): string {
  const target = addDays(startOfCalendarWeek(selected), delta * 7)
  const current = startOfCalendarWeek(today)
  if (target === current) return today
  return target > current ? target : addDays(target, 6)
}

/** Select the representative day from where the target month sits relative to today. */
export function selectAdjacentMonth(selected: string, delta: number, today = localDateKey()): string {
  const target = startOfMonth(addMonths(startOfMonth(selected), delta))
  const current = startOfMonth(today)
  if (target === current) return today
  return target > current ? target : endOfMonth(target)
}

export type CalendarMarkerState = 'active' | 'inactive'

/**
 * A range leaves muted history behind, marks only its current day while it is
 * running, and keeps one active overdue marker on its final day afterwards.
 */
export function calendarMarkerState(task: TaskOccurrence, date: string, today: string): CalendarMarkerState | null {
  if (!occursOnDate(task, date)) return null
  if (task.status === 'completed' || !task.end_date || task.end_date === task.date) return 'active'
  if (task.end_date < today) return date === task.end_date ? 'active' : 'inactive'
  if (date < today) return 'inactive'
  return date === today ? 'active' : null
}

/** Backwards-compatible active-only query for calendar behavior tests. */
export function hasActiveCalendarMarker(task: TaskOccurrence, date: string, today: string): boolean {
  return calendarMarkerState(task, date, today) === 'active'
}

export interface PlannerTaskCounts {
  today: number
  overdue: number
  completed: number
  upcoming: number
}

function recurringOverdueCount(task: Task, now: Date): number {
  const today = localDateKey(now)
  const lastStart = rangeLowerBound(today, rangeSpan(task))
  const past = lastStart === '0001-01-01' ? 0 : recurrenceCount(task, '0001-01-01', addDays(lastStart, -1))
  return past + (isOverdue(makeOccurrence(task, lastStart), now) ? recurrenceCount(task, lastStart, lastStart) : 0)
}

/**
 * Today, overdue and completed include all history. Only virtual future repeats
 * are capped by futureEnd; already-saved one-off plans remain countable anywhere.
 * Sparse exceptions adjust the arithmetic base once, including old series rules.
 */
export function countPlannerTasks(tasks: readonly Task[], overrides: readonly TaskOverride[], now = new Date(), futureEnd = addDays(localDateKey(now), 90)): PlannerTaskCounts {
  const counts: PlannerTaskCounts = { today: 0, overdue: 0, completed: 0, upcoming: 0 }
  const today = localDateKey(now)
  const overridesByTask = indexOverrides(overrides)
  const adjust = (occurrence: TaskOccurrence, amount: number) => {
    if (occurrence.date !== null && !isValidDateKey(occurrence.date)) return
    if (occurrence.status === 'completed') counts.completed += amount
    else {
      if (occursOnDate(occurrence, today)) counts.today += amount
      if (isOverdue(occurrence, now)) counts.overdue += amount
      if (occurrence.date && occurrence.date > today && (!occurrence.isRecurring || occurrence.date <= futureEnd)) counts.upcoming += amount
    }
  }
  for (const task of uniqueTasks(tasks)) {
    if (task.recurrence) {
      counts.today += recurrenceCount(task, rangeLowerBound(today, rangeSpan(task)), today)
      counts.overdue += recurringOverdueCount(task, now)
      counts.upcoming += recurrenceCount(task, addDays(today, 1), futureEnd)
    } else adjust(makeOccurrence(task, task.date), 1)
    for (const [originalDate, override] of overridesByTask.get(task.id) ?? []) {
      if (recurrenceCount(task, originalDate, originalDate)) adjust(makeOccurrence(task, originalDate), -1)
      if (!override.deleted) adjust(makeOccurrence(task, originalDate, override), 1)
    }
  }
  return counts
}

export interface PlannerHistoryOptions {
  kind: 'overdue' | 'completed'
  limit?: number
  query?: string
  now?: Date
  priority?: TaskPriority
  remindersOnly?: boolean
  recurringOnly?: boolean
}

/**
 * Exact history totals with a bounded first page. A century-old daily series
 * needs only the requested rows plus its persisted exceptions, never 100 years
 * of virtual objects. Increasing limit reveals more results in the same order.
 */
export function selectPlannerHistory(tasks: readonly Task[], overrides: readonly TaskOverride[], options: PlannerHistoryOptions): { items: TaskOccurrence[]; total: number; hasMore: boolean } {
  const now = options.now ?? new Date()
  const limit = options.limit === undefined ? 60 : Math.max(0, Number.isFinite(options.limit) ? Math.floor(options.limit) : 60)
  const query = (options.query ?? '').trim().toLocaleLowerCase('uk-UA')
  const matches = (occurrence: TaskOccurrence) => (!options.priority || occurrence.priority === options.priority)
    && (!options.remindersOnly || occurrence.reminders.length > 0)
    && (!options.recurringOnly || occurrence.isRecurring)
    && (!query || `${occurrence.title} ${occurrence.description ?? ''} ${(occurrence.tags ?? []).join(' ')}`.toLocaleLowerCase('uk-UA').includes(query))
  const inHistory = (occurrence: TaskOccurrence) => (occurrence.date === null || isValidDateKey(occurrence.date))
    && (options.kind === 'completed' ? occurrence.status === 'completed' : isOverdue(occurrence, now))
  const overridesByTask = indexOverrides(overrides)
  const candidates: TaskOccurrence[] = []
  let total = 0
  for (const task of uniqueTasks(tasks)) {
    const exceptions = overridesByTask.get(task.id)
    const base = makeOccurrence(task, task.date)
    const baseMatches = matches(base)
    if (baseMatches) {
      total += task.recurrence
        ? options.kind === 'overdue' ? recurringOverdueCount(task, now) : 0
        : Number(inHistory(base))
      if (limit && task.recurrence && task.date && options.kind === 'overdue') {
        const today = localDateKey(now)
        const lastStart = rangeLowerBound(today, rangeSpan(task))
        const end = isOverdue(makeOccurrence(task, lastStart), now) ? lastStart : lastStart === '0001-01-01' ? lastStart : addDays(lastStart, -1)
        const dates = recurrenceDates(task, task.date, end, limit + (exceptions?.size ?? 0))
        let added = 0
        for (const date of dates) {
          if (exceptions?.has(date)) continue
          const occurrence = makeOccurrence(task, date)
          if (!inHistory(occurrence)) continue
          candidates.push(occurrence)
          if (++added === limit) break
        }
      } else if (limit && !task.recurrence && !(task.date && exceptions?.has(task.date)) && inHistory(base)) candidates.push(base)
    }
    for (const [originalDate, override] of exceptions ?? []) {
      if (baseMatches && recurrenceCount(task, originalDate, originalDate) && inHistory(makeOccurrence(task, originalDate))) total--
      if (override.deleted) continue
      const occurrence = makeOccurrence(task, originalDate, override)
      if (matches(occurrence) && inHistory(occurrence)) {
        total++
        if (limit) candidates.push(occurrence)
      }
    }
  }
  const items = sortOccurrences(candidates, now).slice(0, limit)
  return { items, total, hasMore: total > items.length }
}

export function reminderDueAt(occurrence: Pick<TaskOccurrence, 'date' | 'time'>, minutesBefore: number): Date | null {
  const scheduledAt = occurrenceDateTime(occurrence)
  if (!scheduledAt || !Number.isFinite(minutesBefore) || minutesBefore < 0) return null
  return new Date(scheduledAt.getTime() - minutesBefore * 60_000)
}

export function reminderEvents(occurrence: TaskOccurrence): TaskReminderEvent[] {
  if (occurrence.status === 'completed') return []
  return [...new Set(occurrence.reminders)].flatMap(minutesBefore => {
    const dueAt = reminderDueAt(occurrence, minutesBefore)
    // A moved occurrence has a new due instant, so old delivery receipts do not suppress it.
    return dueAt ? [{ id: `${occurrence.id}:${minutesBefore}:${dueAt.getTime()}`, occurrence, minutesBefore, dueAt }] : []
  }).sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())
}

export function recurrenceLabel(rule: TaskRecurrence | null): string {
  if (!rule) return 'Не повторюється'
  if (rule.frequency === 'daily') return rule.interval === 1 ? 'Щодня' : `Кожні ${rule.interval} дн.`
  if (rule.frequency === 'monthly') return rule.interval === 1 ? 'Щомісяця' : `Кожні ${rule.interval} міс.`
  const base = rule.interval === 1 ? 'Щотижня' : `Кожні ${rule.interval} тиж.`
  const names = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']
  return rule.weekdays?.length ? `${base} · ${[...new Set(rule.weekdays)].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map(day => names[day]).join(', ')}` : base
}
