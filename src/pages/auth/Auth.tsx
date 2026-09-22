import { useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { Button, Input, Label } from '../../components/ui'
import { readNavigation } from '../../lib/navigationState'
import { AccountManager } from '../../components/AccountSwitcher'

type Mode = 'login' | 'register' | 'reset'

export function Auth() {
  const { session, loading: sessionLoading, signIn, signUp, resetPassword, sessionError, retrySession } = useAuth()
  const location = useLocation()
  const pushReturnTo = (location.state as { pushReturnTo?: unknown } | null)?.pushReturnTo
  const destination = typeof pushReturnTo === 'string' && /^\/plans\?/.test(pushReturnTo)
    && new URLSearchParams(pushReturnTo.slice(pushReturnTo.indexOf('?'))).has('pushAccount')
    ? pushReturnTo : null
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  if (sessionLoading) return <div className="h-full bg-bg" role="status" aria-label="Завантаження" />
  if (session) return <Navigate to={destination ?? readNavigation(session.user.id).path} replace />

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setMessage(null)
    setLoading(true)
    try {
      if (mode === 'login') {
        await signIn(email, password)
      } else if (mode === 'register') {
        await signUp(email, password)
        setMessage('Перевір пошту — надіслали посилання для підтвердження акаунту.')
      } else {
        await resetPassword(email)
        setMessage('Перевір пошту — надіслали посилання для відновлення пароля.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Щось пішло не так')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-8">
        <div className="brand-wordmark mb-6 text-center text-2xl font-extrabold text-text">
          FINDO<span className="brand-wordmark-dollar">$$</span>AR
        </div>
        {sessionError && (
          <div className="motion-soft-enter mb-4 flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-2 px-4 py-3 text-sm text-text-muted">
            <span>Немає зв'язку з сервером</span>
            <button
              type="button"
              onClick={retrySession}
              className="shrink-0 font-medium text-primary transition-colors hover:text-primary-dark"
            >
              Спробувати ще
            </button>
          </div>
        )}
        <AccountManager compact />
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <Label>Email</Label>
            <Input
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>
          {mode !== 'reset' && (
            <div className="motion-soft-enter">
              <Label>Пароль</Label>
              <Input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>
          )}
          {error && <p className="motion-soft-enter text-sm text-danger">{error}</p>}
          {message && <p className="motion-soft-enter text-sm text-success">{message}</p>}
          <Button type="submit" disabled={loading}>
            {mode === 'login' ? 'Увійти' : mode === 'register' ? 'Зареєструватися' : 'Надіслати посилання'}
          </Button>
        </form>
        <div className="mt-5 flex flex-col items-center gap-2 text-sm text-text-muted">
          {mode !== 'login' && <button onClick={() => setMode('login')}>Вже є акаунт? Увійти</button>}
          {mode !== 'register' && <button onClick={() => setMode('register')}>Створити новий акаунт</button>}
          {mode !== 'reset' && <button onClick={() => setMode('reset')}>Забув(-ла) пароль?</button>}
        </div>
      </div>
    </div>
  )
}
