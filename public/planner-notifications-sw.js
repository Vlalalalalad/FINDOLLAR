/* Loaded by the existing Workbox worker; keeps the PWA cache lifecycle intact. */
const receiptMemory = new Map()
let deviceAccountCount = 1
function receiptDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('findossar-planner-notification-receipts', 2)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('receipts')) {
        const store = request.result.createObjectStore('receipts', { keyPath: 'key' })
        store.createIndex('at', 'at')
      }
      if (!request.result.objectStoreNames.contains('settings')) {
        request.result.createObjectStore('settings', { keyPath: 'key' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
async function readDeviceAccountCount() {
  try {
    const db = await receiptDatabase()
    const stored = await new Promise((resolve, reject) => {
      const tx = db.transaction('settings', 'readonly')
      const request = tx.objectStore('settings').get('account-count')
      request.onsuccess = () => resolve(request.result?.value)
      request.onerror = () => reject(request.error)
    }).finally(() => db.close())
    if (Number.isInteger(stored) && stored >= 0) deviceAccountCount = stored
  } catch { /* Use the in-memory/default single-account presentation. */ }
  return deviceAccountCount
}
async function saveDeviceAccountCount(value) {
  deviceAccountCount = Number.isInteger(value) ? Math.max(0, Math.min(20, value)) : 1
  try {
    const db = await receiptDatabase()
    await new Promise((resolve, reject) => {
      const tx = db.transaction('settings', 'readwrite')
      tx.objectStore('settings').put({ key: 'account-count', value: deviceAccountCount })
      tx.oncomplete = resolve
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    }).finally(() => db.close())
  } catch { /* The live worker still uses the current in-memory count. */ }
}
async function claimReceipt(key) {
  const now = Date.now()
  const cutoff = now - 7 * 86400000
  const memory = receiptMemory.get(key)
  if (memory && ((memory.delivered && memory.at > cutoff) || memory.leaseUntil > now)) return false
  // Claim in memory before the first await. If IndexedDB is blocked, concurrent
  // push events in this worker still cannot both display the same occurrence.
  receiptMemory.set(key, { at: now, delivered: false, leaseUntil: now + 30000 })
  try {
    const db = await receiptDatabase()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('receipts', 'readwrite')
      const store = tx.objectStore('receipts')
      let claimed = false
      const request = store.get(key)
      request.onsuccess = () => {
        const row = request.result
        if (row?.delivered && row.at > cutoff) {
          receiptMemory.set(key, { at: row.at, delivered: true, leaseUntil: 0 })
          return
        }
        if (row?.leaseUntil > now) {
          receiptMemory.set(key, { at: row.at ?? now, delivered: false, leaseUntil: row.leaseUntil })
          return
        }
        store.put({ key, at: now, delivered: false, leaseUntil: now + 30000 })
        claimed = true
      }
      const expired = store.index('at').openCursor(IDBKeyRange.upperBound(cutoff))
      let pruned = 0
      expired.onsuccess = () => {
        const cursor = expired.result
        if (cursor && pruned++ < 200) {
          if (cursor.primaryKey !== key) cursor.delete()
          cursor.continue()
        }
      }
      tx.oncomplete = () => { db.close(); resolve(claimed) }
      tx.onerror = () => { db.close(); reject(tx.error) }
      tx.onabort = () => { db.close(); reject(tx.error) }
    })
  } catch { return true }
}
async function finishReceipt(key, delivered) {
  if (delivered) receiptMemory.set(key, { at: Date.now(), delivered: true, leaseUntil: 0 })
  else receiptMemory.delete(key)
  try {
    const db = await receiptDatabase()
    await new Promise((resolve, reject) => {
      const tx = db.transaction('receipts', 'readwrite')
      tx.objectStore('receipts').put({ key, at: Date.now(), delivered, leaseUntil: 0 })
      tx.oncomplete = resolve
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    }).finally(() => db.close())
  } catch { /* A live worker still holds the successful delivery receipt. */ }
  for (const [id, receipt] of receiptMemory) if (receipt.at < Date.now() - 7 * 86400000) receiptMemory.delete(id)
}
async function clearAccountReceipts(userId) {
  const prefix = userId + ':'
  receiptMemory.forEach((_value, key) => { if (key.startsWith(prefix)) receiptMemory.delete(key) })
  try {
    const db = await receiptDatabase()
    await new Promise((resolve, reject) => {
      const tx = db.transaction('receipts', 'readwrite')
      const cursor = tx.objectStore('receipts').openCursor()
      cursor.onsuccess = () => {
        const current = cursor.result
        if (!current) return
        if (typeof current.key === 'string' && current.key.startsWith(prefix)) current.delete()
        current.continue()
      }
      tx.oncomplete = resolve
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    }).finally(() => db.close())
  } catch { /* Browser storage can be unavailable; backend unlink remains authoritative. */ }
}
const pushId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const pushDate = /^\d{4}-\d{2}-\d{2}$/
function reminderUrl(payload) {
  const params = new URLSearchParams()
  if (pushId.test(payload.userId ?? '')) params.set('pushAccount', payload.userId)
  if (pushId.test(payload.taskId ?? '')) params.set('task', payload.taskId)
  if (pushDate.test(payload.occurrenceDate ?? '')) params.set('occurrence', payload.occurrenceDate)
  if (pushDate.test(payload.date ?? '')) params.set('date', payload.date)
  const query = params.toString()
  return '/plans' + (query ? '?' + query : '')
}
function clipped(value, maximum) {
  return Array.from(typeof value === 'string' ? value.trim() : '').slice(0, maximum).join('')
}
function notificationDestination(path) {
  try {
    const url = new URL(typeof path === 'string' ? path : '/plans', self.location.origin)
    if (url.origin === self.location.origin && url.pathname === '/plans') return url.href
  } catch { /* Use the safe plans fallback. */ }
  return new URL('/plans', self.location.origin).href
}

self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let payload
    try { payload = event.data?.json() } catch { /* A push must still show a visible notification. */ }
    if (!payload || payload.type !== 'planner-reminder' || typeof payload.title !== 'string'
      || typeof payload.userId !== 'string' || typeof payload.eventId !== 'string') {
      await self.registration.showNotification('Нагадування', {
        badge: '/icons/notification-badge.png', data: { url: '/plans' },
      })
      return
    }
    const receiptKey = payload.userId + ':' + payload.eventId
    if (!await claimReceipt(receiptKey)) return
    const url = reminderUrl(payload)
    const planTitle = clipped(payload.title, 120) || 'Нагадування'
    const description = clipped(payload.description, 240)
    const profileName = clipped(payload.profileName, 80) || 'Без назви'
    const showProfileName = await readDeviceAccountCount() >= 2
    const title = showProfileName ? profileName : planTitle
    const body = showProfileName ? [planTitle, description].filter(Boolean).join('\n') : description
    const options = {
      tag: 'planner:' + payload.userId + ':' + payload.eventId,
      badge: '/icons/notification-badge.png',
      data: { url, userId: payload.userId, eventId: payload.eventId },
    }
    if (body) options.body = body
    try {
      await self.registration.showNotification(title, options)
      await finishReceipt(receiptKey, true)
    } catch (error) { await finishReceipt(receiptKey, false); throw error }
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    windows.forEach(client => client.postMessage({ type: 'planner-reminder', userId: payload.userId }))
  })())
})

self.addEventListener('message', event => {
  const message = event.data
  if (message?.type === 'planner-account-count') {
    event.waitUntil(saveDeviceAccountCount(message.accountCount))
    return
  }
  if (message?.type !== 'planner-remove-account' || !pushId.test(message.userId ?? '')) return
  event.waitUntil((async () => {
    await clearAccountReceipts(message.userId)
    const notifications = await self.registration.getNotifications()
    notifications.filter(item => item.data?.userId === message.userId).forEach(item => item.close())
  })())
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  event.waitUntil((async () => {
    const destination = notificationDestination(event.notification.data?.url)
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const existing = windows.find(client => new URL(client.url).origin === self.location.origin)
    if (existing) {
      try {
        const navigated = await existing.navigate(destination)
        if (navigated) { await navigated.focus(); return }
      } catch { /* Open a window if this browser cannot navigate the old client. */ }
    }
    await self.clients.openWindow(destination)
  })())
})
