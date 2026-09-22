// Scheduled transport for planner reminders, including when the app is closed.
// Deploy with --no-verify-jwt and call with Authorization: Bearer PLANNER_CRON_SECRET.
// The secret is independent of user JWTs; service-role/VAPID secrets never reach clients.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import webPush from 'npm:web-push@3.6.7'

type Subscription = {
  id: string; user_id: string; endpoint: string; p256dh: string; auth: string; timezone: string
}
type Reminder = {
  event_id: string
  task_id: string
  title: string
  description: string | null
  profile_name: string
  occurrence_date: string
  date: string
  time: string | null
  minutes_before: number
  due_at: string
  lease_token: string
}

const MAX_SUBSCRIPTIONS = 80
const EVENTS_PER_SUBSCRIPTION = 8
const CONCURRENCY = 4
const RUN_BUDGET_MS = 45_000

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
}

async function equalSecret(actual: string, expected: string) {
  const encoder = new TextEncoder()
  const [a, b] = await Promise.all([actual, expected].map(value => crypto.subtle.digest('SHA-256', encoder.encode(value))))
  const left = new Uint8Array(a); const right = new Uint8Array(b)
  let difference = 0
  for (let index = 0; index < left.length; index++) difference |= left[index] ^ right[index]
  return difference === 0
}

// Keep this trusted Web Push service list in sync with the database CHECK.
// Arbitrary client-provided hosts would create a server-side request forgery
// path, including DNS rebinding to private IP addresses.
function allowedEndpoint(value: string) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || value.length > 4096) return false
    const hostname = url.hostname.toLowerCase()
    const trusted = hostname === 'fcm.googleapis.com'
      || hostname === 'push.services.mozilla.com'
      || hostname.endsWith('.push.services.mozilla.com')
      || /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.push\.apple\.com$/.test(hostname)
      || /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.notify\.windows\.com$/.test(hostname)
    return trusted && /^https:\/\/[^\s#]+$/i.test(value)
  } catch { return false }
}

function clipped(value: string | null | undefined, maximum: number) {
  return Array.from(value?.trim() ?? '').slice(0, maximum).join('')
}

function retryAfterSeconds(error: unknown) {
  const headers = (error as { headers?: Record<string, string> })?.headers
  const value = headers?.['retry-after']
  if (!value) return null
  const seconds = /^\d+$/.test(value) ? Number(value) : Math.ceil((Date.parse(value) - Date.now()) / 1000)
  return Number.isFinite(seconds) ? Math.max(30, Math.min(3600, seconds)) : null
}

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const cronSecret = Deno.env.get('PLANNER_CRON_SECRET')
  if (!cronSecret || cronSecret.length < 32) return json({ error: 'Reminder transport is not configured' }, 503)
  const supplied = request.headers.get('Authorization') ?? ''
  if (supplied.length > 1024 || !await equalSecret(supplied, `Bearer ${cronSecret}`)) return json({ error: 'Unauthorized' }, 401)

  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY')
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY')
  const subject = Deno.env.get('VAPID_SUBJECT')
  if (!url || !serviceKey || !publicKey || !privateKey || !subject || !/^(mailto:|https:\/\/)/.test(subject)) {
    return json({ error: 'Reminder transport is not configured' }, 503)
  }

  const database = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, {
      ...init, signal: init?.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(12_000)]) : AbortSignal.timeout(12_000),
    }) },
  })
  const deadline = Date.now() + RUN_BUDGET_MS
  const totals = { subscriptions: 0, accepted: 0, retrying: 0, expired: 0, deferred: 0, failures: 0 }
  try {
    // Validate VAPID configuration before claiming any events. No sensitive
    // exceptions are logged or returned (web-push errors contain endpoint/body).
    webPush.setVapidDetails(subject, publicKey, privateKey)
    await database.rpc('prune_planner_push_receipts', { p_limit: 2000 })
    const { data, error } = await database.from('planner_push_subscriptions')
      .select('id,user_id,endpoint,p256dh,auth,timezone').eq('enabled', true)
      .order('last_checked_at', { ascending: true, nullsFirst: true }).order('id')
      .range(0, MAX_SUBSCRIPTIONS - 1)
    if (error) return json({ error: 'Could not load reminder subscriptions' }, 500)
    const subscriptions = (data ?? []) as Subscription[]
    let cursor = 0

    async function finish(subscription: Subscription, event: Reminder, outcome: 'delivered' | 'retry' | 'expired', retrySeconds: number | null = null) {
      const { error } = await database.rpc('finish_planner_push_reminder', {
        p_subscription_id: subscription.id, p_event_id: event.event_id,
        p_lease_token: event.lease_token, p_outcome: outcome, p_retry_seconds: retrySeconds,
      })
      if (error) totals.failures++ // Lease expiry recovers a lost acknowledgement.
    }

    async function worker() {
      while (cursor < subscriptions.length && Date.now() < deadline) {
        const subscription = subscriptions[cursor++]
        totals.subscriptions++
        if (!allowedEndpoint(subscription.endpoint)) {
          await database.from('planner_push_subscriptions').update({ enabled: false }).eq('id', subscription.id)
          totals.expired++
          continue
        }
        const { data: claimed, error } = await database.rpc('claim_planner_push_reminders_v2', {
          p_subscription_id: subscription.id, p_limit: EVENTS_PER_SUBSCRIPTION,
        })
        if (error) { totals.failures++; continue }
        let subscriptionExpired = false
        for (const event of (claimed ?? []) as Reminder[]) {
          if (Date.now() >= deadline) { totals.deferred++; continue }
          if (subscriptionExpired) { await finish(subscription, event, 'expired'); continue }
          const ageSeconds = Math.max(0, Math.floor((Date.now() - Date.parse(event.due_at)) / 1000))
          const ttl = Math.max(0, 86_400 - ageSeconds)
          // Bound the payload well below Web Push's encrypted payload limit.
          const title = clipped(event.title, 160) || 'FINDOLLAR'
          const description = clipped(event.description, 240)
          const profileName = clipped(event.profile_name, 80) || 'Без назви'
          const body = [description, profileName].filter(Boolean).join('\n')
          const payload = JSON.stringify({
            type: 'planner-reminder',
            userId: subscription.user_id,
            eventId: event.event_id,
            taskId: event.task_id,
            occurrenceDate: event.occurrence_date,
            date: event.date,
            title,
            description,
            profileName,
            minutesBefore: event.minutes_before,
            scheduledTime: event.time,
            body,
          })
          try {
            await webPush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
              payload,
              { TTL: ttl, urgency: 'high', timeout: Math.min(8000, Math.max(1000, deadline - Date.now())) })
            await finish(subscription, event, 'delivered')
            totals.accepted++
          } catch (failure) {
            const status = Number((failure as { statusCode?: number })?.statusCode)
            if (status === 404 || status === 410) {
              subscriptionExpired = true
              await finish(subscription, event, 'expired')
              totals.expired++
            } else {
              await finish(subscription, event, 'retry', retryAfterSeconds(failure))
              totals.retrying++
            }
          }
        }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))
    totals.deferred += subscriptions.length - cursor
    return json({ success: totals.failures === 0, ...totals }, totals.failures ? 500 : 200)
  } catch {
    return json({ error: 'Reminder transport failed; leased events will be retried' }, 500)
  }
})
