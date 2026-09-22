import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useAuth } from './AuthContext'
import { InlineDraftProvider } from '../hooks/useInlineDraft'
import { useSupabaseTable } from '../hooks/useSupabaseTable'
import { supabase } from '../lib/supabase'
import { addDays, recurrenceDates } from '../lib/planner'
import type { Task, TaskInput, TaskOccurrence, TaskOverride, TaskRecurrence } from '../types/planner'
import type { PlannerConversionResult } from '../lib/plannerConversion'

const isValidDateKey = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
const shiftPlanDate = (task: Pick<Task, 'date' | 'end_date'>, date: string | null): Pick<Task, 'date' | 'end_date'> => {
  if (!date) return { date: null, end_date: null }
  if (!task.date || !task.end_date || !isValidDateKey(task.date) || !isValidDateKey(task.end_date)) return { date, end_date: null }
  const span = Math.round((Date.parse(`${task.end_date}T12:00:00Z`) - Date.parse(`${task.date}T12:00:00Z`)) / 86400000)
  return { date, end_date: addDays(date, Math.max(0, span)) }
}

type StoredTask = Omit<Task, 'status' | 'recurrence'> & {
  status: 'planned' | 'in_progress' | 'done' | 'postponed'
  recurrence: 'none' | 'daily' | 'weekly' | 'monthly'
  recurrence_rule?: TaskRecurrence | null
  due_at?: string | null
  date_initialized?: boolean
}
type CreateTaskInput = TaskInput & { id?: string }

interface PlannerContextValue {
  tasks: Task[]
  overrides: TaskOverride[]
  loading: boolean
  busy: boolean
  error: string | null
  refresh: () => Promise<void>
  acceptConversion: (result: PlannerConversionResult) => void
  reorderOccurrences: (ordered: readonly TaskOccurrence[]) => Promise<void>
  createTask: (input: CreateTaskInput) => Promise<Task>
  updateTask: (id: string, patch: Partial<TaskInput>, expectedUpdatedAt?: string) => Promise<Task>
  saveOccurrence: (occurrence: TaskOccurrence, patch: Partial<TaskInput>) => Promise<void>
  toggleOccurrence: (occurrence: TaskOccurrence) => Promise<void>
  autoCompleteOccurrence: (occurrence: TaskOccurrence) => Promise<void>
  deleteOccurrence: (occurrence: TaskOccurrence) => Promise<void>
  deleteTask: (id: string, expectedUpdatedAt?: string) => Promise<void>
}

const PlannerContext = createContext<PlannerContextValue | undefined>(undefined)
const EDITABLE_KEYS = ['title', 'description', 'date', 'end_date', 'manual_order', 'time', 'duration_minutes', 'auto_complete', 'priority', 'color', 'reminders', 'tags'] as const

type ConfirmedRows = {
  tasks: Map<string, StoredTask>
  overrides: Map<string, TaskOverride>
  deletedTasks: Map<string, string>
}

function mergeConfirmed<T extends { id: string; updated_at: string }>(rows: T[], confirmed: Map<string, T>): T[] {
  const merged = new Map(rows.map(row => [row.id, row]))
  for (const [id, row] of confirmed) {
    const fetched = merged.get(id)
    if (!fetched || fetched.updated_at <= row.updated_at) merged.set(id, row)
  }
  return [...merged.values()]
}

function localLegacyDate(value?: string | null) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/** Keep the original due_at/recurrence columns intact. Old instants are interpreted
 * in the user's local zone once; new civil dates never make a UTC round trip. */
function normalizeTask(row: StoredTask): Task {
  const legacyDate = !row.date_initialized ? localLegacyDate(row.due_at) : null
  const date = row.date ?? (legacyDate
    ? `${legacyDate.getFullYear()}-${String(legacyDate.getMonth() + 1).padStart(2, '0')}-${String(legacyDate.getDate()).padStart(2, '0')}`
    : null)
  return {
    id: row.id,
    user_id: row.user_id,
    title: row.title,
    description: row.description ?? '',
    date,
    ...(row.end_date !== undefined ? { end_date: row.end_date } : {}),
    ...(row.manual_order !== undefined ? { manual_order: row.manual_order } : {}),
    time: row.time?.slice(0, 5) ?? (legacyDate
      ? `${String(legacyDate.getHours()).padStart(2, '0')}:${String(legacyDate.getMinutes()).padStart(2, '0')}`
      : null),
    duration_minutes: row.duration_minutes ?? null,
    ...(typeof row.auto_complete === 'boolean' ? { auto_complete: row.auto_complete } : {}),
    status: row.status === 'done' ? 'completed' : 'planned',
    completed_at: row.completed_at ?? null,
    priority: row.priority,
    color: row.color ?? '#0E8F6E',
    tags: row.tags ?? [],
    reminders: row.reminders ?? [],
    recurrence: row.recurrence_rule ?? (!row.date_initialized && date && row.recurrence !== 'none'
      ? { frequency: row.recurrence, interval: 1, until: null }
      : null),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

function friendlyError(error: unknown): string {
  const message = typeof error === 'string' ? error : error && typeof error === 'object' && 'message' in error
    ? String(error.message) : 'Не вдалося зберегти плани. Спробуйте ще раз.'
  if (/auto_complete|auto_complete_planner_occurrence/i.test(message)) return 'Автоматичне виконання ще не підключене. Потрібне оновлення застосунку на сервері; звичайні плани можна зберігати без цієї опції.'
  if (/schema cache|does not exist|could not find|date_initialized|recurrence_rule/i.test(message)) {
    return 'Оновлення планів ще не підключене до бази даних. Зверніться до адміністратора застосунку та повторіть спробу.'
  }
  if (/fetch|network|offline|load failed/i.test(message)) return 'Немає зв’язку з сервером. Перевірте інтернет і повторіть спробу — зміни ще не підтверджені.'
  if (/row-level security|permission denied|jwt|not authenticated/i.test(message)) return 'Сесія завершилася або немає доступу до планів. Увійдіть у застосунок повторно.'
  if (/violates check constraint|invalid input syntax|invalid occurrence patch|invalid task|invalid status|invalid completion date|not an occurrence/i.test(message)) return 'Перевірте дату, час, назву та налаштування повторення плану.'
  if (/task not found/i.test(message)) return 'План уже змінено або видалено. Оновіть плани.'
  return message
}

function friendlyLoadError(error: unknown): string {
  const message = friendlyError(error)
  if (/Сесія завершилася|немає доступу до планів/i.test(message)) return 'Сесію не вдалося відновити. Увійдіть повторно.'
  if (/Немає зв’язку з сервером/i.test(message)) return 'Не вдалося завантажити плани.'
  return message
}

function inputFromTask(task: Task): TaskInput {
  return {
    title: task.title, description: task.description, date: task.date, time: task.time,
    ...(task.end_date !== undefined ? { end_date: task.end_date } : {}),
    ...(task.manual_order !== undefined ? { manual_order: task.manual_order } : {}),
    duration_minutes: task.duration_minutes, status: task.status, priority: task.priority,
    ...(typeof task.auto_complete === 'boolean' ? { auto_complete: task.auto_complete } : {}),
    color: task.color, reminders: task.reminders, recurrence: task.recurrence, tags: task.tags ?? [],
  }
}

function cleanInput(input: TaskInput): TaskInput {
  const result = { ...input, title: input.title.trim(), description: input.description?.trim() ?? null, reminders: [...new Set(input.reminders)].sort((a, b) => b - a) }
  result.tags = [...new Set((input.tags ?? []).map(tag => tag.trim()).filter(Boolean))]
  if (result.tags.length > 20 || result.tags.some(tag => tag.length > 40)) throw new Error('Додайте до 20 міток довжиною до 40 символів.')
  if (!result.title) throw new Error('Вкажіть назву плану.')
  if (result.date && !isValidDateKey(result.date)) throw new Error('Вкажіть коректну дату.')
  if (result.end_date && (!result.date || !isValidDateKey(result.end_date) || result.end_date < result.date)) throw new Error('Кінцева дата має бути не раніше початкової.')
  if (result.manual_order != null && (!Number.isFinite(result.manual_order) || Math.abs(result.manual_order) > 1e12)) throw new Error('Некоректний порядок планів.')
  if (!result.date) {
    result.time = null
    result.reminders = []
    if (result.end_date !== undefined) result.end_date = null
    if (result.recurrence) throw new Error('Для повторення вкажіть дату початку.')
  }
  if ((!result.date || !result.time) && result.auto_complete) result.auto_complete = false
  return result
}

export function PlannerProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const taskTable = useSupabaseTable<StoredTask>('tasks', { orderBy: 'created_at', ascending: false, pageSize: 500, recoverSession: true, retryTransient: true, refreshOnFocus: true })
  const overrideTable = useSupabaseTable<TaskOverride>('task_overrides', { orderBy: 'occurrence_date', pageSize: 500, recoverSession: true, retryTransient: true, refreshOnFocus: true })
  const ownerRef = useRef(user?.id)
  ownerRef.current = user?.id
  const mountedRef = useRef(true)
  const [busyOwner, setBusyOwner] = useState<string | null>(null)
  // These are acknowledged database results, never optimistic guesses. Keep
  // them visible even if the following read fails or returns an older snapshot.
  const [confirmed, setConfirmed] = useState<ConfirmedRows>(() => ({ tasks: new Map(), overrides: new Map(), deletedTasks: new Map() }))
  const inFlightRef = useRef<{ owner: string; key: string; promise: Promise<unknown> } | null>(null)
  const failedCreateIds = useRef(new Map<string, string>())

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])
  useEffect(() => {
    setBusyOwner(null)
    failedCreateIds.current.clear()
    setConfirmed({ tasks: new Map(), overrides: new Map(), deletedTasks: new Map() })
  }, [user?.id])

  const rememberTask = useCallback((row: StoredTask) => {
    if (mountedRef.current && ownerRef.current === row.user_id) setConfirmed(previous => ({ ...previous, tasks: new Map(previous.tasks).set(row.id, row) }))
    return normalizeTask(row)
  }, [])
  const rememberOverride = useCallback((row: TaskOverride) => {
    if (mountedRef.current && ownerRef.current === row.user_id) setConfirmed(previous => ({ ...previous, overrides: new Map(previous.overrides).set(row.id, row) }))
  }, [])
  const rememberDeletion = useCallback((id: string, owner: string) => {
    if (mountedRef.current && ownerRef.current === owner) setConfirmed(previous => ({ ...previous, deletedTasks: new Map(previous.deletedTasks).set(id, owner) }))
  }, [])
  const acceptConversion = useCallback((result: PlannerConversionResult) => {
    const owner = result.task?.user_id ?? result.entry?.user_id
    if (!owner || !mountedRef.current || ownerRef.current !== owner) return
    setConfirmed(previous => {
      const next = { tasks: new Map(previous.tasks), overrides: new Map(previous.overrides), deletedTasks: new Map(previous.deletedTasks) }
      if (result.sourceKind === 'plan' && result.sourceRemoved) {
        next.tasks.delete(result.sourceId)
        next.deletedTasks.set(result.sourceId, owner)
        for (const [id, row] of next.overrides) if (row.task_id === result.sourceId) next.overrides.delete(id)
      }
      if (result.task?.user_id === owner) {
        next.deletedTasks.delete(result.task.id)
        next.tasks.set(result.task.id, result.task)
      }
      for (const row of [...(result.overrides ?? []), ...(result.override ? [result.override] : [])]) {
        if (row.user_id === owner) next.overrides.set(row.id, row)
      }
      return next
    })
  }, [])
  useEffect(() => {
    // Drop acknowledgements only after a newly fetched snapshot contains them;
    // later external edits/deletes can then flow through normally.
    setConfirmed(previous => {
      const nextTasks = new Map(previous.tasks)
      const nextDeleted = new Map(previous.deletedTasks)
      const fetched = new Map(taskTable.data.map(row => [row.id, row]))
      for (const [id, row] of nextTasks) if (fetched.get(id)?.updated_at && fetched.get(id)!.updated_at >= row.updated_at) nextTasks.delete(id)
      for (const [id, owner] of nextDeleted) if (owner === ownerRef.current && !fetched.has(id)) nextDeleted.delete(id)
      return nextTasks.size === previous.tasks.size && nextDeleted.size === previous.deletedTasks.size
        ? previous : { ...previous, tasks: nextTasks, deletedTasks: nextDeleted }
    })
  }, [taskTable.data])
  useEffect(() => {
    setConfirmed(previous => {
      const next = new Map(previous.overrides)
      const fetched = new Map(overrideTable.data.map(row => [`${row.task_id}:${row.occurrence_date}`, row]))
      for (const [id, row] of next) {
        const actual = fetched.get(`${row.task_id}:${row.occurrence_date}`)
        if (actual && actual.updated_at >= row.updated_at) next.delete(id)
      }
      return next.size === previous.overrides.size ? previous : { ...previous, overrides: next }
    })
  }, [overrideTable.data])

  // Filter synchronously on account switches: the shared hook resets its cache in
  // an effect, so its previous account's rows must never be painted in between.
  const storedTasks = useMemo(() => mergeConfirmed(taskTable.data, confirmed.tasks)
    .filter(row => row.user_id === user?.id && confirmed.deletedTasks.get(row.id) !== user?.id), [taskTable.data, confirmed, user?.id])
  const tasks = useMemo(() => storedTasks.map(normalizeTask), [storedTasks])
  const overrides = useMemo(() => {
    const rows = mergeConfirmed(overrideTable.data, confirmed.overrides)
      .filter(row => row.user_id === user?.id && confirmed.deletedTasks.get(row.task_id) !== user?.id)
    const byOccurrence = new Map<string, TaskOverride>()
    for (const row of rows) {
      const key = `${row.task_id}:${row.occurrence_date}`
      const existing = byOccurrence.get(key)
      if (!existing || existing.updated_at < row.updated_at ||
        (existing.updated_at === row.updated_at && existing.id.startsWith('created:'))) byOccurrence.set(key, row)
    }
    const saved = [...byOccurrence.values()]
    const actualKeys = new Set(saved.map(row => `${row.task_id}:${row.occurrence_date}`))
    const legacy: TaskOverride[] = []
    for (const row of storedTasks) {
      if (row.user_id !== user?.id || row.date_initialized || row.status !== 'done') continue
      const task = normalizeTask(row)
      if (!task.recurrence || !task.date || actualKeys.has(`${task.id}:${task.date}`)) continue
      legacy.push({
        id: `legacy:${task.id}`, user_id: row.user_id, task_id: task.id,
        occurrence_date: task.date, patch: {}, status: 'completed', deleted: false,
        created_at: row.created_at, updated_at: row.updated_at,
      })
    }
    return [...saved, ...legacy]
  }, [overrideTable.data, storedTasks, confirmed, user?.id])
  const taskMap = useMemo(() => new Map(tasks.map(task => [task.id, task])), [tasks])
  const refresh = useCallback(async () => {
    await Promise.all([taskTable.refresh(), overrideTable.refresh()])
  }, [taskTable.refresh, overrideTable.refresh])

  const mutate = useCallback(<T,>(key: string, operation: (owner: string) => Promise<T>): Promise<T> => {
    const owner = ownerRef.current
    if (!owner) return Promise.reject(new Error('Увійдіть у застосунок, щоб зберегти плани.'))
    const active = inFlightRef.current
    if (active?.owner === owner) {
      if (active.key === key) return active.promise as Promise<T>
      return Promise.reject(new Error('Зачекайте, попередня зміна ще зберігається.'))
    }
    setBusyOwner(owner)
    const promise = Promise.resolve().then(() => operation(owner)).then(async result => {
      if (ownerRef.current !== owner || !mountedRef.current) throw new Error('Обліковий запис змінився. Оновіть плани перед наступною дією.')
      await Promise.all([taskTable.refresh(), overrideTable.refresh()])
      return result
    }).catch(error => {
      const message = friendlyError(error)
      throw new Error(message)
    }).finally(() => {
      if (inFlightRef.current?.promise === promise) inFlightRef.current = null
      if (mountedRef.current && ownerRef.current === owner) setBusyOwner(null)
    })
    inFlightRef.current = { owner, key, promise }
    return promise
  }, [taskTable.refresh, overrideTable.refresh])

  const createTask = useCallback((input: CreateTaskInput) => {
    const { id: requestedId, ...taskInput } = input
    const values = cleanInput(taskInput)
    // Old schemas accept every ordinary plan; only opting in needs migration 0010.
    if (!values.auto_complete) delete values.auto_complete
    if (values.end_date == null) delete values.end_date
    if (values.manual_order == null) delete values.manual_order
    const fingerprint = JSON.stringify(values)
    const id = requestedId ?? failedCreateIds.current.get(fingerprint) ?? crypto.randomUUID()
    const completionDate = values.recurrence && values.status === 'completed' && values.date
      ? recurrenceDates(values, values.date, addDays(values.date, values.recurrence.frequency === 'weekly' ? values.recurrence.interval * 7 + 7 : 1))[0]
      : null
    if (values.recurrence && values.status === 'completed' && !completionDate) {
      throw new Error('До кінцевої дати немає повторень. Перевірте вибрані дні та дату завершення серії.')
    }
    failedCreateIds.current.set(fingerprint, id)
    return mutate(`create:${id}`, async owner => {
      // The RPC uses this client UUID as an idempotency key, including after a
      // lost response. Initial completion of a recurring task is transactional.
      const { data, error } = await supabase.rpc('create_planner_task', {
        p_id: id, p_task: values, p_user_id: owner, p_completion_date: completionDate,
      })
      if (error) {
        if (values.auto_complete && /Invalid task|schema cache|does not exist|could not find/i.test(error.message)) throw new Error('auto_complete: migration 0010 required')
        throw error
      }
      failedCreateIds.current.delete(fingerprint)
      const saved = rememberTask(data as StoredTask)
      if (completionDate && saved.recurrence) {
        // The create RPC saved this exception in the same transaction. Its
        // natural key keeps it singular when the next read returns its UUID.
        rememberOverride({ id: `created:${saved.id}:${completionDate}`, user_id: owner, task_id: saved.id,
          occurrence_date: completionDate, patch: {}, status: 'completed', deleted: false,
          created_at: saved.created_at, updated_at: saved.created_at })
      }
      return saved
    })
  }, [mutate, rememberTask, rememberOverride])

  const writeTask = useCallback(async (id: string, patch: Partial<TaskInput>, owner: string, expectedUpdatedAt?: string) => {
    const task = taskMap.get(id)
    if (!task || task.user_id !== owner) throw new Error('План не знайдено. Оновіть плани.')
    const shifted = patch.date !== undefined && patch.end_date === undefined ? shiftPlanDate(task, patch.date) : {}
    const values = cleanInput({ ...inputFromTask(task), ...shifted, ...patch })
    // A manual undo must remain active instead of completing again on the next tick.
    if (task.status === 'completed' && patch.status === 'planned' && task.auto_complete) values.auto_complete = false
    if (!task.auto_complete && !values.auto_complete) delete values.auto_complete
    // Preserve the completion represented by a legacy recurring row before the
    // first explicit edit switches that row to civil-date storage.
    const legacyCompletion = overrides.find(row => row.id === `legacy:${id}`)
    if (legacyCompletion) {
      const { data, error } = await supabase.rpc('save_planner_occurrence', {
        p_task_id: id, p_occurrence_date: legacyCompletion.occurrence_date,
        p_patch: {}, p_status: 'completed', p_deleted: null, p_user_id: owner,
      })
      if (error) throw error
      rememberOverride(data as TaskOverride)
    }
    // A series always remains planned; completion belongs to a dated exception.
    const { recurrence, status, ...fields } = values
    const { data, error } = await supabase.from('tasks').update({
      ...fields,
      status: recurrence ? 'planned' : status === 'completed' ? 'done' : 'planned',
      recurrence: recurrence?.frequency ?? 'none',
      recurrence_rule: recurrence,
      date_initialized: true,
    }).eq('id', id).eq('user_id', owner).eq('updated_at', expectedUpdatedAt ?? task.updated_at).select().single()
    if (error?.code === 'PGRST116') throw new Error('Цей план вже змінили в іншому вікні. Оновіть плани та повторіть редагування.')
    if (error) throw error
    return rememberTask(data as StoredTask)
  }, [taskMap, overrides, rememberTask, rememberOverride])

  const updateTask = useCallback((id: string, patch: Partial<TaskInput>, expectedUpdatedAt?: string) => mutate(`task:${id}`, owner => writeTask(id, patch, owner, expectedUpdatedAt)), [mutate, writeTask])

  const writeOccurrence = useCallback(async (occurrence: TaskOccurrence, patch: Partial<TaskInput>, deleted?: boolean) => {
    if (!occurrence.occurrenceDate) throw new Error('Для цього повторення не вказано дату.')
    const shifted = patch.date !== undefined && patch.end_date === undefined ? shiftPlanDate(occurrence, patch.date) : {}
    const changes = { ...shifted, ...patch }
    const occurrencePatch = Object.fromEntries(EDITABLE_KEYS.filter(key => Object.prototype.hasOwnProperty.call(changes, key)).map(key => [key, changes[key]]))
    if (occurrence.status === 'completed' && patch.status === 'planned' && occurrence.auto_complete) occurrencePatch.auto_complete = false
    if ((patch.date === null || patch.time === null) && occurrence.auto_complete) occurrencePatch.auto_complete = false
    if (!occurrence.auto_complete && !occurrencePatch.auto_complete) delete occurrencePatch.auto_complete
    const { data, error } = await supabase.rpc('save_planner_occurrence', {
      p_task_id: occurrence.taskId,
      p_occurrence_date: occurrence.occurrenceDate,
      p_patch: occurrencePatch,
      p_status: patch.status ?? null,
      p_deleted: deleted ?? null,
      p_user_id: occurrence.user_id,
    })
    if (error) {
      if (occurrencePatch.auto_complete && /Invalid occurrence patch|schema cache|does not exist|could not find/i.test(error.message)) throw new Error('auto_complete: migration 0010 required')
      throw error
    }
    rememberOverride(data as TaskOverride)
  }, [rememberOverride])

  const saveOccurrence = useCallback((occurrence: TaskOccurrence, patch: Partial<TaskInput>) => mutate(`occurrence:${occurrence.id}`, async owner => {
    if (occurrence.user_id !== owner) throw new Error('Немає доступу до цього плану.')
    if (occurrence.isRecurring) await writeOccurrence(occurrence, patch)
    else await writeTask(occurrence.taskId, patch, owner, occurrence.updated_at)
  }), [mutate, writeOccurrence, writeTask])

  const toggleOccurrence = useCallback((occurrence: TaskOccurrence) => saveOccurrence(occurrence, {
    status: occurrence.status === 'completed' ? 'planned' : 'completed',
    ...(occurrence.status === 'completed' && occurrence.auto_complete ? { auto_complete: false } : {}),
  }), [saveOccurrence])

  const reorderOccurrences = useCallback((ordered: readonly TaskOccurrence[]) => {
    if (ordered.length < 2) return Promise.resolve()
    if (ordered.some(row => row.priority !== ordered[0].priority) || new Set(ordered.map(row => row.id)).size !== ordered.length) return Promise.reject(new Error('Переміщуйте плани в межах одного пріоритету.'))
    return mutate(`reorder:${ordered.map(row => row.id).join(',')}`, async owner => {
      if (ordered.some(row => row.user_id !== owner)) throw new Error('Немає доступу до цих планів.')
      const { data, error } = await supabase.rpc('reorder_planner_occurrences', {
        p_user_id: owner,
        p_items: ordered.map(row => ({ task_id: row.taskId, occurrence_date: row.isRecurring ? row.occurrenceDate : null, expected_updated_at: row.updated_at })),
      })
      if (error) throw error
      const result = data as { tasks: StoredTask[]; overrides: TaskOverride[] }
      result.tasks.forEach(rememberTask)
      result.overrides.forEach(rememberOverride)
    })
  }, [mutate, rememberTask, rememberOverride])

  const autoCompleteOccurrence = useCallback((occurrence: TaskOccurrence) => mutate(`auto-complete:${occurrence.id}`, async owner => {
    if (occurrence.user_id !== owner || !occurrence.auto_complete || occurrence.status !== 'planned') return
    const { data, error } = await supabase.rpc('auto_complete_planner_occurrence', {
      p_task_id: occurrence.taskId, p_occurrence_date: occurrence.isRecurring ? occurrence.occurrenceDate : null,
      p_expected_updated_at: occurrence.updated_at, p_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      p_user_id: owner,
    })
    if (error) throw error
    const saved = data as { task?: StoredTask; override?: TaskOverride } | null
    if (saved?.task) rememberTask(saved.task)
    if (saved?.override) rememberOverride(saved.override)
  }), [mutate, rememberTask, rememberOverride])

  const deleteTask = useCallback((id: string, expectedUpdatedAt?: string) => mutate(`delete:${id}`, async owner => {
    const task = taskMap.get(id)
    if (!task || task.user_id !== owner) throw new Error('План не знайдено. Оновіть плани.')
    const { error } = await supabase.from('tasks').delete().eq('id', id).eq('user_id', owner).eq('updated_at', expectedUpdatedAt ?? task.updated_at).select('id').single()
    if (error?.code === 'PGRST116') throw new Error('Цей план вже змінили в іншому вікні. Оновіть плани перед видаленням.')
    if (error) throw error
    rememberDeletion(id, owner)
  }), [mutate, taskMap, rememberDeletion])

  const deleteOccurrence = useCallback((occurrence: TaskOccurrence) => mutate(`delete-occurrence:${occurrence.id}`, async owner => {
    if (occurrence.user_id !== owner) throw new Error('Немає доступу до цього плану.')
    if (occurrence.isRecurring) await writeOccurrence(occurrence, {}, true)
    else {
      const { error } = await supabase.from('tasks').delete().eq('id', occurrence.taskId).eq('user_id', owner).eq('updated_at', occurrence.updated_at).select('id').single()
      if (error?.code === 'PGRST116') throw new Error('Цей план вже змінили в іншому вікні. Оновіть плани перед видаленням.')
      if (error) throw error
      rememberDeletion(occurrence.taskId, owner)
    }
  }), [mutate, writeOccurrence, rememberDeletion])

  // Action errors are returned to the editor/toast caller; they must not turn
  // a usable planner into an unrecoverable full-page loading error.
  const error = taskTable.error || overrideTable.error ? friendlyLoadError(taskTable.error || overrideTable.error) : null
  const value = useMemo<PlannerContextValue>(() => ({
    tasks, overrides, loading: taskTable.loading || overrideTable.loading,
    busy: busyOwner !== null && busyOwner === user?.id, error,
    refresh, acceptConversion, reorderOccurrences, createTask, updateTask, saveOccurrence, toggleOccurrence, autoCompleteOccurrence, deleteOccurrence, deleteTask,
  }), [tasks, overrides, taskTable.loading, overrideTable.loading, busyOwner, user?.id, error, refresh, acceptConversion, reorderOccurrences, createTask, updateTask, saveOccurrence, toggleOccurrence, autoCompleteOccurrence, deleteOccurrence, deleteTask])
  return <PlannerContext.Provider value={value}><InlineDraftProvider key={user?.id ?? 'signed-out'} userId={user?.id}>{children}</InlineDraftProvider></PlannerContext.Provider>
}

export function usePlanner() {
  const context = useContext(PlannerContext)
  if (!context) throw new Error('usePlanner must be used within PlannerProvider')
  return context
}
