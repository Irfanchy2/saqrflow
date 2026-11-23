import 'server-only'
import { z } from 'zod'
import type { Ctx } from '../auth'
import { salesSettings } from './data'

// Previous invoices: tax invoices written before Averiqo (Excel, a book, another program), entered with their ORIGINAL
// number. They never use or move the automatic numbering, are saved as issued invoices (not drafts) so they count in the
// customer ledger, receivables, reminders and statements, and are marked external_provider = 'previous'.

export const PREVIOUS = 'previous'
export const PAID_BEFORE = 'Before Averiqo'
const r2 = (n: number) => Math.round(n * 100) / 100
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date')

export const previousSchema = z.object({
  customer_id: z.string().uuid('Choose the customer'),
  number: z.string().trim().min(1, 'Enter the invoice number').max(60, 'Invoice number: up to 60 characters'),
  issue_date: date,
  due_date: date.optional(),
  lpo_ref: z.string().trim().max(80).optional(),
  description: z.string().trim().max(500).optional(),
  amount: z.coerce.number({ invalid_type_error: 'Enter the amount' }).positive('The amount must be more than 0').max(1e10),
  amount_is: z.enum(['total', 'net']).default('total'),
  vat_rate: z.coerce.number().min(0).max(100).default(5),
  paid: z.coerce.number().min(0, 'Paid cannot be negative').max(1e10).default(0),
  paid_on: date.optional(),
})
export type PreviousInput = z.infer<typeof previousSchema>

/** Amount before VAT, VAT and total, from either the total (incl. VAT) or the amount before VAT. */
export function previousTotals(amount: number, amountIs: 'total' | 'net', vatRate: number) {
  const subtotal = amountIs === 'total' ? r2(amount / (1 + vatRate / 100)) : r2(amount)
  const total = amountIs === 'total' ? r2(amount) : r2(amount + amount * vatRate / 100)
  return { subtotal, vat: r2(total - subtotal), total }
}

/** Plain checks shared by the form and the Excel upload (dates, paid not above the total). */
export function previousProblems(v: PreviousInput, today: string): string | null {
  if (v.issue_date > today) return 'The invoice date cannot be in the future'
  if (v.due_date && v.due_date < v.issue_date) return 'The due date is before the invoice date'
  const { total } = previousTotals(v.amount, v.amount_is, v.vat_rate)
  if (v.paid > total + 0.005) return `Paid (${v.paid.toFixed(2)}) is more than the invoice total (${total.toFixed(2)})`
  if (v.paid_on && v.paid_on > today) return 'The paid date cannot be in the future'
  return null
}

type Cust = { id: string; name: string; address?: string | null; trn?: string | null; phone?: string | null; email?: string | null; contact_person?: string | null }

/**
 * Saves one previous invoice (and, if part or all of it was already paid, that payment, dated `paid_on` or the invoice
 * date). Returns the new id, or a message for the person (e.g. the number already exists).
 */
export async function insertPreviousInvoice(c: Ctx, v: PreviousInput, cu: Cust, o: { dueDays?: number; externalId?: string } = {}): Promise<{ id: string } | { error: string }> {
  const t = previousTotals(v.amount, v.amount_is, v.vat_rate)
  const due = v.due_date ?? addDays(v.issue_date, o.dueDays ?? (await salesSettings(c)).dueDays)
  const { data: inv, error } = await c.supabase.from('invoices').insert({
    company_id: c.company.id, doc_type: 'invoice', number: v.number, status: 'sent',
    customer_id: cu.id, customer_name: cu.name, customer_address: cu.address ?? null, customer_trn: cu.trn ?? null, customer_phone: cu.phone ?? null, customer_email: cu.email ?? null, attention: cu.contact_person ?? null,
    issue_date: v.issue_date, due_date: due, lpo_ref: v.lpo_ref || null, subject: v.description || null,
    subtotal: t.subtotal, vat_rate: v.vat_rate, vat_amount: t.vat, total: t.total, apply_vat: v.vat_rate > 0,
    notes: 'Previous invoice entered from earlier records with its original number (not created in Averiqo).',
    external_provider: PREVIOUS, external_record_id: o.externalId ?? null, created_by: c.userId,
  }).select('id').single()
  if (error) {
    if (error.code === '23505') return { error: `Invoice number ${v.number} already exists. Each tax invoice number can be used once.` }
    throw error
  }
  const { error: ie } = await c.supabase.from('invoice_items').insert({ company_id: c.company.id, invoice_id: inv.id, position: 1, description: v.description || `Tax invoice ${v.number}`, quantity: 1, unit: 'LS', unit_price: t.subtotal, vat_category: v.vat_rate > 0 ? 'standard' : 'zero' })
  if (ie) { await undo(c, inv.id); throw ie }
  if (v.paid > 0) {
    const { error: pe } = await c.supabase.from('payments').insert({ company_id: c.company.id, invoice_id: inv.id, customer_id: cu.id, amount: r2(v.paid), paid_on: v.paid_on ?? v.issue_date, method: 'other', reference: PAID_BEFORE, notes: 'Paid before this invoice was entered in Averiqo', created_by: c.userId })
    if (pe) { await undo(c, inv.id); return { error: `The invoice was not saved: the paid amount could not be recorded (${pe.message}).` } }
  }
  await c.supabase.from('sales_doc_events').insert({ company_id: c.company.id, invoice_id: inv.id, event: 'created', detail: `Previous invoice entered with its original number${v.paid > 0 ? ` · AED ${r2(v.paid).toFixed(2)} already paid` : ''}`, user_id: c.userId })
  return { id: inv.id }
}

/** A half-saved invoice (item or payment failed): cancel it and move it to the Trash, so the number can be used again. */
async function undo(c: Ctx, id: string) {
  await c.supabase.from('invoice_items').delete().eq('invoice_id', id)
  await c.supabase.from('invoices').update({ status: 'cancelled', number: `${id.slice(0, 8)}-void` }).eq('id', id)
  await c.supabase.rpc('soft_delete', { p_entity: 'invoice', p_id: id })
}

const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
