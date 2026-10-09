// Scheduled report periods (pure, unit-tested). Dates are company-local YYYY-MM-DD strings.
import { addDays, addMonths, endOfMonth, formatShortDate } from './time'

export type Schedule = { frequency: 'weekly' | 'monthly'; weekday: number | null; month_day: number | null }
export type Occurrence = { key: string; sendDate: string; from: string; to: string; label: string }

export const SECTIONS = { sales: 'Sales (invoiced, quotations)', collections: 'Payments collected', expenses: 'Expenses', receivables: 'Outstanding receivables', crm: 'Leads & pipeline', service: 'Service tickets' } as const
export type Section = keyof typeof SECTIONS
export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

/** ISO weekday of a date: 1 = Monday … 7 = Sunday. */
export const isoWeekday = (iso: string) => { const d = new Date(`${iso}T00:00:00Z`).getUTCDay(); return d === 0 ? 7 : d }

/**
 * The most recent send date on or before `today`, and the period it reports on.
 * Weekly: the 7 days before the send day. Monthly: the previous calendar month.
 */
export function latestOccurrence(s: Schedule, today: string): Occurrence {
  if (s.frequency === 'weekly') {
    const back = (isoWeekday(today) - (s.weekday ?? 1) + 7) % 7
    const sendDate = addDays(today, -back), from = addDays(sendDate, -7), to = addDays(sendDate, -1)
    return { key: `W:${sendDate}`, sendDate, from, to, label: `${formatShortDate(from)} – ${formatShortDate(to)}` }
  }
  const day = String(s.month_day ?? 1).padStart(2, '0')
  let sendDate = `${today.slice(0, 7)}-${day}`
  if (sendDate > today) sendDate = `${addMonths(`${today.slice(0, 7)}-01`, -1).slice(0, 7)}-${day}`
  const from = `${addMonths(`${sendDate.slice(0, 7)}-01`, -1).slice(0, 7)}-01`, to = endOfMonth(from)
  const label = new Date(`${from}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  return { key: `M:${sendDate.slice(0, 7)}`, sendDate, from, to, label }
}

/** Due when the latest occurrence has not been sent yet (a missed scheduler day is caught up the next morning). */
export const isDue = (s: Schedule & { last_period: string | null; enabled: boolean }, today: string) => s.enabled && latestOccurrence(s, today).key !== s.last_period

export function describeSchedule(s: Schedule) {
  if (s.frequency === 'weekly') return `Every ${WEEKDAYS[(s.weekday ?? 1) - 1]}, for the previous 7 days`
  const d = s.month_day ?? 1, suf = d % 10 === 1 && d !== 11 ? 'st' : d % 10 === 2 && d !== 12 ? 'nd' : d % 10 === 3 && d !== 13 ? 'rd' : 'th'
  return `Monthly on the ${d}${suf}, for the previous month`
}
