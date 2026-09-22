const DAY_MINUTES = 1440
export const MAX_PLAN_DURATION = 7 * DAY_MINUTES

const minuteOfDay = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))
const clockTime = (minutes: number) => `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

/** The end is the next occurrence of its civil time, plus explicit full days. */
export function rangeDuration(start: string, end: string, extraDays = 0): number {
  const difference = (minuteOfDay(end) - minuteOfDay(start) + DAY_MINUTES) % DAY_MINUTES
  return (difference || DAY_MINUTES) + extraDays * DAY_MINUTES
}

/** Preserve legacy multi-day durations while editing their start/end clock times. */
export function rangeFromDuration(start: string, duration: number) {
  const end = clockTime(minuteOfDay(start) + duration)
  const extraDays = (duration - rangeDuration(start, end)) / DAY_MINUTES
  return { end, extraDays }
}

export function rangeEndDay(start: string, duration: number) {
  return Math.floor((minuteOfDay(start) + duration) / DAY_MINUTES)
}

export function timeRangeLabel(start: string, duration?: number | null) {
  if (!duration) return start
  const end = rangeFromDuration(start, duration).end
  const days = rangeEndDay(start, duration)
  return `${start} – ${end}${days ? ` (+${days} дн.)` : ''}`
}
