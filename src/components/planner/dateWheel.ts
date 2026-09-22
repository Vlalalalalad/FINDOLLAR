export const DATE_WHEEL_MIN_YEAR = 1900
export const DATE_WHEEL_MAX_YEAR = 9998
export const DATE_WHEEL_ROWS = 81
export const DATE_WHEEL_MIDDLE = Math.floor(DATE_WHEEL_ROWS / 2)

export type DateWheelPart = 'day' | 'month' | 'year'
export interface WheelDate { day: number; month: number; year: number }

export function cyclicValue(value: number, min: number, max: number): number {
  const count = max - min + 1
  return min + ((value - min) % count + count) % count
}

export function daysInWheelMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

export function dateForWheels(value: string): WheelDate {
  const [year, month, day] = value.split('-').map(Number)
  const safeYear = Math.max(DATE_WHEEL_MIN_YEAR, Math.min(DATE_WHEEL_MAX_YEAR, year))
  const safeMonth = Math.max(1, Math.min(12, month))
  return { year: safeYear, month: safeMonth, day: Math.max(1, Math.min(daysInWheelMonth(safeYear, safeMonth), day)) }
}

/** Work with civil date parts only; device time zones cannot move the chosen day. */
export function changeWheelDate(date: WheelDate, part: DateWheelPart, value: number): WheelDate {
  const next = { ...date }
  if (part === 'year') next.year = cyclicValue(value, DATE_WHEEL_MIN_YEAR, DATE_WHEEL_MAX_YEAR)
  else if (part === 'month') next.month = cyclicValue(value, 1, 12)
  else next.day = cyclicValue(value, 1, daysInWheelMonth(next.year, next.month))
  next.day = Math.min(next.day, daysInWheelMonth(next.year, next.month))
  return next
}

export function wheelDateKey(date: WheelDate): string {
  return `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`
}

/** A fixed neighborhood keeps the year picker independent of its full range. */
export function wheelNeighborhood(anchor: number, min: number, max: number): number[] {
  return Array.from({ length: DATE_WHEEL_ROWS }, (_, index) => cyclicValue(anchor + index - DATE_WHEEL_MIDDLE, min, max))
}
