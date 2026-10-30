'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getCtx, need } from '@/lib/auth'
import { safe, str } from '@/lib/action'
import { toE164 } from '@/lib/phone'
import { SHARE, fillShare, isShareKind, shareBodyProblems, sharePerms, shareSettingKey, type ShareKind } from '@/lib/whatsapp/share'
import { ShareDocError, firstPhone, resolveShareDoc, type ShareDoc, type ShareParty } from '@/lib/whatsapp/share-docs'
import type { Ctx } from '@/lib/auth'
import type { ActionState } from '@/lib/utils'

// "Share via WhatsApp" (free): Averiqo prepares the right recipient, document and message; the user's own WhatsApp sends
// it. Nothing here sends a message or marks anything as delivered. Each document type is resolved in lib/whatsapp/share-docs.ts.
const uuid = z.string().uuid()
const first = firstPhone
const allowed = (c: Ctx, k: ShareKind) => sharePerms(k).every(p => c.can(p))

export type SharePrep = {
  kind: ShareKind; recordId: string; docLabel: string; docDetail: string; pdfUrl: string; filename: string; message: string
  party: ShareParty; phone: string | null; phoneSource: 'whatsapp' | 'phone' | null; storedInvalid: string | null; canSaveNumber: boolean
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
    if (!allowed(c, kind)) return { error: 'You do not have access to share this document.' }
    let doc: ShareDoc
    try { doc = await resolveShareDoc(c, kind, recordId) } catch (e) { if (e instanceof ShareDocError) return { error: e.message }; throw e }
    const { values, ...prep } = doc, sb = c.supabase
    const [body, { data: shares }] = await Promise.all([template(c, kind),
      sb.from('document_shares').select('created_at,user_id').eq('doc_kind', kind).eq('record_id', recordId).order('created_at', { ascending: false }).limit(50)])
    const lastBy = shares?.[0]?.user_id ? (await sb.from('profiles').select('full_name').eq('id', shares[0].user_id).maybeSingle()).data?.full_name ?? null : null
    const data: SharePrep = { ...prep, kind, recordId, message: fillShare(kind, body, values), sameNumberAs: prep.party.type === 'employee' ? await sameNumber(c, prep.party.id, prep.phone) : [],
      lastShare: { count: shares?.length ?? 0, at: shares?.[0]?.created_at ?? null, by: lastBy } }
    return { ok: true, data }
  })
}

/** Check a number typed in the sheet: valid international format, and not saved for another employee. */
export async function checkShareNumber(employeeId: string | null, raw: string): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); if (!c.can('salary.view') && !c.can('finance.view') && !c.can('employees.view_sensitive')) return { error: 'Not allowed.' }
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
    if (!allowed(c, kind)) return { error: 'Not allowed.' }
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
