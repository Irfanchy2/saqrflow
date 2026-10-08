'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { getCtx, need, type Ctx } from '@/lib/auth'
import { safe, str } from '@/lib/action'
import { LEAD_SOURCES, LOST_REASONS, STAGE, STAGE_KEYS } from '@/lib/crm'
import { notifyUser } from '@/lib/notify'
import type { ActionState } from '@/lib/utils'

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date')
const t = (max: number) => z.string().trim().max(max, `At most ${max} characters`).optional()
const uuid = z.string().uuid()
const leadSchema = z.object({
  company_name: z.string().trim().min(1, 'Customer / company name is required').max(200),
  contact_person: t(120), phone: t(40), whatsapp: t(40),
  email: z.string().trim().email('Enter a valid email').max(200).optional(),
  location: t(300), address: t(1000), trn: z.string().trim().regex(/^\d{15}$/, 'TRN is 15 digits').optional(),
  source: z.enum(Object.keys(LEAD_SOURCES) as [string, ...string[]]).default('other'),
  service: t(300),
  estimated_value: z.coerce.number({ message: 'Estimated value must be a number' }).min(0).max(1e11).optional(),
  probability: z.coerce.number({ message: 'Probability must be a number' }).int().min(0, 'Probability: 0–100').max(100, 'Probability: 0–100').optional(),
  expected_close: date.optional(), next_followup: date.optional(),
  salesperson_id: uuid.optional(), stage: z.enum(STAGE_KEYS).default('new'), notes: t(4000),
})
const KEYS = Object.keys(leadSchema.shape)
const invalid = (e: z.ZodError): ActionState => ({ error: e.issues[0].message, fieldErrors: Object.fromEntries(e.issues.map(i => [i.path.join('.'), i.message])) })
const parse = (fd: FormData) => leadSchema.safeParse(Object.fromEntries(KEYS.map(k => [k, k === 'trn' ? str(fd, k)?.replace(/[\s-]/g, '') : str(fd, k)])))
const touch = (id?: string) => { revalidatePath('/leads'); if (id) revalidatePath(`/leads/${id}`); revalidatePath('/') }
const token = (fd: FormData) => uuid.safeParse(str(fd, 'idempotency_key')).data ?? null

async function byToken(c: Ctx, table: string, tok: string | null) {
  if (!tok) return null
  const { data } = await c.supabase.from(table).select('id').eq('client_token', tok).maybeSingle()
  return (data?.id as string | undefined) ?? null
}
async function nextNo(c: Ctx, type: string) {
  const { data, error } = await c.supabase.rpc('next_document_number', { p_doc_type: type }); if (error) throw error
  return data as string
}

export async function createLead(_: ActionState, fd: FormData): Promise<ActionState> {
  let id: string | null = null
  const r = await safe(async () => {
    const c = await getCtx(); need(c, 'records.edit'); need(c, 'crm.view')
    const p = parse(fd); if (!p.success) return invalid(p.error)
    const tok = token(fd)
    if ((id = await byToken(c, 'leads', tok))) return
    const v = p.data
    if (v.stage === 'lost') return { error: 'A new lead cannot start as lost.' }
    const { data, error } = await c.supabase.from('leads').insert({ ...v, salesperson_id: v.salesperson_id ?? c.userId, number: await nextNo(c, 'lead'), company_id: c.company.id, client_token: tok, created_by: c.userId }).select('id').single()
    if (error) { if (error.code === '23505' && (id = await byToken(c, 'leads', tok))) return; throw error }
    id = data.id
    await notifyUser(c, v.salesperson_id, { title: `New lead assigned: ${v.company_name}`, body: v.service ?? undefined, link: `/leads/${data.id}`, key: `lead_assigned:${data.id}:${v.salesperson_id}` })
    touch()
  })
  if (id) redirect(`/leads/${id}`)
  return r
}

export async function updateLead(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.edit'); need(c, 'crm.view')
    const p = parse(fd); if (!p.success) return invalid(p.error)
    const { data: prev } = await c.supabase.from('leads').select('stage,salesperson_id,lost_reason').eq('id', id).maybeSingle()
    if (!prev) return { error: 'Lead not found.' }
    const v = p.data
    const lost = v.stage === 'lost' ? z.enum(Object.keys(LOST_REASONS) as [string, ...string[]]).safeParse(str(fd, 'lost_reason') ?? prev.lost_reason) : null
    if (lost && !lost.success) return { error: 'Choose why the lead was lost.', fieldErrors: { lost_reason: 'Required when the lead is lost' } }
    const cleared = Object.fromEntries(KEYS.filter(k => !['company_name', 'source', 'stage'].includes(k)).map(k => [k, (v as Record<string, unknown>)[k] ?? null]))
    const { data, error } = await c.supabase.from('leads').update({ ...v, ...cleared, lost_reason: lost?.data ?? null, lost_note: v.stage === 'lost' ? str(fd, 'lost_note')?.slice(0, 500) ?? null : null }).eq('id', id).select('id')
    if (error) throw error
    if (!data?.length) return { error: 'Not found or not allowed.' }
    if (v.salesperson_id && v.salesperson_id !== prev.salesperson_id) await notifyUser(c, v.salesperson_id, { title: `Lead assigned to you: ${v.company_name}`, link: `/leads/${id}`, key: `lead_assigned:${id}:${v.salesperson_id}` })
    touch(id); return { ok: true, message: 'Lead saved.' }
  })
}

/** Pipeline drag-and-drop / stage menu. Moving to Lost requires a reason; the DB trigger writes the activity log entry. */
export async function setLeadStage(id: string, stage: string, lostReason?: string, lostNote?: string): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.edit'); need(c, 'crm.view')
    const s = z.enum(STAGE_KEYS).parse(stage)
    let reason: string | null = null
    if (s === 'lost') {
      const r = z.enum(Object.keys(LOST_REASONS) as [string, ...string[]]).safeParse(lostReason)
      if (!r.success) return { error: 'Choose why the lead was lost.' }
      reason = r.data
    }
    const { data, error } = await c.supabase.from('leads').update({ stage: s, lost_reason: reason, lost_note: s === 'lost' ? lostNote?.slice(0, 500) || null : null }).eq('id', id).select('id')
    if (error) throw error
    if (!data?.length) return { error: 'Lead not found or not allowed.' }
    touch(id); return { ok: true, message: `Moved to ${STAGE[s].label}.` }
  })
}

/** Call / WhatsApp / email / meeting / note on the lead's history, optionally setting the next follow-up date. */
export async function addLeadActivity(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.edit'); need(c, 'crm.view')
    const kind = z.enum(['note', 'call', 'whatsapp', 'email', 'meeting']).catch('note').parse(str(fd, 'kind'))
    const body = str(fd, 'body'); if (!body) return { error: 'Write what happened.', fieldErrors: { body: 'Required' } }
    const next = str(fd, 'next_followup'); if (next) date.parse(next)
    const { error } = await c.supabase.from('lead_activities').insert({ company_id: c.company.id, lead_id: id, kind, body: body.slice(0, 2000), user_id: c.userId })
    if (error) throw error
    const patch: Record<string, unknown> = {}
    if (next) patch.next_followup = next
    else if (fd.get('clear_followup')) patch.next_followup = null
    // first contact moves a brand-new lead forward
    const { data: l } = await c.supabase.from('leads').select('stage').eq('id', id).maybeSingle()
    if (l?.stage === 'new' && kind !== 'note') patch.stage = 'contacted'
    if (Object.keys(patch).length) await c.supabase.from('leads').update(patch).eq('id', id)
    touch(id); return { ok: true, message: 'Added to the lead history.' }
  })
}

/**
 * Lead → Customer without re-typing: reuses an existing customer with the same name (or links the one already set),
 * otherwise creates it from the lead's details.
 */
export async function convertLeadToCustomer(id: string): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.edit'); need(c, 'crm.view')
    const { data: l } = await c.supabase.from('leads').select('*').eq('id', id).maybeSingle()
    if (!l) return { error: 'Lead not found.' }
    if (l.customer_id) return { ok: true, message: 'Already linked to a customer.' }
    const { data: existing } = await c.supabase.from('customers').select('id').ilike('name', l.company_name).maybeSingle()
    let customerId = existing?.id as string | undefined
    if (!customerId) {
      const { data: cu, error } = await c.supabase.from('customers').insert({
        company_id: c.company.id, name: l.company_name, contact_person: l.contact_person, phone: l.phone, whatsapp: l.whatsapp, email: l.email,
        trn: l.trn, address: l.address ?? l.location, notes: l.notes, lead_id: l.id, created_by: c.userId,
      }).select('id').single()
      if (error) { if (error.code === '23505') return { error: `A customer named “${l.company_name}” exists (possibly in the trash). Restore it, then convert again.` }; throw error }
      customerId = cu.id
    }
    await c.supabase.from('leads').update({ customer_id: customerId }).eq('id', id)
    await c.supabase.from('lead_activities').insert({ company_id: c.company.id, lead_id: id, kind: 'converted', body: existing ? 'Linked to existing customer' : 'Converted to customer', user_id: c.userId })
    touch(id); revalidatePath('/parties')
    return { ok: true, message: existing ? 'Linked to the existing customer with this name.' : 'Customer created from the lead.' }
  })
}
