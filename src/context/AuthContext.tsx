import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase, createAccountAuthClient } from '../lib/supabase'
import { accountMetadata, forgetSavedAccount, readAccountSessions, rememberAccount, setSavedAccountProfileName, ACCOUNT_SESSIONS_CHANGED_EVENT, ACCOUNT_SESSIONS_KEY, LAST_ACCOUNT_KEY, type SavedAccount } from '../lib/accountSessions'
import { clearAccountDeviceState, LEGACY_STORAGE_OWNER } from '../lib/accountStorage'
import { clearPlannerDeviceNotifications, disconnectPlannerAccount, syncPlannerPush } from '../lib/plannerNotifications'

interface AuthContextValue {
  session: Session | null
  user: User | null
  loading: boolean
  sessionError: boolean
  retrySession: () => void
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string) => Promise<void>
  signOut: (options?: { skipDeviceCleanup?: boolean }) => Promise<void>
  resetPassword: (email: string) => Promise<void>
  accounts: SavedAccount[]
  switching: boolean
  accountStorageError: string | null
  addAccount: (email: string, password: string) => Promise<void>
  switchAccount: (id: string) => Promise<void>
  removeAccount: (id: string) => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

const SESSION_TIMEOUT_MS = 15_000

/** Read each profile only through the client authenticated as that account. */
async function syncSavedProfileName(client: typeof supabase, userId: string) {
  const { data, error } = await client.from('profiles').select('full_name').eq('id', userId).maybeSingle()
  if (!error && data) setSavedAccountProfileName(userId, data.full_name)
}

// Обгортає проміс таймаутом: якщо сервер завис, чекаємо не довше
// SESSION_TIMEOUT_MS — краще показати "немає зв'язку" з кнопкою повтору,
// ніж вічно сидіти на "Завантаження...". Якщо відповідь приходить швидко,
// жодних додаткових затримок немає.
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Session check timed out')), ms)
    promise.then(
      value => {
        clearTimeout(timer)
        resolve(value)
      },
      error => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [sessionError, setSessionError] = useState(false)
  const [accounts, setAccounts] = useState(accountMetadata)
  const [switching, setSwitching] = useState(false)
  const [accountStorageError, setAccountStorageError] = useState<string | null>(null)
  const sessionRef = useRef<Session | null>(null)
  const changingAccount = useRef(false)
  const saveSession = useCallback((next: Session) => {
    try {
      rememberAccount(next)
      localStorage.setItem(LAST_ACCOUNT_KEY, next.user.id)
      if (!localStorage.getItem(LEGACY_STORAGE_OWNER)) localStorage.setItem(LEGACY_STORAGE_OWNER, next.user.id)
      setAccountStorageError(null)
    } catch { setAccountStorageError('Не вдалося зберегти авторизацію на пристрої. Перевірте доступ до сховища браузера.') }
    setAccounts(accountMetadata())
  }, [])
  const applySession = useCallback((next: Session | null) => {
    const previous = sessionRef.current
    // Token refresh / foreground SIGNED_IN is not a new UI session. Keep the
    // stable user identity so form data hooks do not reinitialize on resume.
    const stable = next && previous?.user.id === next.user.id ? { ...next, user: previous.user } : next
    sessionRef.current = stable
    setSession(stable)
    if (stable) saveSession(stable)
    if (stable && previous?.user.id !== stable.user.id) {
      const owner = stable.user.id
      setTimeout(() => {
        if (sessionRef.current?.user.id !== owner || changingAccount.current) return
        void supabase.rpc('ensure_default_categories')
        void syncSavedProfileName(supabase, owner).catch(() => { /* Keep the last known local label while offline. */ })
      }, 0)
    }
  }, [saveSession])
  // Лічильник спроб: якщо юзер натиснув "Спробувати ще", поки стара
  // перевірка ще висить, її пізній результат треба проігнорувати.
  const attemptRef = useRef(0)

  const checkSession = useCallback(async () => {
    const attempt = ++attemptRef.current
    setLoading(true)
    setSessionError(false)
    try {
      const { data } = await withTimeout(supabase.auth.getSession(), SESSION_TIMEOUT_MS)
      if (attempt !== attemptRef.current) return
      applySession(data.session)
      setLoading(false)
      // Категорії за замовчуванням мали б з'явитись самі при реєстрації
      // (тригер на auth.users), але якщо схему колись перестворили без
      // нового signup (наприклад, після ручного очищення БД) — тригер
      // не спрацює повторно для вже існуючого юзера. Ця перевірка сама
      // добавляє дефолтні категорії, якщо їх зараз нуль, і нічого не
      // робить, якщо вони вже є.
    } catch {
      if (attempt !== attemptRef.current) return
      setSessionError(true)
      setLoading(false)
    }
  }, [applySession])

  useEffect(() => {
    checkSession()
    const { data: listener } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (changingAccount.current) return
      // INITIAL_SESSION must not overwrite a newer completed auth operation.
      if (event !== 'INITIAL_SESSION') attemptRef.current += 1
      if (event === 'SIGNED_OUT' && sessionRef.current) {
        try { forgetSavedAccount(sessionRef.current.user.id) } catch { /* Still clear the live session. */ }
        setAccounts(accountMetadata())
      }
      applySession(newSession)
      // Якщо сесія все ж прилетіла пізніше (повільний сервер відповів
      // вже після таймаута) — прибираємо застарілий стан помилки.
      if (newSession) setSessionError(false)
      if (newSession || event === 'SIGNED_OUT') setLoading(false)
    })
    const updateAccounts = (event: StorageEvent) => { if (event.key === ACCOUNT_SESSIONS_KEY) setAccounts(accountMetadata()) }
    const updateLocalAccounts = () => setAccounts(accountMetadata())
    window.addEventListener('storage', updateAccounts)
    window.addEventListener(ACCOUNT_SESSIONS_CHANGED_EVENT, updateLocalAccounts)
    return () => { listener.subscription.unsubscribe(); window.removeEventListener('storage', updateAccounts); window.removeEventListener(ACCOUNT_SESSIONS_CHANGED_EVENT, updateLocalAccounts) }
  }, [checkSession, applySession])

  useEffect(() => {
    let cancelled = false
    // Refresh even previously saved labels: older installs may have cached a
    // wrong name. Every lookup uses that account's own token, never another
    // account's RLS context.
    const hydrateNames = async () => {
      const activeId = localStorage.getItem(LAST_ACCOUNT_KEY)
      for (const saved of readAccountSessions()) {
        if (cancelled) return
        if (saved.id === activeId || changingAccount.current) continue
        const client = createAccountAuthClient()
        try {
          const { data, error } = await client.auth.setSession({ access_token: saved.access_token, refresh_token: saved.refresh_token })
          if (cancelled || changingAccount.current || error || data.session?.user.id !== saved.id) continue
          rememberAccount(data.session)
          await syncSavedProfileName(client, saved.id)
          await syncPlannerPush(saved.id, client)
        } catch { /* Offline or expired: keep the neutral label until this account is opened. */ }
        finally { await client.auth.dispose() }
      }
    }
    void hydrateNames()
    return () => { cancelled = true }
  }, [])

  const activate = async (next: Session) => {
    const previous = sessionRef.current
    setSwitching(true)
    attemptRef.current += 1
    try {
      const { data, error } = await supabase.auth.setSession({ access_token: next.access_token, refresh_token: next.refresh_token })
      if (error) throw error
      if (!data.session || data.session.user.id !== next.user.id) throw new Error('Не вдалося підтвердити акаунт.')
      applySession(data.session)
      setSessionError(false)
    } catch (error) {
      // Validation happens on a separate client first; if committing still
      // fails, never leave another account's token behind the previous UI.
      if (previous) {
        const restored = await supabase.auth.setSession({ access_token: previous.access_token, refresh_token: previous.refresh_token })
        if (!restored.error && restored.data.session?.user.id === previous.user.id) applySession(restored.data.session)
        else { await supabase.auth.signOut({ scope: 'local' }); applySession(null) }
      } else { await supabase.auth.signOut({ scope: 'local' }); applySession(null) }
      throw error
    } finally { setSwitching(false) }
  }

  const switchAccount = async (id: string) => {
    if (id === sessionRef.current?.user.id || changingAccount.current) return
    const saved = readAccountSessions().find(item => item.id === id)
    if (!saved) throw new Error('Акаунт більше не збережений на цьому пристрої. Додайте його знову.')
    changingAccount.current = true
    const client = createAccountAuthClient()
    try {
      const { data, error } = await client.auth.setSession({ access_token: saved.access_token, refresh_token: saved.refresh_token })
      if (error) throw new Error('Не вдалося відкрити сесію. Перевірте інтернет; якщо авторизація завершилась, додайте акаунт знову.')
      if (!data.session || data.session.user.id !== id) throw new Error('Збережена сесія не відповідає акаунту. Додайте його знову.')
      rememberAccount(data.session) // Persist rotated inactive refresh token before activating.
      await syncSavedProfileName(client, id)
      await activate(data.session)
    } finally { changingAccount.current = false; await client.auth.dispose(); setAccounts(accountMetadata()) }
  }

  const addAccount = async (email: string, password: string) => {
    if (changingAccount.current) throw new Error('Зачекайте завершення перемикання.')
    changingAccount.current = true
    const client = createAccountAuthClient()
    try {
      const { data, error } = await client.auth.signInWithPassword({ email, password })
      if (error) throw error
      if (!data.session) throw new Error('Потрібно підтвердити вхід до акаунта.')
      rememberAccount(data.session)
      await syncSavedProfileName(client, data.session.user.id)
      await activate(data.session)
    } finally { changingAccount.current = false; await client.auth.dispose(); setAccounts(accountMetadata()) }
  }

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }

  const signUp = async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({ email, password })
    if (error) throw error
  }

  const signOut = async (options?: { skipDeviceCleanup?: boolean }) => {
    const id = sessionRef.current?.user.id
    if (changingAccount.current) throw new Error('Зачекайте завершення перемикання.')
    if (id && !options?.skipDeviceCleanup) await disconnectPlannerAccount(id)
    if (id && options?.skipDeviceCleanup) await clearPlannerDeviceNotifications(id)
    const { error } = await supabase.auth.signOut({ scope: 'local' })
    if (error) throw error
    if (id) {
      clearAccountDeviceState(id)
      forgetSavedAccount(id)
    }
    applySession(null)
    setAccounts(accountMetadata())
  }

  const removeAccount = async (id: string) => {
    if (id === sessionRef.current?.user.id) return signOut()
    if (changingAccount.current) throw new Error('Зачекайте завершення перемикання.')
    const saved = readAccountSessions().find(item => item.id === id)
    if (!saved) return
    changingAccount.current = true
    const client = createAccountAuthClient()
    try {
      const { data, error } = await client.auth.setSession({ access_token: saved.access_token, refresh_token: saved.refresh_token })
      if (error || data.session?.user.id !== id) throw new Error('Не вдалося підтвердити акаунт для безпечного видалення з пристрою.')
      await disconnectPlannerAccount(id, client)
      clearAccountDeviceState(id)
      forgetSavedAccount(id)
      setAccounts(accountMetadata())
    } finally {
      changingAccount.current = false
      await client.auth.dispose()
    }
  }

  const resetPassword = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    })
    if (error) throw error
  }

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        loading,
        sessionError,
        retrySession: checkSession,
        signIn,
        signUp,
        signOut,
        resetPassword,
        accounts, switching, accountStorageError, addAccount, switchAccount, removeAccount,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
