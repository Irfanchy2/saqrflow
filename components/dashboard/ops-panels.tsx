import Link from 'next/link'
import type { ReactNode } from 'react'
import { ArrowRight, Boxes, CheckCircle2, Cardholder, HardHat, MapPin, Truck, Users } from '@/components/icons'
import { Card, CardHeader, CardLink, EmptyState } from '@/components/ui/primitives'
import { fmtMoney } from '@/lib/sales/money'
import { formatShortDate } from '@/lib/time'
import { ClockChip } from '@/components/dashboard/clock-chip'
import { WO_LABEL, WO_STEPS, type FunnelStep } from '@/lib/dashboard-ops'
import { cn } from '@/lib/utils'

export interface DayEvent { time: string | null; label: string; sub?: string; href: string; kind: 'visit' | 'order' | 'task' | 'cheque' | 'invoice' }
export interface CashAccount { id: string; label: string; balance: number; type: string }
const KIND_DOT: Record<DayEvent['kind'], string> = { visit: 'bg-[hsl(214_78%_52%)]', order: 'bg-[hsl(28_90%_52%)]', task: 'bg-[hsl(160_60%_40%)]', cheque: 'bg-[hsl(265_60%_58%)]', invoice: 'bg-[hsl(345_70%_55%)]' }
const KIND_LABEL: Record<DayEvent['kind'], string> = { visit: 'Site visit', order: 'Work order due', task: 'Task due', cheque: 'Cheque date', invoice: 'Invoice due' }
const mins = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0) }
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('')

/**
 * The top of the dashboard: a live chip (time, what is on today), the greeting, today as a timeline from 7:00 to 19:00
 * (things with a time sit on the track, the rest below it) and the cash on hand across the company's accounts.
 */
export function TodayHero({ greet, date, time, tz, canEdit, demo, now, chip, events, cash, actions }: {
  greet: string; date: string; time: string; tz: string; canEdit: boolean; demo: boolean; now: string; chip: string[]; events: DayEvent[]
  cash: { total: number; accounts: CashAccount[] } | 'none' | null; actions: ReactNode
}) {
  const start = 7 * 60, span = 12 * 60, pos = (t: string) => Math.min(100, Math.max(0, ((mins(t) - start) / span) * 100))
  const timed = events.filter(e => e.time).sort((a, b) => a.time!.localeCompare(b.time!)), loose = events.filter(e => !e.time)
  const nowPct = pos(now), hours = [7, 9, 11, 13, 15, 17, 19]
  return <section aria-label="Today" className="mb-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
    <div className="min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <ClockChip tz={tz} initial={time} chip={chip} canEdit={canEdit} demo={demo} />
          <h1 className="mt-3 text-[30px] font-semibold leading-[1.05] tracking-[-0.035em] sm:text-[44px]">{greet}</h1>
          <p className="mt-1.5 text-[14px] text-muted">{date}. Here is what the day looks like.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">{actions}</div>
      </div>
      <div className="mt-5 rounded-2xl border border-white/70 bg-surface/75 p-4 shadow-card backdrop-blur-xl dark:border-white/[.06] sm:p-5">
        <div className="flex items-center justify-between gap-3"><h2 className="text-[14px] font-semibold">Today</h2>
          <span className="text-[12px] text-muted">{events.length ? `${events.length} thing${events.length === 1 ? '' : 's'} on` : 'A clear day'}</span></div>
        <div className="relative mt-4 h-[92px] max-sm:hidden" role="list" aria-label="Today's timeline">
          <div className="absolute inset-x-0 top-[38px] h-1 rounded-full bg-surface-2 shadow-[inset_0_0_0_1px_hsl(var(--border)/.6)]" />
          {nowPct > 0 && nowPct < 100 && <div className="absolute top-[38px] h-1 rounded-full bg-ink/80 rtl:end-0" style={{ width: `${nowPct}%` }} aria-hidden />}
          {hours.map(h => <span key={h} className="absolute top-[74px] -translate-x-1/2 text-[11px] tabular-nums text-muted rtl:translate-x-1/2" style={{ insetInlineStart: `${((h * 60 - start) / span) * 100}%` }}>{String(h).padStart(2, '0')}:00</span>)}
          {timed.map((e, i) => { const up = i % 2 === 0
            return <Link role="listitem" key={i} href={e.href} title={`${e.time} · ${e.label}${e.sub ? ` · ${e.sub}` : ''}`} style={{ insetInlineStart: `${Math.min(93, Math.max(7, pos(e.time!)))}%` }}
              className={cn('group/ev absolute flex -translate-x-1/2 flex-col items-center rtl:translate-x-1/2', up ? 'top-0' : 'top-[35px]')}>
              {!up && <span className={cn('h-2.5 w-2.5 rounded-full ring-2 ring-surface', KIND_DOT[e.kind])} aria-hidden />}
              {!up && <span className="h-2 w-px bg-border-strong" aria-hidden />}
              <span className="max-w-[170px] truncate rounded-full bg-surface px-2 py-0.5 text-[11.5px] font-medium shadow-card ring-1 ring-border/70 transition-colors group-hover/ev:bg-surface-2"><span className="tabular-nums text-muted">{e.time}</span> {e.label}</span>
              {up && <span className="h-[14px] w-px bg-border-strong" aria-hidden />}
              {up && <span className={cn('h-2.5 w-2.5 rounded-full ring-2 ring-surface', KIND_DOT[e.kind])} aria-hidden />}</Link> })}
          {nowPct > 0 && nowPct < 100 && <span aria-label={`Now, ${now}`} className="absolute top-[32px] h-4 w-4 -translate-x-1/2 rounded-full border-[3px] border-surface bg-ink shadow-card rtl:translate-x-1/2" style={{ insetInlineStart: `${nowPct}%` }} />}
        </div>
        {(loose.length > 0 || timed.length > 0) && <ul className={cn('mt-3 flex flex-wrap gap-1.5', timed.length && 'sm:mt-1')}>{[...timed.map(e => ({ ...e, mobileOnly: true })), ...loose.map(e => ({ ...e, mobileOnly: false }))].map((e, i) =>
          <li key={i} className={cn(e.mobileOnly && 'sm:hidden')}><Link href={e.href} className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-surface-2/80 px-2.5 py-1 text-[12.5px] transition-colors hover:bg-surface-2">
            <span className={cn('h-2 w-2 shrink-0 rounded-full', KIND_DOT[e.kind])} aria-hidden /><span className="sr-only">{KIND_LABEL[e.kind]}: </span>{e.time && <span className="tabular-nums text-muted">{e.time}</span>}<span className="truncate">{e.label}</span></Link></li>)}</ul>}
        {!events.length && <p className="mt-3 flex items-center gap-2 text-sm text-muted"><CheckCircle2 size={15} className="text-success" aria-hidden />No site visits, due work orders, tasks, cheques or invoices today.</p>}
      </div>
    </div>
    {cash && <CashCard cash={cash} />}
  </section>
}

function CashCard({ cash }: { cash: { total: number; accounts: CashAccount[] } | 'none' }) {
  if (cash === 'none') return <Link href="/banking?new=bank_account" className="group/c relative flex flex-col justify-between overflow-hidden rounded-2xl bg-ink p-5 text-ink-fg shadow-card">
    <span><span className="text-[13px] text-ink-fg/70">Cash on hand</span><span className="mt-2 block text-[15px] font-medium leading-snug">Add your bank accounts and petty cash to see the balance here.</span></span>
    <span className="mt-6 inline-flex items-center gap-2 text-[13px] font-semibold">Add an account<ArrowRight size={14} className="transition-transform group-hover/c:translate-x-0.5 rtl:rotate-180" aria-hidden /></span>
    <Cardholder size={90} aria-hidden className="pointer-events-none absolute -bottom-5 -end-4 text-ink-fg/[.07]" /></Link>
  const top = cash.accounts.slice(0, 3), max = Math.max(1, ...cash.accounts.map(a => Math.abs(a.balance)))
  return <Link href="/banking" className="relative overflow-hidden rounded-2xl bg-ink p-5 text-ink-fg shadow-card transition-transform duration-200 hover:-translate-y-px">
    <div className="flex items-center justify-between"><span className="text-[13px] text-ink-fg/70">Cash on hand</span><ArrowRight size={15} className="text-ink-fg/60 rtl:rotate-180" aria-hidden /></div>
    <div className="mt-2 text-[34px] font-semibold leading-none tracking-[-0.035em] tabular-nums"><span className="me-1 text-[15px] font-medium text-ink-fg/60">AED</span>{fmtMoney(cash.total)}</div>
    <ul className="mt-5 space-y-2.5">{top.map(a => <li key={a.id} className="text-[12.5px]"><div className="flex justify-between gap-3"><span className="truncate text-ink-fg/75">{a.label}</span><span className="shrink-0 tabular-nums">{fmtMoney(a.balance)}</span></div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-ink-fg/10"><div className={cn('h-full rounded-full', a.balance < 0 ? 'bg-[hsl(345_70%_60%)]' : a.type === 'cash' ? 'bg-[hsl(150_55%_55%)]' : 'bg-ink-fg/70')} style={{ width: `${Math.round((Math.abs(a.balance) / max) * 100)}%` }} /></div></li>)}</ul>
    {cash.accounts.length > 3 && <p className="mt-3 text-[12px] text-ink-fg/60">+{cash.accounts.length - 3} more account{cash.accounts.length - 3 === 1 ? '' : 's'}</p>}
    <Cardholder size={90} aria-hidden className="pointer-events-none absolute -bottom-5 -end-4 text-ink-fg/[.06]" /></Link>
}

/** Leads by the furthest step reached, as narrowing bars with the conversion from the step before. */
export function SalesFunnel({ steps }: { steps: FunnelStep[] }) {
  const empty = !steps[0]?.count
  return <Card className="h-full"><CardHeader title="Sales funnel" sub="Leads by how far they got" action={<CardLink href="/leads">Pipeline</CardLink>} />
    {empty ? <EmptyState compact icon={Users} title="No leads yet" body="Enquiries you add under CRM & Leads move through this funnel as they reach a site visit, a quotation and a decision." /> :
      <ol className="space-y-2 px-5 pb-5">{steps.map((s, i) => { const prev = i ? steps[i - 1].count : 0
        return <li key={s.key}><Link href="/leads?view=list" className="group/f block">
          <div className="flex items-baseline justify-between gap-2 text-[12.5px]"><span className="font-medium">{s.label}</span>
            <span className="tabular-nums text-muted">{i > 0 && prev > 0 && <span className="me-2">{Math.round((s.count / prev) * 100)}%</span>}<span className="font-semibold text-fg">{s.count}</span></span></div>
          <div className="mt-1 h-7 rounded-lg bg-surface-2/70"><div className="flex h-full items-center rounded-lg px-2 text-[11px] font-medium text-ink-fg transition-[filter] group-hover/f:brightness-110"
            style={{ width: `${Math.max(s.pct, s.count ? 12 : 0)}%`, background: `hsl(var(--ink) / ${1 - i * 0.16})` }}>{s.value > 0 && s.pct >= 30 ? `AED ${fmtMoney(s.value).replace(/\.00$/, '')}` : ''}</div></div></Link></li> })}</ol>}
  </Card>
}

type WO = { id: string; number: string; title: string; status: string; target_date: string | null; priority: string; customer?: { name: string } | null; project?: { name: string } | null }
/** Work orders being made or installed now, with their place on the shop-floor steps. */
export function OnTheFloor({ rows, total, today }: { rows: WO[]; total: number; today: string }) {
  const steps = WO_STEPS.slice(0, -1)
  return <Card className="h-full"><CardHeader title="On the floor" sub={total ? `${total} open work order${total === 1 ? '' : 's'}` : undefined} action={<CardLink href="/work-orders" />} />
    {!rows.length ? <EmptyState compact icon={HardHat} title="No open work orders" body="Work orders you create from a won quotation or a project show their fabrication and installation stage here." /> :
      <ul className="px-2 pb-2">{rows.map(w => { const at = steps.indexOf(w.status as any), late = !!w.target_date && w.target_date < today
        return <li key={w.id}><Link href={`/work-orders?open=${w.id}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 rounded-xl px-3 py-2.5 transition-colors hover:bg-surface-2/70 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto]">
          <span className="min-w-0"><span className="block truncate text-[13.5px] font-medium">{w.title}</span><span className="block truncate text-xs text-muted">{w.number} · {w.customer?.name ?? w.project?.name ?? 'No customer'}</span></span>
          <span className="col-span-2 md:col-span-1"><span className="flex gap-1" aria-hidden>{steps.map((s, i) => <span key={s} className={cn('h-1.5 flex-1 rounded-full', at < 0 ? 'bg-surface-2' : i <= at ? (w.priority === 'urgent' ? 'bg-danger' : 'bg-ink') : 'bg-surface-2')} />)}</span>
            <span className="mt-1 block text-[11.5px] text-muted">{WO_LABEL[w.status] ?? w.status}</span></span>
          <span className={cn('row-start-1 col-start-2 whitespace-nowrap text-xs tabular-nums md:col-start-3', late ? 'font-semibold text-danger' : 'text-muted')}>{w.target_date ? (late ? `Late · ${formatShortDate(w.target_date)}` : w.target_date === today ? 'Due today' : formatShortDate(w.target_date)) : 'No target'}</span></Link></li> })}</ul>}
  </Card>
}

type Low = { id: string; name: string; unit: string; on_hand: number; reorder_level: number; reorder_qty: number }
/** Stock at or below its reorder level, with how much to order. */
export function RunningLow({ rows, total, tracked }: { rows: Low[]; total: number; tracked: boolean }) {
  return <Card className="h-full"><CardHeader title="Running low" sub={total ? `${total} item${total === 1 ? '' : 's'} at or below reorder level` : undefined} action={<CardLink href="/stock?low=1" />} />
    {!tracked ? <EmptyState compact icon={Boxes} title="Stock is not tracked yet" body="Add the plates, pipes and consumables you keep, with a reorder level, and anything running short shows here." action={<Link href="/stock?new=stock_item" className="text-sm font-medium text-primary">Add stock items</Link>} />
      : !rows.length ? <p className="flex items-center gap-2 px-5 pb-5 text-sm text-muted"><CheckCircle2 size={15} className="text-success" aria-hidden />Everything is above its reorder level.</p>
      : <ul className="space-y-3 px-5 pb-5">{rows.map(i => { const pct = Math.min(100, Math.round((Number(i.on_hand) / Math.max(Number(i.reorder_level), 0.001)) * 100))
        return <li key={i.id}><Link href={`/stock?tab=movements&item=${i.id}`} className="block">
          <div className="flex items-baseline justify-between gap-3 text-[13px]"><span className="truncate font-medium">{i.name}</span><span className="shrink-0 tabular-nums"><span className={cn('font-semibold', Number(i.on_hand) <= 0 && 'text-danger')}>{Number(i.on_hand)}</span><span className="text-muted"> / {Number(i.reorder_level)} {i.unit}</span></span></div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2"><div className={cn('h-full rounded-full', pct <= 35 ? 'bg-danger' : 'bg-warning')} style={{ width: `${Math.max(pct, 3)}%` }} /></div>
          {Number(i.reorder_qty) > 0 && <div className="mt-1 text-[11.5px] text-muted">Reorder {Number(i.reorder_qty)} {i.unit}</div>}</Link></li> })}</ul>}
  </Card>
}

type Visit = { id: string; number: string; location: string | null; scheduled_time: string | null; employee?: { full_name: string } | null; customer?: { name: string } | null }
type DN = { id: string; number: string; customer_name: string | null; site: string | null; issue_date: string }
/** Out of the workshop: site visits today and delivery notes on their way (sent, not yet delivered). */
export function OnTheRoad({ visits, deliveries }: { visits: Visit[]; deliveries: DN[] }) {
  return <Card className="h-full"><CardHeader title="On the road" sub="Site visits today and deliveries out" action={<CardLink href="/site-visits">Visits</CardLink>} />
    {!visits.length && !deliveries.length ? <EmptyState compact icon={Truck} title="Nothing out today" body="Scheduled site visits and delivery notes that are sent but not yet delivered appear here." /> :
      <ul className="px-2 pb-2 text-sm">
        {visits.map(v => <li key={v.id}><Link href={`/site-visits?open=${v.id}`} className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-surface-2/70">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary" aria-hidden><MapPin size={16} /></span>
          <span className="min-w-0 flex-1"><span className="block truncate font-medium">{v.customer?.name ?? v.location ?? v.number}</span><span className="block truncate text-xs text-muted">{[v.location, v.employee?.full_name].filter(Boolean).join(' · ') || 'Site visit'}</span></span>
          <span className="shrink-0 text-xs font-medium tabular-nums">{v.scheduled_time ? v.scheduled_time.slice(0, 5) : 'Today'}</span></Link></li>)}
        {deliveries.map(d => <li key={d.id}><Link href={`/invoices/${d.id}`} className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-surface-2/70">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[hsl(28_90%_52%/.12)] text-[hsl(28_80%_42%)] dark:text-[hsl(28_90%_65%)]" aria-hidden><Truck size={16} /></span>
          <span className="min-w-0 flex-1"><span className="block truncate font-medium">{d.customer_name ?? d.number}</span><span className="block truncate text-xs text-muted">{d.number}{d.site ? ` · ${d.site}` : ''}</span></span>
          <span className="shrink-0 text-xs tabular-nums text-muted">{formatShortDate(d.issue_date)}</span></Link></li>)}
      </ul>}
  </Card>
}

/** The team today: who is in, who is on leave, who is out on site or assigned to open work. */
export function TeamToday({ active, onLeave, onSite, onJobs, people }: { active: number; onLeave: number; onSite: number; onJobs: number; people: { id: string; name: string; what: string }[] }) {
  const inToday = Math.max(0, active - onLeave)
  return <Card className="h-full"><CardHeader title="Team today" sub={active ? `${inToday} of ${active} in` : undefined} action={<CardLink href="/employees" />} />
    {!active ? <EmptyState compact icon={Users} title="No employees yet" body="Add your team to see who is in, on leave, on site or on a job." /> : <div className="px-5 pb-5">
      <div className="grid grid-cols-3 gap-2">{[['On jobs', onJobs, '/work-orders'], ['On site', onSite, '/site-visits'], ['On leave', onLeave, '/employees']].map(([l, v, h]) =>
        <Link key={l as string} href={h as string} className="rounded-xl bg-surface-2/70 px-3 py-2.5 transition-colors hover:bg-surface-2"><span className="block text-[11.5px] text-muted">{l}</span><span className="text-[20px] font-semibold tabular-nums leading-tight">{v as number}</span></Link>)}</div>
      {people.length > 0 && <ul className="mt-4 space-y-2">{people.slice(0, 5).map(p => <li key={p.id} className="flex items-center gap-2.5 text-[13px]">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[hsl(160_45%_88%)] text-[11px] font-semibold text-[hsl(160_45%_22%)] dark:bg-[hsl(160_30%_22%)] dark:text-[hsl(160_45%_82%)]" aria-hidden>{initials(p.name)}</span>
        <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span><span className="max-w-[45%] shrink-0 truncate text-xs text-muted">{p.what}</span></li>)}</ul>}
    </div>}
  </Card>
}

