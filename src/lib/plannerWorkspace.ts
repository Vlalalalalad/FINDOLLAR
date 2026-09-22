type Initial<T> = T | (() => T)
type Update<T> = T | ((previous: T) => T)

/** Transient UI only. Its owner is the existing account-scoped draft provider. */
export function createPlannerWorkspaceStore(initialValues: Record<string, unknown> = {}, onWrite?: (key: string, value: unknown) => void) {
  const values = new Map<string, unknown>(Object.entries(initialValues))
  const listeners = new Map<string, Set<() => void>>()
  const read = <T>(key: string, initial: Initial<T>): T => {
    if (!values.has(key)) values.set(key, typeof initial === 'function' ? (initial as () => T)() : initial)
    return values.get(key) as T
  }
  return {
    read,
    write<T>(key: string, update: Update<T>, initial: Initial<T>) {
      const previous = read(key, initial)
      const next = typeof update === 'function' ? (update as (value: T) => T)(previous) : update
      if (Object.is(previous, next)) return
      values.set(key, next)
      onWrite?.(key, next)
      listeners.get(key)?.forEach(listener => listener())
    },
    subscribe(key: string, listener: () => void) {
      if (!listeners.has(key)) listeners.set(key, new Set())
      listeners.get(key)!.add(listener)
      return () => {
        listeners.get(key)?.delete(listener)
        if (!listeners.get(key)?.size) listeners.delete(key)
      }
    },
  }
}

export type PlannerWorkspaceStore = ReturnType<typeof createPlannerWorkspaceStore>
