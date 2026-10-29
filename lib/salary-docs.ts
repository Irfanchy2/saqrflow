import 'server-only'
import type { Ctx } from './auth'
import { brandingBytes, brandingFor } from './sales/data'
import { renderSimplePdf } from './sales/simple-pdf'
import { fmtMoney } from './sales/money'
import { safePart } from './sales/filename'
import { formatShortDate } from './time'
import { methodLabel, sum, STATUS, type SalaryStatus } from './salary-math'

const monthLong = (d: string) => new Date(`${d.slice(0, 7)}-01T00:00:00Z`).toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })

/**
 * One month's payslip, read from the salary ledger (migration 0034): the salary posted for the month, additions for the
 * month, deductions and recoveries applied to it, the payments allocated to it and what is still unpaid. It is a statement
 * of the month, not a receipt, and building it never posts or changes anything. `id` is the month's salary entry
 * (salary_ledger, kind accrual). RLS decides who can read it: salary access, or the employee for their own months.
 */
export async function loadPayslip(c: Ctx, id: string, ownEmployeeId?: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null
  const sb = c.supabase
  const { data: acc } = await sb.from('salary_ledger').select('id,employee_id,kind,period,amount,status,employee:employees(id,full_name,employee_no,designation,phone,whatsapp)').eq('id', id).maybeSingle()
  if (!acc || acc.kind !== 'accrual' || acc.status !== 'posted' || !acc.period) return null
  const e: any = (acc as any).employee
  if (!e || (ownEmployeeId && e.id !== ownEmployeeId)) return null
  const month = acc.period.slice(0, 7), from = `${month}-01`
  const to = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).toISOString().slice(0, 10)
  const [{ data: obs }, { data: deds }] = await Promise.all([
    sb.from('salary_obligations').select('id,kind,period,entry_date,amount,allocated,remaining,reason').eq('employee_id', e.id),
    sb.from('salary_ledger').select('id,kind,amount,reason,entry_date').eq('employee_id', e.id).eq('status', 'posted').in('kind', ['deduction', 'advance_offset']).gte('entry_date', from).lte('entry_date', to),
  ])
  // the month's obligations: its salary, and additions dated (or aimed) at this month
  const mine = (obs ?? []).filter(o => o.id === acc.id || (o.kind === 'adjustment' && (o.period ?? o.entry_date).slice(0, 7) === month))
  const ids = mine.map(o => o.id)
  const { data: allocs } = ids.length ? await sb.from('salary_allocations').select('obligation_id,payment_id,settlement_id,amount').in('obligation_id', ids) : { data: [] }
  const payIds = [...new Set((allocs ?? []).map(a => a.payment_id).filter(Boolean))] as string[]
  const { data: pays } = payIds.length ? await sb.from('salary_payments').select('id,paid_on,period,method,reference').in('id', payIds) : { data: [] }
  const payOf = new Map((pays ?? []).map(p => [p.id, p]))
  const additions = mine.filter(o => o.kind === 'adjustment').map(o => ({ reason: o.reason ?? 'Addition', amount: Number(o.amount) }))
  const gross = sum([acc.amount, ...additions.map(a => a.amount)])
  const appliedDeductions = sum((allocs ?? []).filter(a => a.settlement_id).map(a => a.amount))
  const payments = [...(allocs ?? []).filter(a => a.payment_id).reduce((m, a) => m.set(a.payment_id!, sum([m.get(a.payment_id!) ?? 0, a.amount])), new Map<string, number>())]
    .map(([pid, amount]) => ({ id: pid, amount, ...payOf.get(pid) }))
    .sort((a, b) => String(a.paid_on ?? a.period).localeCompare(String(b.paid_on ?? b.period)))
  const paid = sum(payments.map(p => p.amount))
  const remaining = sum(mine.map(o => o.remaining))
  const status: SalaryStatus = remaining <= 0 ? 'paid' : paid + appliedDeductions > 0 ? 'partial' : 'unpaid'
  return {
    id: acc.id, employee: e, month, monthLabel: monthLong(from), basic: Number(acc.amount), additions, gross, appliedDeductions,
    net: sum([gross, -appliedDeductions]), payments, paid, remaining, status,
    deductionsRecorded: (deds ?? []).map(d => ({ kind: d.kind, reason: d.reason, amount: Number(d.amount), date: d.entry_date })),
    filename: `Payslip_${safePart(e.full_name)}_${month}.pdf`,
  }
}
export type Payslip = NonNullable<Awaited<ReturnType<typeof loadPayslip>>>

export async function payslipPdf(c: Ctx, p: Payslip): Promise<Uint8Array> {
  const [b, images] = await Promise.all([brandingFor(c), brandingBytes(c)])
  const rows: string[][] = [[`Basic salary for ${p.monthLabel}`, fmtMoney(p.basic)],
    ...p.additions.map(a => [`Addition: ${a.reason}`, fmtMoney(a.amount)]),
    ...(p.additions.length ? [['Total salary for the month', fmtMoney(p.gross)]] : []),
    ...(p.appliedDeductions > 0 ? [['Deductions and advance recoveries applied to this month', `- ${fmtMoney(p.appliedDeductions)}`]] : []),
    ['Net salary for the month', fmtMoney(p.net)],
    ...p.payments.map(x => [`Paid on ${formatShortDate(String(x.paid_on ?? x.period))} (${methodLabel(x.method)}${x.reference ? `, ${x.reference}` : ''})`, `- ${fmtMoney(x.amount)}`])]
  const outside = p.deductionsRecorded.length && Math.abs(sum(p.deductionsRecorded.map(d => d.amount)) - p.appliedDeductions) > 0.004
  return renderSimplePdf({
    title: 'Payslip', companyName: c.company.name, images, showHeaderFooter: b.showHeaderFooter, companyAddress: b.companyAddress, companyPhone: b.companyPhone, companyEmail: b.companyEmail,
    left: [['Employee:', p.employee.full_name], ['Employee ID:', p.employee.employee_no], ...(p.employee.designation ? [['Designation:', p.employee.designation] as [string, string]] : [])],
    right: [['Salary month:', p.monthLabel], ['Status:', STATUS[p.status].label], ['Printed:', formatShortDate(c.today)]],
    table: { cols: [{ h: 'Description', w: 4 }, { h: 'Amount (AED)', w: 1.4, right: true }], rows, total: ['Remaining unpaid for this month', fmtMoney(p.remaining)] },
    note: [`This payslip shows the salary for ${p.monthLabel} as recorded on ${formatShortDate(c.today)}. It is not a payment receipt: each payment has its own receipt.`,
      outside ? 'Some deductions recorded this month were applied to earlier unpaid salary (oldest first), so they appear on those months.' : ''].filter(Boolean).join('\n'),
    signLine: 'Authorised signature',
  })
}
