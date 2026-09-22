import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

interface Options {
  orderBy?: string
  ascending?: boolean
  /** Opt-in pagination for large datasets; existing table consumers keep their query. */
  pageSize?: number
  /** Planner-only recovery: refresh an expired token once before surfacing an auth error. */
  recoverSession?: boolean
  /** Planner-only recovery: retry a short-lived transport/server failure once. */
  retryTransient?: boolean
  /** Retry a previously failed planner load when the PWA returns to foreground. */
  refreshOnFocus?: boolean
}

// Route components unmount on every tab change. Keep the last verified rows
// outside an individual hook instance so returning to a tab never paints an
// empty/skeleton frame before the background refresh completes.
const tableCache = new Map<string, unknown[]>()
let sessionRecovery: Promise<string | null> | null = null

function errorSignature(error: unknown) {
  if (!error || typeof error !== 'object') return String(error ?? '')
  const value = error as { code?: unknown; message?: unknown; status?: unknown }
  return `${String(value.code ?? '')} ${String(value.status ?? '')} ${String(value.message ?? '')}`
}

function isAuthError(error: unknown) {
  return /jwt|not authenticated|row-level security|permission denied|pgrst301|42501/i.test(errorSignature(error))
}

function isTransientError(error: unknown) {
  const value = error as { status?: unknown } | null
  const status = Number(value?.status)
  return status >= 500 || /fetch|network|offline|load failed|timeout|temporar|connection/i.test(errorSignature(error))
}

async function recoverActiveSession() {
  if (!sessionRecovery) {
    sessionRecovery = supabase.auth.refreshSession()
      .then(({ data, error }) => error ? null : data.session?.user.id ?? null)
      .catch(() => null)
  }
  const pending = sessionRecovery
  try { return await pending }
  finally { if (sessionRecovery === pending) sessionRecovery = null }
}

export function useSupabaseTable<T extends { id: string }>(table: string, options?: Options) {
  const { user } = useAuth()
  const cacheKey = user ? `${user.id}:${table}` : null
  const [data, setData] = useState<T[]>(() => cacheKey ? (tableCache.get(cacheKey) as T[] | undefined) ?? [] : [])
  const [loading, setLoading] = useState(() => Boolean(cacheKey && !tableCache.has(cacheKey)))
  const [error, setError] = useState<string | null>(null)
  const requestVersionRef = useRef(0)
  const activeCacheKeyRef = useRef(cacheKey)
  activeCacheKeyRef.current = cacheKey

  const refresh = useCallback(async () => {
    if (!user) {
      requestVersionRef.current += 1
      setData([])
      setLoading(false)
      return
    }
    const key = `${user.id}:${table}`
    const hasCachedRows = tableCache.has(key)
    if (!hasCachedRows) setLoading(true)
    const requestVersion = ++requestVersionRef.current
    try {
      const pageSize = options?.pageSize ? Math.max(1, Math.min(1000, options.pageSize)) : null
      const nextRows: T[] = []
      let offset = 0
      do {
        const loadPage = async () => {
          let query = supabase.from(table).select('*').eq('user_id', user.id)
          if (options?.orderBy) query = query.order(options.orderBy, { ascending: options?.ascending ?? true })
          // A stable tie-breaker prevents duplicate/missing rows between pages.
          if (pageSize) query = query.order('id').range(offset, offset + pageSize - 1)
          return await query
        }
        let result = await loadPage()
        if (result.error && options?.recoverSession && isAuthError(result.error)) {
          const recoveredUserId = await recoverActiveSession()
          if (requestVersionRef.current !== requestVersion || activeCacheKeyRef.current !== key) return
          if (recoveredUserId === user.id) result = await loadPage()
        }
        if (result.error && options?.retryTransient && isTransientError(result.error)) {
          await new Promise(resolve => setTimeout(resolve, 300))
          if (requestVersionRef.current !== requestVersion || activeCacheKeyRef.current !== key) return
          result = await loadPage()
        }
        const { data: rows, error: err } = result
        if (requestVersionRef.current !== requestVersion || activeCacheKeyRef.current !== key) return
        if (err) {
          setError(err.message)
          return
        }
        nextRows.push(...(rows ?? []) as T[])
        if (!pageSize || !rows || rows.length < pageSize) break
        offset += pageSize
      } while (true)
      if (requestVersionRef.current !== requestVersion || activeCacheKeyRef.current !== key) return
      setError(null)
      tableCache.set(key, nextRows)
      setData(nextRows)
    } catch (err) {
      if (requestVersionRef.current === requestVersion && activeCacheKeyRef.current === key) {
        setError(err instanceof Error ? err.message : 'Не вдалося завантажити дані')
      }
    } finally {
      if (requestVersionRef.current === requestVersion && activeCacheKeyRef.current === key) setLoading(false)
    }
  }, [user, table, options?.orderBy, options?.ascending, options?.pageSize, options?.recoverSession, options?.retryTransient])

  useEffect(() => {
    if (!cacheKey) {
      requestVersionRef.current += 1
      setData([])
      setError(null)
      setLoading(false)
      return
    }
    // Errors belong to the account/query that produced them. Never flash a
    // previous profile's failure while the active account is switching.
    setError(null)
    const cached = tableCache.get(cacheKey) as T[] | undefined
    if (cached) {
      setData(cached)
      setLoading(false)
    } else {
      setData([])
      setLoading(true)
    }
    void refresh()
  }, [cacheKey, refresh])

  useEffect(() => {
    if (!options?.refreshOnFocus || !cacheKey || !error) return
    let timer = 0
    const retry = () => {
      if (document.visibilityState !== 'visible' || timer) return
      timer = window.setTimeout(() => { timer = 0; void refresh() }, 120)
    }
    window.addEventListener('focus', retry)
    document.addEventListener('visibilitychange', retry)
    return () => {
      window.removeEventListener('focus', retry)
      document.removeEventListener('visibilitychange', retry)
      if (timer) window.clearTimeout(timer)
    }
  }, [cacheKey, error, refresh, options?.refreshOnFocus])

  const create = useCallback(
    async (values: Record<string, unknown>) => {
      if (!user) throw new Error('Не авторизовано')
      const { data: row, error: err } = await supabase
        .from(table)
        .insert({ ...values, user_id: user.id })
        .select()
        .single()
      if (err) throw err
      await refresh()
      return row as T
    },
    [user, table, refresh]
  )

  const update = useCallback(
    async (id: string, values: Record<string, unknown>) => {
      const { data: row, error: err } = await supabase
        .from(table)
        .update(values)
        .eq('id', id)
        .select()
        .single()
      if (err) throw err
      await refresh()
      return row as T
    },
    [table, refresh]
  )

  const remove = useCallback(
    async (id: string) => {
      const { error: err } = await supabase.from(table).delete().eq('id', id)
      if (err) throw err
      await refresh()
    },
    [table, refresh]
  )

  // Зберігає новий порядок рядків: миттєво оновлює локальний стан (щоб
  // перетягування виглядало миттєвим), потім паралельно записує sort_order
  // для кожного елемента. Розрахований на таблиці з колонкою sort_order.
  const reorder = useCallback(
    async (orderedIds: string[]) => {
      setData(prev => {
        const byId = new Map(prev.map(item => [item.id, item]))
        const reordered = orderedIds.map(id => byId.get(id)).filter((x): x is T => Boolean(x))
        // додаємо в кінець будь-що, чого раптом не було в orderedIds (про всяк випадок)
        const missing = prev.filter(item => !orderedIds.includes(item.id))
        const next = [...reordered, ...missing]
        if (cacheKey) tableCache.set(cacheKey, next)
        return next
      })
      try {
        await Promise.all(
          orderedIds.map((id, index) => supabase.from(table).update({ sort_order: index }).eq('id', id))
        )
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Не вдалося зберегти порядок')
      } finally {
        await refresh()
      }
    },
    [table, refresh, cacheKey]
  )

  return { data, loading, error, refresh, create, update, remove, reorder }
}
