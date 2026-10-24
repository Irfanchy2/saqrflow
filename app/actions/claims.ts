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
}).refine(v => v.decision === 'approved' || !!v.note, { message: 'Give a reason so the employee knows what to fix', path: ['note'] })

export async function decideClaim(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx()
    if (!c.can('expenses.approve') && !c.can('approvals.decide')) throw new ForbiddenError('expenses.approve')
    if (!uuid.safeParse(id).success) return { error: 'Expense claim not found.' }
    const r = schema.safeParse(Object.fromEntries(['decision', 'note', 'category', 'project_id', 'paid_from_bank_id'].map(k => [k, str(fd, k)])))
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
    })
    if (error) return { error: error.message.length < 200 ? error.message : 'The decision could not be saved. Please try again.' }
    revalidatePath('/expenses'); revalidatePath('/approvals'); revalidatePath('/')
    return { ok: true, message: v.decision === 'approved' ? 'Approved and added to expenses.' : v.decision === 'rejected' ? 'Rejected. The employee was told why.' : 'Sent back to the employee for a correction.' }
  })
}
