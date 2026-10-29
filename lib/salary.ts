import 'server-only'
import type { Ctx } from './auth'
import { cents, fromCents, salaryStatus, splitOwed, sum, type Movement, type SalaryStatus } from './salary-math'

export type Obligation = { id: string; employee_id: string; kind: string; period: string | null; entry_date: string; amount: number; allocated: number; remaining: number; status: 'paid' | 'partial' | 'unpaid'; reason: string | null; created_at: string }
export type BoardRow = {
  id: string; name: string; no: string; status: string; monthly: number | null
  previous: number; current: number | null; currentId: string | null; currentDue: number; outstanding: number; paidThisMonth: number; payStatus: SalaryStatus
  open: Pick<Obligation, 'id' | 'kind' | 'period' | 'entry_date' | 'remaining' | 'reason'>[]
}
const INACTIVE = new Set(['resigned', 'terminated', 'archived'])
const num = (v: unknown) => Number(v ?? 0)
export const monthStart = (ym: string) => `${ym}-01`
export const monthEnd = (ym: string) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) }

/** Every employee's salary account for the dashboard, with the chosen month's activity. RLS limits it to salary access. */
export async function salaryBoard(c: Ctx, month: string) {
  const sb = c.supabase, from = monthStart(month), to = monthEnd(month)
  const [{ data: emps }, { data: comp }, { data: accts }, { data: obs }, { data: pays }, { data: added }] = await Promise.all([
    sb.from('employees').select('id,full_name,employee_no,status').is('deleted_at', null).order('full_name').limit(2000),
    sb.from('employee_compensation').select('employee_id,monthly_salary').limit(2000),
    sb.from('salary_accounts').select('employee_id,outstanding').limit(2000),
    sb.from('salary_obligations').select('id,employee_id,kind,period,entry_date,amount,allocated,remaining,status,reason,created_at').or(`remaining.gt.0,period.eq.${from}`).limit(20000),
    sb.from('salary_payments').select('employee_id,amount').eq('status', 'posted').gte('paid_on', from).lte('paid_on', to).limit(20000),
    sb.from('salary_ledger').select('employee_id,kind,amount').eq('status', 'posted').or(`and(kind.eq.accrual,period.eq.${from}),and(kind.eq.adjustment,amount.gt.0,entry_date.gte.${from},entry_date.lte.${to})`).limit(20000),
  ])
  const salary = new Map((comp ?? []).map(r => [r.employee_id, num(r.monthly_salary)]))
  const owed = new Map((accts ?? []).map(r => [r.employee_id, num(r.outstanding)]))
  const paid = new Map<string, number>(); for (const p of pays ?? []) paid.set(p.employee_id, fromCents(cents(paid.get(p.employee_id)) + cents(p.amount)))
  const byEmp = new Map<string, Obligation[]>(); for (const o of (obs ?? []) as any[]) { const l = byEmp.get(o.employee_id) ?? []; l.push({ ...o, amount: num(o.amount), allocated: num(o.allocated), remaining: num(o.remaining) }); byEmp.set(o.employee_id, l) }
  const rows: BoardRow[] = []
  for (const e of emps ?? []) {
    const outstanding = owed.get(e.id) ?? 0, list = byEmp.get(e.id) ?? [], p = paid.get(e.id) ?? 0
    if (INACTIVE.has(e.status) && cents(outstanding) === 0 && cents(p) === 0) continue   // former staff with nothing open stay off the list
    const { previous, current } = splitOwed(list, month)
    const acc = list.find(o => o.kind === 'accrual' && o.period === from)
    const open = list.filter(o => o.remaining > 0).sort((a, b) => (a.kind === 'opening' ? -1 : b.kind === 'opening' ? 1 : (a.period ?? a.entry_date).localeCompare(b.period ?? b.entry_date)))
    rows.push({
      id: e.id, name: e.full_name, no: e.employee_no, status: e.status, monthly: salary.get(e.id) ?? null,
      previous, current: acc ? acc.amount : null, currentId: acc?.id ?? null, currentDue: current, outstanding, paidThisMonth: p,
      payStatus: salaryStatus(outstanding, p, list.some(o => o.status === 'partial')),
      open: open.map(({ id, kind, period, entry_date, remaining, reason }) => ({ id, kind, period, entry_date, remaining, reason })),
    })
  }
  const totals = {
    outstanding: sum(rows.filter(r => r.outstanding > 0).map(r => r.outstanding)),
    paid: sum(rows.map(r => r.paidThisMonth)),
    accrued: sum((added ?? []).map(a => a.amount)),
    owing: rows.filter(r => cents(r.outstanding) > 0).length,
  }
  return { rows, totals }
}

/** Who can be posted for `month`: current staff with a salary, and whether that month is already posted for them. */
export async function monthPreview(c: Ctx, month: string) {
  const sb = c.supabase
  const [{ data: emps }, { data: comp }, { data: done }, { data: opens }] = await Promise.all([
    sb.from('employees').select('id,full_name,employee_no,status,joining_date').is('deleted_at', null).order('full_name').limit(2000),
    sb.from('employee_compensation').select('employee_id,monthly_salary').limit(2000),
    sb.from('salary_ledger').select('employee_id,amount').eq('kind', 'accrual').eq('status', 'posted').eq('period', monthStart(month)).limit(2000),
    sb.from('salary_ledger').select('employee_id,entry_date').eq('kind', 'opening').eq('status', 'posted').limit(2000),
  ])
  const salary = new Map((comp ?? []).map(r => [r.employee_id, num(r.monthly_salary)]))
  const posted = new Map((done ?? []).map(r => [r.employee_id, num(r.amount)]))
  const openingFrom = new Map((opens ?? []).map(r => [r.employee_id, r.entry_date.slice(0, 7)]))
  return (emps ?? []).filter(e => !INACTIVE.has(e.status) || posted.has(e.id)).map(e => {
    const s = salary.get(e.id) ?? 0, from = openingFrom.get(e.id)
    const why: 'posted' | 'no_salary' | 'before_opening' | 'not_joined' | null = posted.has(e.id) ? 'posted' : !s ? 'no_salary' : from && month < from ? 'before_opening' : e.joining_date && e.joining_date.slice(0, 7) > month ? 'not_joined' : null
    return { id: e.id, name: e.full_name, no: e.employee_no, salary: posted.get(e.id) ?? s, why }
  })
}

/** Everything on one employee's salary account page. */
export async function salaryAccount(c: Ctx, id: string) {
  const sb = c.supabase
  const [{ data: emp }, { data: comp }, { data: acct }, { data: obs }, { data: entries }, { data: pays }, { data: allocs }, { data: adv }, { data: hist }] = await Promise.all([
    sb.from('employees').select('id,full_name,employee_no,designation,status,joining_date,phone').eq('id', id).is('deleted_at', null).maybeSingle(),
    sb.from('employee_compensation').select('monthly_salary').eq('employee_id', id).maybeSingle(),
    sb.from('salary_accounts').select('*').eq('employee_id', id).maybeSingle(),
    sb.from('salary_obligations').select('id,employee_id,kind,period,entry_date,amount,allocated,remaining,status,reason,created_at').eq('employee_id', id).limit(2000),
    sb.from('salary_ledger').select('id,kind,period,entry_date,amount,reason,status,reversal_reason,reversed_at,advance_id,created_by,created_at').eq('employee_id', id).order('created_at').limit(5000),
    sb.from('salary_payments').select('id,period,amount,paid_on,method,reference,notes,status,reversal_reason,reversed_at,created_by,created_at').eq('employee_id', id).order('paid_on', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false }).limit(2000),
    sb.from('salary_allocations').select('obligation_id,payment_id,settlement_id,amount').eq('employee_id', id).limit(20000),
    sb.from('employee_advance_balances').select('*').eq('employee_id', id).order('given_on', { ascending: false }),
    sb.from('salary_audit').select('id,payment_id,entry_id,action,reason,user_id,created_at').eq('employee_id', id).order('created_at', { ascending: false }).limit(60),
  ])
  if (!emp) return null
  const ids = [...new Set([...(entries ?? []).map(e => e.created_by), ...(pays ?? []).map(p => p.created_by), ...(hist ?? []).map(h => h.user_id)].filter(Boolean))] as string[]
  const { data: people } = ids.length ? await sb.from('profiles').select('id,full_name').in('id', ids) : { data: [] }
  const who = new Map((people ?? []).map(p => [p.id, p.full_name as string]))
  const obligations = ((obs ?? []) as any[]).map(o => ({ ...o, amount: num(o.amount), allocated: num(o.allocated), remaining: num(o.remaining) }) as Obligation)
    .sort((a, b) => (a.kind === 'opening' ? -1 : b.kind === 'opening' ? 1 : (a.period ?? a.entry_date).localeCompare(b.period ?? b.entry_date) || a.created_at.localeCompare(b.created_at)))
  const obById = new Map(obligations.map(o => [o.id, o]))
  const allocOf = new Map<string, { obligation: Obligation; amount: number }[]>()
  for (const a of allocs ?? []) {
    const k = a.payment_id ?? a.settlement_id; const ob = obById.get(a.obligation_id); if (!k || !ob) continue
    const l = allocOf.get(k) ?? []; l.push({ obligation: ob, amount: num(a.amount) }); allocOf.set(k, l)
  }
  const payments = (pays ?? []).map(p => ({ ...p, amount: num(p.amount), by: p.created_by ? who.get(p.created_by) ?? null : null, allocations: allocOf.get(p.id) ?? [] }))
  const ledger = (entries ?? []).map(e => ({ ...e, amount: num(e.amount), by: e.created_by ? who.get(e.created_by) ?? null : null, allocations: allocOf.get(e.id) ?? [] }))
  const a = acct ?? { opening: 0, accrued: 0, additions: 0, deductions: 0, offsets: 0, paid: 0, outstanding: 0, last_accrual: null, opening_date: null }
  return {
    emp, monthly: comp ? num(comp.monthly_salary) : null, obligations, payments, ledger,
    account: { opening: num(a.opening), accrued: num(a.accrued), additions: num(a.additions), deductions: num(a.deductions), offsets: num(a.offsets), paid: num(a.paid), outstanding: num(a.outstanding), lastAccrual: a.last_accrual as string | null, openingDate: a.opening_date as string | null },
    advances: (adv ?? []).map(x => ({ ...x, amount: num(x.amount), recovered: num(x.recovered), remaining: num(x.remaining) })),
    history: (hist ?? []).map(h => ({ ...h, by: h.user_id ? who.get(h.user_id) ?? null : null })),
  }
}
export type SalaryAccount = NonNullable<Awaited<ReturnType<typeof salaryAccount>>>

/** Posted movements as statement lines (signed: + owed more, − owed less). Reversed entries are left out. */
export function movements(a: Pick<SalaryAccount, 'ledger' | 'payments'>): Movement[] {
  const out: Movement[] = []
  for (const e of a.ledger) {
    if (e.status !== 'posted') continue
    const sign = e.kind === 'deduction' || e.kind === 'advance_offset' ? -1 : 1
    const label = e.kind === 'opening' ? 'Opening balance' : e.kind === 'accrual' ? `Salary for ${monthLong(e.period!)}`
      : e.kind === 'adjustment' ? (e.amount > 0 ? `Addition: ${e.reason}` : `Adjustment: ${e.reason}`) : e.kind === 'deduction' ? `Deduction: ${e.reason}` : 'Advance recovered from salary'
    out.push({ id: e.id, date: e.entry_date, kind: e.kind, label, amount: sign * e.amount, ref: null, created_at: e.created_at })
  }
  for (const p of a.payments) {
    if (p.status !== 'posted') continue
    out.push({ id: p.id, date: p.paid_on ?? p.period, kind: 'payment', label: 'Salary payment', amount: -p.amount, ref: p.reference, created_at: p.created_at })
  }
  return out
}
export const monthLong = (d: string) => new Date(`${d.slice(0, 7)}-01T00:00:00Z`).toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
