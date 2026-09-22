import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useAuth } from './AuthContext'
import { useSupabaseTable } from '../hooks/useSupabaseTable'
import { supabase } from '../lib/supabase'
import { isValidDateKey } from '../lib/planner'
import type { PlannerConversionResult } from '../lib/plannerConversion'
import { mergeGoalItems, type GoalItemsSave } from '../lib/goalItems'
import { emptyGoalData, type OrganizationEntry, type OrganizationEntryInput, type OrganizationPage, type OrganizationPageInput } from '../types/organization'

interface OrganizationContextValue {
  entries: OrganizationEntry[]
  pages: OrganizationPage[]
  loading: boolean
  busy: boolean
  error: string | null
  refresh: () => Promise<void>
  acceptConversion: (result: PlannerConversionResult) => void
  createEntry: (input: OrganizationEntryInput & { id?: string }) => Promise<OrganizationEntry>
  updateEntry: (id: string, patch: Partial<OrganizationEntryInput>, expectedUpdatedAt?: string) => Promise<OrganizationEntry>
  toggleGoalCompletion: (id: string, expectedUpdatedAt?: string) => Promise<OrganizationEntry>
  saveGoalItems: GoalItemsSave
  deleteEntry: (id: string, expectedUpdatedAt?: string) => Promise<void>
  createPage: (input: OrganizationPageInput & { id?: string }) => Promise<OrganizationPage>
  updatePage: (id: string, patch: Partial<OrganizationPageInput>, expectedUpdatedAt?: string) => Promise<OrganizationPage>
  deletePage: (id: string, expectedUpdatedAt?: string) => Promise<void>
}

type Row = OrganizationEntry | OrganizationPage
type Acknowledgements = { entries: Map<string, OrganizationEntry>; pages: Map<string, OrganizationPage>; deletedEntries: Map<string, string>; deletedPages: Map<string, string> }
const emptyAcknowledgements = (): Acknowledgements => ({ entries: new Map(), pages: new Map(), deletedEntries: new Map(), deletedPages: new Map() })
const OrganizationContext = createContext<OrganizationContextValue | undefined>(undefined)

function mergeRows<T extends Row>(rows: T[], acknowledged: Map<string, T>, deleted: Map<string, string>, owner?: string): T[] {
  const merged = new Map(rows.map(row => [row.id, row]))
  for (const [id, row] of acknowledged) if (!merged.has(id) || merged.get(id)!.updated_at <= row.updated_at) merged.set(id, row)
  return [...merged.values()].filter(row => row.user_id === owner && deleted.get(row.id) !== owner)
}

function messageFor(error: unknown) {
  const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error)
  if (/schema cache|does not exist|could not find/i.test(message)) return 'Нотатки та цілі ще не підключені. Зверніться до адміністратора застосунку та повторіть спробу.'
  if (/fetch|network|offline|load failed/i.test(message)) return 'Немає зв’язку з сервером. Зміни ще не підтверджені — повторіть спробу.'
  if (/row-level security|permission denied|jwt|not authenticated/i.test(message)) return 'Немає доступу до записів. Увійдіть у застосунок повторно.'
  if (/check constraint|invalid input syntax/i.test(message)) return 'Перевірте назву, дати, теги та кроки цілі.'
  if (/Organization page already changed/i.test(message)) return 'Сторінку вже змінено в іншому вікні. Відкрийте її повторно.'
  if (/Organization page not found/i.test(message)) return 'Сторінку не знайдено. Оновіть список сторінок.'
  if (/Record kind does not match page|Page contains records of another kind/i.test(message)) return 'Цей тип запису не відповідає сторінці. Оберіть іншу сторінку.'
  return message
}

function cleanEntry(input: OrganizationEntryInput): OrganizationEntryInput {
  if (input.kind !== 'note' && input.kind !== 'goal') throw new Error('Оберіть тип запису: нотатка або ціль.')
  const title = input.title.trim()
  if (!title || title.length > 200) throw new Error('Вкажіть назву до 200 символів.')
  const description = input.description?.trim() ?? ''
  if (description.length > 20000) throw new Error('Текст може містити до 20 000 символів.')
  const date = input.date || null
  if (date && !isValidDateKey(date)) throw new Error('Вкажіть коректну дату.')
  const tags = [...new Set(input.tags.map(tag => tag.trim().replace(/^#+/, '')).filter(Boolean))]
  if (tags.length > 20 || tags.some(tag => tag.length > 40)) throw new Error('Можна додати до 20 тегів, до 40 символів кожен.')
  if (input.kind === 'note') return { ...input, title, description, date, tags, data: {} }
  const goal = { ...(input.data.goal ?? emptyGoalData()), items: [...(input.data.goal?.items ?? [])] }
  if (goal.completed !== undefined && typeof goal.completed !== 'boolean') throw new Error('Вкажіть коректний стан виконання цілі.')
  if (!['none', 'year', 'custom'].includes(goal.period)) throw new Error('Оберіть період цілі.')
  if (goal.period === 'year') {
    if (!Number.isInteger(goal.year) || goal.year! < 1 || goal.year! > 9999) throw new Error('Вкажіть рік від 1 до 9999.')
    goal.startDate = null; goal.endDate = null
  } else if (goal.period === 'custom') {
    if (!goal.startDate || !goal.endDate || !isValidDateKey(goal.startDate) || !isValidDateKey(goal.endDate) || goal.endDate < goal.startDate) throw new Error('Вкажіть початок і завершення періоду цілі.')
    goal.year = null
  } else { goal.year = null; goal.startDate = null; goal.endDate = null }
  goal.items = goal.items.map(item => ({ id: item.id, title: item.title.trim(), completed: Boolean(item.completed) }))
  if (goal.items.length > 200 || goal.items.some(item => !item.id || !item.title || item.title.length > 300) || new Set(goal.items.map(item => item.id)).size !== goal.items.length) throw new Error('Кожен крок має мати окрему назву до 300 символів; максимум 200 кроків.')
  // Goals own a period, not a task-like calendar occurrence.
  return { ...input, title, description, date: null, tags, data: { goal } }
}

function cleanPage(input: OrganizationPageInput): OrganizationPageInput {
  const title = input.title.trim()
  if (!title || title.length > 100) throw new Error('Назва сторінки має містити від 1 до 100 символів.')
  if (!['notes', 'goals', 'mixed'].includes(input.kind)) throw new Error('Оберіть тип сторінки.')
  return { title, kind: input.kind }
}

export function OrganizationProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const entryTable = useSupabaseTable<OrganizationEntry>('organization_entries', { orderBy: 'updated_at', ascending: false, pageSize: 500 })
  const pageTable = useSupabaseTable<OrganizationPage>('organization_pages', { orderBy: 'created_at', pageSize: 500 })
  const ownerRef = useRef(user?.id)
  ownerRef.current = user?.id
  const mountedRef = useRef(true)
  const [busyOwner, setBusyOwner] = useState<string | null>(null)
  const [ack, setAck] = useState(emptyAcknowledgements)
  const failedIds = useRef(new Map<string, string>())
  const flight = useRef<{ owner: string; key: string; promise: Promise<unknown> } | null>(null)
  const goalQueue = useRef<Promise<unknown>>(Promise.resolve())
  const pendingGoalEdits = useRef(new Map<string, { owner: string | undefined; before: Parameters<GoalItemsSave>[1]; after: Parameters<GoalItemsSave>[2] }[]>())
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false } }, [])
  useEffect(() => { setAck(emptyAcknowledgements()); failedIds.current.clear(); setBusyOwner(null) }, [user?.id])

  // Acknowledged writes survive failed or stale refetches. Release them only
  // when a later server snapshot includes their revision, so external edits flow.
  useEffect(() => {
    setAck(previous => {
      const next = { ...previous, entries: new Map(previous.entries), deletedEntries: new Map(previous.deletedEntries) }
      const rows = new Map(entryTable.data.map(row => [row.id, row]))
      for (const [id, row] of next.entries) if (!pendingGoalEdits.current.has(id) && rows.get(id)?.user_id === row.user_id && rows.get(id)!.updated_at >= row.updated_at) next.entries.delete(id)
      for (const [id, owner] of next.deletedEntries) if (owner === ownerRef.current && !rows.has(id)) next.deletedEntries.delete(id)
      return next.entries.size === previous.entries.size && next.deletedEntries.size === previous.deletedEntries.size ? previous : next
    })
  }, [entryTable.data])
  useEffect(() => {
    setAck(previous => {
      const next = { ...previous, pages: new Map(previous.pages), deletedPages: new Map(previous.deletedPages) }
      const rows = new Map(pageTable.data.map(row => [row.id, row]))
      for (const [id, row] of next.pages) if (rows.get(id)?.user_id === row.user_id && rows.get(id)!.updated_at >= row.updated_at) next.pages.delete(id)
      for (const [id, owner] of next.deletedPages) if (owner === ownerRef.current && !rows.has(id)) next.deletedPages.delete(id)
      return next.pages.size === previous.pages.size && next.deletedPages.size === previous.deletedPages.size ? previous : next
    })
  }, [pageTable.data])

  const entries = useMemo(() => mergeRows(entryTable.data, ack.entries, ack.deletedEntries, user?.id), [entryTable.data, ack, user?.id])
  const pages = useMemo(() => mergeRows(pageTable.data, ack.pages, ack.deletedPages, user?.id), [pageTable.data, ack, user?.id])
  const entryMap = useMemo(() => new Map(entries.map(entry => [entry.id, entry])), [entries])
  const pageMap = useMemo(() => new Map(pages.map(page => [page.id, page])), [pages])
  const refresh = useCallback(async () => { await Promise.all([entryTable.refresh(), pageTable.refresh()]) }, [entryTable.refresh, pageTable.refresh])
  const remember = useCallback((row: Row, kind: 'entries' | 'pages') => {
    if (kind === 'entries' && 'data' in row && row.kind === 'goal') {
      const goal = row.data.goal ?? emptyGoalData()
      let items = goal.items
      for (const change of pendingGoalEdits.current.get(row.id) ?? []) {
        if (change.owner !== row.user_id) continue
        try { items = mergeGoalItems(change.before, change.after, items) }
        catch { /* The queued write reports a conflict; keep the confirmed row safe. */ }
      }
      row = { ...row, data: { ...row.data, goal: { ...goal, items } } }
    }
    if (mountedRef.current && ownerRef.current === row.user_id) setAck(previous => kind === 'entries'
      ? { ...previous, entries: new Map(previous.entries).set(row.id, row as OrganizationEntry) }
      : { ...previous, pages: new Map(previous.pages).set(row.id, row as OrganizationPage) })
  }, [])
  const rememberDeleted = useCallback((id: string, owner: string, kind: 'deletedEntries' | 'deletedPages') => {
    if (mountedRef.current && ownerRef.current === owner) setAck(previous => ({ ...previous, [kind]: new Map(previous[kind]).set(id, owner) }))
  }, [])
  const acceptConversion = useCallback((result: PlannerConversionResult) => {
    const owner = result.task?.user_id ?? result.entry?.user_id
    if (!owner || !mountedRef.current || ownerRef.current !== owner) return
    setAck(previous => {
      const next = { ...previous, entries: new Map(previous.entries), deletedEntries: new Map(previous.deletedEntries) }
      if (result.sourceKind !== 'plan' && result.sourceRemoved) {
        next.entries.delete(result.sourceId)
        next.deletedEntries.set(result.sourceId, owner)
      }
      if (result.entry?.user_id === owner) {
        next.deletedEntries.delete(result.entry.id)
        next.entries.set(result.entry.id, result.entry)
      }
      return next
    })
  }, [])
  const mutate = useCallback(<T,>(key: string, operation: (owner: string) => Promise<T>, background = false): Promise<T> => {
    const owner = ownerRef.current
    if (!owner) return Promise.reject(new Error('Увійдіть у застосунок, щоб зберегти записи.'))
    if (flight.current?.owner === owner) return flight.current.key === key ? flight.current.promise as Promise<T> : Promise.reject(new Error('Зачекайте, попередня зміна ще зберігається.'))
    if (!background) setBusyOwner(owner)
    const promise = Promise.resolve().then(() => operation(owner)).then(async result => {
      if (ownerRef.current !== owner || !mountedRef.current) throw new Error('Обліковий запис змінився. Відкрийте запис повторно.')
      await refresh()
      return result
    }).catch(error => { throw new Error(messageFor(error)) }).finally(() => {
      if (flight.current?.promise === promise) flight.current = null
      if (!background && mountedRef.current && ownerRef.current === owner) setBusyOwner(null)
    })
    flight.current = { owner, key, promise }
    return promise
  }, [refresh])

  const createEntry = useCallback((input: OrganizationEntryInput & { id?: string }) => {
    const { id: requestedId, ...raw } = input
    const values = cleanEntry(raw)
    const fingerprint = `entry:${JSON.stringify(values)}`
    const id = requestedId ?? failedIds.current.get(fingerprint) ?? crypto.randomUUID()
    failedIds.current.set(fingerprint, id)
    return mutate(`create-entry:${id}`, async owner => {
      const { data, error } = await supabase.from('organization_entries').upsert({ ...values, id, user_id: owner }, { onConflict: 'id', ignoreDuplicates: true }).select().maybeSingle()
      if (error) throw error
      let row = data as OrganizationEntry | null
      if (!row) {
        const result = await supabase.from('organization_entries').select('*').eq('id', id).eq('user_id', owner).single()
        if (result.error) throw result.error
        row = result.data as OrganizationEntry
      }
      if (ownerRef.current === owner) failedIds.current.delete(fingerprint)
      remember(row, 'entries')
      return row
    })
  }, [mutate, remember])
  const updateEntry = useCallback((id: string, patch: Partial<OrganizationEntryInput>, expectedUpdatedAt?: string) => mutate(`entry:${id}`, async owner => {
    const current = entryMap.get(id)
    if (!current || current.user_id !== owner) throw new Error('Запис не знайдено. Оновіть сторінку.')
    if (patch.kind && patch.kind !== current.kind) throw new Error('Тип існуючого запису змінити не можна.')
    const values = cleanEntry({ page_id: current.page_id, kind: current.kind, title: current.title, description: current.description, date: current.date, tags: current.tags, data: current.data, ...patch })
    const { data, error } = await supabase.from('organization_entries').update(values).eq('id', id).eq('user_id', owner).eq('updated_at', expectedUpdatedAt ?? current.updated_at).select().single()
    if (error?.code === 'PGRST116') throw new Error('Запис уже змінено в іншому вікні. Відкрийте його повторно перед редагуванням.')
    if (error) throw error
    const row = data as OrganizationEntry
    remember(row, 'entries')
    return row
  }), [entryMap, mutate, remember])
  const toggleGoalCompletion = useCallback((id: string, expectedUpdatedAt?: string) => {
    const current = entryMap.get(id)
    if (!current || current.kind !== 'goal') return Promise.reject(new Error('Ціль не знайдено. Оновіть список.'))
    const goal = current.data.goal ?? emptyGoalData()
    const next = { ...current, data: { ...current.data, goal: { ...goal, completed: !goal.completed } } }
    // The checklist/progress state is local UI state as soon as the checkbox is
    // pressed. The conditional write still protects the original revision, and
    // a failed request rolls the acknowledgement back to the previous row.
    remember(next, 'entries')
    return updateEntry(id, { data: { goal: next.data.goal } }, expectedUpdatedAt ?? current.updated_at).catch(error => {
      remember(current, 'entries')
      throw error
    })
  }, [entryMap, remember, updateEntry])
  const saveGoalItems = useCallback<GoalItemsSave>((id, before, after) => {
    const requestedOwner = ownerRef.current
    const optimistic = entryMap.get(id)
    const pending = { owner: requestedOwner, before, after }
    pendingGoalEdits.current.set(id, [...(pendingGoalEdits.current.get(id) ?? []), pending])
    const release = () => {
      const remaining = (pendingGoalEdits.current.get(id) ?? []).filter(change => change !== pending)
      if (remaining.length) pendingGoalEdits.current.set(id, remaining)
      else pendingGoalEdits.current.delete(id)
    }
    if (optimistic) remember(optimistic, 'entries')
    // Queue rapid taps/reorders instead of dropping intent behind an in-flight save.
    const promise = goalQueue.current.catch(() => {}).then(async () => {
      const currentFlight = flight.current
      if (currentFlight && currentFlight.owner === requestedOwner) await currentFlight.promise.catch(() => {})
      if (!requestedOwner || ownerRef.current !== requestedOwner) throw new Error('Обліковий запис змінився. Відкрийте ціль повторно.')
      return mutate(`goal-items:${id}`, async owner => {
        for (let attempt = 0; attempt < 3; attempt++) {
          const currentResult = await supabase.from('organization_entries').select('*').eq('id', id).eq('user_id', owner).single()
          if (currentResult.error) throw currentResult.error
          const current = currentResult.data as OrganizationEntry
          if (current.kind !== 'goal') throw new Error('Ціль більше недоступна. Оновіть список.')
          const goal = current.data.goal ?? emptyGoalData()
          const items = mergeGoalItems(before, after, goal.items)
          if (JSON.stringify(items) === JSON.stringify(goal.items)) { release(); remember(current, 'entries'); return current }
          const values = cleanEntry({ ...current, data: { ...current.data, goal: { ...goal, items } } })
          const result = await supabase.from('organization_entries').update({ data: values.data }).eq('id', id).eq('user_id', owner).eq('updated_at', current.updated_at).select().single()
          if (result.error?.code === 'PGRST116') continue
          if (result.error) throw result.error
          const row = result.data as OrganizationEntry
          release()
          remember(row, 'entries')
          return row
        }
        throw new Error('Ціль одночасно змінюється в іншому вікні. Повторіть збереження кроків.')
      }, true)
    })
    const result = promise.catch(error => {
      release()
      if (optimistic) remember(optimistic, 'entries')
      throw error
    })
    // Only the caller's result rejects. The internal queue tail is always
    // handled, including when no later edit arrives to attach another catch.
    goalQueue.current = result.then(() => undefined, () => undefined)
    return result
  }, [entryMap, mutate, remember])
  const deleteEntry = useCallback((id: string, expectedUpdatedAt?: string) => mutate(`delete-entry:${id}`, async owner => {
    const current = entryMap.get(id)
    if (!current || current.user_id !== owner) throw new Error('Запис не знайдено. Оновіть сторінку.')
    const { error } = await supabase.from('organization_entries').delete().eq('id', id).eq('user_id', owner).eq('updated_at', expectedUpdatedAt ?? current.updated_at).select('id').single()
    if (error?.code === 'PGRST116') throw new Error('Запис уже змінено. Відкрийте його повторно перед видаленням.')
    if (error) throw error
    rememberDeleted(id, owner, 'deletedEntries')
  }), [entryMap, mutate, rememberDeleted])
  const createPage = useCallback((input: OrganizationPageInput & { id?: string }) => {
    const values = cleanPage(input)
    const fingerprint = `page:${JSON.stringify(values)}`
    const id = input.id ?? failedIds.current.get(fingerprint) ?? crypto.randomUUID()
    failedIds.current.set(fingerprint, id)
    return mutate(`create-page:${id}`, async owner => {
      const { data, error } = await supabase.from('organization_pages').upsert({ ...values, id, user_id: owner }, { onConflict: 'id', ignoreDuplicates: true }).select().maybeSingle()
      if (error) throw error
      let row = data as OrganizationPage | null
      if (!row) {
        const result = await supabase.from('organization_pages').select('*').eq('id', id).eq('user_id', owner).single()
        if (result.error) throw result.error
        row = result.data as OrganizationPage
      }
      if (ownerRef.current === owner) failedIds.current.delete(fingerprint)
      remember(row, 'pages')
      return row
    })
  }, [mutate, remember])
  const updatePage = useCallback((id: string, patch: Partial<OrganizationPageInput>, expectedUpdatedAt?: string) => mutate(`page:${id}`, async owner => {
    const current = pageMap.get(id)
    if (!current || current.user_id !== owner) throw new Error('Сторінку не знайдено.')
    const { data, error } = await supabase.from('organization_pages').update(cleanPage({ ...current, ...patch })).eq('id', id).eq('user_id', owner).eq('updated_at', expectedUpdatedAt ?? current.updated_at).select().single()
    if (error?.code === 'PGRST116') throw new Error('Сторінку вже змінено. Відкрийте її повторно.')
    if (error) throw error
    const row = data as OrganizationPage
    remember(row, 'pages')
    return row
  }), [pageMap, mutate, remember])
  const deletePage = useCallback((id: string, expectedUpdatedAt?: string) => mutate(`delete-page:${id}`, async owner => {
    const current = pageMap.get(id)
    if (!current || current.user_id !== owner) throw new Error('Сторінку не знайдено.')
    // The RPC moves its records to their main Notes/Goals collections atomically.
    const { data, error } = await supabase.rpc('delete_organization_page', { p_id: id, p_expected_updated_at: expectedUpdatedAt ?? current.updated_at })
    if (error) throw error
    for (const row of (data ?? []) as OrganizationEntry[]) remember(row, 'entries')
    rememberDeleted(id, owner, 'deletedPages')
  }), [pageMap, mutate, remember, rememberDeleted])
  const error = entryTable.error ?? pageTable.error
  const value = useMemo(() => ({ entries, pages, loading: entryTable.loading || pageTable.loading, busy: busyOwner === user?.id, error: error ? messageFor(error) : null, refresh, acceptConversion, createEntry, updateEntry, toggleGoalCompletion, saveGoalItems, deleteEntry, createPage, updatePage, deletePage }), [entries, pages, entryTable.loading, pageTable.loading, busyOwner, user?.id, error, refresh, acceptConversion, createEntry, updateEntry, toggleGoalCompletion, saveGoalItems, deleteEntry, createPage, updatePage, deletePage])
  return <OrganizationContext.Provider value={value}>{children}</OrganizationContext.Provider>
}

export function useOrganization() {
  const context = useContext(OrganizationContext)
  if (!context) throw new Error('useOrganization must be used inside OrganizationProvider')
  return context
}
