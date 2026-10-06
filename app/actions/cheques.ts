'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getCtx, need } from '@/lib/auth'
import { safe, str } from '@/lib/action'
import { saveVersion } from '@/lib/doc-upload'
import { canTransition, type ChequeStatus, type Direction } from '@/lib/cheques'
import type { ActionState } from '@/lib/utils'

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date')
const schema = z.object({
  direction: z.enum(['incoming', 'outgoing']), kind: z.enum(['regular', 'pdc', 'security', 'rental']), party_type: z.enum(['customer', 'supplier', 'landlord', 'other']),
  party_name: z.string().min(1, 'Customer / supplier name is required').max(200), cheque_no: z.string().min(1, 'Cheque number is required').max(40),
  bank_name: z.string().min(1, 'Bank name is required').max(120), account_display_name: z.string().max(120).optional(),
  amount: z.coerce.number({ message: 'Enter the amount' }).positive('Amount must be greater than zero').max(1_000_000_000),
  issue_date: date.optional(), cheque_date: date, deposit_date: date.optional(), purpose: z.string().max(300).optional(), notes: z.string().max(2000).optional(),
  invoice_id: z.string().uuid().optional(),
})
const KEYS = ['invoice_id', 'direction', 'kind', 'party_type', 'party_name', 'cheque_no', 'bank_name', 'account_display_name', 'amount', 'issue_date', 'cheque_date', 'deposit_date', 'purpose', 'notes']

export async function createCheque(_: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'cheques.manage')
    const v = schema.parse(Object.fromEntries(KEYS.map(k => [k, str(fd, k)])))
    if (v.deposit_date && v.deposit_date < v.cheque_date && v.kind === 'pdc') return { error: 'A post-dated cheque cannot be deposited before its cheque date.' }
    const status: ChequeStatus = v.direction === 'incoming' ? (v.deposit_date ? 'scheduled' : 'received') : (v.deposit_date ? 'scheduled' : 'issued')
    // a cheque linked to an invoice takes the invoice's customer (incoming only)
    let invCustomer: string | null = null
    if (v.invoice_id) {
      const { data: inv } = await c.supabase.from('invoices').select('customer_id,doc_type').eq('id', v.invoice_id).maybeSingle()
      if (!inv || inv.doc_type !== 'invoice' || v.direction !== 'incoming') return { error: 'Only incoming cheques can be linked to a tax invoice.' }
      invCustomer = inv.customer_id
    }
    // link to an existing customer/supplier by exact name; never auto-create parties from free text
    const table = v.party_type === 'supplier' ? 'suppliers' : v.party_type === 'customer' ? 'customers' : null
    const party = table ? (await c.supabase.from(table).select('id').ilike('name', v.party_name).maybeSingle()).data : null
    let { data: bank } = await c.supabase.from('banks').select('id').eq('name', v.bank_name).eq('account_display_name', v.account_display_name ?? '').maybeSingle()
    if (!bank) bank = (await c.supabase.from('banks').insert({ company_id: c.company.id, name: v.bank_name, account_display_name: v.account_display_name ?? '' }).select('id').single()).data
    const { data: ch, error } = await c.supabase.from('cheques').insert({
      ...v, company_id: c.company.id, status, created_by: c.userId, bank_id: bank?.id ?? null,
      customer_id: invCustomer ?? (table === 'customers' ? party?.id ?? null : null), supplier_id: table === 'suppliers' ? party?.id ?? null : null,
    }).select('id').single()
    if (error) throw error
    const f = fd.get('file')
    if (f instanceof File && f.size > 0 && c.can('documents.upload')) {
      const { data: doc, error: e2 } = await c.supabase.from('documents').insert({ company_id: c.company.id, owner_type: 'cheque', owner_id: ch.id, name: `Cheque ${v.cheque_no} image`, reminders_active: false, created_by: c.userId }).select('id').single()
      if (e2) throw e2
      try { await saveVersion(c, doc.id, f) } catch (e) { revalidatePath('/cheques'); return { error: `Cheque saved, but the image was rejected: ${(e as Error).message}` } }
    }
    revalidatePath('/', 'layout'); return { ok: true, message: 'Cheque saved.' }
  })
}

export async function changeChequeStatus(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'cheques.manage')
    const to = z.enum(['received', 'issued', 'scheduled', 'deposited', 'presented', 'cleared', 'returned', 'cancelled']).parse(str(fd, 'status'))
    const { data: cur } = await c.supabase.from('cheques').select('direction,status,cheque_date,amount,invoice_id,cheque_no').eq('id', id).maybeSingle()
    if (!cur) return { error: 'Cheque not found.' }
    if (!canTransition(cur.direction as Direction, cur.status as ChequeStatus, to)) return { error: `A ${cur.direction} cheque cannot move from “${cur.status}” to “${to}”.` }
    if (to === 'cleared' && fd.get('confirm') !== 'on') return { error: 'Please confirm you have verified clearance with your bank (statement or bank confirmation).' }
    const upd: Record<string, unknown> = { status: to }
    const dep = str(fd, 'deposit_date'); if (dep) upd.deposit_date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(dep)
    if (['deposited', 'presented'].includes(to) && !upd.deposit_date) upd.deposit_date = c.today
    if (to === 'returned') { const r = str(fd, 'reason'); if (!r) return { error: 'Please enter the reason the cheque was returned.' }; upd.returned_reason = r.slice(0, 300) }
    if (to === 'cleared') { upd.cleared_at = new Date().toISOString(); upd.cleared_by = c.userId }
    const { data, error } = await c.supabase.from('cheques').update(upd).eq('id', id).select('id'); if (error) throw error
    if (!data?.length) return { error: 'You are not allowed to update this cheque.' }
    // Clearing is confirmed by a person (above). Only then — and only if asked — the linked invoice is credited with a payment.
    let extra = ''
    if (to === 'cleared' && cur.direction === 'incoming' && cur.invoice_id && fd.get('apply_payment') === 'on' && c.can('records.edit')) {
      const { data: b } = await c.supabase.from('invoice_balances').select('balance').eq('id', cur.invoice_id).maybeSingle()
      const amount = Math.min(Number(cur.amount), Number(b?.balance ?? 0))
      if (amount > 0) {
        const { error: pe } = await c.supabase.from('payments').insert({ company_id: c.company.id, invoice_id: cur.invoice_id, cheque_id: id, amount, method: 'cheque', paid_on: c.today, reference: `Cheque ${cur.cheque_no}`, created_by: c.userId })
        if (pe && pe.code !== '23505') extra = ` The invoice could not be updated: ${pe.message}`
        else if (!pe) { extra = ` AED ${amount.toFixed(2)} applied to the invoice.`; await c.supabase.from('sales_doc_events').insert({ company_id: c.company.id, invoice_id: cur.invoice_id, event: 'payment', detail: `Cheque ${cur.cheque_no} cleared — AED ${amount.toFixed(2)}`, user_id: c.userId }) }
      } else extra = ' The linked invoice has no balance left, so no payment was added.'
    }
    revalidatePath('/', 'layout'); return { ok: true, message: `Status updated.${extra}` }
  })
}
