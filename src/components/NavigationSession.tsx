import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { readNavigation, writeNavigationPath } from '../lib/navigationState'
let previousAccount: string | null = null

/** Mounted once per authenticated account, never on visibility/focus changes. */
export function NavigationSession({ userId, children }: { userId: string; children: ReactNode }) {
  const location = useLocation()
  const pushIntent = location.pathname === '/plans' && new URLSearchParams(location.search).get('pushAccount') === userId
  const initial = useRef({
    done: false,
    // Explicit links to a section win over the saved starting section.
    path: pushIntent ? location.pathname
      : (previousAccount !== null && previousAccount !== userId) || location.pathname === '/' || location.pathname === '/auth' ? readNavigation(userId).path : location.pathname,
  })
  const redirect = !initial.current.done && (location.pathname !== initial.current.path
    || /(?:prefillAccount|prefillType|editTransaction)=/.test(location.search))
  useLayoutEffect(() => {
    if (redirect) return
    initial.current.done = true
    previousAccount = userId
    writeNavigationPath(userId, location.pathname)
  }, [redirect, userId, location.pathname])
  if (redirect) return <Navigate to={initial.current.path} replace />
  return <>{children}</>
}
