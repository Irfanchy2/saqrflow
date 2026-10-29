import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/auth'
import { flat } from '@/lib/queries'
import { Card, CardHeader, Metrics, PageHeader, StatCard } from '@/components/ui/primitives'
import { Banknote, CalendarPlus, CircleDollarSign, Users } from '@/components/icons'
import { formatAed } from '@/lib/time'
import { monthLong, monthPreview, salaryBoard } from '@/lib/salary'
import { SalaryBoard } from '@/components/salary/board'
import { ProcessMonth } from '@/components/salary/process-month'
import { MonthPicker } from '@/components/salary/month-picker'

export const metadata = { title: 'Salary' }

/**
 * Salary dashboard: what the company owes each employee (one total per person, built from the salary ledger), and what
 * happened in the chosen month. Posting a month adds salary; paying reduces what is owed, oldest first.
 */
export default async function SalaryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await getCtx(); if (!c.can('salary.view')) redirect('/')
  const sp = await flat(searchParams), now = c.today.slice(0, 7)
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month ?? '') && sp.month! >= '2000-01' && sp.month! <= now ? sp.month! : now
  const label = monthLong(month)
  const [{ rows, totals }, preview] = await Promise.all([salaryBoard(c, month), monthPreview(c, month)])
  return <div className="mx-auto max-w-[1400px]">
    <PageHeader title="Salary" sub="What is owed to each employee, every payment and every salary month. Payments settle the oldest unpaid salary first."
      actions={<><MonthPicker month={month} max={now} /><ProcessMonth month={month} label={label} rows={preview} future={month > now} /></>} />
    <Metrics className="mb-5" cols={4}>
      <StatCard index={0} label="Total owed to employees" value={formatAed(totals.outstanding)} hint="All unpaid salary, today" icon={CircleDollarSign} tone={totals.outstanding > 0 ? 'amber' : 'neutral'} />
      <StatCard index={1} label={`Paid in ${label}`} value={formatAed(totals.paid)} hint="Salary payments recorded" icon={Banknote} />
      <StatCard index={2} label={`Salary added for ${label}`} value={formatAed(totals.accrued)} hint="Posted salary and additions" icon={CalendarPlus} />
      <StatCard index={3} label="Employees owed salary" value={String(totals.owing)} hint={`of ${rows.length} on the list`} icon={Users} />
    </Metrics>
    <Card><CardHeader title="Employees" sub={`Totals are as of today. "Paid this month" and "${label}" are for ${label}.`} />
      <SalaryBoard rows={rows} today={c.today} monthLabel={label.split(' ')[0]} /></Card>
  </div>
}
