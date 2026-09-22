import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import type { ExchangeRate } from '../types/database'

const ratesCache = new Map<string, ExchangeRate[]>()

export function useExchangeRates() {
  const { user } = useAuth()
  const userId = user?.id ?? null
  const [rates, setRates] = useState<ExchangeRate[]>(() => userId ? ratesCache.get(userId) ?? [] : [])
  const [loading, setLoading] = useState(() => Boolean(userId && !ratesCache.has(userId)))
  const requestVersionRef = useRef(0)
  const activeUserIdRef = useRef(userId)
  activeUserIdRef.current = userId

  const refresh = useCallback(async () => {
    if (!user) {
      requestVersionRef.current += 1
      setRates([])
      setLoading(false)
      return
    }
    const hasCachedRates = ratesCache.has(user.id)
    if (!hasCachedRates) setLoading(true)
    const requestVersion = ++requestVersionRef.current
    const { data } = await supabase.from('exchange_rates').select('*').eq('user_id', user.id)
    if (requestVersionRef.current !== requestVersion || activeUserIdRef.current !== user.id) return
    const nextRates = (data as ExchangeRate[]) ?? []
    ratesCache.set(user.id, nextRates)
    setRates(nextRates)
    setLoading(false)
  }, [user])

  useEffect(() => {
    if (!userId) {
      requestVersionRef.current += 1
      setRates([])
      setLoading(false)
      return
    }
    const cached = ratesCache.get(userId)
    if (cached) {
      setRates(cached)
      setLoading(false)
    } else {
      setRates([])
      setLoading(true)
    }
    void refresh()
  }, [userId, refresh])

  const setRate = useCallback(
    async (currency: string, rateToBase: number) => {
      if (!user) throw new Error('Не авторизовано')
      const { error } = await supabase
        .from('exchange_rates')
        .upsert({ user_id: user.id, currency, rate_to_base: rateToBase }, { onConflict: 'user_id,currency' })
      if (error) throw error
      await refresh()
    },
    [user, refresh]
  )

  const removeRate = useCallback(
    async (currency: string) => {
      if (!user) return
      const { error } = await supabase
        .from('exchange_rates')
        .delete()
        .eq('user_id', user.id)
        .eq('currency', currency)
      if (error) throw error
      await refresh()
    },
    [user, refresh]
  )

  const ratesMap = useMemo(() => Object.fromEntries(rates.map(r => [r.currency, r.rate_to_base])), [rates])

  return { rates, ratesMap, loading, setRate, removeRate, refresh }
}
