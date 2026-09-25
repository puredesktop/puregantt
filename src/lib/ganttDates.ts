/**
 * Calendar-day arithmetic for the timeline.
 *
 * Task dates are `YYYY-MM-DD` calendar days with no time zone. Every
 * conversion here goes through LOCAL time — `toISOString()` is UTC, and
 * for anyone east of Greenwich local midnight is still "yesterday" in
 * UTC, so a bar dragged one day right would land on the same date.
 */

const MS_DAY = 86_400_000
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

/** A real calendar day in `YYYY-MM-DD` — `2026-02-30` is refused. */
export function isIsoDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value)
  if (!match) return false
  const [, year, month, day] = match.map(Number)
  if (month < 1 || month > 12 || day < 1 || day > 31) return false
  const date = new Date(year, month - 1, day)
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  )
}

/** Local midnight of a `YYYY-MM-DD` day; lenient on missing parts. */
export function parseDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, (month || 1) - 1, day || 1)
}

/** The calendar day of a local `Date` as `YYYY-MM-DD`. */
export function formatDate(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function todayDate(): string {
  return formatDate(new Date())
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

/** Whole calendar days from `start` to `end`; DST-safe via rounding. */
export function diffDays(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / MS_DAY)
}

/** Shift a `YYYY-MM-DD` day by whole days. */
export function shiftDate(value: string, days: number): string {
  return formatDate(addDays(parseDate(value), days))
}
