export type PlannerTimeMode = 'clock' | 'wheel'

const preferenceKey = (userId?: string) => `findossar:planner-time-mode:${userId ?? 'guest'}`

export function readPlannerTimeMode(userId?: string): PlannerTimeMode {
  try { return localStorage.getItem(preferenceKey(userId)) === 'wheel' ? 'wheel' : 'clock' }
  catch { return 'clock' }
}

export function savePlannerTimeMode(mode: PlannerTimeMode, userId?: string) {
  try { localStorage.setItem(preferenceKey(userId), mode) }
  catch { /* A blocked local preference must never prevent choosing a time. */ }
}
