export type Theme = 'light' | 'dark'
export type DevicePreferences = { theme: Theme; hideBalances: boolean }
const keyFor = (id: string) => `findollar:preferences:v1:${id}`
const themeKey = 'findollar-theme'
const hideBalancesKey = 'findollar-hide-balances'
const systemTheme = (): Theme => window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
function readLegacyPreference(suffix: string) {
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)
    if (key && key.endsWith(suffix)) {
      const value = localStorage.getItem(key)
      if (value !== null) return value
    }
  }
  return null
}
export function readDevicePreferences(id: string | null): DevicePreferences {
  try {
    const stored = id ? JSON.parse(localStorage.getItem(keyFor(id)) ?? 'null') : null
    if (stored) return { theme: stored.theme === 'dark' ? 'dark' : 'light', hideBalances: stored.hideBalances === true }
    // Migrate the existing installation once, never copy A's settings into B.
    const migrated = localStorage.getItem('findollar:preferences-migrated')
    if (!id || !migrated) {
      const theme = localStorage.getItem(themeKey) ?? readLegacyPreference('-theme')
      const hidden = localStorage.getItem(hideBalancesKey) ?? readLegacyPreference('-hide-balances')
      return { theme: theme === 'dark' || theme === 'light' ? theme : systemTheme(), hideBalances: hidden === '1' }
    }
  } catch { /* System defaults if storage is unavailable. */ }
  return { theme: systemTheme(), hideBalances: false }
}
export function writeDevicePreferences(id: string | null, value: DevicePreferences) {
  try {
    if (id) {
      localStorage.setItem(keyFor(id), JSON.stringify(value))
      localStorage.setItem('findollar:preferences-migrated', '1')
    }
    // Last active theme is available synchronously before React/auth starts.
    localStorage.setItem(themeKey, value.theme)
    localStorage.setItem(hideBalancesKey, value.hideBalances ? '1' : '0')
  } catch { /* Live theme remains usable. */ }
}
