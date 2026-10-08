'use server'
import { createHash } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { getCtx, need, type Ctx } from '@/lib/auth'
import { safe, str } from '@/lib/action'
import { saveVersion } from '@/lib/doc-upload'
import { addDays } from '@/lib/time'
import { CONVERSIONS, DOC_META, manualStatuses, type SalesType } from '@/lib/sales/docs'
import { computeTotals } from '@/lib/sales/money'
import { BRAND_KINDS, loadSalesDoc, salesSettings } from '@/lib/sales/data'
import { buildSalesPdf } from '@/lib/sales/build'
import { diffSnapshots, snapshotOf } from '@/lib/sales/revisions'
import { matchesFormat } from '@/lib/numbering'
import type { ActionState } from '@/lib/utils'

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date')
const optDate = z.union([date, z.literal('')]).optional().nullable().transform(v => v || null)
const optText = (max: number) => z.string().max(max, `Keep this under ${max} characters`).optional().nullable().transform(v => (v && v.trim() ? v.trim() : null))
const typeSchema = z.enum(['quotation', 'invoice', 'delivery_note', 'credit_note'])
const token = z.string().uuid().optional()
const vatCat = z.enum(['standard', 'zero', 'exempt', 'out_of_scope']).default('standard')

const itemSchema = z.object({
  id: z.string().uuid().optional().nullable(),
  description: z.string().trim().min(1, 'Every line needs a description').max(2000, 'A line description is limited to 2000 characters'),
  materials: optText(1000),
  quantity: z.coerce.number({ message: 'Quantity must be a number' }).min(0, 'Quantity cannot be negative').max(1e9),
  unit: z.string().trim().min(1).max(20).default('Nos'),
  unit_price: z.coerce.number({ message: 'Rate must be a number' }).min(0, 'Rate cannot be negative').max(1e10),
  vat_category: vatCat,
  discount_pct: z.coerce.number().min(0, 'Line discount cannot be negative').max(100, 'Line discount cannot exceed 100%').default(0),
  source_item_id: z.string().uuid().optional().nullable(),
  catalog_item_id: z.string().uuid().optional().nullable(),
})
const docSchema = z.object({
  customer_id: z.string().uuid().nullable().optional(),
  new_customer: z.boolean().optional(),
  update_customer: z.boolean().optional(),                // explicit opt-in: copy this document's details back to the customer record
  customer_email: z.union([z.string().trim().email('Enter a valid email address').max(200), z.literal('')]).optional().nullable().transform(v => v || null),
  project_id: z.string().uuid().nullable().optional(),
  salesperson_id: z.string().uuid().nullable().optional(),
  issue_date: date, due_date: optDate, valid_until: optDate,
  attention: optText(200), customer_name: optText(250), customer_address: optText(500), customer_trn: optText(30),
  customer_phone: z.string().trim().max(40).optional().nullable().transform(v => v || null).refine(v => !v || /^[+\d][\d\s()-]{5,}$/.test(v), 'Enter a valid phone number'),
  site: optText(300), subject: optText(300), reference: optText(120), lpo_ref: optText(120), intro: optText(2000), closing: optText(2000),
  receiver_name: optText(120), vehicle_no: optText(40), notes: optText(4000),
  vat_rate: z.coerce.number({ message: 'VAT rate must be a number' }).min(0, 'VAT cannot be negative').max(100, 'VAT cannot exceed 100%'),
  discount_type: z.enum(['amount', 'percent']).default('amount'),
  discount_value: z.coerce.number({ message: 'Discount must be a number' }).min(0, 'Discount cannot be negative').max(1e10).default(0),
  show_total: z.boolean().default(true), apply_vat: z.boolean().nullable().optional(),
  terms: z.array(z.string().trim().max(1000)).max(60).transform(a => a.filter(Boolean)),
  payment_terms: z.array(z.string().trim().max(500)).max(40).transform(a => a.filter(Boolean)),
  items: z.array(itemSchema).max(300, 'A document can have up to 300 lines'),
}).refine(v => !v.customer_trn || /^\d{15}$/.test(v.customer_trn.replace(/\s|-/g, '')), { message: 'A UAE TRN has 15 digits', path: ['customer_trn'] })
  .refine(v => !v.due_date || v.due_date >= v.issue_date, { message: 'Due date cannot be before the issue date', path: ['due_date'] })
  .refine(v => !v.valid_until || v.valid_until >= v.issue_date, { message: 'Validity cannot end before the issue date', path: ['valid_until'] })
  .refine(v => v.discount_type !== 'percent' || v.discount_value <= 100, { message: 'A percentage discount cannot exceed 100%', path: ['discount_value'] })
export type SalesDocInput = z.input<typeof docSchema>

const done = (id?: string) => { revalidatePath('/invoices'); if (id) revalidatePath(`/invoices/${id}`); revalidatePath('/') }
const vatApplies = (t: SalesType, applyVat: boolean | null | undefined) => t === 'invoice' || t === 'credit_note' || (t === 'quotation' && applyVat === true)

async function nextNumber(c: Ctx, t: SalesType): Promise<string> {
  const { data, error } = await c.supabase.rpc('next_document_number', { p_doc_type: t })
  if (error) throw error
  return data as string
}
async function logEvent(c: Ctx, invoiceId: string, event: string, detail?: string) {
  await c.supabase.from('sales_doc_events').insert({ company_id: c.company.id, invoice_id: invoiceId, event, detail: detail?.slice(0, 500) ?? null, user_id: c.userId })
}
/** idempotent insert: a repeated click / network retry with the same token returns the document created the first time */
async function existingByToken(c: Ctx, tok?: string) {
  if (!tok) return null
  const { data } = await c.supabase.from('invoices').select('id').eq('client_token', tok).maybeSingle()
  return data?.id ?? null
}

/** Creates a new draft (numbered immediately so the paper shows the real number) and opens the editor. */
export async function newSalesDoc(type: string, opts: { customerId?: string; projectId?: string; token?: string } = {}): Promise<ActionState> {
  let id: string | null = null
  const r = await safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    const t = typeSchema.parse(type), tok = token.parse(opts.token)
    if ((id = await existingByToken(c, tok))) return
    const s = await salesSettings(c)
    if (t === 'quotation') {   // default templates (Settings → Document templates) win over the plain default lists
      const { data: tpl } = await c.supabase.from('terms_templates').select('kind,lines').eq('is_default', true)
      for (const x of tpl ?? []) { if (x.kind === 'terms') s.terms = x.lines; else s.paymentTerms = x.lines }
    }
    let customer: any = null
    if (opts.customerId) customer = (await c.supabase.from('customers').select('id,name,address,trn,phone,contact_person,email,credit_days').eq('id', opts.customerId).maybeSingle()).data
    let project: any = null
    if (opts.projectId) {
      project = (await c.supabase.from('projects').select('id,name,location,customer_id').eq('id', opts.projectId).maybeSingle()).data
      if (project?.customer_id && !customer) customer = (await c.supabase.from('customers').select('id,name,address,trn,phone,contact_person,email,credit_days').eq('id', project.customer_id).maybeSingle()).data
    }
    const number = await nextNumber(c, t)
    const { data, error } = await c.supabase.from('invoices').insert({
      company_id: c.company.id, doc_type: t, number, status: 'draft', issue_date: c.today, created_by: c.userId, salesperson_id: c.userId, client_token: tok ?? null,
      due_date: t === 'invoice' ? addDays(c.today, customer?.credit_days ?? s.dueDays) : null, valid_until: t === 'quotation' ? addDays(c.today, s.validityDays) : null,
      vat_rate: s.vatRate, apply_vat: t === 'quotation' ? s.quoteVat === 'add' : null,
      terms: t === 'quotation' ? s.terms : [], payment_terms: t === 'quotation' ? s.paymentTerms : [],
      intro: t === 'quotation' ? s.intro : null, closing: t === 'quotation' ? s.closing : null,
      customer_id: customer?.id ?? null, customer_name: customer?.name ?? null, customer_address: customer?.address ?? null, customer_trn: customer?.trn ?? null,
      customer_phone: customer?.phone ?? null, customer_email: customer?.email ?? null, attention: customer?.contact_person ?? null,
      project_id: project?.id ?? null, site: project?.location ?? null,
    }).select('id').single()
    if (error) {
      if (error.code === '23505' && (id = await existingByToken(c, tok))) return   // the other request won the race — open that one
      throw error
    }
    id = data.id
    await logEvent(c, data.id, 'created')
  })
  if (id) redirect(`/invoices/${id}`)
  return r
}

/**
 * Saves header + lines atomically (one DB transaction, see save_sales_doc). Totals are always recomputed here.
 * - `expected`: the updated_at the editor loaded → a save over someone else's newer change is refused instead of overwriting it.
 * - once a quotation / invoice has been sent, every material change stores the previous version as a revision.
 */
export async function saveSalesDoc(id: string, input: SalesDocInput, opts: { expected?: string | null; autosave?: boolean } = {}): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    const parsed = docSchema.safeParse(input)
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Please check the form.', fieldErrors: Object.fromEntries(parsed.error.issues.map(i => [i.path.join('.'), i.message])) }
    const v = parsed.data
    const { data: cur } = await c.supabase.from('invoices').select('*').eq('id', id).maybeSingle()
    if (!cur) return { error: 'This document no longer exists (it may have been moved to the trash).' }
    const t = cur.doc_type as SalesType
    if (cur.status === 'cancelled') return { error: 'A cancelled document cannot be edited. Duplicate it instead.' }
    if (t === 'invoice' && !['draft', 'sent', 'overdue'].includes(cur.status)) return { error: 'This invoice already has payments or credits. Issue a credit note instead of editing it.' }
    if (t === 'credit_note' && cur.status !== 'draft') return { error: 'An issued credit note cannot be edited. Cancel it and create a new one.' }
    if (opts.autosave && cur.status !== 'draft') return { error: 'Autosave only applies to drafts.' }
    if (cur.approval_status === 'pending' && !c.can('sales.approve')) return { error: 'This document is waiting for approval and is locked until a manager decides.' }

    let customerId = v.customer_id ?? null
    if (!customerId && v.new_customer && v.customer_name) {
      const { data: existing } = await c.supabase.from('customers').select('id').ilike('name', v.customer_name).maybeSingle()
      if (existing) customerId = existing.id
      else {
        const { data: cu, error } = await c.supabase.from('customers').insert({ company_id: c.company.id, name: v.customer_name, address: v.customer_address, trn: v.customer_trn?.replace(/\s|-/g, '') ?? null, phone: v.customer_phone, email: v.customer_email, contact_person: v.attention, created_by: c.userId }).select('id').single()
        if (error) { if (error.code === '23505') return { error: `A customer named “${v.customer_name}” exists (possibly in the trash). Pick it from the list or restore it.` }; throw error }
        customerId = cu.id
      }
    }
    const priced = DOC_META[t].priced
    const applyVat = t === 'quotation' ? (v.apply_vat ?? cur.apply_vat ?? false) : null
    const tot = computeTotals(v.items, v.vat_rate, { type: v.discount_type, value: v.discount_value }, vatApplies(t, applyVat))
    if (t === 'invoice' && cur.status !== 'draft') {
      const { data: b } = await c.supabase.from('invoice_balances').select('paid,credited').eq('id', id).maybeSingle()
      if (b && Number(b.paid) + Number(b.credited ?? 0) > tot.total + 0.005) return { error: 'The new total is lower than what has already been paid or credited.' }
    }
    if (customerId && v.update_customer) {
      const { error: ue } = await c.supabase.from('customers').update({ name: v.customer_name ?? undefined, address: v.customer_address, trn: v.customer_trn?.replace(/\s|-/g, '') ?? null, phone: v.customer_phone, email: v.customer_email, contact_person: v.attention, updated_at: new Date().toISOString() }).eq('id', customerId)
      if (ue) throw ue
    }
    const { items, new_customer: _nc, update_customer: _uc, ...h } = v
    const head = {
      ...h, customer_id: customerId, customer_trn: v.customer_trn?.replace(/\s|-/g, '') ?? null, apply_vat: applyVat,
      subtotal: priced ? tot.subtotal : 0, discount: priced ? tot.discount : 0, vat_amount: priced ? tot.vat : 0, total: priced ? tot.total : 0,
    }
    const lines = items.map((it, i) => ({ ...it, id: it.id ?? null, position: i, unit_price: priced ? it.unit_price : 0, discount_pct: priced ? it.discount_pct : 0 }))

    // revision: only after the document left draft, and only when something material changed
    let revision: { snapshot: unknown; changes: string[] } | null = null
    if (cur.status !== 'draft' && t !== 'delivery_note') {
      const { data: oldItems } = await c.supabase.from('invoice_items').select('*').eq('invoice_id', id).order('position')
      const before = snapshotOf(cur, oldItems ?? []), after = snapshotOf({ ...cur, ...head }, lines)
      const changes = diffSnapshots(before, after)
      if (changes.length) revision = { snapshot: before, changes }
    }
    const { data: ts, error } = await c.supabase.rpc('save_sales_doc', { p_id: id, p_head: head, p_items: lines, p_expected: opts.expected ?? null, p_revision: revision })
    if (error) {
      if (/conflict/.test(error.message)) return { error: 'Someone else saved this document after you opened it. Reload to see their changes. Your edits are still on screen.', data: { conflict: true } }
      throw error
    }
    if (revision) await logEvent(c, id, 'revised', `Revision ${cur.revision + 1}: ${revision.changes.slice(0, 4).join('; ')}`)
    const { data: ids } = await c.supabase.from('invoice_items').select('id').eq('invoice_id', id).order('position')
    done(id)
    return { ok: true, message: revision ? `Saved as revision ${cur.revision + 1}.` : 'Saved.', data: { updatedAt: ts as string, itemIds: (ids ?? []).map(r => r.id), revision: revision ? cur.revision + 1 : cur.revision, ...(customerId ? { customerId } : {}) } }
  })
}

export async function setSalesStatus(id: string, status: string): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    const { data: cur } = await c.supabase.from('invoices').select('id,doc_type,status,total,sent_at,approval_status').eq('id', id).maybeSingle()
    if (!cur) return { error: 'Document not found.' }
    const t = cur.doc_type as SalesType
    if (!manualStatuses(t, cur.status).includes(status)) return { error: `Cannot change from “${cur.status}” to “${status}”.` }
    if (status === 'sent' && t === 'quotation') {
      const s = await salesSettings(c)
      if (s.requireApproval && cur.approval_status !== 'approved') return { error: 'Approval is required before this quotation can be sent. Use “Request approval”.' }
    }
    if ((t === 'invoice' || t === 'credit_note') && status === 'sent') {
      const { count } = await c.supabase.from('invoice_items').select('id', { count: 'exact', head: true }).eq('invoice_id', id)
      if (!count) return { error: `Add at least one line before issuing the ${DOC_META[t].label.toLowerCase()}.` }
    }
    if (t === 'invoice' && status === 'cancelled') {
      const { count } = await c.supabase.from('payments').select('id', { count: 'exact', head: true }).eq('invoice_id', id)
      if (count) return { error: 'This invoice has payments. Delete the payments first (or issue a credit note).' }
    }
    const { error } = await c.supabase.from('invoices').update({ status, sent_at: status === 'sent' && !cur.sent_at ? new Date().toISOString() : undefined, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) { if (/exceeds the invoice balance|not issued/.test(error.message)) return { error: error.message.charAt(0).toUpperCase() + error.message.slice(1) + '.' }; throw error }
    // an issued invoice whose due date already passed is overdue straight away
    if (t === 'invoice' && status === 'sent') {
      const { data: inv } = await c.supabase.from('invoices').select('due_date').eq('id', id).single()
      if (inv?.due_date && inv.due_date < c.today) await c.supabase.from('invoices').update({ status: 'overdue' }).eq('id', id)
    }
    // first time a quotation is sent → schedule the follow-ups (Settings → Sales, default +3 and +10 days)
    if (t === 'quotation' && status === 'sent') {
      const { count } = await c.supabase.from('sales_followups').select('id', { count: 'exact', head: true }).eq('invoice_id', id)
      if (!count) {
        const s = await salesSettings(c)
        if (s.followupDays.length) await c.supabase.from('sales_followups').insert(s.followupDays.map((d, i) => ({ company_id: c.company.id, invoice_id: id, due_date: addDays(c.today, d), note: i === 0 ? 'Follow up with the customer' : `Follow-up ${i + 1}`, created_by: c.userId })))
      }
    }
    if (['accepted', 'rejected', 'cancelled', 'expired'].includes(status)) await c.supabase.from('sales_followups').update({ done_at: new Date().toISOString(), done_by: c.userId, outcome: `Quotation ${status}` }).eq('invoice_id', id).is('done_at', null)
    await logEvent(c, id, 'status', `${cur.status} → ${status}`)
    done(id)
    return { ok: true, message: 'Status updated.' }
  })
}

/** Copies a document into a NEW numbered document of another type; the source document's content is never modified. */
async function copyDoc(c: Ctx, id: string, to: SalesType, link: boolean, tok?: string, lineQty?: Map<string, number>): Promise<string> {
  const src = await loadSalesDoc(c, id)
  if (!src) throw new Error('Document not found.')
  const s = await salesSettings(c)
  const d = src.doc as any
  const items = lineQty ? src.items.filter(it => (lineQty.get(it.id) ?? 0) > 0).map(it => ({ ...it, quantity: lineQty.get(it.id)! })) : src.items
  if (!items.length && lineQty) throw new Error('Choose at least one line with a quantity to deliver.')
  const number = await nextNumber(c, to)
  const same = to === d.doc_type
  const credit = to === 'invoice' && d.customer_id ? (await c.supabase.from('customers').select('credit_days').eq('id', d.customer_id).maybeSingle()).data?.credit_days : null
  const keepDiscount = same || (d.doc_type === 'quotation' && to === 'invoice') || to === 'credit_note'
  const tot = computeTotals(items, Number(d.vat_rate), keepDiscount ? { type: d.discount_type ?? 'amount', value: Number(d.discount_value ?? d.discount) } : 0, vatApplies(to, d.apply_vat))
  const { data, error } = await c.supabase.from('invoices').insert({
    company_id: c.company.id, doc_type: to, number, status: 'draft', issue_date: c.today, created_by: c.userId, client_token: tok ?? null,
    salesperson_id: d.salesperson_id ?? c.userId, customer_id: d.customer_id, project_id: d.project_id, attention: d.attention, customer_name: d.customer_name, customer_address: d.customer_address,
    customer_trn: d.customer_trn, customer_phone: d.customer_phone, customer_email: d.customer_email, site: d.site, subject: d.subject, reference: d.reference, lpo_ref: d.lpo_ref,
    vat_rate: d.vat_rate, show_total: d.show_total, notes: d.notes, apply_vat: to === 'quotation' ? d.apply_vat : null,
    discount_type: tot.discount ? d.discount_type ?? 'amount' : 'amount', discount_value: tot.discount ? Number(d.discount_value ?? d.discount) : 0,
    intro: to === 'quotation' ? d.intro ?? s.intro : null, closing: to === 'quotation' ? d.closing ?? s.closing : null,
    terms: to === 'quotation' || to === 'invoice' ? d.terms : [], payment_terms: to === 'delivery_note' ? [] : d.payment_terms,
    due_date: to === 'invoice' ? addDays(c.today, credit ?? s.dueDays) : null, valid_until: to === 'quotation' ? addDays(c.today, s.validityDays) : null,
    quotation_id: link ? (d.doc_type === 'quotation' ? d.id : d.quotation_id) : null,
    source_invoice_id: link && d.doc_type === 'invoice' ? d.id : null,
    subtotal: DOC_META[to].priced ? tot.subtotal : 0, discount: DOC_META[to].priced ? tot.discount : 0, vat_amount: DOC_META[to].priced ? tot.vat : 0, total: DOC_META[to].priced ? tot.total : 0,
  }).select('id').single()
  if (error) {
    if (error.code === '23505' && tok) { const again = await existingByToken(c, tok); if (again) return again }
    throw error
  }
  if (items.length) {
    const ins = await c.supabase.from('invoice_items').insert(items.map((it: any, i) => ({
      company_id: c.company.id, invoice_id: data.id, position: i, description: it.description, materials: it.materials ?? null,
      quantity: it.quantity, unit: it.unit || 'Nos', unit_price: DOC_META[to].priced ? it.unit_price : 0, vat_category: it.vat_category ?? 'standard',
      discount_pct: DOC_META[to].priced ? Number(it.discount_pct ?? 0) : 0, catalog_item_id: it.catalog_item_id ?? null,
      source_item_id: link && d.doc_type === 'quotation' && to === 'delivery_note' ? it.id : null,
    })))
    if (ins.error) { await c.supabase.from('invoices').delete().eq('id', data.id); throw ins.error }
  }
  if (link) {
    // attachments linked to the source (drawings, LPO …) are linked to the new document too
    const { data: rels } = await c.supabase.from('document_relationships').select('document_id,role').eq('related_type', DOC_META[d.doc_type as SalesType].relatedType).eq('related_id', d.id).limit(100)
    const att = (rels ?? []).filter(r => r.document_id !== d.pdf_document_id)
    if (att.length) await c.supabase.from('document_relationships').upsert(att.map(r => ({ company_id: c.company.id, document_id: r.document_id, related_type: DOC_META[to].relatedType, related_id: data.id, role: r.role, created_by: c.userId })), { onConflict: 'document_id,related_type,related_id', ignoreDuplicates: true })
  }
  if (link && d.doc_type === 'delivery_note' && to === 'invoice') await c.supabase.from('invoices').update({ source_invoice_id: data.id }).eq('id', d.id)
  // the quotation's content stays untouched; only its workflow status records the conversion
  if (link && d.doc_type === 'quotation' && to === 'invoice' && !['cancelled', 'rejected'].includes(d.status)) await c.supabase.from('invoices').update({ status: 'converted' }).eq('id', d.id)
  if (link && d.doc_type === 'quotation') await c.supabase.from('sales_followups').update({ done_at: new Date().toISOString(), done_by: c.userId, outcome: `${DOC_META[to].label} ${number} created` }).eq('invoice_id', d.id).is('done_at', null)
  await logEvent(c, data.id, 'created', link ? `From ${DOC_META[d.doc_type as SalesType].label} ${d.number}` : `Copy of ${d.number}`)
  if (link) await logEvent(c, d.id, 'converted', `${DOC_META[to].label} ${number}`)
  return data.id
}

export async function convertSalesDoc(id: string, to: string, tok?: string): Promise<ActionState> {
  let newId: string | null = null
  const r = await safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    const target = typeSchema.parse(to), t = token.parse(tok)
    if ((newId = await existingByToken(c, t))) return
    const { data: cur } = await c.supabase.from('invoices').select('doc_type,status').eq('id', id).maybeSingle()
    if (!cur) return { error: 'Document not found.' }
    if (!(CONVERSIONS[cur.doc_type as SalesType] ?? []).includes(target)) return { error: `A ${DOC_META[cur.doc_type as SalesType].label} cannot be converted to a ${DOC_META[target].label}.` }
    if (cur.status === 'cancelled') return { error: 'A cancelled document cannot be converted.' }
    if (target === 'credit_note' && cur.status === 'draft') return { error: 'Issue the invoice before creating a credit note.' }
    newId = await copyDoc(c, id, target, true, t)
    done(id)
  })
  if (newId) redirect(`/invoices/${newId}`)
  return r
}

/** Quotation → delivery note with chosen quantities (partial delivery). Quantities may not exceed what is still undelivered. */
export async function createDeliveryNote(quotationId: string, lines: { item_id: string; qty: number }[], tok?: string): Promise<ActionState> {
  let newId: string | null = null
  const r = await safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    const t = token.parse(tok)
    if ((newId = await existingByToken(c, t))) return
    const { data: q } = await c.supabase.from('invoices').select('doc_type,status').eq('id', quotationId).maybeSingle()
    if (!q || q.doc_type !== 'quotation') return { error: 'Quotation not found.' }
    if (['cancelled', 'rejected'].includes(q.status)) return { error: `A ${q.status} quotation cannot be delivered.` }
    const { data: rem } = await c.supabase.from('quotation_delivery').select('item_id,ordered,delivered').eq('quotation_id', quotationId)
    const left = new Map((rem ?? []).map(x => [x.item_id as string, Number(x.ordered) - Number(x.delivered)]))
    const qty = new Map<string, number>()
    for (const l of z.array(z.object({ item_id: z.string().uuid(), qty: z.coerce.number().min(0, 'Quantity cannot be negative').max(1e9) })).max(300).parse(lines)) {
      if (!left.has(l.item_id)) return { error: 'A line no longer exists on the quotation. Reload and try again.' }
      if (l.qty > left.get(l.item_id)! + 1e-9) return { error: `Cannot deliver ${l.qty}. Only ${left.get(l.item_id)} remain on that line.` }
      if (l.qty > 0) qty.set(l.item_id, l.qty)
    }
    if (!qty.size) return { error: 'Enter a quantity to deliver on at least one line.' }
    newId = await copyDoc(c, quotationId, 'delivery_note', true, t, qty)
    done(quotationId)
  })
  if (newId) redirect(`/invoices/${newId}`)
  return r
}

export async function duplicateSalesDoc(id: string, tok?: string): Promise<ActionState> {
  let newId: string | null = null
  const r = await safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    const t = token.parse(tok)
    if ((newId = await existingByToken(c, t))) return
    const { data: cur } = await c.supabase.from('invoices').select('doc_type').eq('id', id).maybeSingle()
    if (!cur) return { error: 'Document not found.' }
    newId = await copyDoc(c, id, typeSchema.parse(cur.doc_type), false, t)
    done()
  })
  if (newId) redirect(`/invoices/${newId}`)
  return r
}

/** Drafts (and cancelled documents) go to the trash — restorable from Settings → Trash. Issued documents are cancelled instead. */
export async function deleteSalesDraft(id: string): Promise<ActionState> {
  const r = await safe(async () => {
    const c = await getCtx(); need(c, 'records.delete')
    const { error } = await c.supabase.rpc('soft_delete', { p_entity: 'invoice', p_id: id })
    if (error) { if (/only draft|has payments/.test(error.message)) return { error: 'Only drafts and cancelled documents can be moved to the trash. Cancel issued documents instead.' }; throw error }
    done()
  })
  if (r?.ok) redirect('/invoices')
  return r
}

/**
 * Re-number a draft that still carries a number from before the company's custom format was set up (e.g. QTN-2026-0004 →
 * AS0025183/2026). Only drafts that were never sent; the new number comes from the database sequence (never a duplicate)
 * and the change is written to the audit log by the invoices trigger.
 */
export async function renumberDraft(id: string): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.edit'); need(c, 'finance.view')
    const { data: d } = await c.supabase.from('invoices').select('id,doc_type,number,status,sent_at,revision').eq('id', id).maybeSingle()
    if (!d) return { error: 'Not found.' }
    if (d.status !== 'draft' || d.sent_at || d.revision > 0) return { error: 'Only drafts that were never sent can be renumbered.' }
    const { data: f } = await c.supabase.from('document_number_formats').select('prefix,fixed_digits,seq_pad,year_separator,include_year').eq('doc_type', d.doc_type).maybeSingle()
    if (!f) return { error: 'No custom number format is set for this document type (Settings → Numbering).' }
    if (matchesFormat(d.number, f)) return { error: `${d.number} already follows the current format.` }
    const { data: num, error: ne } = await c.supabase.rpc('next_document_number', { p_doc_type: d.doc_type })
    if (ne) throw ne
    const { data: upd, error } = await c.supabase.from('invoices').update({ number: num, updated_at: new Date().toISOString() }).eq('id', id).eq('status', 'draft').select('id')
    if (error) throw error
    if (!upd?.length) return { error: 'The document changed. Reload and try again.' }
    await c.supabase.from('sales_doc_events').insert({ company_id: c.company.id, invoice_id: id, event: 'revised', detail: `Renumbered ${d.number} → ${num}`, user_id: c.userId })
    done(); revalidatePath(`/invoices/${id}`)
    return { ok: true, message: `Renumbered to ${num}.` }
  })
}

/** print / download / email / WhatsApp clicks — recorded so the document shows its send history */
export async function logSalesEvent(id: string, event: 'printed' | 'downloaded' | 'emailed' | 'whatsapp'): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'finance.view')
    if (!['printed', 'downloaded', 'emailed', 'whatsapp'].includes(event)) return { error: 'Unknown event.' }
    await logEvent(c, id, event)
  })
}

// ───────────── approval (Settings → Sales → “Quotations need approval before sending”) ─────────────
export async function requestApproval(id: string): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    const { error } = await c.supabase.from('invoices').update({ approval_status: 'pending', approval_note: null, approved_by: null, approved_at: null }).eq('id', id).eq('doc_type', 'quotation')
    if (error) throw error
    await logEvent(c, id, 'approval', 'Approval requested'); done(id)
    return { ok: true, message: 'Sent for approval.' }
  })
}
export async function decideApproval(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'sales.approve')
    const decision = z.enum(['approved', 'rejected', 'changes_requested']).parse(str(fd, 'decision'))
    const note = str(fd, 'note')?.slice(0, 500) ?? null
    if (decision !== 'approved' && !note) return { error: 'Add a note so the estimator knows what to change.' }
    const { error } = await c.supabase.from('invoices').update({ approval_status: decision, approval_note: note, approved_by: c.userId, approved_at: new Date().toISOString() }).eq('id', id)
    if (error) throw error
    await logEvent(c, id, 'approval', `${decision.replace('_', ' ')}${note ? ': ' + note : ''}`); done(id)
    return { ok: true, message: decision === 'approved' ? 'Approved. It can now be sent.' : 'Decision saved.' }
  })
}

// ───────────── follow-ups ─────────────
export async function addFollowup(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    const due = date.safeParse(str(fd, 'due_date'))
    if (!due.success) return { error: 'Choose the follow-up date.', fieldErrors: { due_date: 'Required' } }
    const { error } = await c.supabase.from('sales_followups').insert({ company_id: c.company.id, invoice_id: id, due_date: due.data, note: str(fd, 'note')?.slice(0, 500) ?? null, created_by: c.userId })
    if (error) throw error
    done(id); return { ok: true, message: 'Follow-up scheduled.' }
  })
}
export async function completeFollowup(fid: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    const { data, error } = await c.supabase.from('sales_followups').update({ done_at: new Date().toISOString(), done_by: c.userId, outcome: str(fd, 'outcome')?.slice(0, 500) ?? 'Done' }).eq('id', fid).select('invoice_id')
    if (error) throw error
    if (data?.[0]) { await logEvent(c, data[0].invoice_id, 'followup', str(fd, 'outcome') ?? 'Follow-up done'); done(data[0].invoice_id) }
    return { ok: true, message: 'Follow-up completed.' }
  })
}

// ───────────── payments ─────────────
const paySchema = z.object({
  amount: z.coerce.number({ message: 'Enter the amount' }).positive('Amount must be greater than zero').max(1e10).transform(n => Math.round(n * 100) / 100),
  paid_on: date, method: z.enum(['cash', 'bank_transfer', 'cheque', 'pdc', 'card', 'other'], { message: 'Choose the payment method' }),
  reference: z.string().max(120).optional(), bank_name: z.string().max(120).optional(), notes: z.string().max(1000).optional(), cheque_id: z.string().uuid().optional(),
  idempotency_key: z.string().uuid().optional(),
})
export async function recordPayment(invoiceId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    const parsed = paySchema.safeParse({ amount: str(fd, 'amount'), paid_on: str(fd, 'paid_on') ?? c.today, method: str(fd, 'method'), reference: str(fd, 'reference'), bank_name: str(fd, 'bank_name'), notes: str(fd, 'notes'), cheque_id: str(fd, 'cheque_id'), idempotency_key: str(fd, 'idempotency_key') })
    if (!parsed.success) return { error: parsed.error.issues[0].message, fieldErrors: Object.fromEntries(parsed.error.issues.map(i => [i.path.join('.'), i.message])) }
    const v = parsed.data
    if (v.paid_on > c.today) return { error: 'Payment date cannot be in the future. Track post-dated cheques under Cheques.', fieldErrors: { paid_on: 'Cannot be in the future' } }
    if (v.idempotency_key) {
      const { data: dup } = await c.supabase.from('payments').select('id').eq('idempotency_key', v.idempotency_key).maybeSingle()
      if (dup) return { ok: true, message: 'Payment already recorded.' }
    }
    if (v.cheque_id) {
      const { data: q } = await c.supabase.from('cheques').select('status,amount').eq('id', v.cheque_id).maybeSingle()
      if (!q) return { error: 'Cheque not found.' }
      if (q.status !== 'cleared') return { error: 'Only a cheque you have confirmed as Cleared can be applied as a payment. Update the cheque status first.' }
      if (v.amount > Number(q.amount) + 0.005) return { error: 'The payment is larger than the cheque amount.' }
    }
    let documentId: string | null = null
    const f = fd.get('file')
    if (f instanceof File && f.size > 0 && c.can('documents.upload')) {
      const { data: d, error: de } = await c.supabase.from('documents').insert({ company_id: c.company.id, owner_type: 'vault', name: `Payment receipt ${v.reference ?? v.paid_on}`.slice(0, 250), folder: 'Payments', reminders_active: false, created_by: c.userId }).select('id').single()
      if (de) throw de
      try { await saveVersion(c, d.id, f) } catch (e) { await c.supabase.rpc('soft_delete', { p_entity: 'document', p_id: d.id }); return { error: `Payment not saved. The attachment was rejected: ${(e as Error).message}` } }
      documentId = d.id
    }
    const { error } = await c.supabase.from('payments').insert({ ...v, company_id: c.company.id, invoice_id: invoiceId, created_by: c.userId, document_id: documentId })
    if (error) {
      if (error.code === '23505' && /idem/.test(`${error.message} ${error.details ?? ''}`)) return { ok: true, message: 'Payment already recorded.' }   // double click / retry
      if (error.code === '23505') return { error: 'This cheque has already been applied to an invoice.' }
      if (/exceeds the invoice balance|issue the invoice|tax invoices/.test(error.message)) return { error: error.message.charAt(0).toUpperCase() + error.message.slice(1) + '.' }
      throw error
    }
    if (documentId) await c.supabase.from('document_relationships').insert({ company_id: c.company.id, document_id: documentId, related_type: 'invoice', related_id: invoiceId, role: 'payment_receipt', created_by: c.userId })
    await logEvent(c, invoiceId, 'payment', `AED ${v.amount.toFixed(2)} · ${v.method}${v.reference ? ' · ' + v.reference : ''}`)
    done(invoiceId); revalidatePath('/cheques')
    return { ok: true, message: 'Payment recorded.' }
  })
}

export async function deletePayment(paymentId: string): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.delete')
    const { data, error } = await c.supabase.from('payments').delete().eq('id', paymentId).select('invoice_id,amount')
    if (error) throw error
    if (!data?.length) return { error: 'Payment not found.' }
    if (data[0].invoice_id) await logEvent(c, data[0].invoice_id, 'payment', `Payment of AED ${Number(data[0].amount).toFixed(2)} removed`)
    done(data[0].invoice_id ?? undefined)
    return { ok: true, message: 'Payment removed.' }
  })
}

// ───────────── PDF → Document Vault ─────────────
async function categoryId(c: Ctx, name: string): Promise<string | null> {
  const { data } = await c.supabase.from('document_categories').select('id').eq('name', name).maybeSingle()
  if (data) return data.id
  const { data: created } = await c.supabase.from('document_categories').insert({ company_id: c.company.id, name, scope: 'other' }).select('id').single()
  return created?.id ?? null
}

/** Saves the current PDF into the Document Vault (new document the first time, a new version afterwards) and links it to the customer/project. */
export async function archivePdfToVault(id: string): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'documents.upload'); need(c, 'records.edit')
    const built = await buildSalesPdf(c, id)
    if (!built) return { error: 'Document not found.' }
    const { doc } = built.data
    const meta = DOC_META[doc.doc_type]
    let docId = doc.pdf_document_id
    if (docId) {
      const { data: still } = await c.supabase.from('documents').select('id').eq('id', docId).is('deleted_at', null).maybeSingle()
      if (!still) docId = null
    }
    if (!docId) {
      const folder = `Customers/${(doc.customer_name || 'Unassigned').replace(/[\\/]/g, '-').slice(0, 80)}/${meta.folder}`
      const { data: created, error } = await c.supabase.from('documents').insert({
        company_id: c.company.id, owner_type: 'vault', name: `${meta.label} ${doc.number}${doc.customer_name ? ': ' + doc.customer_name : ''}`.slice(0, 250),
        reference_no: doc.number, issue_date: doc.issue_date, folder, category_id: await categoryId(c, meta.category), reminders_active: false, created_by: c.userId,
        notes: 'Generated by Averiqo sales documents.',
      }).select('id').single()
      if (error) throw error
      docId = created.id
      await c.supabase.from('invoices').update({ pdf_document_id: docId }).eq('id', id)
    }
    const file = new File([built.bytes as BlobPart], built.name, { type: 'application/pdf' })
    const saved = await saveVersion(c, docId!, file, `Generated from ${doc.number} (${doc.status}, revision ${(doc as any).revision ?? 0})`)
    const rels = [
      { related_type: meta.relatedType, related_id: id, role: doc.doc_type },
      doc.customer_id ? { related_type: 'customer', related_id: doc.customer_id, role: doc.doc_type } : null,
      doc.project_id ? { related_type: 'project', related_id: doc.project_id, role: doc.doc_type } : null,
    ].filter(Boolean) as { related_type: string; related_id: string; role: string }[]
    await c.supabase.from('document_relationships').upsert(rels.map(r => ({ ...r, company_id: c.company.id, document_id: docId, created_by: c.userId })), { onConflict: 'document_id,related_type,related_id', ignoreDuplicates: true })
    await logEvent(c, id, 'archived', `Vault version ${saved.versionNo}`)
    done(id); revalidatePath('/vault'); revalidatePath('/documents')
    return { ok: true, message: `Saved to the Document Vault (version ${saved.versionNo}).` }
  })
}

// ───────────── settings: branding & document defaults ─────────────
const IMG = /^image\/(png|jpeg)$/
export async function uploadBranding(_: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'settings.manage')
    const kind = z.enum(BRAND_KINDS).parse(str(fd, 'kind'))
    const f = fd.get('file')
    if (!(f instanceof File) || !f.size) return { error: 'Choose an image (PNG or JPG).' }
    if (f.size > 3 * 1024 * 1024) return { error: 'Images must be 3 MB or smaller.' }
    const buf = new Uint8Array(await f.arrayBuffer())
    const png = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47, jpg = buf[0] === 0xff && buf[1] === 0xd8
    if (!(png || jpg) || !IMG.test(f.type || (png ? 'image/png' : 'image/jpeg'))) return { error: 'Only PNG or JPG images are supported.' }
    const hash = createHash('sha256').update(buf).digest('hex').slice(0, 16)
    const path = `${c.company.id}/branding/${kind}-${hash}.${png ? 'png' : 'jpg'}`
    // content-addressed path: re-uploading the same image is a no-op (storage has no update policy by design)
    const up = await c.supabase.storage.from('vault').upload(path, buf, { contentType: png ? 'image/png' : 'image/jpeg', upsert: false })
    if (up.error && !/exists|duplicate/i.test(up.error.message)) return { error: 'Upload failed. Please try again.' }
    const { error } = await c.supabase.from('app_settings').upsert({ company_id: c.company.id, key: `branding.${kind}`, value: path, updated_at: new Date().toISOString() })
    if (error) throw error
    revalidatePath('/settings'); revalidatePath('/invoices', 'layout')
    return { ok: true, message: 'Image saved.' }
  })
}

export async function removeBranding(kind: string): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'settings.manage')
    const k = z.enum(BRAND_KINDS).parse(kind)
    const { error } = await c.supabase.from('app_settings').upsert({ company_id: c.company.id, key: `branding.${k}`, value: '', updated_at: new Date().toISOString() })
    if (error) throw error
    revalidatePath('/settings'); return { ok: true, message: 'Image removed.' }
  })
}

const lines = (s?: string) => (s ?? '').split('\n').map(x => x.trim()).filter(Boolean).slice(0, 40)
export async function saveSalesSettings(_: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'settings.manage')
    const n = (k: string, min: number, max: number, d?: number) => z.coerce.number({ message: `${k.replace(/_/g, ' ')} must be a number` }).min(min).max(max).parse(str(fd, k) ?? d)
    const trn = str(fd, 'company_trn')?.replace(/\s|-/g, '') ?? ''
    if (trn && !/^\d{15}$/.test(trn)) return { error: 'Company TRN must have 15 digits.', fieldErrors: { company_trn: '15 digits' } }
    const color = str(fd, 'brand_color') ?? ''
    if (color && !/^#[0-9a-f]{6}$/i.test(color)) return { error: 'Brand colour must be a hex colour like #B91C1C.' }
    const email = str(fd, 'company_email') ?? ''
    if (email && !z.string().email().safeParse(email).success) return { error: 'Enter a valid company email.', fieldErrors: { company_email: 'Invalid email' } }
    const followups = (str(fd, 'followup_days') ?? '').split(/[,\s]+/).filter(Boolean).map(Number)
    if (followups.some(d => !Number.isInteger(d) || d < 1 || d > 365)) return { error: 'Follow-up days must be whole numbers between 1 and 365, e.g. “3, 10”.' }
    const rows: [string, unknown][] = [
      ['sales.terms', lines(str(fd, 'terms'))], ['sales.payment_terms', lines(str(fd, 'payment_terms'))],
      ['sales.intro', (str(fd, 'intro') ?? '').slice(0, 2000)], ['sales.closing', (str(fd, 'closing') ?? '').slice(0, 2000)],
      ['sales.vat_rate', n('vat_rate', 0, 100)], ['sales.due_days', n('due_days', 0, 365)], ['sales.validity_days', n('validity_days', 1, 365)],
      ['sales.quote_vat', str(fd, 'quote_vat') === 'add' ? 'add' : 'note'], ['sales.followup_days', [...new Set(followups)].sort((a, b) => a - b).slice(0, 6)],
      ['sales.require_approval', fd.get('require_approval') === 'on'],
      ['branding.bank_details', (str(fd, 'bank_details') ?? '').slice(0, 1000)], ['branding.company_trn', trn],
      ['branding.show_header_footer', fd.get('show_header_footer') === 'on'], ['branding.show_stamp', fd.get('show_stamp') === 'on'],
      ['branding.seal_size', n('seal_size', 70, 220)], ['branding.signature_width', n('signature_width', 80, 260)],
      ['branding.sign_align', z.enum(['left', 'center', 'right']).parse(str(fd, 'sign_align') ?? 'right')], ['branding.sign_spacing', n('sign_spacing', 0, 80)],
      ['branding.address', (str(fd, 'company_address') ?? '').slice(0, 500)], ['branding.phone', (str(fd, 'company_phone') ?? '').slice(0, 80)],
      ['branding.email', email.slice(0, 120)], ['branding.website', (str(fd, 'company_website') ?? '').slice(0, 120)],
      ['branding.signatory_name', (str(fd, 'signatory_name') ?? '').slice(0, 120)], ['branding.signatory_title', (str(fd, 'signatory_title') ?? '').slice(0, 120)],
      ['branding.color', color], ['branding.logo_height', n('logo_height', 0, 60, 0)], ['branding.logo_align', z.enum(['left', 'center', 'right']).parse(str(fd, 'logo_align') ?? 'center')],
    ]
    const { error } = await c.supabase.from('app_settings').upsert(rows.map(([key, value]) => ({ company_id: c.company.id, key, value, updated_at: new Date().toISOString() })))
    if (error) throw error
    revalidatePath('/settings'); revalidatePath('/invoices', 'layout')
    return { ok: true, message: 'Document settings saved.' }
  })
}

/** Payment received on account (not against one invoice) — e.g. settling an opening balance. */
export async function recordPaymentOnAccount(customerId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    const parsed = paySchema.safeParse({ amount: str(fd, 'amount'), paid_on: str(fd, 'paid_on') ?? c.today, method: str(fd, 'method'), reference: str(fd, 'reference'), bank_name: str(fd, 'bank_name'), notes: str(fd, 'notes'), idempotency_key: str(fd, 'idempotency_key') })
    if (!parsed.success) return { error: parsed.error.issues[0].message, fieldErrors: Object.fromEntries(parsed.error.issues.map(i => [i.path.join('.'), i.message])) }
    const v = parsed.data
    if (v.paid_on > c.today) return { error: 'Payment date cannot be in the future.', fieldErrors: { paid_on: 'Cannot be in the future' } }
    const { error } = await c.supabase.from('payments').insert({ ...v, company_id: c.company.id, invoice_id: null, customer_id: customerId, created_by: c.userId })
    if (error) { if (error.code === '23505') return { ok: true, message: 'Payment already recorded.' }; throw error }
    revalidatePath(`/parties/${customerId}`); revalidatePath(`/parties/${customerId}/ledger`)
    return { ok: true, message: 'Payment on account recorded.' }
  })
}
