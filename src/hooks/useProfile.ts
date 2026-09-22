import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import type { Profile } from '../types/database'
import { setSavedAccountProfileName } from '../lib/accountSessions'

const profileCache = new Map<string, Profile | null>()

export function useProfile() {
  const { user } = useAuth()
  const userId = user?.id ?? null
  const [profile, setProfile] = useState<Profile | null>(() => userId ? profileCache.get(userId) ?? null : null)
  const [loading, setLoading] = useState(() => Boolean(userId && !profileCache.has(userId)))
  const requestVersionRef = useRef(0)
  const activeUserIdRef = useRef(userId)
  activeUserIdRef.current = userId

  const refresh = useCallback(async () => {
    if (!user) {
      requestVersionRef.current += 1
      setProfile(null)
      setLoading(false)
      return
    }
    const hasCachedProfile = profileCache.has(user.id)
    if (!hasCachedProfile) setLoading(true)
    const requestVersion = ++requestVersionRef.current
    const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).single()
    if (requestVersionRef.current !== requestVersion || activeUserIdRef.current !== user.id) return
    if (error) { setLoading(false); return }
    const nextProfile = (data as Profile) ?? null
    if (nextProfile) setSavedAccountProfileName(user.id, nextProfile.full_name)
    profileCache.set(user.id, nextProfile)
    setProfile(nextProfile)
    setLoading(false)
  }, [user])

  useEffect(() => {
    if (!userId) {
      requestVersionRef.current += 1
      setProfile(null)
      setLoading(false)
      return
    }
    if (profileCache.has(userId)) {
      setProfile(profileCache.get(userId) ?? null)
      setLoading(false)
    } else {
      setProfile(null)
      setLoading(true)
    }
    void refresh()
  }, [userId, refresh])

  const updateProfile = useCallback(
    async (values: Partial<Pick<Profile, 'full_name' | 'base_currency'>>) => {
      if (!user) throw new Error('Не авторизовано')
      const targetUserId = user.id
      requestVersionRef.current += 1
      const { data, error } = await supabase
        .from('profiles')
        .update(values)
        .eq('id', targetUserId)
        .select()
        .single()
      if (error) throw error
      const nextProfile = data as Profile
      if ('full_name' in values) setSavedAccountProfileName(targetUserId, nextProfile.full_name)
      profileCache.set(targetUserId, nextProfile)
      requestVersionRef.current += 1
      if (activeUserIdRef.current === targetUserId) setProfile(nextProfile)
      return nextProfile
    },
    [user]
  )

  return { profile, loading, updateProfile, refresh }
}
