import 'server-only'
import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Ctx } from '../auth'
import { createAdminClient } from '../supabase/admin'
import { buildSalesPdf } from '../sales/build'
import { brandingBytes, brandingFor } from '../sales/data'
import { renderStatementPdf } from '../sales/statement-pdf'
import { renderSimplePdf } from '../sales/simple-pdf'
import { amountInWords, fmtMoney } from '../sales/money'
import { safePart } from '../sales/filename'
import { buildLedger } from '../ledger'
import { toE164 } from '../phone'
import { formatAed, formatShortDate } from '../time'
import { loadWhatsAppConfig } from '../reminders/engine'
import { parseSettings } from '../reminders/settings'
import { isConfigured, type SendResult } from './client'
import { sendMessage, uploadMedia } from './cloud'
import { KINDS, WINDOW_MS, fill, placeholders, safeFreeText, safeValue, type PartyType } from './messages'

type Admin = SupabaseClient
export interface Resolved {
  kind: string; recordType: string; recordId: string
  party: { type: PartyType; id: string; name: string }
  phone: string | null; values: Record<string, string>
  pdf?: () => Promise<{ bytes: Uint8Array; filename: string }>
  link: string
}
export class SendError extends Error {}
const fail = (m: string): never => { throw new SendError(m) }
const need = (c: Ctx, p: Parameters<Ctx['can']>[0]) => { if (!c.can(p)) fail('You do not have permission to send this.') }
const phoneOf = (...xs: (string | null | undefined)[]) => { for (const x of xs) { const e = x ? toE164(x) : null; if (e) return e } return null }
/** first day of the period's month (+n months), as YYYY-MM-DD; `-31` is not a valid date in short months */
const monthStart = (iso: string, n = 0) => { const d = new Date(`${iso.slice(0, 7)}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10) }
const monthLabel = (iso: string) => new Date(`${iso.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })

/** What a message type says and attaches, read with the user's own session (RLS) after the permission check. */
export async function resolveMessage(c: Ctx, kind: string, recordId: string): Promise<Resolved> {
  if (!KINDS[kind]) fail('Unknown message type.')
  if (!/^[0-9a-f-]{36}$/i.test(recordId)) fail('Unknown record.')
  const company = c.company.name, sb = c.supabase
  const salesKind: Record<string, string> = { quotation: 'quotation', invoice: 'invoice', delivery_note: 'delivery_note', payment_reminder: 'invoice', quotation_followup: 'quotation' }
  if (kind in salesKind) {
    need(c, 'finance.view')
    const { data: d } = await sb.from('invoices').select('id,doc_type,number,status,customer_id,customer_name,customer_phone,total,due_date,valid_until').eq('id', recordId).maybeSingle()
    if (!d) fail('Document not found.')
    if (d!.doc_type !== salesKind[kind]) fail('This message does not fit this document.')
    if (d!.status === 'draft' && kind !== 'quotation' && kind !== 'invoice' && kind !== 'delivery_note') fail('Send the document first.')
    const { data: cu } = d!.customer_id ? await sb.from('customers').select('id,name,phone,whatsapp').eq('id', d!.customer_id).maybeSingle() : { data: null }
    let amount = formatAed(Number(d!.total))
    if (kind === 'payment_reminder') { const { data: b } = await sb.from('invoice_balances').select('balance').eq('id', d!.id).maybeSingle(); amount = formatAed(Number(b?.balance ?? d!.total)); if (Number(b?.balance ?? 0) <= 0.004) fail('This invoice is fully paid.') }
    return {
      kind, recordType: 'invoice', recordId, link: `/invoices/${d!.id}`,
      party: { type: 'customer', id: cu?.id ?? d!.customer_id ?? d!.id, name: cu?.name ?? d!.customer_name ?? 'Customer' },
      phone: phoneOf(cu?.whatsapp, cu?.phone, d!.customer_phone),
      values: { customer: cu?.name ?? d!.customer_name ?? 'Customer', number: d!.number, amount, due_date: d!.due_date ? formatShortDate(d!.due_date) : 'on receipt', valid_until: d!.valid_until ? formatShortDate(d!.valid_until) : '30 days', company },
      pdf: async () => { const r = await buildSalesPdf(c, d!.id); if (!r) fail('Could not create the PDF.'); return { bytes: r!.bytes, filename: r!.name } },
    }
  }
  if (kind === 'receipt') {
    need(c, 'finance.view')
    const { data: p } = await sb.from('payments').select('id,amount,paid_on,method,reference,customer_id,invoice:invoices(id,number,customer_id,customer_name,total)').eq('id', recordId).maybeSingle()
    if (!p) fail('Payment not found.')
    const inv: any = (p as any).invoice, custId = p!.customer_id ?? inv?.customer_id
    const { data: cu } = custId ? await sb.from('customers').select('id,name,phone,whatsapp,address,trn').eq('id', custId).maybeSingle() : { data: null }
    if (!cu) fail('This payment has no customer.')
    const ref = inv?.number ?? p!.reference ?? 'on account'
    return {
      kind, recordType: 'payment', recordId, link: inv ? `/invoices/${inv.id}` : `/parties/${cu!.id}`,
      party: { type: 'customer', id: cu!.id, name: cu!.name }, phone: phoneOf(cu!.whatsapp, cu!.phone),
      values: { customer: cu!.name, amount: formatAed(Number(p!.amount)), date: formatShortDate(p!.paid_on), reference: ref, company },
      pdf: async () => {
        const [b, images] = await Promise.all([brandingFor(c), brandingBytes(c)])
        const bytes = await renderSimplePdf({ title: 'Payment receipt', companyName: company, images, showHeaderFooter: b.showHeaderFooter, companyTrn: b.companyTrn, companyAddress: b.companyAddress, companyPhone: b.companyPhone, companyEmail: b.companyEmail,
          left: [['Received from:', cu!.name], ...(cu!.trn ? [['TRN:', cu!.trn] as [string, string]] : []), ...(cu!.address ? [['Address:', cu!.address] as [string, string]] : [])],
          right: [['Date:', formatShortDate(p!.paid_on)], ['Receipt for:', ref], ['Method:', String(p!.method ?? 'other').replace('_', ' ')]],
          table: { cols: [{ h: 'Description', w: 4 }, { h: 'Amount (AED)', w: 1.4, right: true }], rows: [[inv ? `Payment against invoice ${inv.number}` : 'Payment on account', fmtMoney(p!.amount)]], total: ['Total received', fmtMoney(p!.amount)] },
          words: `Amount in words: ${amountInWords(Number(p!.amount))}`, signLine: 'Authorised signature' })
        return { bytes, filename: `Receipt_${safePart(cu!.name)}_${p!.paid_on}.pdf` }
      },
    }
  }
  if (kind === 'payslip') {
    need(c, 'salary.view')
    const { data: s } = await sb.from('salary_payments').select('id,period,amount,paid_on,method,employee:employees(id,full_name,employee_no,designation,phone)').eq('id', recordId).maybeSingle()
    if (!s) fail('Salary payment not found.')
    const e: any = (s as any).employee
    const { data: adv } = await sb.from('employee_advances').select('kind,amount,given_on').eq('employee_id', e.id).gte('given_on', monthStart(s!.period)).lt('given_on', monthStart(s!.period, 1))
    const ded = (adv ?? []).filter((a: any) => a.kind === 'deduction')
    return {
      kind, recordType: 'salary_payment', recordId, link: `/employees/${e.id}?tab=salary`,
      party: { type: 'employee', id: e.id, name: e.full_name }, phone: phoneOf(e.phone),
      values: { employee: e.full_name, period: monthLabel(s!.period), company },   // no amounts in the message text
      pdf: async () => {
        const [b, images] = await Promise.all([brandingFor(c), brandingBytes(c)])
        const rows = [[`Salary for ${monthLabel(s!.period)}`, fmtMoney(s!.amount)], ...ded.map((d: any) => [`Deduction (${formatShortDate(d.given_on)})`, `- ${fmtMoney(d.amount)}`])]
        const net = Number(s!.amount) - ded.reduce((a: number, d: any) => a + Number(d.amount), 0)
        const bytes = await renderSimplePdf({ title: 'Salary payslip', companyName: company, images, showHeaderFooter: b.showHeaderFooter, companyAddress: b.companyAddress, companyPhone: b.companyPhone, companyEmail: b.companyEmail,
          left: [['Employee:', e.full_name], ['Employee ID:', e.employee_no], ...(e.designation ? [['Designation:', e.designation] as [string, string]] : [])],
          right: [['Period:', monthLabel(s!.period)], ['Paid on:', s!.paid_on ? formatShortDate(s!.paid_on) : '-'], ['Paid by:', String(s!.method ?? '-').replace('_', ' ').toUpperCase()]],
          table: { cols: [{ h: 'Description', w: 4 }, { h: 'Amount (AED)', w: 1.4, right: true }], rows, total: ['Net paid', fmtMoney(net)] }, signLine: 'Authorised signature' })
        return { bytes, filename: `Payslip_${safePart(e.full_name)}_${s!.period.slice(0, 7)}.pdf` }
      },
    }
  }
  if (kind === 'statement') {
    need(c, 'finance.view')
    const { data: cu } = await sb.from('customers').select('id,name,address,trn,phone,whatsapp,email,contact_person').eq('id', recordId).maybeSingle()
    if (!cu) fail('Customer not found.')
    const ledger = await buildLedger(c, cu!.id, {})
    return {
      kind, recordType: 'customer', recordId, link: `/parties/${cu!.id}`, party: { type: 'customer', id: cu!.id, name: cu!.name }, phone: phoneOf(cu!.whatsapp, cu!.phone),
      values: { customer: cu!.name, date: formatShortDate(c.today), balance: formatAed(ledger.closing), company },
      pdf: async () => {
        const [b, images] = await Promise.all([brandingFor(c), brandingBytes(c)])
        const bytes = await renderStatementPdf(cu as any, ledger, { companyName: company, images, showHeaderFooter: b.showHeaderFooter, companyTrn: b.companyTrn, bankDetails: b.bankDetails, today: c.today, companyAddress: b.companyAddress, companyPhone: b.companyPhone, companyEmail: b.companyEmail })
        return { bytes, filename: `Statement_${safePart(cu!.name)}_${c.today}.pdf` }
      },
    }
  }
  if (kind === 'document_expiry') {
    need(c, 'employees.view_sensitive')
    const { data: d } = await sb.from('documents').select('id,name,expiry_date,owner_type,owner_id,category:document_categories(name)').eq('id', recordId).maybeSingle()
    if (!d || d.owner_type !== 'employee' || !d.expiry_date) fail('Only employee documents with an expiry date can be sent as a reminder.')
    const { data: e } = await sb.from('employees').select('id,full_name,phone').eq('id', d!.owner_id).maybeSingle()
    if (!e) fail('Employee not found.')
    const docName = String((d as any).category?.name ?? d!.name).replace(new RegExp(`\\s*[-–]\\s*${e!.full_name}`, 'i'), '')
    return { kind, recordType: 'document', recordId, link: `/employees/${e!.id}?tab=documents`, party: { type: 'employee', id: e!.id, name: e!.full_name }, phone: phoneOf(e!.phone),
      values: { employee: e!.full_name, document: docName, expiry_date: formatShortDate(d!.expiry_date!), company } }   // document name only, never its number or a scan
  }
  if (kind === 'cheque_reminder') {
    need(c, 'finance.view')
    const { data: q } = await sb.from('cheques').select('id,cheque_no,direction,amount,cheque_date,status,party_name,customer_id,supplier_id').eq('id', recordId).maybeSingle()
    if (!q) fail('Cheque not found.')
    const isCust = !!q!.customer_id
    const { data: p } = isCust ? await sb.from('customers').select('id,name,phone,whatsapp').eq('id', q!.customer_id).maybeSingle() : q!.supplier_id ? await sb.from('suppliers').select('id,name,phone,whatsapp').eq('id', q!.supplier_id).maybeSingle() : { data: null }
    if (!p) fail('Link the cheque to a customer or supplier first.')
    return { kind, recordType: 'cheque', recordId, link: `/cheques?q=${encodeURIComponent(q!.cheque_no)}`, party: { type: isCust ? 'customer' : 'supplier', id: p!.id, name: p!.name }, phone: phoneOf(p!.whatsapp, p!.phone),
      values: { customer: p!.name, cheque: `ending ${String(q!.cheque_no).slice(-4)}`, amount: formatAed(Number(q!.amount)), date: formatShortDate(q!.cheque_date), company } }
  }
  if (kind === 'project_update') {
    need(c, 'records.edit')
    const { data: pr } = await sb.from('projects').select('id,name,code,status,fabrication_progress,site_progress,customer:customers(id,name,phone,whatsapp)').eq('id', recordId).maybeSingle()
    if (!pr) fail('Project not found.')
    const cu: any = (pr as any).customer; if (!cu) fail('Link the project to a customer first.')
    return { kind, recordType: 'project', recordId, link: `/projects/${pr!.id}`, party: { type: 'customer', id: cu.id, name: cu.name }, phone: phoneOf(cu.whatsapp, cu.phone),
      values: { customer: cu.name, project: pr!.name, progress: `${pr!.fabrication_progress}% / ${pr!.site_progress}%`, status: String(pr!.status).replace('_', ' ').replace(/^./, m => m.toUpperCase()), company } }
  }
  return fail('Unknown message type.')
}

export interface WaTemplate { body: string; language: string; submitted?: { body: string; at: string }; meta?: { id: string; status: string; reason?: string } }
export async function loadTemplates(sb: SupabaseClient, companyId: string): Promise<Record<string, WaTemplate>> {
  const { data } = await sb.from('app_settings').select('key,value').eq('company_id', companyId).like('key', 'whatsapp.template.%')
  const saved = Object.fromEntries((data ?? []).map(r => [r.key.slice('whatsapp.template.'.length), r.value]))
  return Object.fromEntries(Object.entries(KINDS).map(([k, d]) => {
    const s = saved[k] && typeof saved[k] === 'object' ? saved[k] as any : {}
    return [k, { body: typeof s.body === 'string' ? s.body : d.body, language: typeof s.language === 'string' ? s.language : 'en', submitted: s.submitted, meta: s.meta }]
  }))
}

export async function companyWhatsApp(companyId: string) {
  const admin = createAdminClient()
  const { data } = await admin.from('app_settings').select('key,value').eq('company_id', companyId)
  const s = parseSettings(data ?? []), cfg = await loadWhatsAppConfig(admin, companyId, s)
  const raw = Object.fromEntries((data ?? []).map(r => [r.key, r.value]))
  return { admin, cfg, live: isConfigured(cfg), wabaId: s.wabaId, appId: typeof raw['whatsapp.app_id'] === 'string' ? raw['whatsapp.app_id'] as string : null }
}

/** Everything the send dialog shows before anything leaves Averiqo. */
export async function prepare(c: Ctx, kind: string, recordId: string) {
  const r = await resolveMessage(c, kind, recordId)
  const [tpls, wa] = await Promise.all([loadTemplates(c.supabase, c.company.id), companyWhatsApp(c.company.id)])
  const t = tpls[kind], body = wa.live ? t.submitted?.body ?? t.body : t.body
  const contact = r.phone ? (await wa.admin.from('whatsapp_contacts').select('last_inbound_at,opted_out_at').eq('company_id', c.company.id).eq('phone', r.phone).maybeSingle()).data : null
  const windowOpen = !!contact?.last_inbound_at && Date.now() - new Date(contact.last_inbound_at).getTime() < WINDOW_MS
  const approved = t.meta?.status === 'APPROVED'
  return {
    kind, label: KINDS[kind].label, party: r.party, phone: r.phone, preview: fill(kind, body, r.values), attachment: KINDS[kind].pdf, mode: wa.live ? 'live' as const : 'sandbox' as const,
    templateReady: !wa.live || approved, templateStatus: wa.live ? (t.meta?.status ?? 'NOT_SUBMITTED') : 'SANDBOX', windowOpen, optedOut: !!contact?.opted_out_at,
  }
}

/** Queues the message (notification_logs) with its PDF in private storage, then sends it right away through the dispatcher. */
export async function queueAndSend(c: Ctx, kind: string, recordId: string, toRaw: string, freeText?: string) {
  const r = await resolveMessage(c, kind, recordId)
  const to = toE164(toRaw); if (!to) fail('Enter a valid mobile number with country code, e.g. +971 50 123 4567.')
  const p = await prepare(c, kind, recordId)
  const contact = (await createAdminClient().from('whatsapp_contacts').select('opted_out_at,last_inbound_at').eq('company_id', c.company.id).eq('phone', to).maybeSingle()).data
  if (contact?.opted_out_at) fail('This number replied STOP and has opted out of WhatsApp messages.')
  const windowOpen = !!contact?.last_inbound_at && Date.now() - new Date(contact.last_inbound_at).getTime() < WINDOW_MS
  const useFree = freeText !== undefined && freeText.trim() !== ''
  if (useFree && !windowOpen) fail('A custom message can only be sent within 24 hours of the customer’s last WhatsApp message. Use the template instead.')
  if (!useFree && !p.templateReady) fail(`The “${p.label}” template is not approved by WhatsApp yet (${p.templateStatus.replace('_', ' ').toLowerCase()}). Submit it under Settings → WhatsApp, or send a custom message while the 24-hour window is open.`)
  const tpls = await loadTemplates(c.supabase, c.company.id), wa = await companyWhatsApp(c.company.id)
  const body = wa.live ? tpls[kind].submitted?.body ?? tpls[kind].body : tpls[kind].body
  const order = placeholders(kind, body), values = Object.fromEntries(Object.entries(r.values).map(([k, v]) => [k, safeValue(v)]))
  const text = useFree ? safeFreeText(freeText!) : fill(kind, body, r.values)
  const id = randomUUID(), admin = wa.admin
  let attachment_path: string | null = null, attachment_name: string | null = null
  if (r.pdf) {
    const f = await r.pdf(); attachment_name = f.filename.slice(0, 200); attachment_path = `${c.company.id}/whatsapp/${id}.pdf`
    const { error } = await admin.storage.from('vault').upload(attachment_path, f.bytes, { contentType: 'application/pdf', upsert: false })
    if (error) fail(`Could not store the PDF: ${error.message}`)
  }
  const { error } = await admin.from('notification_logs').insert({
    id, company_id: c.company.id, recipient_id: null, channel: 'whatsapp', template: `wa_${kind}`, params: { ...values, _order: order, _language: tpls[kind].language, _title: `${KINDS[kind].label} to ${r.party.name}`, _link: r.link },
    dedupe_key: `wa:${kind}:${recordId}:${id}`, source_type: 'whatsapp', source_id: recordId, to_number: to, party_type: r.party.type, party_id: r.party.id, kind, record_type: r.recordType, record_id: recordId,
    body_text: text.slice(0, 1100), attachment_path, attachment_name, freeform: useFree, sent_by: c.userId, max_attempts: 4,
  })
  if (error) throw error
  const { processBatch } = await import('../reminders/dispatch')
  const { makeSenders, supabaseStore } = await import('../reminders/engine')
  await processBatch(supabaseStore(admin), makeSenders(admin), { tz: c.company.timezone, emailFallback: false, batch: 20 })
  const { data: after } = await admin.from('notification_logs').select('id,status,last_error,sandbox').eq('id', id).single()
  return after!
}

/** Dispatcher hook for a message to a customer / employee number: upload the stored PDF, then send (template or in-window). */
export async function deliverParty(admin: Admin, log: { company_id: string; to_number: string; kind: string; params: any; body_text: string | null; attachment_path: string | null; attachment_name: string | null; freeform: boolean }): Promise<SendResult> {
  const { cfg, live } = await companyWhatsApp(log.company_id)
  const { data: ct } = await admin.from('whatsapp_contacts').select('opted_out_at').eq('company_id', log.company_id).eq('phone', log.to_number).maybeSingle()
  if (ct?.opted_out_at) return { ok: false, retryable: false, error: 'The number has opted out (replied STOP).' }
  if (!live) return { ok: true, sandbox: true }
  let doc: { id: string; filename: string } | undefined
  if (log.attachment_path) {
    const { data: blob, error } = await admin.storage.from('vault').download(log.attachment_path)
    if (error || !blob) return { ok: false, retryable: true, error: `PDF not available: ${error?.message ?? 'missing'}` }
    const up = await uploadMedia(cfg, new Uint8Array(await blob.arrayBuffer()), log.attachment_name ?? 'document.pdf')
    if ('error' in up) return { ok: false, retryable: up.retryable, error: up.error }
    doc = { id: up.id, filename: log.attachment_name ?? 'document.pdf' }
  }
  const p = log.params ?? {}
  return sendMessage(cfg, { to: log.to_number, kind: log.kind, language: p._language ?? 'en', order: Array.isArray(p._order) ? p._order : [], values: p, doc, freeText: log.freeform ? (log.body_text ?? '') : undefined })
}
