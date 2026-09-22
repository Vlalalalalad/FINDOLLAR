import { useEffect, useRef } from 'react'
import { usePlanner } from '../../context/PlannerContext'
import { selectAutoCompleteCandidates } from '../../lib/planner'

/** Foreground/wake catch-up. A suspended or closed browser is not a scheduler. */
export function PlannerAutoComplete() {
  const planner = usePlanner()
  const latest = useRef(planner)
  latest.current = planner
  const inFlight = useRef(false)
  useEffect(() => {
    let disposed = false
    const run = async () => {
      const snapshot = latest.current
      if (disposed || inFlight.current || snapshot.loading || snapshot.busy || snapshot.error || document.visibilityState === 'hidden') return
      if (!snapshot.tasks.some(task => task.auto_complete) && !snapshot.overrides.some(item => item.patch.auto_complete)) return
      inFlight.current = true
      try {
        const candidates = selectAutoCompleteCandidates(snapshot.tasks, snapshot.overrides, new Date(), 8)
        for (const occurrence of candidates) {
          if (disposed) break
          await latest.current.autoCompleteOccurrence(occurrence)
        }
      } catch {
        // Offline/schema/conflict failures leave the plan unchanged. A later wake
        // or timer retries; the RPC is idempotent and re-checks the current state.
      } finally { inFlight.current = false }
    }
    const tick = () => { void run() }
    const initial = window.setTimeout(tick, 1000)
    const interval = window.setInterval(tick, 30_000)
    window.addEventListener('focus', tick)
    document.addEventListener('visibilitychange', tick)
    return () => {
      disposed = true
      clearTimeout(initial); clearInterval(interval)
      window.removeEventListener('focus', tick)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [])
  return null
}
