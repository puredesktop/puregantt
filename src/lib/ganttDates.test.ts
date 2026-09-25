import { describe, expect, it } from 'vitest'
import {
  addDays,
  diffDays,
  formatDate,
  isIsoDate,
  parseDate,
  shiftDate,
  todayDate,
} from './ganttDates'

describe('isIsoDate', () => {
  it('accepts real calendar days only', () => {
    expect(isIsoDate('2026-02-28')).toBe(true)
    expect(isIsoDate('2028-02-29')).toBe(true)
    expect(isIsoDate('2026-12-31')).toBe(true)
  })

  it('refuses days V8 would silently roll over', () => {
    // Date.parse('2026-02-30') is a number; the timeline must not accept it.
    expect(isIsoDate('2026-02-30')).toBe(false)
    expect(isIsoDate('2026-02-29')).toBe(false)
    expect(isIsoDate('2026-04-31')).toBe(false)
    expect(isIsoDate('2026-13-01')).toBe(false)
    expect(isIsoDate('2026-00-10')).toBe(false)
  })

  it('refuses other shapes', () => {
    expect(isIsoDate('')).toBe(false)
    expect(isIsoDate('2026-7-1')).toBe(false)
    expect(isIsoDate('2026-07-01T00:00:00Z')).toBe(false)
    expect(isIsoDate('July 1 2026')).toBe(false)
  })
})

describe('local-day round trip', () => {
  it('formats the same day it parsed, whatever the time zone', () => {
    for (const day of ['2026-01-01', '2026-06-30', '2026-12-31']) {
      expect(formatDate(parseDate(day))).toBe(day)
    }
  })

  it('shifts by whole calendar days across month and year ends', () => {
    expect(shiftDate('2026-01-31', 1)).toBe('2026-02-01')
    expect(shiftDate('2026-12-31', 1)).toBe('2027-01-01')
    expect(shiftDate('2026-03-01', -1)).toBe('2026-02-28')
    expect(shiftDate('2026-07-10', 0)).toBe('2026-07-10')
  })

  it('counts whole days between local dates', () => {
    expect(diffDays(parseDate('2026-03-01'), parseDate('2026-03-31'))).toBe(30)
    expect(diffDays(parseDate('2026-03-31'), parseDate('2026-03-01'))).toBe(-30)
    // Across a DST change the day is 23 or 25 hours; still one day.
    expect(diffDays(parseDate('2026-03-28'), addDays(parseDate('2026-03-28'), 1))).toBe(1)
  })

  it('reports today as a local calendar day', () => {
    const now = new Date()
    expect(todayDate()).toBe(
      `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
        now.getDate(),
      ).padStart(2, '0')}`,
    )
  })
})
