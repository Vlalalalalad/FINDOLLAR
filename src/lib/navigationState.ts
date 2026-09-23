const PATHS = new Set(['/', '/plans', '/debts', '/profile', '/accounts', '/transactions', '/categories', '/calculator', '/statistics'])
export const PROFILE_HOME_PATH = '/profile'
const PROFILE_TOOL_PATHS = new Set(['/accounts', '/transactions', '/categories', '/calculator', '/statistics'])
const keyFor = (id: string) => `findollar:navigation:v1:${id}`
export type NavigationState = { path: string; plans: Record<string, unknown> }

export function isProfileToolPath(pathname: string): boolean {
  return PROFILE_TOOL_PATHS.has(pathname)
}

export function profileDestinationForTap(pathname: string, lastProfilePath: string): string {
  if (isProfileToolPath(pathname)) return PROFILE_HOME_PATH
  return isProfileToolPath(lastProfilePath) ? lastProfilePath : PROFILE_HOME_PATH
}

const permittedPlanValue = (key: string, value: unknown) =>
  key === 'navigation:space' ? typeof value === 'string' && value.length > 0 && value.length <= 128
    : key === 'navigation:browsing' || key === 'calendar:expanded' ? typeof value === 'boolean'
      : key === 'calendar:selected' ? typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value : false

export function readNavigation(id: string): NavigationState {
  try {
    const value = JSON.parse(localStorage.getItem(keyFor(id)) ?? '{}')
    return {
      path: PATHS.has(value?.path) ? value.path : '/',
      plans: Object.fromEntries(Object.entries(value?.plans ?? {}).filter(([key, item]) => permittedPlanValue(key, item))),
    }
  } catch { return { path: '/', plans: {} } }
}

export function writeNavigationPath(id: string, path: string) {
  if (!PATHS.has(path)) return
  try { localStorage.setItem(keyFor(id), JSON.stringify({ ...readNavigation(id), path })) } catch { /* Navigation still works without storage. */ }
}

export function writePlannerNavigation(id: string, key: string, value: unknown) {
  // Explicit allowlist: never persist selection, editor drafts, dialogs or menus.
  if (!permittedPlanValue(key, value)) return
  try {
    const previous = readNavigation(id)
    localStorage.setItem(keyFor(id), JSON.stringify({ ...previous, plans: { ...previous.plans, [key]: value } }))
  } catch { /* Retain the live in-memory session only. */ }
}
