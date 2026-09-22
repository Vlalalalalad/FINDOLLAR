import { useEffect, useState } from 'react'

/** Keeps overlay content mounted just long enough to finish its exit motion. */
export function usePresence(visible: boolean, exitDurationMs = 160) {
  const [present, setPresent] = useState(visible)

  useEffect(() => {
    if (visible) {
      setPresent(true)
      return
    }

    if (!present) return

    const reduceMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const timer = window.setTimeout(() => setPresent(false), reduceMotion ? 0 : exitDurationMs)
    return () => window.clearTimeout(timer)
  }, [exitDurationMs, present, visible])

  // `visible` makes opening synchronous; `present` only extends the closing
  // phase so the exit animation can finish before unmounting.
  return visible || present
}
