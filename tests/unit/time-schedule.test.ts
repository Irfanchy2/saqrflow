import { describe, it, expect } from 'vitest'
import { todayInTz, daysBetween, addDays, endOfMonth, inQuietHours, nextAllowedSendTime, zonedToUtc, formatLongDate, formatAed } from '@/lib/time'
import { nextOccurrence, DEFAULT_OFFSETS, parseOffsets, nextTriggerDate, advanceDue } from '@/lib/reminders/schedule'
import { addMonths } from '@/lib/time'

describe('timezone handling (Asia/Dubai, UTC+4, no DST)', () => {
  it('"today" rolls over at 20:00 UTC', () => {
    expect(todayInTz(new Date('2026-10-03T19:59:00Z'))).toBe('2026-10-03')
    expect(todayInTz(new Date('2026-10-03T20:00:00Z'))).toBe('2026-10-04')
  })
  it('other zones differ', () => { expect(todayInTz(new Date('2026-10-03T20:00:00Z'), 'America/New_York')).toBe('2026-10-03') })
  it('date arithmetic is calendar-exact across months and leap years', () => {
    expect(daysBetween('2026-10-04', '2026-10-20')).toBe(16)
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2)
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02')
    expect(endOfMonth('2026-02-10')).toBe('2026-02-28'); expect(endOfMonth('2028-02-10')).toBe('2028-02-29')
  })
  it('formats', () => { expect(formatLongDate('2026-10-20')).toBe('20 October 2026'); expect(formatAed(15000)).toBe('AED 15,000') })
  it('quiet hours, including windows that wrap midnight', () => {
    expect(inQuietHours('23:30', '22:00', '07:00')).toBe(true)
    expect(inQuietHours('06:59', '22:00', '07:00')).toBe(true)
    expect(inQuietHours('07:00', '22:00', '07:00')).toBe(false)
    expect(inQuietHours('12:00', '13:00', '14:00')).toBe(false)
    expect(inQuietHours('12:00', null, null)).toBe(false)
  })
  it('zonedToUtc converts Dubai wall time', () => { expect(zonedToUtc('2026-10-04', '07:00').toISOString()).toBe('2026-10-04T03:00:00.000Z') })
  it('defers to the end of quiet hours in company time', () => {
    // 23:00 Dubai (19:00Z) → 07:00 next day Dubai
    expect(nextAllowedSendTime(new Date('2026-10-04T19:00:00Z'), '22:00', '07:00').toISOString()).toBe('2026-10-05T03:00:00.000Z')
    // 05:00 Dubai (01:00Z) → 07:00 same day
    expect(nextAllowedSendTime(new Date('2026-10-04T01:00:00Z'), '22:00', '07:00').toISOString()).toBe('2026-10-04T03:00:00.000Z')
    const noon = new Date('2026-10-04T08:00:00Z'); expect(nextAllowedSendTime(noon, '22:00', '07:00')).toEqual(noon)
  })
})

describe('reminder schedule', () => {
  const T = '2026-10-04'
  it('default offsets are 90/60/30/15/7/3/1/0', () => expect(DEFAULT_OFFSETS).toEqual([90, 60, 30, 15, 7, 3, 1, 0]))
  it('fires exactly on each default threshold', () => {
    for (const o of DEFAULT_OFFSETS) {
      const occ = nextOccurrence(addDays(T, o), T)!
      expect(occ.offset).toBe(o); expect(occ.key).toBe(`offset:${o}`)
    }
  })
  it('nothing before the first threshold', () => expect(nextOccurrence(addDays(T, 91), T)).toBeNull())
  it('catch-up: only the latest crossed threshold is returned', () => {
    expect(nextOccurrence(addDays(T, 10), T)!.offset).toBe(15)
    expect(nextOccurrence(addDays(T, 2), T)!.offset).toBe(3)
    expect(nextOccurrence(addDays(T, 16), T)!.offset).toBe(30)
  })
  it('same day → "due" kind', () => expect(nextOccurrence(T, T)!.kind).toBe('due'))
  it('overdue: repeats every N days, capped', () => {
    expect(nextOccurrence(addDays(T, -1), T)!.key).toBe('offset:0')       // not yet in overdue cycle
    expect(nextOccurrence(addDays(T, -7), T)!.key).toBe('overdue:1')
    expect(nextOccurrence(addDays(T, -13), T)!.key).toBe('overdue:1')
    expect(nextOccurrence(addDays(T, -14), T)!.key).toBe('overdue:2')
    expect(nextOccurrence(addDays(T, -28), T)!.key).toBe('overdue:4')
    expect(nextOccurrence(addDays(T, -35), T)).toBeNull()                  // beyond overdueMax
    expect(nextOccurrence(addDays(T, -14), T, { overdueEveryDays: 3, overdueMax: 10 })!.key).toBe('overdue:4')
  })
  it('custom per-document offsets override defaults', () => {
    expect(nextOccurrence(addDays(T, 45), T, { offsets: [45, 10] })!.offset).toBe(45)
    expect(nextOccurrence(addDays(T, 30), T, { offsets: [45, 10] })!.offset).toBe(45)
    expect(nextOccurrence(addDays(T, 91), T, { offsets: [120] })!.offset).toBe(120)
  })
  it('parses offset input', () => expect(parseOffsets('7, 30 90,abc,-1,30')).toEqual([90, 30, 7]))
})

describe('next trigger date & recurrence', () => {
  it('nextTriggerDate = first threshold not yet reached', () => {
    expect(nextTriggerDate('2026-12-31', '2026-10-04')).toBe('2026-11-01')   // 88 days left → 60-day mark is Nov 1
    expect(nextTriggerDate('2026-10-05', '2026-10-04')).toBe('2026-10-05')   // 1 day left → "due date" (offset 0)
    expect(nextTriggerDate('2026-10-04', '2026-10-04')).toBeNull()
    expect(nextTriggerDate('2026-12-31', '2026-10-04', [10])).toBe('2026-12-21')
  })
  it('addMonths clamps month ends', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28'); expect(addMonths('2028-01-31', 1)).toBe('2028-02-29'); expect(addMonths('2026-11-30', 3)).toBe('2027-02-28')
  })
  it('advanceDue keeps the original day and lands after today', () => {
    expect(advanceDue('2026-01-31', 'monthly', '2026-03-01')).toBe('2026-03-31')
    expect(advanceDue('2026-01-15', 'quarterly', '2026-10-04')).toBe('2026-10-15')
    expect(advanceDue('2025-02-28', 'yearly', '2026-10-04')).toBe('2027-02-28')
    expect(advanceDue('2026-12-01', 'monthly', '2026-10-04')).toBe('2026-12-01')   // future: unchanged
    expect(advanceDue('2026-01-01', 'none', '2026-10-04')).toBe('2026-01-01')
  })
})
