import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from 'react'
import { createPlannerWorkspaceStore } from '../lib/plannerWorkspace'
import { readNavigation, writePlannerNavigation } from '../lib/navigationState'

const InlineDraftContext = createContext<Map<string, unknown> | null>(null)

/** Unsaved editor text survives workspace navigation within this signed-in session. */
export function InlineDraftProvider({ children, userId }: { children: ReactNode; userId?: string }) {
  const drafts = useRef<Map<string, unknown>>()
  if (!drafts.current) {
    drafts.current = new Map()
    if (userId) drafts.current.set('planner:workspace-ui', createPlannerWorkspaceStore(readNavigation(userId).plans,
      (key, value) => writePlannerNavigation(userId, key, value)))
  }
  return <InlineDraftContext.Provider value={drafts.current}>{children}</InlineDraftContext.Provider>
}

/** A null key disables retention, for example while a new composer is closed. */
export function useInlineDraft<T>(key: string | null) {
  const drafts = useContext(InlineDraftContext)
  if (!drafts) throw new Error('useInlineDraft must be used within InlineDraftProvider')

  const read = useCallback(() => key === null ? undefined : drafts.get(key) as T | undefined, [drafts, key])
  const write = useCallback((value: T) => { if (key !== null) drafts.set(key, value) }, [drafts, key])
  const clear = useCallback(() => { if (key !== null) drafts.delete(key) }, [drafts, key])
  return useMemo(() => ({ read, write, clear }), [read, write, clear])
}
