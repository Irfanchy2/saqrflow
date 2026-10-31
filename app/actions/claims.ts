'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getCtx } from '@/lib/auth'
import { safe, str } from '@/lib/action'
import { ForbiddenError } from '@/lib/permissions'
import type { ActionState } from '@/lib/utils'
import { resolveSupplier } from '@/lib/expenses/suppliers'

// Approvers' side of employee expense claims. The decision itself is one database function (decide_expense_claim): it
// checks the approver's permission again, locks the claim, refuses the employee's own claim, and on approval adds it to
// the company's expenses exactly once (linked both ways), verified and approved, with the employee and the receipt.

const uuid = z.string().uuid()
const schema = z.object({
  decision: z.enum(['approved', 'rejected', 'correction_requested'], { message: 'Choose a decision' }),
  note: z.string().trim().max(2000, 'The note is too long').optional(),
  category: z.enum(['material', 'labour', 'transport', 'fuel', 'equipment', 'subcontract', 'accommodation', 'food', 'maintenance', 'other']).optional(),
  project_id: uuid.optional(), paid_from_bank_id: uuid.optional(),
  // petty cash claims: how much is settled from petty cash, and how much the employee confirmed paying themselves
  petty: z.coerce.number().min(0, 'Amounts cannot be negative').max(10_000_000).optional(), personal: z.coerce.number().min(0, 'Amounts cannot be negative').max(10_000_000).optional(),
}).refine(v => v.decision === 'approved' || !!v.note, { message: 'Give a reason so the employee knows what to fix', path: ['note'] })

export async function decideClaim(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx()
    if (!c.can('expenses.approve') && !c.can('approvals.decide')) throw new ForbiddenError('expenses.approve')
    if (!uuid.safeParse(id).success) return { error: 'Expense claim not found.' }
    const r = schema.safeParse(Object.fromEntries(['decision', 'note', 'category', 'project_id', 'paid_from_bank_id', 'petty', 'personal'].map(k => [k, str(fd, k)])))
    if (!r.success) return { error: r.error.issues[0].message, fieldErrors: Object.fromEntries(r.error.issues.map(i => [i.path.join('.'), i.message])) }
    const v = r.data
    const { data: claim } = await c.supabase.from('expense_claims').select('id,status,supplier_name,supplier_trn').eq('id', id).maybeSingle()
    if (!claim) return { error: 'Expense claim not found.' }
    // the supplier is linked (or added) only when the claim becomes a company expense
    const supplier = v.decision === 'approved' && claim.status === 'pending' && (claim.supplier_name || claim.supplier_trn)
      ? await resolveSupplier(c, { name: claim.supplier_name, trn: claim.supplier_trn }) : null
    const { error } = await c.supabase.rpc('decide_expense_claim', {
      p_claim: id, p_decision: v.decision, p_note: v.note ?? null, p_category: v.category ?? null,
      p_project: v.project_id ?? null, p_supplier: supplier?.id ?? null, p_bank: v.paid_from_bank_id ?? null,
      p_petty: v.decision === 'approved' ? v.petty ?? null : null, p_personal: v.decision === 'approved' ? v.personal ?? null : null,
    })
    if (error) return { error: error.message.length < 200 ? error.message : 'The decision could not be saved. Please try again.' }
    revalidatePath('/expenses'); revalidatePath('/approvals'); revalidatePath('/')
    return { ok: true, message: v.decision === 'approved' ? 'Approved and added to expenses.' : v.decision === 'rejected' ? 'Rejected. The employee was told why.' : 'Sent back to the employee for a correction.' }
  })
}

const bulk = z.object({ ids: z.array(uuid).min(1, 'Choose at least one claim').max(100, 'Approve at most 100 claims at a time'), bank: uuid.nullish() })

/**
 * Approve several waiting claims at once (Expenses → Employee claims → select → Approve). Each claim goes through the same
 * database function as a single approval (permission, own-claim refusal, added to expenses exactly once), with the
 * employee's own category and project. A claim that cannot be approved is skipped and named; the others still go through.
 */
export async function approveClaims(ids: string[], bank?: string | null): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx()
    if (!c.can('expenses.approve') && !c.can('approvals.decide')) throw new ForbiddenError('expenses.approve')
    const r = bulk.safeParse({ ids: [...new Set(ids)], bank: bank || null })
    if (!r.success) return { error: r.error.issues[0].message }
    const { data: claims } = await c.supabase.from('expense_claims').select('id,status,supplier_name,supplier_trn,amount,vat_amount,reference,employee:employees(full_name)').in('id', r.data.ids)
    let approved = 0, total = 0
    const skipped: string[] = []
    for (const id of r.data.ids) {
      const claim: any = (claims ?? []).find(x => x.id === id)
      const name = claim ? `${claim.employee?.full_name ?? 'Employee'} · ${claim.supplier_name ?? claim.reference ?? 'claim'}` : 'A claim'
      if (!claim) { skipped.push(`${name}: not found`); continue }
      if (claim.status !== 'pending') { skipped.push(`${name}: already ${String(claim.status).replace('_', ' ')}`); continue }
      const supplier = claim.supplier_name || claim.supplier_trn ? await resolveSupplier(c, { name: claim.supplier_name, trn: claim.supplier_trn }).catch(() => null) : null
      const { error } = await c.supabase.rpc('decide_expense_claim', { p_claim: id, p_decision: 'approved', p_note: null, p_category: null, p_project: null, p_supplier: supplier?.id ?? null, p_bank: r.data.bank ?? null, p_petty: null, p_personal: null })
      if (error) { skipped.push(`${name}: ${error.message.length < 120 ? error.message : 'could not be approved'}`); continue }
      approved++; total += Number(claim.amount) + Number(claim.vat_amount)
    }
    revalidatePath('/expenses'); revalidatePath('/approvals'); revalidatePath('/')
    const aed = `AED ${total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    if (!approved) return { error: `Nothing was approved. ${skipped.join('. ')}.` }
    return { ok: true, message: `Approved ${approved} claim${approved === 1 ? '' : 's'} (${aed}) and added ${approved === 1 ? 'it' : 'them'} to expenses.${skipped.length ? ` Skipped ${skipped.length}: ${skipped.join('; ')}.` : ''}`, data: { approved, skipped } }
  })
}
