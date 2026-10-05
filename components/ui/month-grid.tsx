import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { addDays, endOfMonth, startOfMonth } from '@/lib/time'
import { cn } from '@/lib/utils'
import type { Tone } from './primitives'

export interface CalItem { date: string; label: string; href: string; tone: Tone }
const dot: Record<Tone, string> = { neutral: 'bg-surface-2 text-muted', blue: 'bg-primary-soft text-primary', green: 'bg-success/10 text-success', amber: 'bg-warning/15 text-warning', red: 'bg-danger/10 text-danger' }
const shift = (month: string, n: number) => { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7) }

/** Monday-first month grid. `month` = YYYY-MM. */
export function MonthGrid({ month, today, items, base, extraParams = '' }: { month: string; today: string; items: CalItem[]; base: string; extraParams?: string }) {
  const first = startOfMonth(month + '-01'), last = endOfMonth(first)
  const lead = (new Date(first + 'T00:00:00Z').getUTCDay() + 6) % 7
  const days: (string | null)[] = [...Array(lead).fill(null)]; for (let d = first; d <= last; d = addDays(d, 1)) days.push(d)
  while (days.length % 7) days.push(null)
  const title = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(first + 'T00:00:00Z'))
  const link = (m: string) => `${base}?${extraParams}${extraParams ? '&' : ''}m=${m}`
  return <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-card">
    <div className="flex items-center justify-between border-b border-border px-4 py-3"><h3 className="text-sm font-semibold">{title}</h3>
      <div className="flex gap-1"><Link aria-label="Previous month" href={link(shift(month, -1))} className="rounded p-1.5 hover:bg-surface-2"><ChevronLeft size={16} /></Link>
        <Link href={link(today.slice(0, 7))} className="rounded px-2 py-1.5 text-xs hover:bg-surface-2">Today</Link><Link aria-label="Next month" href={link(shift(month, 1))} className="rounded p-1.5 hover:bg-surface-2"><ChevronRight size={16} /></Link></div></div>
    <div className="grid grid-cols-7 border-b border-border text-center text-[11px] font-medium uppercase tracking-wide text-muted">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => <div key={d} className="py-2">{d}</div>)}</div>
    <div className="grid grid-cols-7">{days.map((d, i) => { const its = d ? items.filter(x => x.date === d) : []
      return <div key={i} className={cn('min-h-[88px] border-b border-e border-border p-1.5 text-xs [&:nth-child(7n)]:border-e-0', !d && 'bg-surface-2/40')}>
        {d && <><div className={cn('mb-1 inline-grid h-5 min-w-5 place-items-center rounded-full px-1 tabular-nums', d === today ? 'bg-primary font-semibold text-primary-fg' : 'text-muted')}>{Number(d.slice(8))}</div>
          <div className="space-y-0.5">{its.slice(0, 3).map((x, k) => <Link key={k} href={x.href} title={x.label} className={cn('block truncate rounded px-1.5 py-0.5', dot[x.tone])}>{x.label}</Link>)}
            {its.length > 3 && <div className="px-1 text-muted">+{its.length - 3} more</div>}</div></>}</div> })}</div></div>
}
