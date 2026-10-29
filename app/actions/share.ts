'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getCtx, need } from '@/lib/auth'
import { safe, str } from '@/lib/action'
import { toE164 } from '@/lib/phone'
import { formatAed, formatShortDate } from '@/lib/time'
import { loadPayslip } from '@/lib/salary-docs'
import { safePart, salesPdfName } from '@/lib/sales/filename'
import type { SalesType } from '@/lib/sales/docs'
import { SHARE, fillShare, isShareKind, shareBodyProblems, shareSettingKey, type ShareKind } from '@/lib/whatsapp/share'
import type { Ctx } from '@/lib/auth'
import type { ActionState } from '@/lib/utils'

// "Share via WhatsApp" (free): Averiqo prepares the right recipient, document and message; the user's own WhatsApp sends
// it. Nothing here sends a message or marks anything as delivered.
const SALES: Record<string, string> = { quotation: 'quotation', invoice: 'invoice', delivery_note: 'delivery_note', payment_reminder: 'invoice' }
const uuid = z.string().uuid()
const first = (...xs: (string | null | undefined)[]) => { for (const x of xs) { const e = x ? toE164(x) : null; if (e) return e } return null }
const salaryKind = (k: ShareKind) => k === 'payslip' || k === 'salary_receipt'

export type SharePrep = {
  kind: ShareKind; recordId: string; docLabel: string; docDetail: string; pdfUrl: string; filename: string; message: string
  party: { type: 'employee' | 'customer'; id: string; name: string; code: string | null }
  phone: string | null; phoneSource: 'whatsapp' | 'phone' | null; storedInvalid: string | null; canSaveNumber: boolean
  sameNumberAs: string[]; lastShare: { count: number; at: string | null; by: string | null }; portalLink: boolean
}

async function template(c: Ctx, kind: ShareKind) {
  const { data } = await c.supabase.from('app_settings').select('value').eq('key', shareSettingKey(kind)).maybeSingle()
  const body = (data?.value as any)?.body
  return typeof body === 'string' && body.trim() ? body : SHARE[kind].body
}
/** Other employees saved with the same WhatsApp / contact number (a payslip must never reach the wrong person). */
async function sameNumber(c: Ctx, employeeId: string, e164: string | null) {
  if (!e164) return []
  const { data } = await c.supabase.from('employees').select('id,full_name,phone,whatsapp').is('deleted_at', null).neq('id', employeeId).limit(2000)
  return (data ?? []).filter(o => first(o.whatsapp) === e164 || first(o.phone) === e164).map(o => o.full_name as string)
}

/** Who, which number, which PDF and which message: for the sharing sheet. */
export async function prepareShare(kind: string, recordId: string): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx()
    if (!isShareKind(kind) || !uuid.safeParse(recordId).success) return { error: 'Unknown document.' }
    need(c, salaryKind(kind) ? 'salary.view' : 'finance.view')
    const company = c.company.name, sb = c.supabase
    let prep: Omit<SharePrep, 'message' | 'lastShare' | 'sameNumberAs'>, values: Record<string, string>
    if (kind === 'payslip') {
      const p = await loadPayslip(c, recordId)
      if (!p) return { error: 'This payslip is not available. Post the salary month first.' }
      const e = p.employee, { data: link } = await sb.from('employees').select('user_id').eq('id', e.id).maybeSingle()
      prep = { kind, recordId, docLabel: `Payslip · ${p.monthLabel}`, docDetail: `${e.employee_no} · ${p.monthLabel}`, pdfUrl: `/api/salary-payslips/${recordId}`, filename: p.filename,
        party: { type: 'employee', id: e.id, name: e.full_name, code: e.employee_no }, phone: first(e.whatsapp, e.phone), phoneSource: first(e.whatsapp) ? 'whatsapp' : first(e.phone) ? 'phone' : null,
        storedInvalid: !first(e.whatsapp, e.phone) && (e.whatsapp || e.phone) ? (e.whatsapp || e.phone) : null, canSaveNumber: c.can('records.edit') && c.can('employees.view_sensitive'), portalLink: !!link?.user_id }
      values = { employee: e.full_name, period: p.monthLabel, company }
    } else if (kind === 'salary_receipt') {
      const { data: s } = await sb.from('salary_payments').select('id,period,amount,paid_on,reference,status,employee:employees(id,full_name,employee_no,phone,whatsapp,user_id)').eq('id', recordId).maybeSingle()
      if (!s) return { error: 'Salary payment not found.' }
      if (s.status !== 'posted') return { error: 'This payment was reversed. Share the corrected payment instead.' }
      const e: any = (s as any).employee, day = s.paid_on ?? s.period
      prep = { kind, recordId, docLabel: `Salary receipt SR-${s.id.slice(0, 8).toUpperCase()}`, docDetail: `${e.employee_no} · paid ${formatShortDate(day)}`, pdfUrl: `/api/payslips/${s.id}`,
        filename: `Salary_receipt_${safePart(e.full_name)}_${day.slice(0, 10)}.pdf`,
        party: { type: 'employee', id: e.id, name: e.full_name, code: e.employee_no }, phone: first(e.whatsapp, e.phone), phoneSource: first(e.whatsapp) ? 'whatsapp' : first(e.phone) ? 'phone' : null,
        storedInvalid: !first(e.whatsapp, e.phone) && (e.whatsapp || e.phone) ? (e.whatsapp || e.phone) : null, canSaveNumber: c.can('records.edit') && c.can('employees.view_sensitive'), portalLink: !!e.user_id }
      values = { employee: e.full_name, amount: formatAed(Number(s.amount)), date: formatShortDate(day), reference: s.reference ?? '-', company }
    } else {
      const { data: d } = await sb.from('invoices').select('id,doc_type,number,revision,status,customer_id,customer_name,customer_phone,total,due_date,valid_until,project:projects(name)').eq('id', recordId).maybeSingle()
      if (!d || d.doc_type !== SALES[kind]) return { error: 'Document not found.' }
      const { data: cu } = d.customer_id ? await sb.from('customers').select('id,name,phone,whatsapp').eq('id', d.customer_id).maybeSingle() : { data: null }
      const { data: bal } = kind === 'payment_reminder' ? await sb.from('invoice_balances').select('balance').eq('id', d.id).maybeSingle() : { data: null }
      const label = SHARE[kind].label
      prep = { kind, recordId, docLabel: `${kind === 'payment_reminder' ? 'Tax invoice' : label} ${d.number}`, docDetail: kind === 'payment_reminder' ? 'Payment reminder' : label, pdfUrl: `/api/sales/${d.id}/pdf`,
        // the same name the PDF downloads with, so "attach <file>" points at the file that is really in Downloads
        filename: salesPdfName({ doc_type: d.doc_type as SalesType, number: d.number, revision: d.revision, customer_name: d.customer_name, project_name: (d.project as unknown as { name?: string } | null)?.name ?? null }),
        party: { type: 'customer', id: cu?.id ?? d.customer_id ?? d.id, name: cu?.name ?? d.customer_name ?? 'Customer', code: null },
        phone: first(cu?.whatsapp, cu?.phone, d.customer_phone), phoneSource: first(cu?.whatsapp) ? 'whatsapp' : first(cu?.phone, d.customer_phone) ? 'phone' : null,
        storedInvalid: null, canSaveNumber: !!cu && c.can('records.edit'), portalLink: false }
      values = { customer: prep.party.name, number: d.number, amount: formatAed(Number(d.total)), due_date: d.due_date ? formatShortDate(d.due_date) : 'on receipt',
        valid_until: d.valid_until ? formatShortDate(d.valid_until) : '30 days', balance: formatAed(Number(bal?.balance ?? d.total)), company }
    }
    const [body, { data: shares }] = await Promise.all([template(c, kind),
      sb.from('document_shares').select('created_at,user_id').eq('doc_kind', kind).eq('record_id', recordId).order('created_at', { ascending: false }).limit(50)])
    const lastBy = shares?.[0]?.user_id ? (await sb.from('profiles').select('full_name').eq('id', shares[0].user_id).maybeSingle()).data?.full_name ?? null : null
    const data: SharePrep = { ...prep, message: fillShare(kind, body, values), sameNumberAs: prep.party.type === 'employee' ? await sameNumber(c, prep.party.id, prep.phone) : [],
      lastShare: { count: shares?.length ?? 0, at: shares?.[0]?.created_at ?? null, by: lastBy } }
    return { ok: true, data }
  })
}

/** Check a number typed in the sheet: valid international format, and not saved for another employee. */
export async function checkShareNumber(employeeId: string | null, raw: string): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); if (!c.can('salary.view') && !c.can('finance.view')) return { error: 'Not allowed.' }
    const e = toE164(raw ?? '')
    if (!e) return { error: 'Enter a valid WhatsApp number with country code, e.g. +971 50 123 4567.' }
    return { ok: true, data: { phone: e, sameNumberAs: employeeId && uuid.safeParse(employeeId).success ? await sameNumber(c, employeeId, e) : [] } }
  })
}

/** Save a corrected WhatsApp number to the employee's (or customer's) profile: only when the user asks, and only with edit rights. */
export async function saveShareNumber(party: 'employee' | 'customer', id: string, raw: string): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.edit'); if (party === 'employee') need(c, 'employees.view_sensitive')
    if (!uuid.safeParse(id).success) return { error: 'Unknown record.' }
    const e = toE164(raw ?? ''); if (!e) return { error: 'Enter a valid WhatsApp number with country code, e.g. +971 50 123 4567.' }
    const { data, error } = await c.supabase.from(party === 'employee' ? 'employees' : 'customers').update({ whatsapp: e }).eq('id', id).select('id')
    if (error) throw error
    if (!data?.length) return { error: 'You cannot change this profile.' }
    revalidatePath(party === 'employee' ? `/employees/${id}` : `/parties/${id}`)
    return { ok: true, message: 'WhatsApp number saved to the profile.', data: { phone: e } }
  })
}

/** Record that WhatsApp (or the share sheet) was opened for a document: intent only, never "sent". Keeps the last 4 digits. */
export async function logShare(kind: string, recordId: string, method: string, partyId: string | null, phone: string | null): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx()
    if (!isShareKind(kind) || !uuid.safeParse(recordId).success || !['native_share', 'whatsapp_link', 'download'].includes(method)) return { error: 'Unknown share.' }
    need(c, salaryKind(kind) ? 'salary.view' : 'finance.view')
    const { error } = await c.supabase.from('document_shares').insert({ company_id: c.company.id, doc_kind: kind, record_id: recordId, party_type: SHARE[kind].party,
      party_id: partyId && uuid.safeParse(partyId).success ? partyId : null, method, phone_last4: phone ? phone.replace(/\D/g, '').slice(-4) : null, user_id: c.userId })
    if (error) throw error
    return { ok: true }
  })
}

/** Settings → WhatsApp → sharing messages: the text the free share opens with, per document type. Empty = the default. */
export async function saveShareTemplate(kind: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'settings.manage')
    if (!isShareKind(kind)) return { error: 'Unknown message type.' }
    const body = (str(fd, 'body') ?? '').replace(/\r/g, '')
    if (fd.get('reset') === '1' || !body.trim()) {
      const { error } = await c.supabase.from('app_settings').upsert({ company_id: c.company.id, key: shareSettingKey(kind), value: { body: null }, updated_at: new Date().toISOString() }); if (error) throw error
      revalidatePath('/settings'); return { ok: true, message: 'Back to the default message.' }
    }
    const problems = shareBodyProblems(kind, body); if (problems.length) return { error: problems.join(' ') }
    const { error } = await c.supabase.from('app_settings').upsert({ company_id: c.company.id, key: shareSettingKey(kind), value: { body }, updated_at: new Date().toISOString() })
    if (error) throw error
    revalidatePath('/settings'); return { ok: true, message: 'Message saved.' }
  })
}
