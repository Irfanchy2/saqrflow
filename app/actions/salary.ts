'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getCtx, need } from '@/lib/auth'
import { safe, str } from '@/lib/action'
import { cents, fromCents } from '@/lib/salary-math'
import type { ActionState } from '@/lib/utils'

// Salary accounts (migration 0034). The database posts, allocates (oldest first), reverses and refuses; these actions
// validate the form, call it, and refresh the pages that show the balance.
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date')
const money = (what = 'Amount') => z.coerce.number({ message: `Enter the ${what.toLowerCase()}` }).positive(`${what} must be more than 0`).max(10_000_000).refine(v => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'Use at most 2 decimals')
const uuid = z.string().uuid()
const reason = z.string().trim().min(3, 'Give a reason (a few words)').max(500)
const refresh = (emp?: string) => { revalidatePath('/salary'); if (emp) { revalidatePath(`/salary/${emp}`); revalidatePath(`/employees/${emp}`) } revalidatePath('/me/salary'); revalidatePath('/me') }

/** Record one salary payment. Any number per month; a resubmitted form (same idempotency key) is saved once. */
export async function paySalary(_: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'salary.view')
    const v = z.object({
      employee_id: uuid, amount: money(), paid_on: day, method: z.enum(['cash', 'bank_transfer', 'cheque', 'wps', 'other'], { message: 'Choose how it was paid' }),
      reference: z.string().max(120).optional(), notes: z.string().max(500).optional(), allocate_to: uuid.optional(), idempotency_key: uuid.optional(),
    }).parse(Object.fromEntries(['employee_id', 'amount', 'paid_on', 'method', 'reference', 'notes', 'allocate_to', 'idempotency_key'].map(k => [k, str(fd, k)])))
    if (v.paid_on > c.today) return { error: 'The payment date cannot be in the future.', fieldErrors: { paid_on: 'In the future' } }
    const row = { company_id: c.company.id, employee_id: v.employee_id, amount: v.amount, paid_on: v.paid_on, period: `${v.paid_on.slice(0, 7)}-01`, method: v.method,
      reference: v.reference ?? null, notes: v.notes ?? null, allocate_to: v.allocate_to ?? null, idempotency_key: v.idempotency_key ?? null }
    const { data, error } = await c.supabase.from('salary_payments').insert(row).select('id').single()
    if (error?.code === '23505' && v.idempotency_key) {
      const [{ data: same }, { data: acct }] = await Promise.all([c.supabase.from('salary_payments').select('id').eq('idempotency_key', v.idempotency_key).maybeSingle(),
        c.supabase.from('salary_accounts').select('outstanding').eq('employee_id', v.employee_id).maybeSingle()])
      refresh(v.employee_id); return { ok: true, message: 'Payment already saved.', data: { paymentId: same?.id ?? null, outstanding: Number(acct?.outstanding ?? 0) } }
    }
    if (error) throw error
    const { data: acct } = await c.supabase.from('salary_accounts').select('outstanding').eq('employee_id', v.employee_id).maybeSingle()
    refresh(v.employee_id)
    return { ok: true, message: `Payment of AED ${v.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })} recorded.`, data: { paymentId: data.id, outstanding: Number(acct?.outstanding ?? 0) } }
  })
}

/** Post one salary month (accrual) for the chosen employees. Months already posted are skipped by the database. */
export async function postSalaryMonth(_: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'salary.view')
    const month = z.string().regex(/^\d{4}-\d{2}$/, 'Choose the month').parse(str(fd, 'month'))
    const ids = z.array(uuid).min(1, 'Tick at least one employee').max(2000).parse(fd.getAll('employee_id'))
    if (month > c.today.slice(0, 7)) return { error: 'Salary can only be posted for this month or earlier.' }
    const { data, error } = await c.supabase.rpc('salary_post_month', { p_period: `${month}-01`, p_employees: ids })
    if (error) throw error
    refresh(); for (const id of ids) revalidatePath(`/salary/${id}`)
    const n = Number(data ?? 0)
    return { ok: true, message: n ? `Salary posted for ${n} employee${n === 1 ? '' : 's'}.` : 'Nothing new to post: that month is already posted for everyone you chose.', data: { posted: n } }
  })
}

/**
 * Opening balance: what was owed to the employee before the records in Averiqo start. `mode=today` reconciles against what
 * is already recorded: the admin enters what is still owed today and the opening entry is worked out so nothing is counted
 * twice (opening = owed today − salary posted − additions + payments, deductions and recoveries already recorded).
 */
export async function setOpeningBalance(_: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'salary.view')
    const v = z.object({ employee_id: uuid, amount: z.coerce.number({ message: 'Enter the amount' }).min(0, 'Use 0 or more').max(10_000_000), as_of: day, mode: z.enum(['before', 'today']).default('before'), reason: z.string().max(500).optional() })
      .parse(Object.fromEntries(['employee_id', 'amount', 'as_of', 'mode', 'reason'].map(k => [k, str(fd, k)])))
    let amount = v.amount
    if (v.mode === 'today') {
      const { data: a } = await c.supabase.from('salary_accounts').select('opening,outstanding').eq('employee_id', v.employee_id).maybeSingle()
      const rest = cents(a?.outstanding) - cents(a?.opening)            // balance from everything except the opening entry
      amount = fromCents(cents(v.amount) - rest)
      if (amount < 0) return { error: `What is already recorded leaves AED ${fromCents(rest).toFixed(2)} owed, more than the AED ${v.amount.toFixed(2)} you entered. Check the payments and salary months recorded, or record an adjustment instead.` }
    }
    const { error } = await c.supabase.rpc('salary_set_opening', { p_employee: v.employee_id, p_amount: amount, p_as_of: v.as_of, p_reason: v.reason ?? null })
    if (error) throw error
    refresh(v.employee_id)
    return { ok: true, message: amount > 0 ? `Opening balance set to AED ${amount.toFixed(2)}.` : 'Opening balance removed.' }
  })
}

/** An addition (bonus, overtime, correction) or a deduction (damage, fine, unpaid leave), always with a reason. */
export async function recordAdjustment(_: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'salary.view')
    const v = z.object({ employee_id: uuid, type: z.enum(['addition', 'deduction']), amount: money(), reason, entry_date: day, period: z.string().regex(/^\d{4}-\d{2}$/).optional(), idempotency_key: uuid.optional() })
      .parse(Object.fromEntries(['employee_id', 'type', 'amount', 'reason', 'entry_date', 'period', 'idempotency_key'].map(k => [k, str(fd, k)])))
    const { error } = await c.supabase.from('salary_ledger').insert({
      company_id: c.company.id, employee_id: v.employee_id, kind: v.type === 'addition' ? 'adjustment' : 'deduction', amount: v.amount, reason: v.reason,
      entry_date: v.entry_date, period: v.type === 'addition' && v.period ? `${v.period}-01` : null, idempotency_key: v.idempotency_key ?? null,
    })
    if (error?.code === '23505' && v.idempotency_key) return { ok: true, message: 'Already saved.' }
    if (error) throw error
    refresh(v.employee_id); return { ok: true, message: v.type === 'addition' ? 'Addition recorded.' : 'Deduction recorded.' }
  })
}

/** Recover (part of) an advance from salary: reduces what is owed to the employee and what they owe back, once. */
export async function applyAdvance(_: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'salary.view')
    const v = z.object({ employee_id: uuid, advance_id: uuid, amount: money(), entry_date: day, idempotency_key: uuid.optional() })
      .parse(Object.fromEntries(['employee_id', 'advance_id', 'amount', 'entry_date', 'idempotency_key'].map(k => [k, str(fd, k)])))
    const { data: a } = await c.supabase.from('salary_accounts').select('outstanding').eq('employee_id', v.employee_id).maybeSingle()
    if (cents(v.amount) > cents(a?.outstanding)) return { error: `Only AED ${Number(a?.outstanding ?? 0).toFixed(2)} of salary is owed now. Recover at most that, or post the salary month first.`, fieldErrors: { amount: 'More than owed' } }
    const { error } = await c.supabase.from('salary_ledger').insert({ company_id: c.company.id, employee_id: v.employee_id, kind: 'advance_offset', advance_id: v.advance_id, amount: v.amount, entry_date: v.entry_date, idempotency_key: v.idempotency_key ?? null })
    if (error?.code === '23505' && v.idempotency_key) return { ok: true, message: 'Already saved.' }
    if (error) throw error
    refresh(v.employee_id); revalidatePath(`/employees/${v.employee_id}`); return { ok: true, message: 'Advance recovered from salary.' }
  })
}

/** Reverse a payment or a ledger entry (salary month, opening balance, adjustment, recovery). Kept, marked reversed, with the reason. */
export async function reverseSalaryItem(_: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'salary.view')
    const v = z.object({ id: uuid, type: z.enum(['payment', 'entry']), employee_id: uuid, reason }).parse(Object.fromEntries(['id', 'type', 'employee_id', 'reason'].map(k => [k, str(fd, k)])))
    const table = v.type === 'payment' ? 'salary_payments' : 'salary_ledger'
    const { data, error } = await c.supabase.from(table).update({ status: 'reversed', reversal_reason: v.reason }).eq('id', v.id).eq('employee_id', v.employee_id).eq('status', 'posted').select('id')
    if (error) throw error
    if (!data?.length) return { error: 'This item was already reversed, or you cannot change it.' }
    refresh(v.employee_id); return { ok: true, message: v.type === 'payment' ? 'Payment reversed. The amount is owed again.' : 'Entry reversed.' }
  })
}

/** Change a payment's date, method, reference or notes. The amount never changes: reverse it and record it again. */
export async function editPayment(_: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'salary.view')
    const v = z.object({ id: uuid, employee_id: uuid, paid_on: day, method: z.enum(['cash', 'bank_transfer', 'cheque', 'wps', 'other']), reference: z.string().max(120).optional(), notes: z.string().max(500).optional() })
      .parse(Object.fromEntries(['id', 'employee_id', 'paid_on', 'method', 'reference', 'notes'].map(k => [k, str(fd, k)])))
    if (v.paid_on > c.today) return { error: 'The payment date cannot be in the future.' }
    const { data, error } = await c.supabase.from('salary_payments').update({ paid_on: v.paid_on, method: v.method, reference: v.reference ?? null, notes: v.notes ?? null })
      .eq('id', v.id).eq('employee_id', v.employee_id).eq('status', 'posted').select('id')
    if (error) throw error
    if (!data?.length) return { error: 'This payment is reversed or no longer available.' }
    refresh(v.employee_id); return { ok: true, message: 'Payment details updated.' }
  })
}
