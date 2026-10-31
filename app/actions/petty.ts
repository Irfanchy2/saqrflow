'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getCtx, type Ctx } from '@/lib/auth'
import { safe, str } from '@/lib/action'
import { ForbiddenError } from '@/lib/permissions'
import { getMe } from '@/lib/me'
import { canManagePetty } from '@/lib/petty'
import type { ActionState } from '@/lib/utils'

// Employee Petty Cash: company money an employee holds for business purchases. Every posting is one database function
// (migration 0037) that checks the caller's permission again, locks the employee's wallet, refuses a negative balance and
// posts each business event exactly once (a request key per form; retries and double clicks return the first result).
// Nothing here reads or writes salary, salary advances or payslips.

const uuid = z.string().uuid()
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a date')
const money = (label = 'Amount') => z.coerce.number({ message: `Enter the ${label.toLowerCase()}` }).finite().refine(n => n > 0, `${label} must be more than zero`).refine(n => n <= 10_000_000, `${label} is too large`)
  .refine(n => Math.abs(Math.round(n * 100) - n * 100) < 1e-6, 'Use at most 2 decimals')
const method = z.enum(['cash', 'bank_transfer', 'cheque', 'card', 'other']).default('cash')
const text = (max: number) => z.string().trim().max(max, 'Too long').optional()
const bad = (e: z.ZodError): ActionState => ({ error: e.issues[0].message, fieldErrors: Object.fromEntries(e.issues.map(i => [i.path.join('.'), i.message])) })
const pick = (fd: FormData, keys: string[]) => Object.fromEntries(keys.map(k => [k, str(fd, k)]))
const dbError = (m: string) => ({ error: m.length < 220 ? m : 'This could not be saved. Please try again.' })
function refresh(emp?: string | null) {
  revalidatePath('/expenses'); revalidatePath('/approvals'); revalidatePath('/me/expenses'); revalidatePath('/me/expenses/petty-cash'); revalidatePath('/')
  if (emp) revalidatePath(`/expenses/petty-cash/${emp}`)
}
async function manager(): Promise<Ctx> {
  const c = await getCtx()
  if (!canManagePetty(c)) throw new ForbiddenError('expenses.approve')
  return c
}

// ───────────── approvers ─────────────
const issueSchema = z.object({
  employee_id: uuid, amount: money(), entry_date: day, method, paid_from_bank_id: uuid.optional(), project_id: uuid.optional(),
  purpose: z.string().trim().min(2, 'Give the purpose').max(300), reference: text(120), notes: text(2000), idempotency_key: uuid,
})
/** Issue Petty Cash: the money was handed over. Credits the wallet once; the account it came from goes down once. */
export async function issuePettyCash(_: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await manager()
    const r = issueSchema.safeParse(pick(fd, ['employee_id', 'amount', 'entry_date', 'method', 'paid_from_bank_id', 'project_id', 'purpose', 'reference', 'notes', 'idempotency_key']))
    if (!r.success) return bad(r.error)
    const v = r.data
    if (v.entry_date > c.today) return { error: 'The hand-over date cannot be in the future.', fieldErrors: { entry_date: 'In the future' } }
    const { error } = await c.supabase.rpc('petty_issue', { p_employee: v.employee_id, p_amount: v.amount, p_date: v.entry_date, p_method: v.method, p_bank: v.paid_from_bank_id ?? null,
      p_project: v.project_id ?? null, p_purpose: v.purpose, p_reference: v.reference || null, p_notes: v.notes || null, p_document: null, p_key: v.idempotency_key })
    if (error) return dbError(error.message)
    refresh(v.employee_id)
    return { ok: true, message: `Petty cash issued: AED ${v.amount.toFixed(2)}.` }
  })
}

const decideSchema = z.object({
  decision: z.enum(['approved', 'rejected', 'correction_requested'], { message: 'Choose a decision' }), note: text(2000),
  link: z.string().optional(), deposit_bank_id: uuid.optional(), paid_from_bank_id: uuid.optional(),
}).refine(v => v.decision === 'approved' || !!v.note, { message: 'Give a reason so the employee knows what to fix', path: ['note'] })
/** Confirm (or refuse) what an employee reported: money received (matched to a recorded hand-over, or credited now) or a return. */
export async function decidePettyRequest(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await manager()
    if (!uuid.safeParse(id).success) return { error: 'Request not found.' }
    const r = decideSchema.safeParse(pick(fd, ['decision', 'note', 'link', 'deposit_bank_id', 'paid_from_bank_id']))
    if (!r.success) return bad(r.error)
    const v = r.data
    const { data: req } = await c.supabase.from('petty_cash_requests').select('kind,employee_id').eq('id', id).maybeSingle()
    if (!req) return { error: 'Request not found.' }
    const link = v.link && v.link !== 'new' && uuid.safeParse(v.link).success ? v.link : null
    const bank = req.kind === 'return' ? v.deposit_bank_id : link ? null : v.paid_from_bank_id
    const { error } = await c.supabase.rpc('petty_decide_request', { p_request: id, p_decision: v.decision, p_note: v.note || null, p_link: v.decision === 'approved' ? link : null, p_bank: v.decision === 'approved' ? bank ?? null : null })
    if (error) return dbError(error.message)
    refresh(req.employee_id)
    return { ok: true, message: v.decision === 'approved' ? (req.kind === 'return' ? 'Return confirmed.' : link ? 'Confirmed and matched to the recorded hand-over (not credited twice).' : 'Confirmed: added to the employee\'s petty cash.')
      : v.decision === 'rejected' ? 'Not accepted. The employee was told why.' : 'Sent back to the employee for a correction.' }
  })
}

const moneySchema = z.object({ employee_id: uuid, amount: money(), entry_date: day, method, bank: uuid.optional(), reference: text(120), notes: text(2000), idempotency_key: uuid })
/** Record unused petty cash handed back to the company (confirmed by the approver who received it). */
export async function recordPettyReturn(_: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await manager()
    const r = moneySchema.safeParse({ ...pick(fd, ['employee_id', 'amount', 'entry_date', 'method', 'reference', 'notes', 'idempotency_key']), bank: str(fd, 'deposit_bank_id') })
    if (!r.success) return bad(r.error)
    const v = r.data
    const { error } = await c.supabase.rpc('petty_record_return', { p_employee: v.employee_id, p_amount: v.amount, p_date: v.entry_date, p_method: v.method, p_bank: v.bank ?? null, p_reference: v.reference || null, p_notes: v.notes || null, p_key: v.idempotency_key })
    if (error) return dbError(error.message)
    refresh(v.employee_id)
    return { ok: true, message: `Return of AED ${v.amount.toFixed(2)} recorded.` }
  })
}

/** Pay back (part of) what the company owes the employee for expenses they paid with their own money. */
export async function payReimbursement(_: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await manager()
    const r = moneySchema.safeParse({ ...pick(fd, ['employee_id', 'amount', 'entry_date', 'method', 'reference', 'notes', 'idempotency_key']), bank: str(fd, 'paid_from_bank_id') })
    if (!r.success) return bad(r.error)
    const v = r.data
    const { error } = await c.supabase.rpc('petty_reimburse', { p_employee: v.employee_id, p_amount: v.amount, p_date: v.entry_date, p_method: v.method, p_bank: v.bank ?? null, p_reference: v.reference || null, p_notes: v.notes || null, p_key: v.idempotency_key })
    if (error) return dbError(error.message)
    refresh(v.employee_id)
    return { ok: true, message: `Reimbursement of AED ${v.amount.toFixed(2)} recorded.` }
  })
}

const adjustSchema = z.object({
  employee_id: uuid, direction: z.enum(['add', 'remove'], { message: 'Choose add or take off' }), amount: money(), entry_date: day,
  reason: z.string().trim().min(3, 'Give the reason').max(250), idempotency_key: uuid,
})
/** An authorized correction of the wallet (a counted shortage, a mistake), with its reason. Never below zero. */
export async function adjustPettyCash(_: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await manager()
    const r = adjustSchema.safeParse(pick(fd, ['employee_id', 'direction', 'amount', 'entry_date', 'reason', 'idempotency_key']))
    if (!r.success) return bad(r.error)
    const v = r.data
    const { error } = await c.supabase.rpc('petty_adjust', { p_employee: v.employee_id, p_amount: v.direction === 'add' ? v.amount : -v.amount, p_date: v.entry_date, p_reason: v.reason, p_key: v.idempotency_key })
    if (error) return dbError(error.message)
    refresh(v.employee_id)
    return { ok: true, message: 'Adjustment recorded.' }
  })
}

/** Reverse a posted entry: an opposite, linked entry (and its company cash), with the reason. The entry itself stays. */
export async function reversePettyEntry(_: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await manager()
    const r = z.object({ id: uuid, employee_id: uuid, reason: z.string().trim().min(3, 'Give the reason').max(250) }).safeParse(pick(fd, ['id', 'employee_id', 'reason']))
    if (!r.success) return bad(r.error)
    const { error } = await c.supabase.rpc('petty_reverse', { p_entry: r.data.id, p_reason: r.data.reason })
    if (error) return dbError(error.message)
    refresh(r.data.employee_id)
    return { ok: true, message: 'Reversed. Both entries stay on the statement.' }
  })
}

const settleSchema = z.object({ petty: z.coerce.number().min(0).max(10_000_000).default(0), personal: z.coerce.number().min(0).max(10_000_000).default(0), idempotency_key: uuid })
  .refine(v => v.petty + v.personal > 0, { message: 'Enter an amount to settle', path: ['petty'] })
/** Settle (the rest of) an approved expense: from the employee's petty cash and/or as money owed to the employee. */
export async function settleClaim(claimId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await manager()
    if (!uuid.safeParse(claimId).success) return { error: 'Expense not found.' }
    const r = settleSchema.safeParse({ petty: str(fd, 'petty') || 0, personal: str(fd, 'personal') || 0, idempotency_key: str(fd, 'idempotency_key') })
    if (!r.success) return bad(r.error)
    const { data: cl } = await c.supabase.from('expense_claims').select('employee_id').eq('id', claimId).maybeSingle()
    const { error } = await c.supabase.rpc('petty_settle_claim', { p_claim: claimId, p_petty: r.data.petty, p_personal: r.data.personal, p_key: r.data.idempotency_key })
    if (error) return dbError(error.message)
    refresh(cl?.employee_id)
    return { ok: true, message: 'Expense settled.' }
  })
}

// ───────────── employees (their own wallet only) ─────────────
const reportSchema = z.object({
  kind: z.enum(['received', 'return']), amount: money(), entry_date: day, method, counterparty: text(200), project_id: uuid.optional(),
  purpose: text(300), reference: text(120), notes: text(2000), idempotency_key: uuid.optional(),
})
const REPORT_KEYS = ['kind', 'amount', 'entry_date', 'method', 'counterparty', 'project_id', 'purpose', 'reference', 'notes', 'idempotency_key']
/** "Add Petty Cash Received" / "Return Unused Petty Cash": saved as pending; the wallet changes only once an approver confirms. */
export async function reportPettyCash(_: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const { c, emp } = await getMe()
    if (!emp) return { error: 'Your login is not linked to an employee record. Ask your administrator.' }
    const r = reportSchema.safeParse(pick(fd, REPORT_KEYS))
    if (!r.success) return bad(r.error)
    const v = r.data
    if (v.entry_date > c.today) return { error: 'The date cannot be in the future.', fieldErrors: { entry_date: 'In the future' } }
    if (v.kind === 'received' && !v.counterparty) return { error: 'Say who gave you the money.', fieldErrors: { counterparty: 'Required' } }
    if (v.idempotency_key) { const { data: dup } = await c.supabase.from('petty_cash_requests').select('id').eq('idempotency_key', v.idempotency_key).maybeSingle(); if (dup) return { ok: true, message: 'Already sent for approval.' } }
    if (v.kind === 'return') {
      const { data: bal } = await c.supabase.rpc('petty_wallet_balance', { p_employee: emp.id })
      if (v.amount > Number(bal ?? 0) + 0.004) return { error: `You hold AED ${Number(bal ?? 0).toFixed(2)} of petty cash: you cannot return more than that.`, fieldErrors: { amount: 'More than you hold' } }
    }
    const { error } = await c.supabase.from('petty_cash_requests').insert({ company_id: c.company.id, employee_id: emp.id, kind: v.kind, amount: v.amount, entry_date: v.entry_date, method: v.method,
      counterparty: v.counterparty || null, project_id: v.project_id ?? null, purpose: v.purpose || null, reference: v.reference || null, notes: v.notes || null, idempotency_key: v.idempotency_key ?? null })
    if (error) throw error
    refresh(emp.id)
    return { ok: true, message: v.kind === 'received' ? 'Sent for admin approval. Your balance changes once it is confirmed.' : 'Return sent for confirmation. Your balance changes once the admin confirms receiving it.' }
  })
}

/** Correct a report the approver sent back (it goes back to pending), or change one still pending. */
export async function updatePettyReport(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const { c, emp } = await getMe()
    if (!emp || !uuid.safeParse(id).success) return { error: 'Not found.' }
    const r = reportSchema.omit({ kind: true }).safeParse(pick(fd, REPORT_KEYS.filter(k => k !== 'kind')))
    if (!r.success) return bad(r.error)
    const v = r.data
    const { data, error } = await c.supabase.from('petty_cash_requests').update({ amount: v.amount, entry_date: v.entry_date, method: v.method, counterparty: v.counterparty || null,
      project_id: v.project_id ?? null, purpose: v.purpose || null, reference: v.reference || null, notes: v.notes || null, status: 'pending' }).eq('id', id).eq('employee_id', emp.id).in('status', ['pending', 'correction_requested']).select('id')
    if (error) throw error
    if (!data?.length) return { error: 'This report has already been decided and cannot be changed.' }
    refresh(emp.id)
    return { ok: true, message: 'Saved and sent for approval again.' }
  })
}

export async function withdrawPettyReport(id: string): Promise<ActionState> {
  return safe(async () => {
    const { c, emp } = await getMe()
    if (!emp || !uuid.safeParse(id).success) return { error: 'Not found.' }
    const { data, error } = await c.supabase.from('petty_cash_requests').update({ status: 'withdrawn' }).eq('id', id).eq('employee_id', emp.id).in('status', ['pending', 'correction_requested']).select('id')
    if (error) throw error
    if (!data?.length) return { error: 'This report has already been decided.' }
    refresh(emp.id)
    return { ok: true, message: 'Withdrawn.' }
  })
}
