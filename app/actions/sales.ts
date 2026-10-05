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
import type { ActionState } from '@/lib/utils'

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date')
const optDate = z.union([date, z.literal('')]).optional().transform(v => v || null)
const optText = (max: number) => z.string().max(max).optional().nullable().transform(v => (v && v.trim() ? v.trim() : null))
const typeSchema = z.enum(['quotation', 'invoice', 'delivery_note'])

const itemSchema = z.object({
  description: z.string().trim().min(1, 'Every line needs a description').max(2000),
  materials: optText(1000),
  quantity: z.coerce.number().min(0, 'Quantity cannot be negative').max(1e9),
  unit: z.string().trim().min(1).max(20).default('Nos'),
  unit_price: z.coerce.number().min(0, 'Price cannot be negative').max(1e10),
})
const docSchema = z.object({
  customer_id: z.string().uuid().nullable().optional(),
  new_customer: z.boolean().optional(),
  update_customer: z.boolean().optional(),                // explicit opt-in: copy this document's details back to the customer record
  customer_email: z.union([z.string().trim().email('Enter a valid email').max(200), z.literal('')]).optional().nullable().transform(v => v || null),
  project_id: z.string().uuid().nullable().optional(),
  issue_date: date, due_date: optDate, valid_until: optDate,
  attention: optText(200), customer_name: optText(250), customer_address: optText(500), customer_trn: optText(30), customer_phone: optText(40),
  site: optText(300), subject: optText(300), reference: optText(120), lpo_ref: optText(120), intro: optText(2000), closing: optText(2000),
  receiver_name: optText(120), vehicle_no: optText(40), notes: optText(4000),
  vat_rate: z.coerce.number().min(0).max(100), discount: z.coerce.number().min(0).max(1e10).default(0), show_total: z.boolean().default(true),
  terms: z.array(z.string().trim().max(500)).max(40).transform(a => a.filter(Boolean)),
  payment_terms: z.array(z.string().trim().max(500)).max(40).transform(a => a.filter(Boolean)),
  items: z.array(itemSchema).max(300),
}).refine(v => !v.customer_trn || /^\d{15}$/.test(v.customer_trn.replace(/\s|-/g, '')), { message: 'A UAE TRN has 15 digits', path: ['customer_trn'] })
  .refine(v => !v.due_date || v.due_date >= v.issue_date, { message: 'Due date cannot be before the issue date', path: ['due_date'] })
export type SalesDocInput = z.input<typeof docSchema>

const done = (id?: string) => { revalidatePath('/invoices'); if (id) revalidatePath(`/invoices/${id}`); revalidatePath('/') }

async function nextNumber(c: Ctx, t: SalesType): Promise<string> {
  const { data, error } = await c.supabase.rpc('next_document_number', { p_doc_type: t })
  if (error) throw error
  return data as string
}

/** Creates a new draft (numbered immediately so the paper shows the real number) and opens the editor. */
export async function newSalesDoc(type: string, opts: { customerId?: string; projectId?: string } = {}): Promise<ActionState> {
  let id: string | null = null
  const r = await safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    const t = typeSchema.parse(type)
    const s = await salesSettings(c)
    let customer: any = null
    if (opts.customerId) customer = (await c.supabase.from('customers').select('id,name,address,trn,phone,contact_person,email').eq('id', opts.customerId).maybeSingle()).data
    let project: any = null
    if (opts.projectId) {
      project = (await c.supabase.from('projects').select('id,name,location,customer_id').eq('id', opts.projectId).maybeSingle()).data
      if (project?.customer_id && !customer) customer = (await c.supabase.from('customers').select('id,name,address,trn,phone,contact_person,email').eq('id', project.customer_id).maybeSingle()).data
    }
    const number = await nextNumber(c, t)
    const { data, error } = await c.supabase.from('invoices').insert({
      company_id: c.company.id, doc_type: t, number, status: 'draft', issue_date: c.today, created_by: c.userId,
      due_date: t === 'invoice' ? addDays(c.today, s.dueDays) : null, valid_until: t === 'quotation' ? addDays(c.today, s.validityDays) : null,
      vat_rate: s.vatRate, terms: t === 'quotation' ? s.terms : [], payment_terms: t === 'quotation' ? s.paymentTerms : [],
      intro: t === 'quotation' ? s.intro : null, closing: t === 'quotation' ? s.closing : null,
      customer_id: customer?.id ?? null, customer_name: customer?.name ?? null, customer_address: customer?.address ?? null, customer_trn: customer?.trn ?? null,
      customer_phone: customer?.phone ?? null, customer_email: customer?.email ?? null, attention: customer?.contact_person ?? null,
      project_id: project?.id ?? null, site: project?.location ?? null,
    }).select('id').single()
    if (error) throw error
    id = data.id
  })
  if (id) redirect(`/invoices/${id}`)
  return r
}

/** Saves the header + replaces all lines. Totals are always recomputed on the server. */
export async function saveSalesDoc(id: string, input: SalesDocInput): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    const v = docSchema.parse(input)
    const { data: cur } = await c.supabase.from('invoices').select('id,doc_type,status').eq('id', id).maybeSingle()
    if (!cur) return { error: 'Document not found.' }
    if (cur.doc_type === 'invoice' && !['draft', 'sent', 'overdue'].includes(cur.status)) {
      return { error: cur.status === 'cancelled' ? 'A cancelled invoice cannot be edited.' : 'This invoice already has payments — record a credit note instead of editing it.' }
    }
    if (cur.status === 'cancelled') return { error: 'A cancelled document cannot be edited. Duplicate it instead.' }
    const t = cur.doc_type as SalesType
    let customerId = v.customer_id ?? null
    if (!customerId && v.new_customer && v.customer_name) {
      const { data: existing } = await c.supabase.from('customers').select('id').ilike('name', v.customer_name).maybeSingle()
      if (existing) customerId = existing.id
      else {
        const { data: cu, error } = await c.supabase.from('customers').insert({ company_id: c.company.id, name: v.customer_name, address: v.customer_address, trn: v.customer_trn, phone: v.customer_phone, email: v.customer_email, contact_person: v.attention }).select('id').single()
        if (error) throw error
        customerId = cu.id
      }
    }
    const priced = DOC_META[t].priced
    const tot = computeTotals(v.items, v.vat_rate, v.discount, t === 'invoice')
    if (t === 'invoice' && cur.status !== 'draft') {
      const { data: b } = await c.supabase.from('invoice_balances').select('paid').eq('id', id).maybeSingle()
      if (b && Number(b.paid) > tot.total + 0.005) return { error: 'The new total is lower than what has already been paid.' }
    }
    if (customerId && v.update_customer) {
      const { error: ue } = await c.supabase.from('customers').update({ name: v.customer_name ?? undefined, address: v.customer_address, trn: v.customer_trn?.replace(/\s|-/g, '') ?? null, phone: v.customer_phone, email: v.customer_email, contact_person: v.attention }).eq('id', customerId)
      if (ue) throw ue
    }
    const { items, new_customer: _nc, customer_id: _ci, update_customer: _uc, ...head } = v
    const { error } = await c.supabase.from('invoices').update({
      ...head, customer_id: customerId, customer_trn: v.customer_trn?.replace(/\s|-/g, '') ?? null,
      subtotal: priced ? tot.subtotal : 0, discount: priced ? tot.discount : 0, vat_amount: priced ? tot.vat : 0, total: priced ? tot.total : 0,
      updated_at: new Date().toISOString(),
    }).eq('id', id)
    if (error) throw error
    const del = await c.supabase.from('invoice_items').delete().eq('invoice_id', id)
    if (del.error) throw del.error
    if (items.length) {
      const ins = await c.supabase.from('invoice_items').insert(items.map((it, i) => ({ ...it, unit_price: priced ? it.unit_price : 0, position: i, invoice_id: id, company_id: c.company.id })))
      if (ins.error) throw ins.error
    }
    done(id)
    return { ok: true, message: 'Saved.', data: customerId ? { customerId } : undefined }
  })
}

export async function setSalesStatus(id: string, status: string): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    const { data: cur } = await c.supabase.from('invoices').select('id,doc_type,status,total').eq('id', id).maybeSingle()
    if (!cur) return { error: 'Document not found.' }
    if (!manualStatuses(cur.doc_type as SalesType, cur.status).includes(status)) return { error: `Cannot change from “${cur.status}” to “${status}”.` }
    if (cur.doc_type === 'invoice' && status === 'sent') {
      const { count } = await c.supabase.from('invoice_items').select('id', { count: 'exact', head: true }).eq('invoice_id', id)
      if (!count) return { error: 'Add at least one line before issuing the invoice.' }
    }
    if (cur.doc_type === 'invoice' && status === 'cancelled') {
      const { count } = await c.supabase.from('payments').select('id', { count: 'exact', head: true }).eq('invoice_id', id)
      if (count) return { error: 'This invoice has payments. Delete the payments first (or issue a credit note).' }
    }
    const { error } = await c.supabase.from('invoices').update({ status, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) throw error
    // an issued invoice whose due date already passed is overdue straight away
    if (cur.doc_type === 'invoice' && status === 'sent') {
      const { data: inv } = await c.supabase.from('invoices').select('due_date').eq('id', id).single()
      if (inv?.due_date && inv.due_date < c.today) await c.supabase.from('invoices').update({ status: 'overdue' }).eq('id', id)
    }
    done(id)
    return { ok: true, message: 'Status updated.' }
  })
}

async function copyDoc(c: Ctx, id: string, to: SalesType, link: boolean): Promise<string> {
  const src = await loadSalesDoc(c, id)
  if (!src) throw new Error('Document not found.')
  const s = await salesSettings(c)
  const d = src.doc as any
  const number = await nextNumber(c, to)
  const { data, error } = await c.supabase.from('invoices').insert({
    company_id: c.company.id, doc_type: to, number, status: 'draft', issue_date: c.today, created_by: c.userId,
    customer_id: d.customer_id, project_id: d.project_id, attention: d.attention, customer_name: d.customer_name, customer_address: d.customer_address,
    customer_trn: d.customer_trn, customer_phone: d.customer_phone, customer_email: d.customer_email, site: d.site, subject: d.subject, reference: d.reference, lpo_ref: d.lpo_ref,
    vat_rate: d.vat_rate, discount: to === d.doc_type ? d.discount : 0, show_total: d.show_total,
    intro: to === 'quotation' ? d.intro ?? s.intro : null, closing: to === 'quotation' ? d.closing ?? s.closing : null,
    terms: to === 'quotation' ? d.terms : [], payment_terms: to === 'quotation' ? d.payment_terms : [],
    due_date: to === 'invoice' ? addDays(c.today, s.dueDays) : null, valid_until: to === 'quotation' ? addDays(c.today, s.validityDays) : null,
    quotation_id: link ? (d.doc_type === 'quotation' ? d.id : d.quotation_id) : null,
    source_invoice_id: link && d.doc_type === 'invoice' ? d.id : null,
    subtotal: d.subtotal, vat_amount: to === 'invoice' ? d.vat_amount : 0, total: DOC_META[to].priced ? d.total : 0,
  }).select('id').single()
  if (error) throw error
  if (src.items.length) {
    const ins = await c.supabase.from('invoice_items').insert(src.items.map((it, i) => ({
      company_id: c.company.id, invoice_id: data.id, position: i, description: it.description, materials: it.materials ?? null,
      quantity: it.quantity, unit: it.unit || 'Nos', unit_price: DOC_META[to].priced ? it.unit_price : 0,
    })))
    if (ins.error) throw ins.error
  }
  // keep priced totals right when converting DN → invoice etc.
  if (DOC_META[to].priced) {
    const t = computeTotals(src.items, Number(d.vat_rate), to === d.doc_type ? Number(d.discount) : 0, to === 'invoice')
    await c.supabase.from('invoices').update({ subtotal: t.subtotal, vat_amount: t.vat, total: t.total, discount: t.discount }).eq('id', data.id)
  }
  if (link && d.doc_type === 'delivery_note' && to === 'invoice') await c.supabase.from('invoices').update({ source_invoice_id: data.id }).eq('id', d.id)
  if (link && d.doc_type === 'quotation' && ['draft', 'sent'].includes(d.status)) await c.supabase.from('invoices').update({ status: 'accepted' }).eq('id', d.id)
  return data.id
}

export async function convertSalesDoc(id: string, to: string): Promise<ActionState> {
  let newId: string | null = null
  const r = await safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    const target = typeSchema.parse(to)
    const { data: cur } = await c.supabase.from('invoices').select('doc_type,status').eq('id', id).maybeSingle()
    if (!cur) return { error: 'Document not found.' }
    if (!(CONVERSIONS[cur.doc_type as SalesType] ?? []).includes(target)) return { error: `A ${DOC_META[cur.doc_type as SalesType].label} cannot be converted to a ${DOC_META[target].label}.` }
    if (cur.status === 'cancelled') return { error: 'A cancelled document cannot be converted.' }
    newId = await copyDoc(c, id, target, true)
    done(id)
  })
  if (newId) redirect(`/invoices/${newId}`)
  return r
}

export async function duplicateSalesDoc(id: string): Promise<ActionState> {
  let newId: string | null = null
  const r = await safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    const { data: cur } = await c.supabase.from('invoices').select('doc_type').eq('id', id).maybeSingle()
    if (!cur) return { error: 'Document not found.' }
    newId = await copyDoc(c, id, typeSchema.parse(cur.doc_type), false)
    done()
  })
  if (newId) redirect(`/invoices/${newId}`)
  return r
}

/** Only drafts can be deleted; issued documents are cancelled instead so the numbering keeps an audit trail. */
export async function deleteSalesDraft(id: string): Promise<ActionState> {
  const r = await safe(async () => {
    const c = await getCtx(); need(c, 'records.delete')
    const { data: cur } = await c.supabase.from('invoices').select('status').eq('id', id).maybeSingle()
    if (!cur) return { error: 'Document not found.' }
    if (cur.status !== 'draft') return { error: 'Only drafts can be deleted. Cancel issued documents instead.' }
    const { error } = await c.supabase.from('invoices').delete().eq('id', id)
    if (error) throw error
    done()
  })
  if (r?.ok) redirect('/invoices')
  return r
}

// ───────────── payments ─────────────
const paySchema = z.object({
  amount: z.coerce.number({ message: 'Enter the amount' }).positive('Amount must be greater than zero').max(1e10),
  paid_on: date, method: z.enum(['cash', 'bank_transfer', 'cheque', 'pdc', 'card', 'other']),
  reference: z.string().max(120).optional(), notes: z.string().max(1000).optional(), cheque_id: z.string().uuid().optional(),
})
export async function recordPayment(invoiceId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    const v = paySchema.parse({ amount: str(fd, 'amount'), paid_on: str(fd, 'paid_on') ?? c.today, method: str(fd, 'method'), reference: str(fd, 'reference'), notes: str(fd, 'notes'), cheque_id: str(fd, 'cheque_id') })
    if (v.paid_on > c.today) return { error: 'Payment date cannot be in the future. Track post-dated cheques under Cheques.' }
    const { error } = await c.supabase.from('payments').insert({ ...v, company_id: c.company.id, invoice_id: invoiceId, created_by: c.userId })
    if (error) {
      if (/exceeds the invoice balance|issue the invoice|tax invoices/.test(error.message)) return { error: error.message.charAt(0).toUpperCase() + error.message.slice(1) + '.' }
      throw error
    }
    done(invoiceId)
    return { ok: true, message: 'Payment recorded.' }
  })
}

export async function deletePayment(paymentId: string): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.delete')
    const { data, error } = await c.supabase.from('payments').delete().eq('id', paymentId).select('invoice_id')
    if (error) throw error
    if (!data?.length) return { error: 'Payment not found.' }
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
        company_id: c.company.id, owner_type: 'vault', name: `${meta.label} ${doc.number}${doc.customer_name ? ' — ' + doc.customer_name : ''}`.slice(0, 250),
        reference_no: doc.number, issue_date: doc.issue_date, folder, category_id: await categoryId(c, meta.category), reminders_active: false, created_by: c.userId,
        notes: 'Generated by SaqrFlow sales documents.',
      }).select('id').single()
      if (error) throw error
      docId = created.id
      await c.supabase.from('invoices').update({ pdf_document_id: docId }).eq('id', id)
    }
    const file = new File([built.bytes as BlobPart], built.name, { type: 'application/pdf' })
    const saved = await saveVersion(c, docId!, file, `Generated from ${doc.number} (${doc.status})`)
    const rels = [
      { related_type: meta.relatedType, related_id: id, role: doc.doc_type },
      doc.customer_id ? { related_type: 'customer', related_id: doc.customer_id, role: doc.doc_type } : null,
      doc.project_id ? { related_type: 'project', related_id: doc.project_id, role: doc.doc_type } : null,
    ].filter(Boolean) as { related_type: string; related_id: string; role: string }[]
    await c.supabase.from('document_relationships').upsert(rels.map(r => ({ ...r, company_id: c.company.id, document_id: docId, created_by: c.userId })), { onConflict: 'document_id,related_type,related_id', ignoreDuplicates: true })
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
    const n = (k: string, min: number, max: number) => z.coerce.number().min(min).max(max).parse(str(fd, k))
    const trn = str(fd, 'company_trn')?.replace(/\s|-/g, '') ?? ''
    if (trn && !/^\d{15}$/.test(trn)) return { error: 'Company TRN must have 15 digits.' }
    const rows: [string, unknown][] = [
      ['sales.terms', lines(str(fd, 'terms'))], ['sales.payment_terms', lines(str(fd, 'payment_terms'))],
      ['sales.intro', (str(fd, 'intro') ?? '').slice(0, 2000)], ['sales.closing', (str(fd, 'closing') ?? '').slice(0, 2000)],
      ['sales.vat_rate', n('vat_rate', 0, 100)], ['sales.due_days', n('due_days', 0, 365)], ['sales.validity_days', n('validity_days', 1, 365)],
      ['branding.bank_details', (str(fd, 'bank_details') ?? '').slice(0, 1000)], ['branding.company_trn', trn],
      ['branding.show_header_footer', fd.get('show_header_footer') === 'on'], ['branding.show_stamp', fd.get('show_stamp') === 'on'],
      ['branding.seal_size', n('seal_size', 70, 220)], ['branding.signature_width', n('signature_width', 80, 260)],
      ['branding.sign_align', z.enum(['left', 'center', 'right']).parse(str(fd, 'sign_align') ?? 'right')], ['branding.sign_spacing', n('sign_spacing', 0, 80)],
    ]
    const { error } = await c.supabase.from('app_settings').upsert(rows.map(([key, value]) => ({ company_id: c.company.id, key, value, updated_at: new Date().toISOString() })))
    if (error) throw error
    revalidatePath('/settings'); revalidatePath('/invoices', 'layout')
    return { ok: true, message: 'Document settings saved.' }
  })
}
