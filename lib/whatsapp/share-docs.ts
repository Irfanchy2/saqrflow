import 'server-only'
import type { Ctx } from '../auth'
import { toE164 } from '../phone'
import { formatAed, formatShortDate } from '../time'
import { loadPayslip } from '../salary-docs'
import { movements, salaryAccount, statementRange } from '../salary'
import { safePart, salesPdfName } from '../sales/filename'
import type { SalesType } from '../sales/docs'
import { SendError, resolveMessage } from './outbox'
import { SHARE, type ShareKind } from './share'

// One resolver per document type for the free "Share via WhatsApp" sheet: who receives it (the record's own employee or
// customer, never a free choice), which number, which PDF endpoint (the same one Download uses, so the file shared is the
// file downloaded, under the same name) and the values its message may use. Reads go through the caller's own session,
// so RLS keeps every lookup inside the company and inside the caller's permissions.

export type ShareParty = { type: 'employee' | 'customer'; id: string; name: string; code: string | null }
export type ShareDoc = {
  docLabel: string; docDetail: string; pdfUrl: string; filename: string; party: ShareParty
  phone: string | null; phoneSource: 'whatsapp' | 'phone' | null; storedInvalid: string | null; canSaveNumber: boolean; portalLink: boolean
  values: Record<string, string>
}
export class ShareDocError extends Error {}

export const firstPhone = (...xs: (string | null | undefined)[]) => { for (const x of xs) { const e = x ? toE164(x) : null; if (e) return e } return null }
const SALES: Partial<Record<ShareKind, SalesType>> = { quotation: 'quotation', invoice: 'invoice', delivery_note: 'delivery_note', payment_reminder: 'invoice' }

/** Employee recipient: WhatsApp number, else the contact number; a stored number that is not valid is shown for correction. */
function employeeTo(c: Ctx, e: { id: string; full_name: string; employee_no: string; phone?: string | null; whatsapp?: string | null; user_id?: string | null }) {
  const phone = firstPhone(e.whatsapp, e.phone)
  return {
    party: { type: 'employee' as const, id: e.id, name: e.full_name, code: e.employee_no }, phone,
    phoneSource: firstPhone(e.whatsapp) ? 'whatsapp' as const : firstPhone(e.phone) ? 'phone' as const : null,
    storedInvalid: !phone && (e.whatsapp || e.phone) ? (e.whatsapp || e.phone) ?? null : null,
    canSaveNumber: c.can('records.edit') && c.can('employees.view_sensitive'), portalLink: !!e.user_id,
  }
}
/** Customer recipient: the customer's WhatsApp number, else their phone, else the phone typed on the document. */
async function customerTo(c: Ctx, customerId: string | null, fallback: { name?: string | null; phone?: string | null; id: string }) {
  const { data: cu } = customerId ? await c.supabase.from('customers').select('id,name,phone,whatsapp').eq('id', customerId).maybeSingle() : { data: null }
  const phone = firstPhone(cu?.whatsapp, cu?.phone, fallback.phone)
  return {
    party: { type: 'customer' as const, id: cu?.id ?? customerId ?? fallback.id, name: cu?.name ?? fallback.name ?? 'Customer', code: null }, phone,
    phoneSource: firstPhone(cu?.whatsapp) ? 'whatsapp' as const : firstPhone(cu?.phone, fallback.phone) ? 'phone' as const : null,
    storedInvalid: null, canSaveNumber: !!cu && c.can('records.edit'), portalLink: false,
  }
}

const RESOLVE: Record<ShareKind, (c: Ctx, id: string) => Promise<ShareDoc>> = {
  async payslip(c, id) {
    const p = await loadPayslip(c, id)
    if (!p) throw new ShareDocError('This payslip is not available. Post the salary month first.')
    const e = p.employee, { data: link } = await c.supabase.from('employees').select('user_id').eq('id', e.id).maybeSingle()
    return { docLabel: `Payslip · ${p.monthLabel}`, docDetail: `${e.employee_no} · ${p.monthLabel}`, pdfUrl: `/api/salary-payslips/${id}`, filename: p.filename,
      ...employeeTo(c, { ...e, user_id: link?.user_id }), values: { employee: e.full_name, period: p.monthLabel } }
  },
  async salary_receipt(c, id) {
    const { data: s } = await c.supabase.from('salary_payments').select('id,period,amount,paid_on,reference,status,employee:employees(id,full_name,employee_no,phone,whatsapp,user_id)').eq('id', id).maybeSingle()
    if (!s) throw new ShareDocError('Salary payment not found.')
    if (s.status !== 'posted') throw new ShareDocError('This payment was reversed. Share the corrected payment instead.')
    const e: any = (s as any).employee, day = s.paid_on ?? s.period
    return { docLabel: `Salary receipt SR-${s.id.slice(0, 8).toUpperCase()}`, docDetail: `${e.employee_no} · paid ${formatShortDate(day)}`, pdfUrl: `/api/payslips/${s.id}`,
      filename: `Salary_receipt_${safePart(e.full_name)}_${day.slice(0, 10)}.pdf`, ...employeeTo(c, e),
      values: { employee: e.full_name, amount: formatAed(Number(s.amount)), date: formatShortDate(day), reference: s.reference ?? '-' } }
  },
  async salary_statement(c, id) {
    // id = the employee; the statement covers the default period (first entry to today), the same one Download gives
    const a = await salaryAccount(c, id)
    if (!a) throw new ShareDocError('Employee not found.')
    const { data: e } = await c.supabase.from('employees').select('id,full_name,employee_no,phone,whatsapp,user_id').eq('id', id).maybeSingle()
    if (!e) throw new ShareDocError('Employee not found.')
    const r = statementRange(movements(a), c.today)
    return { docLabel: 'Salary statement', docDetail: `${e.employee_no} · ${formatShortDate(r.from)} to ${formatShortDate(r.to)}`, pdfUrl: `/api/salary-statements/${id}`,
      filename: `Salary_statement_${safePart(e.full_name)}_${r.from}_${r.to}.pdf`, ...employeeTo(c, e),
      values: { employee: e.full_name, from: formatShortDate(r.from), to: formatShortDate(r.to) } }
  },
  quotation: (c, id) => salesDoc(c, 'quotation', id),
  invoice: (c, id) => salesDoc(c, 'invoice', id),
  delivery_note: (c, id) => salesDoc(c, 'delivery_note', id),
  payment_reminder: (c, id) => salesDoc(c, 'payment_reminder', id),
  async customer_receipt(c, id) {
    // the receipt WhatsApp Business attaches (lib/whatsapp/outbox.ts, kind "receipt"), served by /api/payment-receipts
    const r = await resolveMessage(c, 'receipt', id).catch(e => { throw e instanceof SendError ? new ShareDocError(e.message) : e })
    const { data: p } = await c.supabase.from('payments').select('paid_on').eq('id', id).maybeSingle()
    return { docLabel: `Payment receipt · ${r.values.amount}`, docDetail: `Received ${r.values.date} · ${r.values.reference}`, pdfUrl: `/api/payment-receipts/${id}`,
      filename: `Receipt_${safePart(r.party.name)}_${p?.paid_on}.pdf`, ...(await customerTo(c, r.party.id, { id: r.party.id, name: r.party.name })), values: r.values }
  },
  async customer_statement(c, id) {
    // id = the customer; the statement of account up to today (the same as the customer page's Download)
    const r = await resolveMessage(c, 'statement', id).catch(e => { throw e instanceof SendError ? new ShareDocError(e.message) : e })
    return { docLabel: 'Statement of account', docDetail: `As of ${r.values.date} · balance ${r.values.balance}`, pdfUrl: `/api/statements/${id}`,
      filename: `Statement_${safePart(r.party.name) || 'customer'}_${c.today}.pdf`, ...(await customerTo(c, id, { id, name: r.party.name })), values: r.values }
  },
  async employee_document(c, id) {
    // a PDF in the employee's own file (passport, visa, contract…), shared with that employee only
    const { data: d } = await c.supabase.from('documents').select('id,name,owner_type,owner_id,expiry_date,current_version_id,category:document_categories(name)').eq('id', id).is('deleted_at', null).maybeSingle()
    if (!d || d.owner_type !== 'employee' || !d.owner_id) throw new ShareDocError('Only documents in an employee\'s file can be shared with them.')
    const { data: v } = d.current_version_id ? await c.supabase.from('document_versions').select('file_name,mime_type').eq('id', d.current_version_id).maybeSingle() : { data: null }
    if (!v) throw new ShareDocError('This document has no file attached.')
    if (v.mime_type !== 'application/pdf') throw new ShareDocError('Only PDF files can be shared on WhatsApp from here. Download the file to send it.')
    const { data: e } = await c.supabase.from('employees').select('id,full_name,employee_no,phone,whatsapp,user_id').eq('id', d.owner_id).maybeSingle()
    if (!e) throw new ShareDocError('Employee not found.')
    const title = (d.category as unknown as { name?: string } | null)?.name ?? d.name
    return { docLabel: title, docDetail: `${e.employee_no} · ${d.expiry_date ? `expires ${formatShortDate(d.expiry_date)}` : d.name}`, pdfUrl: `/api/documents/${id}/download?mode=preview`,
      filename: /\.pdf$/i.test(v.file_name) ? v.file_name : `${v.file_name}.pdf`, ...employeeTo(c, e), portalLink: false,
      values: { employee: e.full_name, document: title === d.name ? title : `${title} (${d.name})`, expiry: d.expiry_date ? formatShortDate(d.expiry_date) : '-' } }
  },
}

async function salesDoc(c: Ctx, kind: ShareKind, id: string): Promise<ShareDoc> {
  const { data: d } = await c.supabase.from('invoices').select('id,doc_type,number,revision,status,customer_id,customer_name,customer_phone,total,due_date,valid_until,project:projects(name)').eq('id', id).maybeSingle()
  if (!d || d.doc_type !== SALES[kind]) throw new ShareDocError('Document not found.')
  const { data: bal } = kind === 'payment_reminder' ? await c.supabase.from('invoice_balances').select('balance').eq('id', d.id).maybeSingle() : { data: null }
  const label = SHARE[kind].label, to = await customerTo(c, d.customer_id, { id: d.id, name: d.customer_name, phone: d.customer_phone })
  return { docLabel: `${kind === 'payment_reminder' ? 'Tax invoice' : label} ${d.number}`, docDetail: kind === 'payment_reminder' ? 'Payment reminder' : label, pdfUrl: `/api/sales/${d.id}/pdf`,
    // the same name the PDF downloads with, so "attach <file>" points at the file that is really in Downloads
    filename: salesPdfName({ doc_type: d.doc_type as SalesType, number: d.number, revision: d.revision, customer_name: d.customer_name, project_name: (d.project as unknown as { name?: string } | null)?.name ?? null }),
    ...to, values: { customer: to.party.name, number: d.number, amount: formatAed(Number(d.total)), due_date: d.due_date ? formatShortDate(d.due_date) : 'on receipt',
      valid_until: d.valid_until ? formatShortDate(d.valid_until) : '30 days', balance: formatAed(Number(bal?.balance ?? d.total)) } }
}

/** The document, recipient and message values for one share. Permission is checked by the caller (sharePerms). */
export async function resolveShareDoc(c: Ctx, kind: ShareKind, id: string): Promise<ShareDoc> {
  const doc = await RESOLVE[kind](c, id)
  return { ...doc, values: { ...doc.values, company: c.company.name } }
}
