import type { Session } from '@supabase/supabase-js'

// Same device/origin storage boundary as Supabase's existing persistent session.
// Passwords are never retained. Tokens must never be included in UI metadata/logs.
export const ACCOUNT_SESSIONS_KEY = 'findollar:account-sessions:v1'
export const LAST_ACCOUNT_KEY = 'findollar:last-account'
export const ACCOUNT_SESSIONS_CHANGED_EVENT = 'findollar:account-sessions-changed'
export type SavedAccount = { id: string; email: string; full_name?: string | null }
export type SavedSession = SavedAccount & { access_token: string; refresh_token: string }

const notifyAccountChange = () => window.dispatchEvent(new Event(ACCOUNT_SESSIONS_CHANGED_EVENT))

export function accountLabel(account: SavedAccount): string {
  return account.full_name?.trim() || 'Без назви'
}

export function readAccountSessions(): SavedSession[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(ACCOUNT_SESSIONS_KEY) ?? '[]')
    if (!Array.isArray(value)) return []
    const accounts = new Map<string, SavedSession>()
    for (const item of value) {
      if (item && typeof item.id === 'string' && typeof item.email === 'string'
        && typeof item.access_token === 'string' && item.access_token
        && typeof item.refresh_token === 'string' && item.refresh_token) accounts.set(item.id, {
          id: item.id, email: item.email,
          // Read the previous local format, but keep the profile's existing field name going forward.
          full_name: typeof item.full_name === 'string' ? item.full_name.trim()
            : typeof item.displayName === 'string' ? item.displayName.trim() : null,
          access_token: item.access_token, refresh_token: item.refresh_token,
        })
    }
    return [...accounts.values()]
  } catch { return [] }
}

export function rememberAccount(session: Session) {
  const accounts = readAccountSessions()
  const index = accounts.findIndex(item => item.id === session.user.id)
  const previous = index >= 0 ? accounts[index] : null
  const updated = { id: session.user.id, email: session.user.email ?? '', full_name: previous?.full_name, access_token: session.access_token, refresh_token: session.refresh_token }
  // A token refresh or account switch must not move a row beneath a finger.
  if (index >= 0) accounts[index] = updated
  else accounts.push(updated)
  localStorage.setItem(ACCOUNT_SESSIONS_KEY, JSON.stringify(accounts))
  notifyAccountChange()
}

export function forgetSavedAccount(id: string) {
  const remaining = readAccountSessions().filter(item => item.id !== id)
  localStorage.setItem(ACCOUNT_SESSIONS_KEY, JSON.stringify(remaining))
  if (localStorage.getItem(LAST_ACCOUNT_KEY) === id) {
    if (remaining[0]) localStorage.setItem(LAST_ACCOUNT_KEY, remaining[0].id)
    else localStorage.removeItem(LAST_ACCOUNT_KEY)
  }
  notifyAccountChange()
}

export function setSavedAccountProfileName(id: string, fullName: string | null) {
  const normalized = fullName?.trim() || null
  const saved = readAccountSessions()
  if (!saved.some(item => item.id === id && item.full_name !== normalized)) return
  const accounts = saved.map(item => item.id === id
    ? { ...item, full_name: normalized }
    : item)
  localStorage.setItem(ACCOUNT_SESSIONS_KEY, JSON.stringify(accounts))
  notifyAccountChange()
}

export function accountMetadata(): SavedAccount[] {
  return readAccountSessions().map(({ id, email, full_name }) => ({ id, email, full_name }))
}
