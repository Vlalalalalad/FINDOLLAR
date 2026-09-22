import { useCallback, useLayoutEffect, useRef, useSyncExternalStore, type Dispatch, type RefObject, type SetStateAction } from 'react'
import { useInlineDraft } from './useInlineDraft'
import { createPlannerWorkspaceStore, type PlannerWorkspaceStore } from '../lib/plannerWorkspace'

function useWorkspaceStore() {
  const retained = useInlineDraft<PlannerWorkspaceStore>('planner:workspace-ui')
  let store = retained.read()
  if (!store) { store = createPlannerWorkspaceStore(); retained.write(store) }
  return store
}

/** Switching keys reads the destination immediately, never writes the old view
 * into the new one. Late callbacks remain bound to their original section. */
export function usePlannerWorkspaceState<T>(key: string, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const store = useWorkspaceStore()
  const initialRef = useRef(initial)
  initialRef.current = initial
  const read = useCallback(() => store.read(key, initialRef.current), [store, key])
  const subscribe = useCallback((listener: () => void) => store.subscribe(key, listener), [store, key])
  const value = useSyncExternalStore(subscribe, read, read)
  const write = useCallback((update: SetStateAction<T>) => store.write(key, update, initialRef.current), [store, key])
  return [value, write]
}

/** Main is the app's scroll viewport, not window. Restore before paint and wait
 * for records to load before allowing a clamped empty-list offset to be saved. */
export function usePlannerWorkspaceScroll(rootRef: RefObject<HTMLElement>, key: string, ready: boolean) {
  const store = useWorkspaceStore()
  useLayoutEffect(() => {
    const main = rootRef.current?.closest('main')
    if (!main || !ready) return
    const storageKey = `scroll:${key}`
    main.scrollTo({ top: store.read(storageKey, 0), left: 0, behavior: 'auto' })
    let lastTop = main.scrollTop
    const save = () => { lastTop = main.scrollTop; store.write(storageKey, lastTop, 0) }
    main.addEventListener('scroll', save, { passive: true })
    return () => {
      main.removeEventListener('scroll', save)
      // During unmount the children may already be detached: don't read the
      // now-empty main (0), keep the last actual position of this section.
      store.write(storageKey, lastTop, 0)
    }
  }, [store, key, ready, rootRef])
}
