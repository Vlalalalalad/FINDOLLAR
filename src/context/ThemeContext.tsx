import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from 'react'
import { useAuth } from './AuthContext'
import { readDevicePreferences, writeDevicePreferences, type Theme } from '../lib/devicePreferences'


interface ThemeContextValue {
  theme: Theme
  toggleTheme: () => void
  hideBalances: boolean
  toggleHideBalances: () => void
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const owner = user?.id ?? null
  const [preferences, setPreferences] = useState(() => ({ owner, ...readDevicePreferences(owner) }))
  const current = preferences.owner === owner ? preferences : { owner, ...readDevicePreferences(owner) }
  const { theme, hideBalances } = current

  useLayoutEffect(() => {
    const root = document.documentElement
    // Вимикаємо переходи кольорів на мить перемикання теми (щоб не
    // "блимало"), тоді застосовуємо нову тему, тоді за два кадри
    // вмикаємо переходи назад — вони й далі потрібні для ховерів тощо.
    root.classList.add('theme-switching')
    root.classList.toggle('dark', theme === 'dark')
    root.style.colorScheme = theme
    if (preferences.owner !== owner) setPreferences(current)
    writeDevicePreferences(owner, { theme, hideBalances })

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        root.classList.remove('theme-switching')
      })
    })
  }, [theme, hideBalances, owner, preferences.owner])

  return (
    <ThemeContext.Provider
      value={{
        theme,
        toggleTheme: () => setPreferences({ ...current, theme: theme === 'light' ? 'dark' : 'light' }),
        hideBalances,
        toggleHideBalances: () => setPreferences({ ...current, hideBalances: !hideBalances }),
      }}
    >
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
