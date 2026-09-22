import type { GoalItem, OrganizationEntry } from '../types/organization'

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const clone = (items: GoalItem[]) => items.map(item => ({ ...item }))

/** Apply only edits made locally; preserve unrelated steps/fields from another device. */
export function mergeGoalItems(before: GoalItem[], after: GoalItem[], latest: GoalItem[]): GoalItem[] {
  const previous = new Map(before.map(item => [item.id, item]))
  const edited = new Map(after.map(item => [item.id, item]))
  const merged = new Map(latest.map(item => [item.id, { ...item }]))
  const conflict = () => { throw new Error('Цей крок уже змінили в іншому вікні. Оновіть ціль і повторіть зміну.') }
  for (const [id, item] of previous) {
    const next = edited.get(id), current = merged.get(id)
    if (!next) {
      if (current && !same(current, item)) conflict()
      merged.delete(id)
    } else if (current) {
      for (const field of ['title', 'completed'] as const) {
        if (next[field] === item[field]) continue
        if (current[field] !== item[field] && current[field] !== next[field]) conflict()
        if (field === 'title') current.title = next.title
        else current.completed = next.completed
      }
    } else if (!same(item, next)) conflict()
  }
  for (const item of after) if (!previous.has(item.id)) {
    const current = merged.get(item.id)
    if (current && !same(current, item)) conflict()
    merged.set(item.id, { ...item })
  }
  const previousOrder = before.filter(item => edited.has(item.id)).map(item => item.id)
  const nextOrder = after.filter(item => previous.has(item.id)).map(item => item.id)
  const localOrderChanged = !same(previousOrder, nextOrder)
  // Reorder only known ids in their slots. Concurrently added steps keep their place.
  const order = latest.filter(item => merged.has(item.id)).map(item => item.id)
  for (const item of after) if (!order.includes(item.id) && merged.has(item.id)) order.push(item.id)
  if (localOrderChanged) {
    const desired = after.filter(item => merged.has(item.id)).map(item => item.id)
    let index = 0
    for (let i = 0; i < order.length; i++) if (edited.has(order[i])) order[i] = desired[index++]
  }
  return order.map(id => merged.get(id)!)
}

export type GoalItemsSave = (id: string, before: GoalItem[], after: GoalItem[]) => Promise<OrganizationEntry>

/** Keep queued intent alive after the composer closes, without overwriting later edits. */
export function createGoalItemsAutosave(entry: OrganizationEntry, save: GoalItemsSave) {
  let baseline = clone(entry.data.goal?.items ?? [])
  let desired = clone(baseline)
  let pending: Promise<OrganizationEntry | undefined> | null = null
  let last: OrganizationEntry | undefined
  let error: string | null = null
  const listeners = new Set<(state: { saving: boolean; error: string | null }, row?: OrganizationEntry) => void>()
  const notify = (row?: OrganizationEntry) => listeners.forEach(listener => listener({ saving: !!pending, error }, row))
  const run = (): Promise<OrganizationEntry | undefined> => {
    if (pending) return pending
    if (same(baseline, desired)) return Promise.resolve(last)
    error = null
    pending = Promise.resolve().then(async () => {
      while (!same(baseline, desired)) {
        const snapshot = clone(desired)
        const row = await save(entry.id, clone(baseline), snapshot)
        const confirmed = clone(row.data.goal?.items ?? [])
        // New clicks received while saving stay pending on top of the acknowledged row.
        desired = mergeGoalItems(snapshot, desired, confirmed)
        baseline = confirmed
        last = row
        notify(row)
      }
      return last
    }).catch(failure => {
      error = failure instanceof Error ? failure.message : 'Не вдалося зберегти кроки цілі.'
      throw failure
    }).finally(() => { pending = null; notify() })
    notify()
    return pending
  }
  return {
    commit: (_before: GoalItem[], after: GoalItem[]) => { desired = clone(after); void run().catch(() => {}) },
    flush: run,
    subscribe: (listener: (state: { saving: boolean; error: string | null }, row?: OrganizationEntry) => void) => {
      listeners.add(listener); listener({ saving: !!pending, error })
      return () => { listeners.delete(listener) }
    },
  }
}
