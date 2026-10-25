import Link from 'next/link'
import { getMe, portalSettings, advanceBalance, attendanceSummary, monthName, clock } from '@/lib/me'
import { endOfMonth, formatShortDate, localHm, startOfMonth } from '@/lib/time'
import { Badge, EmptyState, Money } from '@/components/ui/primitives'
import { AlertTriangle, Banknote, CalendarCheck, CheckCircle2, Clock, Receipt, Wallet } from '@/components/icons'
import { NewClaim } from '@/components/portal/new-claim'
import { ClaimList, CLAIM_COLS, type ClaimRow } from '@/components/portal/claim-list'
import { PortalCard, PortalStat } from '@/components/portal/stat'
import { PrivateValue } from '@/components/portal/private-value'
import { Today } from '@/components/portal/today'
import { claimSuppliers } from '@/lib/expenses/claim-suppliers'

export const metadata = { title: 'My portal' }

/** Employee home: add an expense in one tap, then the person's own month at a glance (expenses, attendance, salary). */
export default async function MyHome() {
  const { c, emp } = await getMe()
  if (!emp) return null
  const month = startOfMonth(c.today), monthEnd = endOfMonth(c.today), sb = c.supabase
  const [sups, settings, { data: all }, { data: recent }, { data: att }, { data: comp }, { data: pays }, { data: adv }] = await Promise.all([
    claimSuppliers(c, emp.id),
    portalSettings(c),
    sb.from('expense_claims').select('status,amount,vat_amount,spent_on').eq('employee_id', emp.id).limit(5000),
    sb.from('expense_claims').select(CLAIM_COLS).eq('employee_id', emp.id).order('created_at', { ascending: false }).limit(5),
    sb.from('attendance_records').select('work_date,status,overtime_hours,check_in_at,check_out_at').eq('employee_id', emp.id).gte('work_date', month).lte('work_date', monthEnd),
    sb.from('employee_compensation').select('monthly_salary').eq('employee_id', emp.id).maybeSingle(),
    sb.from('salary_payments').select('id,period,amount,paid_on').eq('employee_id', emp.id).order('period', { ascending: false }).limit(2),
    sb.from('employee_advances').select('kind,amount,settled,given_on').eq('employee_id', emp.id),
  ])
  const claims = all ?? [], total = (r: { amount: unknown; vat_amount: unknown }) => Number(r.amount) + Number(r.vat_amount)
  const thisMonth = claims.filter(r => r.spent_on >= month && r.spent_on <= monthEnd && r.status !== 'withdrawn')
  const by = (s: string) => claims.filter(r => r.status === s)
  const attention = by('correction_requested').length
  const sum = attendanceSummary(att ?? [])
  const today = (att ?? []).find(a => a.work_date === c.today)
  const salary = comp ? Number(comp.monthly_salary) : null
  const bal = advanceBalance(salary, adv ?? [], settings.advanceLimitPct)
  const lastAdv = (adv ?? []).filter(a => a.kind === 'advance').sort((a, b) => b.given_on.localeCompare(a.given_on))[0]
  const paidNow = (pays ?? []).find(p => p.period.slice(0, 7) === month.slice(0, 7) && p.paid_on), last = (pays ?? []).find(p => p.paid_on)
  const hour = Number(localHm(new Date(), c.company.timezone).slice(0, 2))
  const hello = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const tz = c.company.timezone

  return <div className="space-y-4">
    <div className="pb-1 pt-1">
      <p className="text-[13px] font-medium text-muted">{formatShortDate(c.today)}{emp.designation ? ` · ${emp.designation}` : ''}</p>
      <h1 className="mt-0.5 text-[26px] font-semibold leading-tight tracking-[-0.03em] sm:text-[30px]">{hello}, {emp.full_name.split(' ')[0]}</h1>
    </div>

    {attention > 0 && <Link href="/me/expenses?status=correction_requested" className="flex items-center gap-3 rounded-2xl border border-primary/20 bg-primary-soft px-4 py-3 text-[14px] font-medium text-primary">
      <AlertTriangle size={18} aria-hidden className="shrink-0" />{attention === 1 ? 'One expense needs a correction from you.' : `${attention} expenses need a correction from you.`}<span className="ms-auto shrink-0 underline-offset-2">Fix now</span></Link>}

    <PortalCard title="Add an expense" sub="Photograph the receipt: the details fill in for you to check.">
      <div className="px-4 pb-4 sm:px-5"><NewClaim today={c.today} suppliers={sups} /></div>
    </PortalCard>

    {settings.checkin && <Today c={c} empId={emp.id} settings={settings} />}

    <div className="grid grid-cols-2 gap-3" data-expense-stats>
      <PortalStat label={`Expenses in ${monthName(month).split(' ')[0]}`} icon={Receipt} tone="blue" testId="month-count" href="/me/expenses"
        value={<Money value={thisMonth.reduce((s, r) => s + total(r), 0)} />} hint={`${thisMonth.length} expense${thisMonth.length === 1 ? '' : 's'}`} />
      <PortalStat label="Pending approval" icon={Clock} tone="amber" testId="pending" href="/me/expenses?status=pending"
        value={by('pending').length} hint={<Money value={by('pending').reduce((s, r) => s + total(r), 0)} />} />
      <PortalStat label="Approved" icon={CheckCircle2} tone="green" testId="approved" href="/me/expenses?status=approved"
        value={by('approved').length} hint={<Money value={by('approved').reduce((s, r) => s + total(r), 0)} />} />
      <PortalStat label="Rejected" icon={AlertTriangle} tone="red" testId="rejected" href="/me/expenses?status=rejected"
        value={by('rejected').length} hint={<Money value={by('rejected').reduce((s, r) => s + total(r), 0)} />} />
    </div>

    <PortalCard title="Salary" sub="Only you can see this. Tap an amount to show it." action={<Link href="/me/salary" className="text-[13px] font-medium text-primary">Details</Link>}>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-4 px-4 pb-5 pt-1 sm:px-5" data-salary>
        <div><dt className="text-[12.5px] text-muted">Monthly salary</dt><dd className="mt-1 text-[19px] font-semibold tabular-nums">{salary !== null ? <PrivateValue><Money value={salary} /></PrivateValue> : <span className="text-[14px] font-normal text-muted">Not set</span>}</dd></div>
        <div><dt className="text-[12.5px] text-muted">{monthName(month)}</dt><dd className="mt-1.5">{paidNow ? <Badge tone="green">Paid {formatShortDate(paidNow.paid_on!)}</Badge> : <Badge tone="amber">Not paid yet</Badge>}</dd></div>
        <div><dt className="text-[12.5px] text-muted">Last payment</dt><dd className="mt-1 text-[14px] font-medium">{last ? <><span className="block">{monthName(last.period)}</span><PrivateValue><Money value={last.amount} /></PrivateValue></> : <span className="font-normal text-muted">None yet</span>}</dd></div>
        {lastAdv && <div className="col-span-2 flex items-center justify-between gap-3 rounded-xl border border-border/80 px-3.5 py-2.5" data-last-advance><dt className="text-[13px] text-muted">Last advance received</dt>
          <dd className="text-end text-[13.5px] font-medium">{formatShortDate(lastAdv.given_on)} · <PrivateValue><Money value={lastAdv.amount} /></PrivateValue></dd></div>}
        <div><dt className="text-[12.5px] text-muted">Advances to repay</dt><dd className="mt-1 text-[14px] font-medium"><PrivateValue><Money value={bal.outstanding} /></PrivateValue></dd></div>
        {bal.available !== null && <div className="col-span-2 flex items-center gap-3 rounded-xl bg-surface-2 px-3.5 py-3"><Banknote size={18} className="shrink-0 text-success" aria-hidden />
          <span className="text-[13.5px]">Advance you can still ask for: <b className="font-semibold"><PrivateValue><Money value={bal.available} /></PrivateValue></b></span></div>}
      </dl>
    </PortalCard>

    <PortalCard title={`Attendance · ${monthName(month)}`} action={<Link href="/me/attendance" className="text-[13px] font-medium text-primary">All days</Link>}>
      <div className="grid grid-cols-4 gap-2 px-4 pb-5 pt-1 text-center sm:px-5" data-attendance>
        {([['Present', sum.present + sum.half_day * 0.5, 'text-success'], ['Absent', sum.absent, 'text-danger'], ['Leave', sum.leave, 'text-primary'], ['Overtime h', sum.overtime, 'text-fg']] as const).map(([l, v, t]) =>
          <div key={l} className="rounded-xl bg-surface-2 px-1 py-3"><div className={`text-[20px] font-semibold tabular-nums ${t}`}>{v}</div><div className="mt-0.5 text-[11.5px] text-muted">{l}</div></div>)}
      </div>
    </PortalCard>

    <PortalCard title="Recent expenses" action={(recent ?? []).length ? <Link href="/me/expenses" className="text-[13px] font-medium text-primary">View all</Link> : undefined}>
      {(recent ?? []).length ? <ClaimList rows={recent as ClaimRow[]} /> : <EmptyState compact icon={Wallet} title="No expenses yet" body="Scan your first receipt above. It goes to your manager for approval." />}
    </PortalCard>
    <p className="flex items-center justify-center gap-1.5 pb-2 pt-1 text-[12px] text-muted"><CalendarCheck size={13} aria-hidden />Something wrong in your records? Tell HR: only they can change attendance and salary.</p>
  </div>
}
