import Link from 'next/link'
import { ChevronLeft, ChevronRight } from '@/components/icons'
import { cn } from '@/lib/utils'

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const shift = (ym: string, n: number) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7) }

/**
 * This month at a glance: today is marked, days with something due (documents, cheques, invoices, renewals) carry a dot.
 * Every day and the arrows open the full calendar on that month.
 */
export function MiniCalendar({ today, due }: { today: string; due: Map<string, number> }) {
  const ym = today.slice(0, 7), [y, m] = ym.split('-').map(Number)
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(), days = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const prevDays = new Date(Date.UTC(y, m - 1, 0)).getUTCDate()
  const cells: { d: number; iso?: string; out?: boolean }[] = []
  for (let i = first - 1; i >= 0; i--) cells.push({ d: prevDays - i, out: true })
  for (let d = 1; d <= days; d++) cells.push({ d, iso: `${ym}-${String(d).padStart(2, '0')}` })
  while (cells.length % 7) cells.push({ d: cells.length - first - days + 1, out: true })
  const title = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  return <div className="px-5 pb-5 pt-4">
    <div className="mb-3 flex items-center justify-between"><h3 className="text-[15px] font-semibold">{title}</h3>
      <div className="flex gap-1"><Link href={`/calendar?m=${shift(ym, -1)}`} aria-label="Previous month" className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg"><ChevronLeft size={16} className="rtl:rotate-180" /></Link>
        <Link href={`/calendar?m=${shift(ym, 1)}`} aria-label="Next month" className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg"><ChevronRight size={16} className="rtl:rotate-180" /></Link></div></div>
    <div className="grid grid-cols-7 gap-y-1 text-center text-[12.5px]">
      {DOW.map(d => <div key={d} className="pb-1 text-[11px] font-medium text-muted">{d}</div>)}
      {cells.map((c, i) => {
        if (c.out || !c.iso) return <div key={i} className="grid h-9 place-items-center text-muted/40 tabular-nums">{c.d}</div>
        const n = due.get(c.iso) ?? 0, isToday = c.iso === today
        return <Link key={i} href={`/calendar?m=${ym}`} aria-label={`${c.iso}${n ? `, ${n} due` : ''}`}
          className={cn('relative mx-auto grid h-9 w-9 place-items-center rounded-lg tabular-nums transition-colors', isToday ? 'bg-primary font-semibold text-primary-fg' : 'hover:bg-surface-2', c.iso < today && !isToday && 'text-muted')}>
          {c.d}{n > 0 && <span aria-hidden className={cn('absolute bottom-1 h-1 w-1 rounded-full', isToday ? 'bg-primary-fg' : c.iso < today ? 'bg-danger' : 'bg-warning')} />}</Link>
      })}
    </div>
    <p className="mt-3 flex items-center gap-3 text-[11px] text-muted"><span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-warning" aria-hidden />Something due</span><span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-danger" aria-hidden />Overdue</span></p>
  </div>
}
