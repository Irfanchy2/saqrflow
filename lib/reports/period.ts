// Report periods (pure, unit-tested). All dates are the company's local (Asia/Dubai) calendar dates as YYYY-MM-DD strings:
// no Date objects in local time, so nothing shifts across UTC midnight.
import { addDays, endOfMonth } from '../time'

export const PERIODS = [['today', 'Today'], ['week', 'This week'], ['month', 'This month'], ['quarter', 'This quarter'], ['year', 'This year'], ['custom', 'Custom']] as const
export type PeriodKey = typeof PERIODS[number][0]
export interface Period { key: PeriodKey; from: string; to: string; label: string }
const ISO = /^\d{4}-\d{2}-\d{2}$/
const valid = (s?: string) => !!s && ISO.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'))
const fmt = (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso + 'T00:00:00Z'))

/** Resolve ?period=&from=&to= against today. Weeks start on Monday (UAE working week). Custom ranges are capped at 5 years. */
export function resolvePeriod(p: { period?: string; from?: string; to?: string }, today: string): Period {
  const key = (PERIODS.some(([k]) => k === p.period) ? p.period : p.from || p.to ? 'custom' : 'month') as PeriodKey
  const [y, m] = today.split('-').map(Number)
  let from: string, to: string
  switch (key) {
    case 'today': from = to = today; break
    case 'week': { const dow = (new Date(today + 'T00:00:00Z').getUTCDay() + 6) % 7; from = addDays(today, -dow); to = addDays(from, 6); break }
    case 'quarter': { const q0 = Math.floor((m - 1) / 3) * 3 + 1; from = `${y}-${String(q0).padStart(2, '0')}-01`; to = endOfMonth(`${y}-${String(q0 + 2).padStart(2, '0')}-01`); break }
    case 'year': from = `${y}-01-01`; to = `${y}-12-31`; break
    case 'custom': {
      from = valid(p.from) ? p.from! : today.slice(0, 7) + '-01'; to = valid(p.to) ? p.to! : today
      if (from > to) [from, to] = [to, from]
      if (Date.parse(to) - Date.parse(from) > 5 * 366 * 864e5) from = addDays(to, -5 * 365)
      break
    }
    default: from = today.slice(0, 7) + '-01'; to = endOfMonth(today)
  }
  const label = key === 'custom' ? `${fmt(from)} to ${fmt(to)}` : `${PERIODS.find(([k]) => k === key)![1]} (${from === to ? fmt(from) : `${fmt(from)} to ${fmt(to)}`})`
  return { key, from, to, label }
}
