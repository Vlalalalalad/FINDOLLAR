import { useEffect, useMemo, useRef, useState } from 'react'
import { createGoalItemsAutosave, type GoalItemsSave } from '../lib/goalItems'
import type { OrganizationEntry } from '../types/organization'

export function useGoalItemsAutosave({ entry, save, onSaved }: {
  entry?: OrganizationEntry | null; save?: GoalItemsSave; onSaved: (entry: OrganizationEntry) => void
}) {
  const callback = useRef(onSaved)
  callback.current = onSaved
  // The queue belongs to the edit session; changing server revisions must not reset it.
  const entryRef = useRef(entry), saveRef = useRef(save)
  entryRef.current = entry; saveRef.current = save
  const key = entry?.kind === 'goal' && save ? `${entry.user_id}:${entry.id}` : null
  const controller = useMemo(() => key && entryRef.current && saveRef.current
    ? createGoalItemsAutosave(entryRef.current, (...args) => saveRef.current!(...args)) : null, [key])
  const [state, setState] = useState({ saving: false, error: null as string | null })
  useEffect(() => {
    if (!controller) { setState({ saving: false, error: null }); return }
    return controller.subscribe((next, row) => { setState(next); if (row) callback.current(row) })
  }, [controller])
  return { ...state, commit: controller?.commit, flush: controller?.flush ?? (() => Promise.resolve(undefined)) }
}
