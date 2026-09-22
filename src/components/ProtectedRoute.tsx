import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Button } from './ui'
import { NavigationSession } from './NavigationSession'

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { session, loading, switching, sessionError, retrySession, accounts, switchAccount } = useAuth()
  const location = useLocation()
  const [pushError, setPushError] = useState('')
  const attemptedPush = useRef('')
  const pushAccount = useMemo(() => {
    if (location.pathname !== '/plans') return null
    const value = new URLSearchParams(location.search).get('pushAccount')
    return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : null
  }, [location.pathname, location.search])
  const switchingForPush = !!session && !!pushAccount && pushAccount !== session.user.id

  useEffect(() => {
    let cancelled = false
    if (!switchingForPush || !pushAccount) {
      if (!pushAccount) attemptedPush.current = ''
      return () => { cancelled = true }
    }
    const attemptKey = `${pushAccount}:${location.search}`
    if (attemptedPush.current === attemptKey) return () => { cancelled = true }
    attemptedPush.current = attemptKey
    setPushError('')
    if (!accounts.some(account => account.id === pushAccount)) {
      setPushError('Цього профілю більше немає на цьому пристрої. Додайте його знову, щоб відкрити план.')
      return () => { cancelled = true }
    }
    void switchAccount(pushAccount).catch(error => {
      if (!cancelled) setPushError(error instanceof Error ? error.message : 'Не вдалося відкрити потрібний профіль.')
    })
    return () => { cancelled = true }
  }, [switchingForPush, pushAccount, location.search, accounts, switchAccount])

  if (loading) return <div className="h-full bg-bg" role="status" aria-label="Завантаження" />
  // Сесію перевірити не вдалось (сервер не відповів за 15с або запит
  // впав) — показуємо зрозумілий стан замість вічного "Завантаження...".
  if (!session && sessionError) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="text-sm text-text-muted">Немає зв'язку з сервером</p>
        <Button variant="secondary" onClick={retrySession}>
          Спробувати ще
        </Button>
      </div>
    )
  }
  if (!session) return <Navigate to="/auth" state={pushAccount ? { pushReturnTo: location.pathname + location.search } : undefined} replace />
  if (switchingForPush) return <div className="flex h-full min-h-screen flex-col items-center justify-center gap-4 bg-bg px-5 text-center" role="status">
    {pushError ? <>
      <p className="max-w-sm text-sm text-text-muted">{pushError}</p>
      <Button variant="secondary" onClick={() => window.location.replace('/plans')}>Відкрити плани</Button>
    </> : <p className="text-sm text-text-muted">Відкриваємо потрібний профіль…</p>}
  </div>
  return <>
    <NavigationSession key={session.user.id} userId={session.user.id}>{children}</NavigationSession>
    {switching && <div className="fixed inset-0 z-[100] cursor-progress" role="status" aria-label="Перемикання акаунта" />}
  </>
}
