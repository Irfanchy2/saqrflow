import { getMe, portalSettings, advanceBalance, monthName } from '@/lib/me'
import { formatShortDate, startOfMonth } from '@/lib/time'
import { Badge, EmptyState, Money } from '@/components/ui/primitives'
import { Banknote, Download, Wallet } from '@/components/icons'
import { PortalCard } from '@/components/portal/stat'
import { PrivateValue } from '@/components/portal/private-value'

export const metadata = { title: 'My salary' }
const METHOD: Record<string, string> = { wps: 'WPS', bank_transfer: 'Bank transfer', cash: 'Cash', cheque: 'Cheque' }

/**
 * The employee's own salary: monthly amount, every payment with its payslip (PDF), advances and deductions and what is
 * left to repay. Read-only: HR records payments and advances, and they show up here (and in payroll) the moment they do.
 */
export default async function MySalary() {
  const { c, emp } = await getMe()
  if (!emp) return null
  const sb = c.supabase
  const [settings, { data: comp }, { data: pays }, { data: adv }] = await Promise.all([
    portalSettings(c),
    sb.from('employee_compensation').select('monthly_salary,updated_at').eq('employee_id', emp.id).maybeSingle(),
    sb.from('salary_payments').select('id,period,amount,paid_on,method').eq('employee_id', emp.id).order('period', { ascending: false }).limit(36),
    sb.from('employee_advances').select('id,kind,amount,given_on,monthly_recovery,settled,notes').eq('employee_id', emp.id).order('given_on', { ascending: false }),
  ])
  const salary = comp ? Number(comp.monthly_salary) : null
  const bal = advanceBalance(salary, adv ?? [], settings.advanceLimitPct)
  const month = startOfMonth(c.today), thisMonth = (pays ?? []).find(p => p.period.slice(0, 7) === month.slice(0, 7))
  const recovery = (adv ?? []).filter(a => a.kind === 'advance' && !a.settled).reduce((s, a) => s + Number(a.monthly_recovery ?? 0), 0)
  return <div className="space-y-4">
    <div className="pt-1"><h1 className="text-[26px] font-semibold tracking-[-0.03em] sm:text-[30px]">Salary</h1>
      <p className="mt-0.5 text-[13px] text-muted">Only you and HR can see this. Tap an amount to show it.</p></div>

    <section className="rounded-2xl border border-border/80 bg-surface p-5 shadow-card" data-salary-summary>
      <div className="text-[13px] font-medium text-muted">Monthly salary</div>
      <div className="mt-1 text-[30px] font-semibold tracking-[-0.03em]">{salary !== null ? <PrivateValue><Money value={salary} /></PrivateValue> : <span className="text-[16px] font-normal text-muted">Not set yet</span>}</div>
      <div className="mt-4 grid grid-cols-2 gap-3 text-[14px]">
        <div className="rounded-xl bg-surface-2 px-3.5 py-3"><div className="text-[12.5px] text-muted">{monthName(month)}</div>
          <div className="mt-1">{thisMonth?.paid_on ? <Badge tone="green">Paid {formatShortDate(thisMonth.paid_on)}</Badge> : thisMonth ? <Badge tone="blue">Being processed</Badge> : <Badge tone="amber">Not paid yet</Badge>}</div></div>
        <div className="rounded-xl bg-surface-2 px-3.5 py-3"><div className="text-[12.5px] text-muted">Advances to repay</div>
          <div className="mt-1 font-semibold"><PrivateValue><Money value={bal.outstanding} /></PrivateValue></div>{recovery > 0 && <div className="text-[12px] text-muted">Recovered <Money value={recovery} /> a month</div>}</div>
      </div>
      {bal.available !== null && <div className="mt-3 flex items-center gap-3 rounded-xl border border-success/20 bg-success/[.06] px-3.5 py-3 text-[14px]" data-advance-available>
        <Banknote size={18} className="shrink-0 text-success" aria-hidden /><span>Advance you can still ask for: <b className="font-semibold"><PrivateValue><Money value={bal.available} /></PrivateValue></b>
          <span className="block text-[12px] text-muted">Up to {settings.advanceLimitPct}% of your monthly salary, less advances not yet repaid. Ask HR.</span></span></div>}
    </section>

    <PortalCard title="Payments & payslips">
      {(pays ?? []).length ? <ul className="divide-y divide-border/70" data-payslips>{pays!.map(p => <li key={p.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
        <div className="min-w-0 flex-1"><div className="text-[15px] font-semibold">{monthName(p.period)}</div>
          <div className="text-[13px] text-muted">{p.paid_on ? `Paid ${formatShortDate(p.paid_on)}` : 'Not paid yet'}{p.method ? ` · ${METHOD[p.method] ?? p.method}` : ''}</div></div>
        <div className="text-[15px] font-semibold"><PrivateValue><Money value={p.amount} /></PrivateValue></div>
        <a href={`/api/payslips/${p.id}`} aria-label={`Download payslip for ${monthName(p.period)}`} title="Payslip (PDF)" className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-border bg-surface text-primary shadow-key hover:bg-surface-2"><Download size={17} /></a></li>)}</ul>
        : <EmptyState compact icon={Wallet} title="No salary payments yet" body="Each payment and its payslip appear here once HR records it." />}
    </PortalCard>

    <PortalCard title="Advances & deductions">
      {(adv ?? []).length ? <ul className="divide-y divide-border/70" data-advances>{adv!.map(a => <li key={a.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
        <div className="min-w-0 flex-1"><div className="text-[15px] font-medium">{a.kind === 'advance' ? 'Advance' : 'Deduction'}<span className="text-[13px] font-normal text-muted"> · {formatShortDate(a.given_on)}</span></div>
          {(a.notes || a.monthly_recovery) && <div className="truncate text-[13px] text-muted">{a.monthly_recovery ? <>Repaid <Money value={a.monthly_recovery} /> a month</> : null}{a.notes && a.monthly_recovery ? ' · ' : ''}{a.notes}</div>}</div>
        <div className="flex flex-col items-end gap-1"><span className="text-[15px] font-semibold"><PrivateValue><Money value={a.amount} /></PrivateValue></span>
          {a.kind === 'advance' && <Badge tone={a.settled ? 'green' : 'amber'}>{a.settled ? 'Repaid' : 'Open'}</Badge>}</div></li>)}</ul>
        : <EmptyState compact icon={Banknote} title="No advances or deductions" />}
    </PortalCard>
  </div>
}
