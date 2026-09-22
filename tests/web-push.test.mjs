import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')
const readBytes = path => readFile(new URL(`../${path}`, import.meta.url))
const workerSource = await read('public/planner-notifications-sw.js')
const userId = '11111111-1111-4111-8111-111111111111'
const taskId = '22222222-2222-4222-8222-222222222222'
const payload = {
  type: 'planner-reminder', userId, eventId: `${taskId}:2026-09-21:30:123`, taskId,
  occurrenceDate: '2026-09-21', date: '2026-09-22', title: 'Тренування',
  description: 'Спина та біцепс', profileName: 'Основа',
}

function workerHarness() {
  const handlers = new Map()
  const shown = []
  const posted = []
  const navigated = []
  const focused = []
  const opened = []
  let clients = []
  const self = {
    location: { origin: 'https://findollar.test' },
    addEventListener(type, listener) { handlers.set(type, listener) },
    registration: {
      async showNotification(title, options) { shown.push({ title, options }) },
      async getNotifications() { return [] },
    },
    clients: {
      async matchAll() { return clients },
      async openWindow(url) { opened.push(url) },
    },
  }
  const context = vm.createContext({
    self,
    indexedDB: { open() { throw new Error('IndexedDB unavailable') } },
    IDBKeyRange: { upperBound() { throw new Error('unreachable') } },
    URL,
    URLSearchParams,
    Map,
    Date,
    Promise,
  })
  new vm.Script(workerSource).runInContext(context)
  return {
    handlers, shown, posted, navigated, focused, opened,
    setClients(next) {
      clients = next.map(url => ({
        url,
        postMessage(message) { posted.push(message) },
        async navigate(destination) { navigated.push(destination); return { async focus() { focused.push(destination) } } },
      }))
    },
  }
}

async function dispatch(handler, event) {
  let pending
  handler({ ...event, waitUntil(value) { assert.equal(pending, undefined); pending = value } })
  assert.ok(pending, 'listener must extend the service-worker event')
  await pending
}

async function shownNotification(accountCount, description) {
  const harness = workerHarness()
  await dispatch(harness.handlers.get('message'), {
    data: { type: 'planner-account-count', accountCount },
  })
  await dispatch(harness.handlers.get('push'), {
    data: { json: () => ({ ...payload, eventId: `${payload.eventId}:${accountCount}:${description ?? 'empty'}`, description }) },
  })
  assert.equal(harness.shown.length, 1)
  return harness.shown[0]
}

test('notification delivery is not scheduled by React', async () => {
  const source = await read('src/components/planner/PlannerReminders.tsx')
  assert.doesNotMatch(source, /showNotification\s*\(/)
  assert.doesNotMatch(source, /new\s+Notification\s*\(/)
  assert.doesNotMatch(source, /pendingReminders/)
  assert.match(source, /syncPlannerPush/)
})

test('turning one account off preserves the shared browser subscription', async () => {
  const source = await read('src/lib/plannerNotifications.ts')
  const disable = source.slice(source.indexOf('export async function disablePlannerNotifications'), source.indexOf('export async function syncPlannerPush'))
  assert.match(disable, /update\(\{ enabled: false \}\)/)
  assert.doesNotMatch(disable, /\.unsubscribe\s*\(/)
  assert.doesNotMatch(disable, /\.delete\s*\(/)
  const disconnect = source.slice(source.indexOf('export async function disconnectPlannerAccount'))
  assert.match(disconnect, /\.delete\(\)/)
})

test('service worker delivers concise multi-account presentation once', async () => {
  const harness = workerHarness()
  harness.setClients(['https://findollar.test/plans'])
  await dispatch(harness.handlers.get('message'), {
    data: { type: 'planner-account-count', accountCount: 2 },
  })
  const event = () => ({ data: { json: () => payload } })
  await Promise.all([
    dispatch(harness.handlers.get('push'), event()),
    dispatch(harness.handlers.get('push'), event()),
  ])
  assert.deepEqual([...harness.handlers.keys()].sort(), ['message', 'notificationclick', 'push'])
  assert.equal(harness.shown.length, 1)
  assert.equal(harness.shown[0].title, 'Основа')
  assert.equal(harness.shown[0].options.body, 'Тренування\nСпина та біцепс')
  assert.equal(harness.shown[0].options.tag, `planner:${userId}:${payload.eventId}`)
  assert.equal(harness.shown[0].options.badge, '/icons/notification-badge.png')
  assert.equal(harness.shown[0].options.icon, undefined)
  assert.equal(harness.shown[0].options.image, undefined)
  assert.equal(harness.shown[0].options.data.url, `/plans?pushAccount=${userId}&task=${taskId}&occurrence=2026-09-21&date=2026-09-22`)
  assert.equal(harness.posted.length, 1)
})

test('notification text has the four required single/multi-account shapes', async () => {
  const singleWithDescription = await shownNotification(1, 'Спина та біцепс')
  assert.equal(singleWithDescription.title, 'Тренування')
  assert.equal(singleWithDescription.options.body, 'Спина та біцепс')

  const singleWithoutDescription = await shownNotification(1, '')
  assert.equal(singleWithoutDescription.title, 'Тренування')
  assert.equal(singleWithoutDescription.options.body, undefined)

  const multiWithDescription = await shownNotification(2, 'Спина та біцепс')
  assert.equal(multiWithDescription.title, 'Основа')
  assert.equal(multiWithDescription.options.body, 'Тренування\nСпина та біцепс')

  const multiWithoutDescription = await shownNotification(2, null)
  assert.equal(multiWithoutDescription.title, 'Основа')
  assert.equal(multiWithoutDescription.options.body, 'Тренування')
})

test('notification badge is a small RGBA PNG and no content image is configured', async () => {
  const badge = await readBytes('public/icons/notification-badge.png')
  assert.equal(badge.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
  assert.equal(badge.readUInt32BE(16), 96)
  assert.equal(badge.readUInt32BE(20), 96)
  assert.equal(badge[25], 6)
  assert.doesNotMatch(workerSource, /\bimage\s*:/)
  assert.doesNotMatch(workerSource, /\bicon\s*:/)
  assert.match(workerSource, /badge:\s*'\/icons\/notification-badge\.png'/)
})

test('notification click reuses a window and cannot escape /plans', async () => {
  const existing = workerHarness()
  existing.setClients(['https://findollar.test/profile'])
  await dispatch(existing.handlers.get('notificationclick'), {
    notification: { data: { url: `/plans?pushAccount=${userId}` }, close() {} },
  })
  assert.deepEqual(existing.navigated, [`https://findollar.test/plans?pushAccount=${userId}`])
  assert.deepEqual(existing.focused, existing.navigated)
  assert.deepEqual(existing.opened, [])

  const unsafe = workerHarness()
  await dispatch(unsafe.handlers.get('notificationclick'), {
    notification: { data: { url: '/plans/../auth' }, close() {} },
  })
  assert.deepEqual(unsafe.opened, ['https://findollar.test/plans'])
})

test('sender and schema use the v2 structured payload with bounded subscriptions', async () => {
  const [edge, migration, presentation] = await Promise.all([
    read('supabase/functions/planner-reminders/index.ts'),
    read('supabase/migrations/20260921194048_planner_push_payload.sql'),
    read('src/components/planner/PlannerReminders.tsx'),
  ])
  assert.match(edge, /claim_planner_push_reminders_v2/)
  for (const field of ['taskId', 'occurrenceDate', 'description', 'profileName', 'minutesBefore']) assert.match(edge, new RegExp(field))
  assert.match(edge, /fcm\.googleapis\.com/)
  assert.ok(edge.includes(String.raw`push\.apple\.com`))
  assert.match(migration, /planner_push_trusted_endpoint/)
  assert.match(migration, />= 32/)
  assert.match(migration, /grant execute on function public\.claim_planner_push_reminders_v2/)
  assert.match(presentation, /planner-account-count/)
  assert.match(presentation, /accountCount: accounts\.length/)
})

test('notification routing switches account before opening a plan', async () => {
  const [guard, auth, navigation, plans, accountCleanup] = await Promise.all([
    read('src/components/ProtectedRoute.tsx'),
    read('src/pages/auth/Auth.tsx'),
    read('src/components/NavigationSession.tsx'),
    read('src/pages/Plans.tsx'),
    read('src/context/AuthContext.tsx'),
  ])
  assert.match(guard, /pushAccount/)
  assert.match(guard, /switchAccount\(pushAccount\)/)
  assert.match(guard, /pushReturnTo/)
  assert.match(auth, /pushReturnTo/)
  assert.match(navigation, /pushIntent/)
  assert.match(plans, /params\.get\('task'\)/)
  assert.match(plans, /setHomeSelection/)
  assert.match(plans, /navigate\('\/plans', \{ replace: true \}\)/)
  assert.match(accountCleanup, /clearPlannerDeviceNotifications/)
})
