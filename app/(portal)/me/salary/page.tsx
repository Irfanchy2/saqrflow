import { getMe, portalSettings, advanceBalance } from '@/lib/me'
import { formatShortDate } from '@/lib/time'
import { Badge, EmptyState, Money } from '@/components/ui/primitives'
import { Banknote, CalendarCheck, Download, FileText, Wallet } from '@/components/icons'
import { PortalCard } from '@/components/portal/stat'
import { PrivateValue } from '@/components/portal/private-value'
import { STATUS, methodLabel, periodLabel, sum } from '@/lib/salary-math'

export const metadata = { title: 'My salary' }

/**
 * The employee's own salary account: what the company still owes them, month by month, every payment with its receipt
 * (PDF), the statement, and advances with what is left to repay. Read-only: HR records salary, payments and advances, and
 * they show up here the moment they do. The database only ever returns this person's own rows.
 */
export default async function MySalary() {
  const { c, emp } = await getMe()
  if (!emp) return null
  const sb = c.supabase
  const [settings, { data: comp }, { data: acct }, { data: obs }, { data: pays }, { data: allocs }, { data: adv }] = await Promise.all([
    portalSettings(c),
    sb.from('employee_compensation').select('monthly_salary,updated_at').eq('employee_id', emp.id).maybeSingle(),
    sb.from('salary_accounts').select('outstanding,paid').eq('employee_id', emp.id).maybeSingle(),
    sb.from('salary_obligations').select('id,kind,period,entry_date,amount,allocated,remaining,status,reason').eq('employee_id', emp.id).limit(500),
    sb.from('salary_payments').select('id,period,amount,paid_on,method,status').eq('employee_id', emp.id).order('paid_on', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false }).limit(60),
    sb.from('salary_allocations').select('payment_id,obligation_id,amount').eq('employee_id', emp.id).not('payment_id', 'is', null).limit(5000),
    sb.from('employee_advance_balances').select('id,kind,amount,given_on,monthly_recovery,settled,notes,recovered,remaining').eq('employee_id', emp.id).order('given_on', { ascending: false }),
  ])
  const salary = comp ? Number(comp.monthly_salary) : null
  const owed = Number(acct?.outstanding ?? 0)
  const bal = advanceBalance(salary, adv ?? [], settings.advanceLimitPct)
  const months = ((obs ?? []) as any[]).sort((a, b) => (a.kind === 'opening' ? 1 : b.kind === 'opening' ? -1 : (b.period ?? b.entry_date).localeCompare(a.period ?? a.entry_date)))
  const byId = new Map(months.map(o => [o.id, o]))
  const settled = (pid: string) => (allocs ?? []).filter(a => a.payment_id === pid).map(a => byId.get(a.obligation_id)).filter(Boolean).map(o => periodLabel(o)).join(', ')
  const recovery = sum((adv ?? []).filter(a => a.kind === 'advance' && Number(a.remaining) > 0).map(a => a.monthly_recovery))
  return <div className="space-y-4">
    <div className="pt-1"><h1 className="text-[26px] font-semibold tracking-[-0.03em] sm:text-[30px]">Salary</h1>
      <p className="mt-0.5 text-[13px] text-muted">Only you and HR can see this. Tap an amount to show it.</p></div>

    <section className="rounded-2xl border border-border/80 bg-surface p-5 shadow-card" data-salary-summary>
      <div className="text-[13px] font-medium text-muted">Salary owed to you</div>
      <div className="mt-1 text-[30px] font-semibold tracking-[-0.03em]" data-owed>{owed > 0 ? <PrivateValue><Money value={owed} /></PrivateValue> : owed < 0 ? <span className="text-[17px] font-medium text-success">Paid ahead by <PrivateValue><Money value={-owed} /></PrivateValue></span> : <Badge tone="green">All paid</Badge>}</div>
      <div className="mt-4 grid grid-cols-2 gap-3 text-[14px]">
        <div className="rounded-xl bg-surface-2 px-3.5 py-3"><div className="text-[12.5px] text-muted">Monthly salary</div>
          <div className="mt-1 font-semibold">{salary !== null ? <PrivateValue><Money value={salary} /></PrivateValue> : <span className="font-normal text-muted">Not set yet</span>}</div></div>
        <div className="rounded-xl bg-surface-2 px-3.5 py-3"><div className="text-[12.5px] text-muted">Advances to repay</div>
          <div className="mt-1 font-semibold"><PrivateValue><Money value={bal.outstanding} /></PrivateValue></div>{recovery > 0 && <div className="text-[12px] text-muted">Recovered <Money value={recovery} /> a month</div>}</div>
      </div>
      {bal.available !== null && <div className="mt-3 flex items-center gap-3 rounded-xl border border-success/20 bg-success/[.06] px-3.5 py-3 text-[14px]" data-advance-available>
        <Banknote size={18} className="shrink-0 text-success" aria-hidden /><span>Advance you can still ask for: <b className="font-semibold"><PrivateValue><Money value={bal.available} /></PrivateValue></b>
          <span className="block text-[12px] text-muted">Up to {settings.advanceLimitPct}% of your monthly salary, less advances not yet repaid. Ask HR.</span></span></div>}
      <a href={`/api/salary-statements/${emp.id}`} className="mt-3 flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border bg-surface text-[14px] font-medium text-primary shadow-key hover:bg-surface-2" data-statement><FileText size={16} aria-hidden />Download my salary statement</a>
    </section>

    {months.length > 0 && <PortalCard title="Month by month">
      <ul className="divide-y divide-border/70" data-months>{months.map(o => <li key={o.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
        <div className="min-w-0 flex-1"><div className="text-[15px] font-semibold">{periodLabel(o)}</div>
          <div className="text-[13px] text-muted">Salary <PrivateValue><Money value={o.amount} /></PrivateValue>{Number(o.allocated) > 0 && <> · paid <PrivateValue><Money value={o.allocated} /></PrivateValue></>}</div></div>
        <div className="flex flex-col items-end gap-1"><Badge tone={STATUS[o.status as keyof typeof STATUS].tone}>{STATUS[o.status as keyof typeof STATUS].label}</Badge>
          {Number(o.remaining) > 0 && <span className="text-[12.5px] text-muted"><PrivateValue><Money value={o.remaining} /></PrivateValue> left</span>}</div></li>)}</ul>
    </PortalCard>}

    <PortalCard title="Payments & receipts">
      {(pays ?? []).length ? <ul className="divide-y divide-border/70" data-payslips>{pays!.map(p => { const off = p.status !== 'posted'; const when = formatShortDate(p.paid_on ?? p.period); return <li key={p.id} className={`flex items-center gap-3 px-4 py-3 sm:px-5 ${off ? 'opacity-60' : ''}`}>
        <div className="min-w-0 flex-1"><div className="text-[15px] font-semibold">Paid {when}</div>
          <div className="truncate text-[13px] text-muted">{off ? 'Cancelled by HR' : [methodLabel(p.method), settled(p.id)].filter(x => x && x !== '—').join(' · ')}</div></div>
        <div className={`text-[15px] font-semibold ${off ? 'line-through' : ''}`}><PrivateValue><Money value={p.amount} /></PrivateValue></div>
        <a href={`/api/payslips/${p.id}`} aria-label={`Download the receipt for the payment on ${when}`} title="Receipt (PDF)" className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-border bg-surface text-primary shadow-key hover:bg-surface-2"><Download size={17} /></a></li> })}</ul>
        : <EmptyState compact icon={Wallet} title="No salary payments yet" body="Each payment and its receipt appear here once HR records it." />}
    </PortalCard>

    <PortalCard title="Advances & deductions">
      {(adv ?? []).length ? <ul className="divide-y divide-border/70" data-advances>{adv!.map(a => <li key={a.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
        <div className="min-w-0 flex-1"><div className="text-[15px] font-medium">{a.kind === 'advance' ? 'Advance' : 'Deduction'}<span className="text-[13px] font-normal text-muted"> · {formatShortDate(a.given_on)}</span></div>
          {(a.notes || a.monthly_recovery || Number(a.recovered) > 0) && <div className="truncate text-[13px] text-muted">{Number(a.recovered) > 0 ? <>Recovered <Money value={a.recovered} /></> : a.monthly_recovery ? <>Repaid <Money value={a.monthly_recovery} /> a month</> : null}{a.notes && (a.monthly_recovery || Number(a.recovered) > 0) ? ' · ' : ''}{a.notes}</div>}</div>
        <div className="flex flex-col items-end gap-1"><span className="text-[15px] font-semibold"><PrivateValue><Money value={a.amount} /></PrivateValue></span>
          {a.kind === 'advance' && <Badge tone={Number(a.remaining) > 0 ? 'amber' : 'green'}>{Number(a.remaining) > 0 ? 'Open' : 'Repaid'}</Badge>}</div></li>)}</ul>
        : <EmptyState compact icon={Banknote} title="No advances or deductions" />}
    </PortalCard>
    <p className="flex items-center justify-center gap-1.5 pb-2 text-[12px] text-muted"><CalendarCheck size={13} aria-hidden />Something wrong? Tell HR: only they can change salary records.</p>
  </div>
}
