import Link from 'next/link'
import { getMe, myProjects } from '@/lib/me'
import { NewClaim } from '@/components/portal/new-claim'
import { claimSuppliers } from '@/lib/expenses/claim-suppliers'
import { companyCards } from '@/lib/cards'
import { Badge, EmptyState, LinkButton, Money } from '@/components/ui/primitives'
import { ArrowLeft, CheckCircle2, Clock, Download, HandCoins, Wallet } from '@/components/icons'
import { PortalCard, PortalStat } from '@/components/portal/stat'
import { EditReport, ReportReceived, ReportReturn, myWallet } from '@/components/petty/portal'
import { ENTRY_COLS, REQUEST_COLS } from '@/lib/petty'
import { KIND, REQUEST_STATUS, statement, statementRange, type PettyEntry, type PettyKind } from '@/lib/petty-math'
import { formatShortDate } from '@/lib/time'
import { cn } from '@/lib/utils'

export const metadata = { title: 'My petty cash' }

/**
 * The employee's own petty cash wallet (Employee Portal): what they hold, what is waiting, their reports and history.
 * Only their own records (RLS). Company money for business expenses: never salary, never deducted from salary.
 */
export default async function MyPettyCash() {
  const { c, emp } = await getMe()
  if (!emp) return null
  const [w, projects, sups, cards, { data: entries }, { data: requests }] = await Promise.all([
    myWallet(c, emp.id), myProjects(c), claimSuppliers(c, emp.id), companyCards(c),
    c.supabase.from('petty_cash_entries').select(ENTRY_COLS).eq('employee_id', emp.id).order('entry_date').order('created_at').limit(5000),
    c.supabase.from('petty_cash_requests').select(REQUEST_COLS).eq('employee_id', emp.id).neq('status', 'withdrawn').order('created_at', { ascending: false }).limit(100),
  ])
  const all = (entries ?? []) as unknown as PettyEntry[]
  const r = statementRange(all, c.today), st = statement(all, '0000-01-01', c.today)
  const recent = [...st.rows].reverse().slice(0, 30)
  const open = (requests ?? []).filter((x: any) => x.status === 'pending' || x.status === 'correction_requested')
  const done = (requests ?? []).filter((x: any) => x.status !== 'pending' && x.status !== 'correction_requested').slice(0, 10)

  return <div className="space-y-4">
    <div className="pt-1">
      <Link href="/me/expenses" className="inline-flex items-center gap-1 text-[13px] font-medium text-muted hover:text-fg"><ArrowLeft size={14} aria-hidden />My expenses</Link>
      <h1 className="mt-1 text-[26px] font-semibold tracking-[-0.03em] sm:text-[30px]">Petty cash</h1>
      <p className="mt-0.5 text-[13px] text-muted">Company money you hold for business purchases. It is not salary and is never deducted from your salary.</p>
    </div>

    <section className="overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-600 to-teal-700 p-5 text-white shadow-solid" data-petty-hero>
      <div className="flex items-center gap-2 text-[13.5px] font-medium text-white/85"><Wallet size={17} aria-hidden />Available petty cash</div>
      <div className="mt-1 text-[36px] font-semibold leading-tight tracking-[-0.035em] tabular-nums" data-petty-available><Money value={w.available} /></div>
      <div className="mt-1 text-[12.5px] text-white/80">{w.pending_expenses > 0 ? <>AED {w.pending_expenses.toFixed(2)} in expenses waiting for approval: not taken off yet</> : 'From confirmed entries only'}</div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-[12px]">
        {([['Received', w.received], ['Spent', w.settled], ['Returned', w.returned]] as [string, number][]).map(([l, v]) =>
          <div key={l} className="rounded-xl bg-white/12 px-2.5 py-2"><div className="text-white/75">{l}</div><div className="mt-0.5 text-[14px] font-semibold tabular-nums"><Money value={v} /></div></div>)}
      </div>
    </section>

    <PortalCard title="Add a business expense" sub="Choose “Company petty cash” as where the money came from.">
      <div className="px-4 pb-4 sm:px-5"><NewClaim today={c.today} size="sm" suppliers={sups} cards={cards} projects={projects} pettyBalance={w.available} /></div></PortalCard>

    <div className="grid grid-cols-2 gap-2.5 sm:flex sm:flex-wrap" data-petty-actions>
      <ReportReceived today={c.today} projects={projects} />
      {w.available > 0 && <ReportReturn today={c.today} available={w.available} />}
      <LinkButton href={`/api/petty-cash/${emp.id}/statement`} variant="secondary"><Download size={15} aria-hidden />Statement</LinkButton>
    </div>

    <div className="grid grid-cols-2 gap-3">
      <PortalStat label="Pending expenses" icon={Clock} tone="amber" href="/me/expenses?status=pending" testId="petty-pending" value={w.pending_claims} hint={<Money value={w.pending_expenses} />} />
      <PortalStat label="Waiting for confirmation" icon={CheckCircle2} tone="blue" testId="petty-requests" value={w.pending_requests} hint={w.pending_received > 0 ? <>AED {w.pending_received.toFixed(2)} received</> : 'Money received and returns'} />
      {(w.reimbursement_due > 0 || w.reimbursed > 0) && <PortalStat label="To be paid back to you" icon={HandCoins} tone="green" testId="petty-reimb" value={<Money value={w.reimbursement_due} />} hint={w.reimbursed > 0 ? <>Paid back so far AED {w.reimbursed.toFixed(2)}</> : 'Expenses you paid with your own money'} />}
      {w.awaiting_settlement > 0 && <PortalStat label="Approved, to settle" icon={Wallet} tone="violet" testId="petty-awaiting" value={<Money value={w.awaiting_settlement} />} hint="More than you held: the admin settles it" />}
    </div>

    {open.length > 0 && <PortalCard title="Waiting for the admin" sub="Your balance changes once these are confirmed.">
      <ul className="divide-y divide-border" data-petty-open>{open.map((x: any) => <li key={x.id} className="px-4 py-3 sm:px-5">
        <div className="flex items-center gap-3"><span className="min-w-0 flex-1"><span className="block truncate text-[14.5px] font-medium">{x.kind === 'received' ? 'Petty cash received' : 'Return of unused petty cash'}</span>
          <span className="block truncate text-[12.5px] text-muted">{formatShortDate(x.entry_date)}{x.counterparty ? ` · ${x.counterparty}` : ''}{x.purpose ? ` · ${x.purpose}` : ''}</span></span>
          <Money value={x.amount} className="shrink-0 font-semibold" /></div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2"><Badge tone={REQUEST_STATUS[x.status]?.tone}>{REQUEST_STATUS[x.status]?.label}</Badge><EditReport r={x} today={c.today} projects={projects} /></div>
        {x.status === 'correction_requested' && x.decision_note && <p className="mt-2 rounded-lg bg-warning/10 px-3 py-2 text-[13px] text-warning">Admin: “{x.decision_note}”</p>}</li>)}</ul></PortalCard>}

    <PortalCard title="History" sub={all.length ? `From ${formatShortDate(r.from)} · newest first` : undefined}>
      {!recent.length ? <EmptyState compact icon={Wallet} title="No petty cash yet" body="When the company gives you petty cash, it shows here. If you received money that is not shown, add it as Petty cash received." />
        : <ul className="divide-y divide-border" data-petty-history>{recent.map(x => { const e = all.find(y => y.id === x.id)!
          return <li key={x.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
            <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-full', x.in ? 'bg-success/10 text-success' : 'bg-surface-2 text-muted')} aria-hidden><Wallet size={16} /></span>
            <span className="min-w-0 flex-1"><span className="block truncate text-[14.5px] font-medium">{x.label}</span>
              <span className="block truncate text-[12.5px] text-muted">{formatShortDate(x.date)} · {x.detail}</span></span>
            <span className="shrink-0 text-end"><span className={cn('block font-semibold tabular-nums', x.in ? 'text-success' : '')}>{x.in ? '+' : '−'}<Money value={x.in || x.out} /></span>
              <span className="block text-[11.5px] text-muted tabular-nums">Balance <Money value={x.balance} /></span></span>
            <span className="sr-only">{KIND[e.kind as PettyKind].label}</span></li> })}</ul>}
    </PortalCard>

    {st.reimbursements.length > 0 && <PortalCard title="Paid with your own money" sub="Owed back to you, and what was paid back. Separate from salary.">
      <ul className="divide-y divide-border">{[...st.reimbursements].reverse().map(x => <li key={x.id} className="flex items-center gap-3 px-4 py-3 text-[14px] sm:px-5">
        <span className="min-w-0 flex-1"><span className="block truncate font-medium">{x.label}</span><span className="block truncate text-[12.5px] text-muted">{formatShortDate(x.date)} · {x.detail}</span></span>
        <span className="shrink-0 font-semibold tabular-nums">{x.amount > 0 ? '+' : '−'}<Money value={Math.abs(x.amount)} /></span></li>)}</ul></PortalCard>}

    {done.length > 0 && <PortalCard title="Your reports">
      <ul className="divide-y divide-border">{done.map((x: any) => <li key={x.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
        <span className="min-w-0 flex-1"><span className="block truncate text-[14px] font-medium">{x.kind === 'received' ? 'Petty cash received' : 'Return of unused petty cash'}</span>
          <span className="block truncate text-[12.5px] text-muted">{formatShortDate(x.entry_date)}{x.decision_note ? ` · “${x.decision_note}”` : ''}</span></span>
        <Money value={x.amount} className="shrink-0 font-semibold" /><Badge tone={REQUEST_STATUS[x.status]?.tone} className="shrink-0">{REQUEST_STATUS[x.status]?.label}</Badge></li>)}</ul></PortalCard>}
  </div>
}
