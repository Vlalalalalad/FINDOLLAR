import { supabase } from './supabase'

export const NOTIFICATION_CHANGE = 'planner-notification-change'
const preferenceKey = (userId: string) => `findossar-planner-notifications:${userId}`
const pushKey = (userId: string) => `findossar-planner-push:${userId}`
export const seenKey = (userId: string) => `findossar-planner-seen:${userId}`

export type PlannerNotificationState = {
  available: boolean
  enabled: boolean
  message: string
}

export function readNotificationValue(key: string) {
  try { return localStorage.getItem(key) } catch { return null }
}

export function writeNotificationValue(key: string, value: string | null) {
  try {
    if (localStorage.getItem(key) === value) return
    if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value)
  } catch { /* Optional device state. */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(NOTIFICATION_CHANGE))
}

/** A fast local hint only. The profile toggle always verifies the browser and backend. */
export const notificationsEnabled = (userId: string) => readNotificationValue(preferenceKey(userId)) === '1'
export const backgroundPushEnabled = (userId: string) => notificationsEnabled(userId) && !!readNotificationValue(pushKey(userId))
export const backgroundPushConfigured = () => !!import.meta.env.VITE_WEB_PUSH_PUBLIC_KEY

function supportState(): PlannerNotificationState {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return { available: false, enabled: false, message: 'Фонові сповіщення недоступні в цьому режимі.' }
  }
  if (!window.isSecureContext || !('serviceWorker' in navigator) || !('PushManager' in window) || typeof Notification === 'undefined') {
    return { available: false, enabled: false, message: 'Цей браузер або режим не підтримує фонові сповіщення. На iPhone та iPad відкрийте встановлений застосунок з головного екрана.' }
  }
  if (!backgroundPushConfigured()) {
    return { available: false, enabled: false, message: 'Фонові сповіщення ще не налаштовані для цього застосунку.' }
  }
  if (Notification.permission === 'denied') {
    return { available: false, enabled: false, message: 'Сповіщення заблоковані. Дозвольте їх у налаштуваннях сайту або пристрою.' }
  }
  return { available: true, enabled: false, message: '' }
}

function publicKeyBytes(value: string): Uint8Array<ArrayBuffer> {
  try {
    const decoded = atob(value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '='))
    const bytes = Uint8Array.from(decoded, character => character.charCodeAt(0))
    if (bytes.length !== 65 || bytes[0] !== 4) throw new Error('Invalid public key')
    return bytes
  } catch {
    throw new Error('Фонові сповіщення мають некоректне налаштування. Зверніться до адміністратора застосунку.')
  }
}

function sameServerKey(subscription: PushSubscription, expected: Uint8Array<ArrayBuffer>) {
  const current = subscription.options.applicationServerKey
  if (!current) return false
  const bytes = new Uint8Array(current)
  return bytes.byteLength === expected.byteLength && bytes.every((byte, index) => byte === expected[index])
}

function timezone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } catch { return 'UTC' }
}

async function currentSubscription() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null
  const registration = await navigator.serviceWorker.getRegistration()
  return registration ? registration.pushManager.getSubscription() : null
}

function storeState(userId: string, enabled: boolean, rowId?: string | null) {
  writeNotificationValue(pushKey(userId), rowId ?? null)
  writeNotificationValue(preferenceKey(userId), enabled ? '1' : null)
}

export async function loadPlannerNotificationState(userId: string, client: typeof supabase = supabase): Promise<PlannerNotificationState> {
  const support = supportState()
  if (!support.available || Notification.permission !== 'granted') {
    storeState(userId, false)
    return support
  }
  try {
    const subscription = await currentSubscription()
    if (!subscription) {
      storeState(userId, false)
      return { ...support, enabled: false }
    }
    const { data, error } = await client.from('planner_push_subscriptions')
      .select('id,enabled').eq('user_id', userId).eq('endpoint', subscription.endpoint).maybeSingle()
    if (error) throw error
    const enabled = data?.enabled === true
    storeState(userId, enabled, data?.id ?? null)
    return { available: true, enabled, message: '' }
  } catch {
    storeState(userId, false)
    return { available: true, enabled: false, message: 'Не вдалося перевірити стан сповіщень. Перевірте з’єднання та спробуйте ще раз.' }
  }
}

/** Call only from the explicit OFF → ON user gesture. */
export async function enablePlannerNotifications(userId: string, client: typeof supabase = supabase) {
  const support = supportState()
  if (!support.available) throw new Error(support.message)

  // Keep the native permission request in the original user activation chain.
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Дозвольте сповіщення в налаштуваннях браузера або пристрою.')

  const registration = await navigator.serviceWorker.ready
  if (!registration.active) throw new Error('Зачекайте, доки застосунок підготується до роботи, та спробуйте ще раз.')
  const keyBytes = publicKeyBytes(import.meta.env.VITE_WEB_PUSH_PUBLIC_KEY ?? '')
  let subscription = await registration.pushManager.getSubscription()
  if (subscription && !sameServerKey(subscription, keyBytes)) {
    // One browser subscription may be linked to several FINDOLLAR accounts.
    // Silently replacing it here would disable those other accounts.
    throw new Error('Підписка браузера створена зі старими налаштуваннями. Вимкніть сповіщення для всіх локальних профілів і ввімкніть їх знову.')
  }
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes })
  }
  const serialized = subscription.toJSON()
  if (!serialized.keys?.p256dh || !serialized.keys.auth) throw new Error('Браузер не надав ключі для фонових сповіщень.')
  const { data, error } = await client.from('planner_push_subscriptions').upsert({
    user_id: userId,
    endpoint: subscription.endpoint,
    p256dh: serialized.keys.p256dh,
    auth: serialized.keys.auth,
    timezone: timezone(),
    enabled: true,
  }, { onConflict: 'user_id,endpoint' }).select('id').single()
  if (error) throw new Error('Не вдалося підключити фонові сповіщення. Перевірте з’єднання та повторіть спробу.')
  storeState(userId, true, data.id)
}

export async function disablePlannerNotifications(userId: string, client: typeof supabase = supabase) {
  const rowId = readNotificationValue(pushKey(userId))
  let subscription: PushSubscription | null = null
  try { subscription = await currentSubscription() } catch { /* The saved row id is still usable. */ }

  if (subscription) {
    const { error } = await client.from('planner_push_subscriptions').update({ enabled: false })
      .eq('user_id', userId).eq('endpoint', subscription.endpoint)
    if (error) throw new Error('Не вдалося вимкнути фонові сповіщення. Перевірте з’єднання та повторіть спробу.')
  } else if (rowId) {
    const { error } = await client.from('planner_push_subscriptions').update({ enabled: false })
      .eq('id', rowId).eq('user_id', userId)
    if (error) throw new Error('Не вдалося вимкнути фонові сповіщення. Перевірте з’єднання та повторіть спробу.')
  }
  // Do not unsubscribe: this physical PushSubscription may serve other local accounts.
  storeState(userId, false, rowId)
}

/** Reconcile this account with the real browser subscription and backend row. */
export async function syncPlannerPush(userId: string, client: typeof supabase = supabase) {
  const support = supportState()
  if (!support.available || Notification.permission !== 'granted') {
    storeState(userId, false)
    return
  }
  const subscription = await currentSubscription()
  if (!subscription) {
    storeState(userId, false)
    return
  }
  const serialized = subscription.toJSON()
  const { data, error } = await client.from('planner_push_subscriptions')
    .select('id,enabled').eq('user_id', userId).eq('endpoint', subscription.endpoint).maybeSingle()
  if (error) throw error
  if (!data?.enabled) {
    storeState(userId, false, data?.id ?? null)
    return
  }
  if (!serialized.keys?.p256dh || !serialized.keys.auth) {
    storeState(userId, false, data.id)
    return
  }
  const { error: updateError } = await client.from('planner_push_subscriptions').update({
    p256dh: serialized.keys.p256dh,
    auth: serialized.keys.auth,
    timezone: timezone(),
  }).eq('id', data.id).eq('user_id', userId)
  if (updateError) throw updateError
  storeState(userId, true, data.id)
}

export function clearPlannerNotificationLocalState(userId: string) {
  writeNotificationValue(pushKey(userId), null)
  writeNotificationValue(preferenceKey(userId), null)
  writeNotificationValue(seenKey(userId), null)
}

/** Clear only this account's browser-side notifications and receipts. */
export async function clearPlannerDeviceNotifications(userId: string) {
  try {
    const registration = await navigator.serviceWorker?.getRegistration()
    registration?.active?.postMessage({ type: 'planner-remove-account', userId })
    const notifications = await registration?.getNotifications()
    notifications?.filter(item => item.data?.userId === userId).forEach(item => item.close())
  } catch { /* Backend unlink is authoritative. */ }
  clearPlannerNotificationLocalState(userId)
}

/** Remove one account from this installation without touching other accounts or devices. */
export async function disconnectPlannerAccount(userId: string, client: typeof supabase = supabase) {
  const rowId = readNotificationValue(pushKey(userId))
  let subscription: PushSubscription | null = null
  try { subscription = await currentSubscription() } catch { /* Fall back to the locally known row id. */ }

  if (subscription) {
    const { error } = await client.from('planner_push_subscriptions').delete()
      .eq('user_id', userId).eq('endpoint', subscription.endpoint)
    if (error) throw new Error('Не вдалося прибрати сповіщення цього акаунта з пристрою.')
  } else if (rowId) {
    const { error } = await client.from('planner_push_subscriptions').delete().eq('id', rowId).eq('user_id', userId)
    if (error) throw new Error('Не вдалося прибрати сповіщення цього акаунта з пристрою.')
  }
  await clearPlannerDeviceNotifications(userId)
}

/** Backward-compatible name used by older call sites. */
export const disconnectPlannerDevice = disconnectPlannerAccount
