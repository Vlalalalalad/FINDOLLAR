import { useEffect, useState } from 'react'

/** Local midnight, wake from sleep and time-zone changes are observed without remounting pages. */
export function usePlannerClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const tick = () => setNow(new Date())
    const timer = window.setInterval(tick, 30_000)
    window.addEventListener('focus', tick)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', tick)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [])
  return now
}
