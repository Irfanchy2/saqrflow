import { addDays, daysBetween, formatAed, formatLongDate } from './time'

export interface AlertSource { source_type: string; source_id: string; title: string; subject: string | null; owner_type: string | null; due_date: string; amount: number | null; direction: string | null; link: string }
export interface Alert { key: string; severity: 'critical' | 'warning' | 'info'; text: string; sub: string; href: string; days: number }

/** Human sentences for the Priority Alerts widget. Every alert carries the href of its record. */
export function buildAlerts(src: AlertSource[], today: string, horizon = 30): Alert[] {
  const out: Alert[] = []
  for (const s of src) {
    const d = daysBetween(today, s.due_date); if (d > horizon) continue
    const when = d < 0 ? `${-d} day${-d === 1 ? '' : 's'} ago` : d === 0 ? 'today' : `in ${d} day${d === 1 ? '' : 's'}`
    let text: string, sub = formatLongDate(s.due_date)
    if (s.source_type === 'document') {
      text = s.owner_type === 'employee' ? `${s.title}${s.subject ? ` — ${s.subject}` : ''} ${d < 0 ? 'expired' : 'expires'} ${when}` : `${s.title} ${d < 0 ? 'expired' : 'expires'} ${when}`
      if (s.owner_type !== 'employee' && d >= 0) text = `${s.title} renewal is due ${when}`
    } else if (s.source_type === 'cheque') {
      text = `${s.direction === 'outgoing' ? 'Outgoing' : 'Incoming'} cheque of ${formatAed(s.amount ?? 0)} ${s.subject ? `(${s.subject}) ` : ''}${d < 0 ? 'was due' : 'is scheduled for'} ${formatLongDate(s.due_date)}`; sub = d < 0 ? `Overdue ${-d}d – action required` : when
    } else if (s.source_type === 'invoice') { text = `${s.title} ${d < 0 ? 'is overdue' : 'is due'} (${formatAed(s.amount ?? 0)})`; sub = when }
    else if (s.source_type === 'milestone') { text = `Milestone “${s.title}”${s.subject ? ` (${s.subject})` : ''} ${d < 0 ? 'is overdue' : 'is due'} ${when}`; sub = formatLongDate(s.due_date) }
    else { text = `${s.title} — ${when}` }
    out.push({ key: `${s.source_type}:${s.source_id}`, severity: d < 0 ? 'critical' : d <= 7 ? 'warning' : 'info', text, sub, href: s.link, days: d })
  }
  return out.sort((a, b) => a.days - b.days)
}

export function monthBuckets(today: string, n = 6) {
  const [y, m] = today.split('-').map(Number)
  return Array.from({ length: n }, (_, i) => { const d = new Date(Date.UTC(y, m - 1 + i, 1)); return { key: d.toISOString().slice(0, 7), label: new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' }).format(d) } })
}
export { addDays }
