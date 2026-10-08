// All business dates are plain ISO dates (YYYY-MM-DD) interpreted in the company time zone (default Asia/Dubai).
export const DEFAULT_TZ = 'Asia/Dubai'
const MS_DAY = 86_400_000

/** Today's calendar date in the given IANA zone. */
export function todayInTz(now: Date = new Date(), tz: string = DEFAULT_TZ): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}
/** Calendar date of a stored timestamp in the company zone. Never `ts.slice(0, 10)`: that is the UTC date, a day early 00:00-04:00 in Dubai. */
export function localDate(ts: string, tz: string = DEFAULT_TZ): string { return todayInTz(new Date(ts), tz) }
const toUtcMs = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d) }
export function daysBetween(fromIso: string, toIso: string): number { return Math.round((toUtcMs(toIso) - toUtcMs(fromIso)) / MS_DAY) }
export function addDays(iso: string, n: number): string { return new Date(toUtcMs(iso) + n * MS_DAY).toISOString().slice(0, 10) }
export function endOfMonth(iso: string): string { const [y, m] = iso.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) }
export function startOfMonth(iso: string): string { return iso.slice(0, 7) + '-01' }

/** "20 October 2026" */
export function formatLongDate(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(toUtcMs(iso)))
}
/** "18 Oct 2026": table cells */
export function formatShortDate(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(toUtcMs(iso)))
}
const AED = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
/** "AED 1,250.00": one money format everywhere (rounded half away from zero on the cent, never "1,250.1") */
export function formatAed(n: number | string): string {
  const v = Number(n); const r = Math.sign(v) * Math.round(Math.abs(v) * 100 + 1e-9) / 100
  return (r < 0 ? '-AED ' : 'AED ') + AED.format(Math.abs(r))
}

/** Local wall-clock time of `now` in tz, as "HH:MM". */
export function localHm(now: Date, tz: string = DEFAULT_TZ): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now)
}

/** Is `hm` inside the quiet window [start, end)? Handles windows that wrap midnight (22:00–07:00). */
export function inQuietHours(hm: string, start?: string | null, end?: string | null): boolean {
  if (!start || !end) return false
  const s = start.slice(0, 5), e = end.slice(0, 5)
  if (s === e) return false
  return s < e ? hm >= s && hm < e : hm >= s || hm < e
}

/** UTC instant for local date+time in tz (DST-safe via offset probing). */
export function zonedToUtc(isoDate: string, hm: string, tz: string = DEFAULT_TZ): Date {
  const [y, mo, d] = isoDate.split('-').map(Number); const [h, mi] = hm.split(':').map(Number)
  const guess = Date.UTC(y, mo - 1, d, h, mi)
  const offsetAt = (t: number) => {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }).formatToParts(new Date(t))
    const g = (k: string) => Number(parts.find(p => p.type === k)!.value)
    return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute')) - t
  }
  return new Date(guess - offsetAt(guess - offsetAt(guess)))
}

/** The next instant at/after `now` that is outside the quiet window. */
export function nextAllowedSendTime(now: Date, start: string | null | undefined, end: string | null | undefined, tz: string = DEFAULT_TZ): Date {
  const hm = localHm(now, tz)
  if (!inQuietHours(hm, start, end)) return now
  const today = todayInTz(now, tz)
  const endHm = end!.slice(0, 5)
  const sameDay = zonedToUtc(today, endHm, tz)
  return sameDay.getTime() > now.getTime() ? sameDay : zonedToUtc(addDays(today, 1), endHm, tz)
}

/** Add calendar months, clamping the day (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1 + n, 1)), last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate()
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), Math.min(d, last))).toISOString().slice(0, 10)
}
