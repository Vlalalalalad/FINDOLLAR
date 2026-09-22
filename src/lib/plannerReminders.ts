import type { TaskReminderEvent } from '../types/planner'

export type ReminderReceipts = Record<string, number>
export const REMINDER_CATCHUP_MS = 24 * 60 * 60 * 1000
export function pendingReminders(events: readonly TaskReminderEvent[], receipts: ReminderReceipts, now: number) {
  return events.filter(event => {
    const due = event.dueAt.getTime()
    return due <= now && due > now - REMINDER_CATCHUP_MS && !receipts[event.id] && event.occurrence.status !== 'completed'
  }).sort((a, b) => b.dueAt.getTime() - a.dueAt.getTime())
}
export function pruneReceipts(receipts: ReminderReceipts, now: number): ReminderReceipts {
  return Object.fromEntries(Object.entries(receipts).filter(([, time]) => Number.isFinite(time) && time > now - 7 * REMINDER_CATCHUP_MS))
}
