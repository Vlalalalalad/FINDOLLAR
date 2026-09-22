import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { usePlanner } from '../../context/PlannerContext'
import { useAuth } from '../../context/AuthContext'
import { usePlannerClock } from '../../hooks/usePlannerClock'
import { addDays, expandTasks, localDateKey, occursOnDate, reminderEvents } from '../../lib/planner'
import {
  disablePlannerNotifications,
  enablePlannerNotifications,
  loadPlannerNotificationState,
  NOTIFICATION_CHANGE,
  readNotificationValue,
  seenKey,
  syncPlannerPush,
  writeNotificationValue,
  type PlannerNotificationState,
} from '../../lib/plannerNotifications'
import './workspace.css'

function useNotificationChanges() {
  const [version, setVersion] = useState(0)
  useEffect(() => {
    const sync = () => setVersion(value => value + 1)
    window.addEventListener(NOTIFICATION_CHANGE, sync)
    window.addEventListener('storage', sync)
    window.addEventListener('focus', sync)
    navigator.serviceWorker?.addEventListener('message', sync)
    return () => {
      window.removeEventListener(NOTIFICATION_CHANGE, sync)
      window.removeEventListener('storage', sync)
      window.removeEventListener('focus', sync)
      navigator.serviceWorker?.removeEventListener('message', sync)
    }
  }, [])
  return version
}

const emptyState: PlannerNotificationState = { available: false, enabled: false, message: '' }

/** Account-specific state for this browser/PWA installation. */
export function NotificationSettings() {
  const { user } = useAuth()
  const version = useNotificationChanges()
  const [state, setState] = useState<PlannerNotificationState>(emptyState)
  const [stateOwnerId, setStateOwnerId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const enabled = stateOwnerId === user?.id && state.enabled

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    if (!user) {
      setState(emptyState)
      setStateOwnerId(null)
      setLoading(false)
      return () => { cancelled = true }
    }
    void loadPlannerNotificationState(user.id).then(next => {
      if (!cancelled) { setState(next); setStateOwnerId(user.id); setLoading(false) }
    })
    return () => { cancelled = true }
  }, [user?.id, version])

  const toggle = async () => {
    if (!user || loading || !state.available) return
    setLoading(true)
    setError('')
    try {
      if (enabled) await disablePlannerNotifications(user.id)
      else await enablePlannerNotifications(user.id)
      setState(await loadPlannerNotificationState(user.id))
      setStateOwnerId(user.id)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Не вдалося змінити налаштування сповіщень.')
      setState(await loadPlannerNotificationState(user.id))
      setStateOwnerId(user.id)
    } finally { setLoading(false) }
  }

  return <div className="flex flex-col gap-2">
    <div className="flex min-h-11 items-center justify-between gap-4">
      <div>
        <h2 className="font-display font-semibold text-text">Сповіщення</h2>
        <p className="mt-0.5 text-xs text-text-muted">Для цього профілю на цьому пристрої</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={enabled ? 'Вимкнути сповіщення' : 'Увімкнути сповіщення'}
        disabled={loading || !state.available}
        onClick={() => void toggle()}
        className={`relative h-7 w-12 shrink-0 overflow-hidden rounded-full border transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:cursor-not-allowed disabled:opacity-50 ${enabled ? 'border-primary bg-primary' : 'border-border bg-surface-2'}`}
      >
        <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${enabled ? 'translate-x-6' : 'translate-x-0'}`} />
      </button>
    </div>
    {!loading && state.message && <p className="text-xs leading-relaxed text-text-muted">{state.message}</p>}
    {error && <p role="alert" className="text-xs leading-relaxed text-danger">{error}</p>}
  </div>
}

/** A navigation signal only; delivery is exclusively server-side Web Push. */
export function PlannerNavBadge() {
  const { tasks, overrides, loading } = usePlanner()
  const { user } = useAuth()
  const { pathname } = useLocation()
  const now = usePlannerClock()
  useNotificationChanges()
  const today = localDateKey(now)
  const occurrences = useMemo(() => expandTasks(tasks, overrides, addDays(today, -1), addDays(today, 2)), [tasks, overrides, today])
  const count = occurrences.filter(task => occursOnDate(task, today) && task.status !== 'completed').length
  const seen = user ? Number(readNotificationValue(seenKey(user.id)) ?? 0) : 0
  const unread = pathname !== '/plans' && occurrences.flatMap(reminderEvents).some(event => event.dueAt.getTime() > seen && event.dueAt <= now && event.dueAt.getTime() > now.getTime() - 86_400_000)
  useEffect(() => {
    if (user && pathname === '/plans' && document.visibilityState === 'visible') writeNotificationValue(seenKey(user.id), String(now.getTime()))
  }, [user, pathname, now])
  if (loading || !user || (!unread && !count)) return null
  return <span className={'planner-nav-badge' + (unread ? ' is-unread' : '')} aria-label={unread ? 'Нові нагадування' : `Заплановано на сьогодні: ${count}`}>{unread ? null : count > 99 ? '99+' : count}</span>
}

/** Reconcile the active account on startup/focus; never schedule in React. */
export function PlannerReminders() {
  const { user, accounts } = useAuth()
  useEffect(() => {
    const syncPresentation = () => {
      void navigator.serviceWorker?.ready.then(registration => {
        registration.active?.postMessage({ type: 'planner-account-count', accountCount: accounts.length })
      }).catch(() => { /* The next app start can synchronize presentation metadata. */ })
    }
    syncPresentation()
    navigator.serviceWorker?.addEventListener('controllerchange', syncPresentation)
    return () => navigator.serviceWorker?.removeEventListener('controllerchange', syncPresentation)
  }, [accounts.length])
  useEffect(() => {
    if (!user) return
    const sync = () => { void syncPlannerPush(user.id).catch(() => { /* Profile shows the authoritative state. */ }) }
    sync()
    window.addEventListener('focus', sync)
    return () => window.removeEventListener('focus', sync)
  }, [user?.id])
  return null
}
