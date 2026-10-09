'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { str } from '@/lib/action'
import { createAdminClient } from '@/lib/supabase/admin'
import { ipHash, logLinkEvent, notifyCompany, resolveLink, storeLinkUpload, underLimit, type LinkKind } from '@/lib/portal'
import { respondToQuote } from '@/lib/portal-quote'
import type { ActionState } from '@/lib/utils'

// Public (signed-out) actions. Each one resolves the link again from its token, validates the input, rate-limits, and only
// touches the record the link was issued for. Errors never reveal whether other records exist.
const GONE = { error: 'This link is no longer valid. Ask the sender for a new one.' }
const UUID = /^[0-9a-f-]{36}$/i
const name = (fd: FormData) => z.string().trim().min(2, 'Enter your name').max(120).parse(str(fd, 'name') ?? '')

export async function publicRespondQuote(token: string, kind: 'quote_response' | 'customer_portal', quoteId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const r = await resolveLink(token, kind); if (!r) return GONE
    if (!UUID.test(quoteId)) return { error: 'Unknown quotation.' }
    if (!(await underLimit(r, 'accepted', 10, 60)) || !(await underLimit(r, 'rejected', 10, 60))) return { error: 'Too many answers from this link. Please try again later.' }
    const decision = z.enum(['accepted', 'rejected']).parse(str(fd, 'decision'))
    const res = await respondToQuote(r, quoteId, decision, name(fd), str(fd, 'note')?.slice(0, 500) ?? null)
    if ('error' in res) return res
    revalidatePath(`/invoices/${quoteId}`)
    return { ok: true, message: res.message }
  } catch (e) { if (!(e instanceof z.ZodError)) console.error('[public]', e); return { error: e instanceof z.ZodError ? e.issues[0].message : 'Something went wrong. Please try again.' } }
}

/** Supplier confirms that the goods / services of a purchase order were delivered. */
export async function publicConfirmDelivery(token: string, poId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const r = await resolveLink(token, 'supplier_portal'); if (!r) return GONE
    if (!UUID.test(poId)) return { error: 'Unknown purchase order.' }
    const { data: po } = await r.admin.from('invoices').select('id,number,status,supplier_id,supplier_confirmed_at,deleted_at').eq('id', poId).eq('company_id', r.company.id).eq('doc_type', 'purchase_order').maybeSingle()
    if (!po || po.deleted_at || po.supplier_id !== r.link.supplier_id || ['draft', 'cancelled'].includes(po.status)) return { error: 'This purchase order is not available through this link.' }
    if (po.supplier_confirmed_at) return { error: 'Delivery was already confirmed for this purchase order.' }
    const v = z.object({ delivered_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the delivery date'), reference: z.string().max(80).optional(), note: z.string().max(500).optional() })
      .parse({ delivered_on: str(fd, 'delivered_on') ?? '', reference: str(fd, 'reference'), note: str(fd, 'note') })
    const by = name(fd), now = new Date().toISOString()
    const { error } = await r.admin.from('invoices').update({ supplier_confirmed_at: now, supplier_confirmation: { ...v, by } }).eq('id', po.id).eq('company_id', r.company.id).is('supplier_confirmed_at', null)
    if (error) return { error: 'Could not save. Please try again.' }
    await r.admin.from('sales_doc_events').insert({ company_id: r.company.id, invoice_id: po.id, event: 'status', detail: `Delivery confirmed by the supplier (${by}) for ${v.delivered_on}${v.reference ? ` · DN ${v.reference}` : ''}${v.note ? ` · ${v.note}` : ''}`.slice(0, 500), user_id: null })
    await logLinkEvent(r, 'delivery_confirmed', `${po.number} · ${by}`)
    await notifyCompany(r, 'finance.view', { title: `Supplier confirmed delivery for ${po.number}`, body: `${by} · ${v.delivered_on}`, link: `/invoices/${po.id}`, key: `po_delivered:${po.id}` })
    revalidatePath(`/invoices/${po.id}`)
    return { ok: true, message: `Thank you. Delivery for ${po.number} is confirmed.` }
  } catch (e) { if (!(e instanceof z.ZodError)) console.error('[public]', e); return { error: e instanceof z.ZodError ? e.issues[0].message : 'Something went wrong. Please try again.' } }
}

/** Files through a link (supplier invoice, or requested documents) go to the Smart Inbox for review. */
export async function publicUpload(token: string, kind: 'supplier_portal' | 'document_request', _: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const r = await resolveLink(token, kind as LinkKind); if (!r) return GONE
    if (!(await underLimit(r, kind === 'supplier_portal' ? 'invoice_uploaded' : 'uploaded', 40, 24 * 60))) return { error: 'Upload limit for this link reached. Please contact us.' }
    const files = fd.getAll('file').filter((f): f is File => f instanceof File && f.size > 0).slice(0, 10)
    if (!files.length) return { error: 'Choose at least one file.' }
    const who = name(fd)
    const item = str(fd, 'item')?.slice(0, 120) ?? null
    if (kind === 'document_request' && item && !r.link.items.includes(item)) return { error: 'Choose one of the requested documents.' }
    // who the files belong to (pre-selected for the reviewer)
    let owner: { kind: 'employee' | 'customer' | 'supplier'; id: string; name: string } | null = null
    if (r.link.employee_id) { const { data } = await r.admin.from('employees').select('id,full_name').eq('id', r.link.employee_id).eq('company_id', r.company.id).maybeSingle(); if (data) owner = { kind: 'employee', id: data.id, name: data.full_name } }
    else if (r.link.customer_id) { const { data } = await r.admin.from('customers').select('id,name').eq('id', r.link.customer_id).eq('company_id', r.company.id).maybeSingle(); if (data) owner = { kind: 'customer', id: data.id, name: data.name } }
    else if (r.link.supplier_id) { const { data } = await r.admin.from('suppliers').select('id,name').eq('id', r.link.supplier_id).eq('company_id', r.company.id).maybeSingle(); if (data) owner = { kind: 'supplier', id: data.id, name: data.name } }
    if (!owner) return GONE
    const extra = kind === 'supplier_portal' ? [str(fd, 'po_number') && `for PO ${str(fd, 'po_number')!.slice(0, 40)}`, str(fd, 'reference') && `invoice ${str(fd, 'reference')!.slice(0, 60)}`, str(fd, 'amount') && `AED ${Number(str(fd, 'amount')).toFixed(2)}`].filter(Boolean).join(', ') : ''
    const note = kind === 'supplier_portal' ? `Supplier invoice uploaded through the supplier portal by ${who}${extra ? ` (${extra})` : ''}` : `${item ?? 'Document'} sent by ${who} through a document request link`
    const done: string[] = [], problems: string[] = []
    for (const f of files) { const res = await storeLinkUpload(r, f, note, owner); if ('error' in res) problems.push(res.error); else done.push(f.name) }
    if (done.length) {
      await logLinkEvent(r, kind === 'supplier_portal' ? 'invoice_uploaded' : 'uploaded', `${done.length} file(s)${item ? ` · ${item}` : ''} · ${who}`)
      await notifyCompany(r, 'documents.upload', { title: kind === 'supplier_portal' ? `Supplier invoice from ${owner.name}` : `Documents received from ${owner.name}`, body: `${done.length} file(s) waiting in Smart Inbox${item ? ` · ${item}` : ''}`, link: '/inbox?tab=review', key: `link_upload:${r.link.id}:${Date.now()}` })
    }
    if (!done.length) return { error: problems.join(' ') || 'Nothing was uploaded.' }
    return { ok: true, message: `Received ${done.length} file${done.length === 1 ? '' : 's'}. Thank you.${problems.length ? ` Not accepted: ${problems.join(' ')}` : ''}` }
  } catch (e) { if (!(e instanceof z.ZodError)) console.error('[public]', e); return { error: e instanceof z.ZodError ? e.issues[0].message : 'Something went wrong. Please try again.' } }
}

/**
 * Website enquiry / service request → a new lead (source Website) with its number from the company's numbering.
 * Spam protection: hidden honeypot field, minimum fill time, and at most 5 submissions per visitor per hour and 200 per form per day.
 */
export async function publicEnquiry(slug: string, _: ActionState, fd: FormData): Promise<ActionState> {
  try {
    if (!/^[a-z0-9][a-z0-9-]{2,39}$/.test(slug)) return { error: 'This form is not available.' }
    const admin = createAdminClient()
    const { data: form } = await admin.from('public_forms').select('id,company_id,kind,title,enabled').eq('slug', slug).maybeSingle()
    if (!form || !form.enabled) return { error: 'This form is not available.' }
    if (str(fd, 'website')) return { ok: true, message: 'Thank you. We will contact you shortly.' }        // honeypot: bots fill every field
    const started = Number(str(fd, 't') ?? 0); if (!started || Date.now() - started < 2500) return { error: 'Please take a moment to fill in the form, then send it again.' }
    const ip = await ipHash()
    const [{ count: mine }, { count: today }] = await Promise.all([
      admin.from('public_form_submissions').select('id', { count: 'exact', head: true }).eq('form_id', form.id).eq('ip_hash', ip).gte('created_at', new Date(Date.now() - 3600e3).toISOString()),
      admin.from('public_form_submissions').select('id', { count: 'exact', head: true }).eq('form_id', form.id).gte('created_at', new Date(Date.now() - 864e5).toISOString()),
    ])
    if ((mine ?? 0) >= 5 || (today ?? 0) >= 200) return { error: 'We have received several requests already. Please call or WhatsApp us instead.' }
    const v = z.object({
      name: z.string().trim().min(2, 'Enter your name').max(120), company: z.string().trim().max(200).optional(),
      phone: z.string().trim().min(7, 'Enter a phone number').max(40).regex(/^[+0-9 ()-]+$/, 'Phone: digits only'), email: z.string().trim().email('Enter a valid email').max(200).optional(),
      location: z.string().trim().max(300).optional(), service: z.string().trim().max(300).optional(), message: z.string().trim().min(5, 'Tell us briefly what you need').max(3000),
    }).parse({ name: str(fd, 'name') ?? '', company: str(fd, 'company'), phone: str(fd, 'phone') ?? '', email: str(fd, 'email'), location: str(fd, 'location'), service: str(fd, 'service'), message: str(fd, 'message') ?? '' })
    const { data: number, error: ne } = await admin.rpc('issue_document_number', { cid: form.company_id, p_doc_type: 'lead' })
    if (ne || !number) { console.error('[public] numbering', ne?.message); return { error: 'Could not send right now. Please try again in a minute.' } }
    const kindLabel = form.kind === 'service_request' ? 'Service request' : 'Website enquiry'
    const { data: lead, error } = await admin.from('leads').insert({
      company_id: form.company_id, number, company_name: v.company || v.name, contact_person: v.name, phone: v.phone, email: v.email ?? null, location: v.location ?? null,
      service: (v.service ?? kindLabel).slice(0, 300), source: 'website', stage: 'new', next_followup: new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 10),
      notes: `${kindLabel} (${form.title}):\n${v.message}`.slice(0, 4000), created_by: null,
    }).select('id').single()
    if (error) { console.error('[public] lead insert', error.message); return { error: 'Could not send right now. Please try again in a minute.' } }
    await admin.from('public_form_submissions').insert({ company_id: form.company_id, form_id: form.id, ip_hash: ip, lead_id: lead.id })
    await admin.from('lead_activities').insert({ company_id: form.company_id, lead_id: lead.id, kind: 'note', body: `${kindLabel} received through the public form “${form.title}”.`, user_id: null })
    // notify everyone who works the pipeline
    const { data: users } = await admin.from('profiles').select('id,role').eq('company_id', form.company_id).eq('is_active', true)
    const { data: rp } = await admin.from('role_permissions').select('role').eq('permission', 'crm.view')
    const roles = new Set((rp ?? []).map(x => x.role))
    const ids = (users ?? []).filter(u => roles.has(u.role)).map(u => u.id)
    if (ids.length) await admin.from('in_app_notifications').upsert(ids.map(id => ({ company_id: form.company_id, user_id: id, title: `New ${kindLabel.toLowerCase()}: ${v.company || v.name}`, body: `${number} · ${v.phone}${v.service ? ` · ${v.service}` : ''}`.slice(0, 500), link: `/leads/${lead.id}`, severity: 'info', dedupe_key: `enquiry:${lead.id}` })), { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true })
    return { ok: true, message: `Thank you, ${v.name}. Your reference is ${number}. We will contact you shortly.` }
  } catch (e) { if (!(e instanceof z.ZodError)) console.error('[public]', e); return { error: e instanceof z.ZodError ? e.issues[0].message : 'Something went wrong. Please try again.' } }
}
