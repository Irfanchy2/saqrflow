'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getCtx, need } from '@/lib/auth'
import { safe, str } from '@/lib/action'
import { canDecide, SALES_APPROVAL_TYPES } from '@/lib/approvals'
import type { ActionState } from '@/lib/utils'

const done = () => { revalidatePath('/approvals'); revalidatePath('/') }

/** A free-form request (purchase request, leave, discount, anything that needs a manager's yes). */
export async function createApprovalRequest(_: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    const v = z.object({
      title: z.string().trim().min(3, 'Title: at least 3 characters').max(200),
      details: z.string().trim().max(4000).optional(),
      amount: z.coerce.number().min(0).max(1e12).optional(),
    }).parse({ title: str(fd, 'title') ?? '', details: str(fd, 'details'), amount: str(fd, 'amount') })
    const { error } = await c.supabase.from('approval_requests').insert({ company_id: c.company.id, entity_type: 'other', entity_id: null, title: v.title, details: v.details ?? null, amount: v.amount ?? null, requested_by: c.userId })
    if (error) throw error
    done(); return { ok: true, message: 'Request sent to the approvers.' }
  })
}

/**
 * Approve / reject / request changes. Sales documents are decided on the document itself (invoices.approval_status, which
 * the database mirrors back into the request); expenses and cheques carry the decision on their own row too.
 */
export async function decideApprovalRequest(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx()
    const decision = z.enum(['approved', 'rejected', 'changes_requested']).parse(str(fd, 'decision'))
    const note = str(fd, 'note')?.slice(0, 2000) ?? null
    const { data: r } = await c.supabase.from('approval_requests').select('id,entity_type,entity_id,status,requested_by').eq('id', id).maybeSingle()
    if (!r) return { error: 'Request not found.' }
    if (!canDecide(r.entity_type, c.can)) return { error: 'You are not allowed to decide approvals.' }
    if (r.status !== 'pending') return { error: 'This request was already decided.' }
    if (decision !== 'approved' && !note) return { error: 'Add a note so the requester knows what to change.' }
    const now = new Date().toISOString()
    if ((SALES_APPROVAL_TYPES as string[]).includes(r.entity_type)) {
      const { data: upd, error } = await c.supabase.from('invoices').update({ approval_status: decision, approval_note: note, approved_by: c.userId, approved_at: now }).eq('id', r.entity_id).eq('approval_status', 'pending').select('id')
      if (error) throw error
      if (!upd?.length) return { error: 'The document changed. Reload and try again.' }
      await c.supabase.from('sales_doc_events').insert({ company_id: c.company.id, invoice_id: r.entity_id, event: 'approval', detail: `${decision.replace('_', ' ')}${note ? ': ' + note : ''}`.slice(0, 500), user_id: c.userId })
      revalidatePath(`/invoices/${r.entity_id}`)
    } else {
      if (r.entity_type === 'expense' || r.entity_type === 'cheque') {
        const { error } = await c.supabase.from(r.entity_type === 'expense' ? 'project_expenses' : 'cheques').update({ approval_status: decision }).eq('id', r.entity_id)
        if (error) throw error
      }
      const { data: upd, error } = await c.supabase.from('approval_requests').update({ status: decision, decision_note: note, decided_by: c.userId, decided_at: now }).eq('id', id).eq('status', 'pending').select('id')
      if (error) throw error
      if (!upd?.length) return { error: 'This request was already decided.' }
    }
    done(); return { ok: true, message: decision === 'approved' ? 'Approved.' : 'Decision saved and the requester was notified.' }
  })
}

export async function cancelApprovalRequest(id: string): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx()
    const { data: r } = await c.supabase.from('approval_requests').select('entity_type,entity_id,status,requested_by').eq('id', id).maybeSingle()
    if (!r || r.status !== 'pending') return { error: 'Only a pending request can be cancelled.' }
    if (r.requested_by !== c.userId && !c.can('approvals.decide')) return { error: 'Only the requester can cancel a request.' }
    if ((SALES_APPROVAL_TYPES as string[]).includes(r.entity_type)) {
      const { error } = await c.supabase.from('invoices').update({ approval_status: null }).eq('id', r.entity_id).eq('approval_status', 'pending')
      if (error) throw error
    } else {
      if (r.entity_type === 'expense' || r.entity_type === 'cheque') await c.supabase.from(r.entity_type === 'expense' ? 'project_expenses' : 'cheques').update({ approval_status: null }).eq('id', r.entity_id)
      const { error } = await c.supabase.from('approval_requests').update({ status: 'cancelled' }).eq('id', id).eq('status', 'pending')
      if (error) throw error
    }
    done(); return { ok: true, message: 'Request cancelled.' }
  })
}

/** Settings → Approvals: when an approval is required automatically. */
export async function saveApprovalRules(_: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'settings.manage')
    const n = (k: string) => { const v = str(fd, k); const x = v ? Number(v) : 0; if (!Number.isFinite(x) || x < 0 || x > 1e12) throw new Error('Thresholds must be positive amounts (0 = off).'); return Math.round(x * 100) / 100 }
    const rows = [
      { key: 'approvals.expense_threshold', value: n('expense_threshold') },
      { key: 'approvals.cheque_threshold', value: n('cheque_threshold') },
      { key: 'approvals.po_required', value: fd.get('po_required') === 'on' },
      { key: 'sales.require_approval', value: fd.get('quote_required') === 'on' },
    ].map(r => ({ ...r, company_id: c.company.id, updated_at: new Date().toISOString() }))
    const { error } = await c.supabase.from('app_settings').upsert(rows)
    if (error) throw error
    revalidatePath('/settings'); return { ok: true, message: 'Approval rules saved. They apply to new records from now on.' }
  })
}

/** Settings → Employee portal: self check-in on/off and the salary-advance limit shown to employees. */
export async function savePortalSettings(_: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'settings.manage')
    const raw = str(fd, 'advance_limit_pct'), pct = raw ? Number(raw) : 0
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) return { error: 'The advance limit is a percentage between 0 and 100.', fieldErrors: { advance_limit_pct: '0 to 100' } }
    const hm = /^([01]\d|2[0-3]):[0-5]\d$/, ws = str(fd, 'work_start') ?? '08:00', we = str(fd, 'work_end') ?? '18:00', ot = Number(str(fd, 'overtime_max_hours') ?? 5)
    if (!hm.test(ws) || !hm.test(we)) return { error: 'Enter the working hours as HH:MM.' }
    if (we <= ws) return { error: 'The working day must end after it starts.', fieldErrors: { work_end: 'After the start' } }
    if (!Number.isFinite(ot) || ot <= 0 || ot > 12) return { error: 'The overtime limit is between 0.5 and 12 hours.', fieldErrors: { overtime_max_hours: '0.5 to 12' } }
    const rows = [
      { key: 'portal.checkin', value: fd.get('checkin') === 'on' },
      { key: 'portal.advance_limit_pct', value: Math.round(pct) },
      { key: 'portal.work_start', value: ws }, { key: 'portal.work_end', value: we },
      { key: 'portal.overtime_max_hours', value: Math.round(ot * 2) / 2 },
    ].map(r => ({ ...r, company_id: c.company.id, updated_at: new Date().toISOString() }))
    const { error } = await c.supabase.from('app_settings').upsert(rows)
    if (error) throw error
    revalidatePath('/settings'); revalidatePath('/me'); return { ok: true, message: 'Employee portal settings saved.' }
  })
}
