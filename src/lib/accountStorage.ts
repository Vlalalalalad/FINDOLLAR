export const LEGACY_STORAGE_OWNER = 'findollar:legacy-storage-owner'

function legacyKeyWithSuffix(suffix: string, accountSuffix = '') {
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)
    if (key && key.endsWith(`${suffix}${accountSuffix}`)) return key
  }
  return null
}

/** Remove device-only state owned by one FINDOLLAR account, never shared PWA caches. */
export function clearAccountDeviceState(userId: string) {
  try {
    const suffix = `:account:${userId}`
    const exact = new Set([
      `findollar:navigation:v1:${userId}`,
      `findollar:preferences:v1:${userId}`,
      `findossar:planner-time-mode:${userId}`,
      `findossar-planner-notifications:${userId}`,
      `findossar-planner-push:${userId}`,
      `findossar-planner-seen:${userId}`,
      `findossar-planner-receipts:${userId}`,
    ])
    for (let index = localStorage.length - 1; index >= 0; index--) {
      const key = localStorage.key(index)
      if (key && (key.endsWith(suffix) || exact.has(key))) localStorage.removeItem(key)
    }
    if (localStorage.getItem(LEGACY_STORAGE_OWNER) === userId) {
      localStorage.removeItem(LEGACY_STORAGE_OWNER)
      for (const key of ['findossar-last-custom-color', 'findossar-calculator-state', 'findossar-calculator-currencies', 'findossar-calculator-history', 'findollar-dashboard-widget']) {
        localStorage.removeItem(key)
      }
      const legacyDashboardKey = legacyKeyWithSuffix('-dashboard-widget')
      if (legacyDashboardKey) localStorage.removeItem(legacyDashboardKey)
    }
  } catch { /* Removal still clears the saved authentication registry. */ }
}

export function accountStorage(userId: string) {
  const accountSuffix = `:account:${userId}`
  const keyFor = (key: string) => `${key}:account:${userId}`
  return {
    getItem(key: string) {
      try {
        const scopedKey = keyFor(key)
        const scoped = localStorage.getItem(scopedKey)
        if (scoped !== null) return scoped
        const separator = key.indexOf('-')
        if (separator >= 0) {
          const legacyScopedKey = legacyKeyWithSuffix(key.slice(separator), accountSuffix)
          const legacyScoped = legacyScopedKey ? localStorage.getItem(legacyScopedKey) : null
          if (legacyScoped !== null) {
            localStorage.setItem(scopedKey, legacyScoped)
            return legacyScoped
          }
        }
        if (localStorage.getItem(LEGACY_STORAGE_OWNER) !== userId) return null
        let legacy = localStorage.getItem(key)
        if (legacy === null && separator >= 0) {
          const legacyKey = legacyKeyWithSuffix(key.slice(separator))
          legacy = legacyKey ? localStorage.getItem(legacyKey) : null
        }
        if (legacy !== null) localStorage.setItem(keyFor(key), legacy)
        return legacy
      } catch { return null }
    },
    setItem(key: string, value: string) { try { localStorage.setItem(keyFor(key), value) } catch { /* Optional device preference. */ } },
  }
}
