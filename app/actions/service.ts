'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { getCtx, need, type Ctx } from '@/lib/auth'
import { safe, str } from '@/lib/action'
import { notifyUser } from '@/lib/notify'
import { KB_CATEGORIES, TICKET_CATEGORY, TICKET_PRIORITY, TICKET_SOURCE, TICKET_STATUS } from '@/lib/service'
import type { ActionState } from '@/lib/utils'

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date')
const opt = (max: number) => z.string().trim().max(max, `At most ${max} characters`).optional()
const id = z.string().uuid().optional()
const keys = (o: Record<string, unknown>) => Object.keys(o) as [string, ...string[]]
const invalid = (e: z.ZodError): ActionState => ({ error: e.issues[0].message, fieldErrors: Object.fromEntries(e.issues.map(i => [i.path.join('.'), i.message])) })
async function nextNo(c: Ctx, type: string) { const { data, error } = await c.supabase.rpc('next_document_number', { p_doc_type: type }); if (error) throw error; return data as string }
const touch = (tid?: string) => { revalidatePath('/tickets'); if (tid) revalidatePath(`/tickets/${tid}`); revalidatePath('/brief') }

// ───────────── service tickets ─────────────
const ticketSchema = z.object({
  title: z.string().trim().min(3, 'Describe the issue in a few words').max(200), description: opt(4000),
  category: z.enum(keys(TICKET_CATEGORY)), priority: z.enum(keys(TICKET_PRIORITY)), source: z.enum(keys(TICKET_SOURCE)),
  customer_id: id, project_id: id, asset_id: id, warranty_id: id, assigned_to: id, employee_id: id,
  contact_name: opt(120), contact_phone: opt(40), site_location: opt(300), scheduled_date: date.optional(), due_date: date.optional(), chargeable: z.boolean(),
})
const TK = ['title', 'description', 'category', 'priority', 'source', 'customer_id', 'project_id', 'asset_id', 'warranty_id', 'assigned_to', 'employee_id', 'contact_name', 'contact_phone', 'site_location', 'scheduled_date', 'due_date']
const parseTicket = (fd: FormData) => ticketSchema.safeParse({ ...Object.fromEntries(TK.map(k => [k, str(fd, k)])), category: str(fd, 'category') ?? 'repair', priority: str(fd, 'priority') ?? 'normal', source: str(fd, 'source') ?? 'internal', chargeable: fd.get('chargeable') === 'on' })

export async function createTicket(_: ActionState, fd: FormData): Promise<ActionState> {
  let newId: string | null = null
  const r = await safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    const p = parseTicket(fd); if (!p.success) return invalid(p.error)
    const tok = z.string().uuid().safeParse(str(fd, 'idempotency_key')).data ?? null
    if (tok) { const { data: d } = await c.supabase.from('service_tickets').select('id').eq('client_token', tok).maybeSingle(); if (d) { newId = d.id; return } }
    const { data, error } = await c.supabase.from('service_tickets').insert({ ...p.data, number: await nextNo(c, 'service_ticket'), company_id: c.company.id, client_token: tok, created_by: c.userId }).select('id,number,warranty_id,under_warranty').single()
    if (error) throw error
    newId = data.id
    await c.supabase.from('ticket_events').insert({ company_id: c.company.id, ticket_id: data.id, kind: 'created', body: `Ticket opened${data.under_warranty ? ' · covered by warranty' : ''}`, user_id: c.userId })
    await notifyUser(c, p.data.assigned_to, { title: `Service ticket ${data.number} assigned to you`, body: p.data.title, link: `/tickets/${data.id}`, key: `ticket_assigned:${data.id}:${p.data.assigned_to}`, severity: p.data.priority === 'urgent' ? 'warning' : 'info' })
    touch()
  })
  if (newId) redirect(`/tickets/${newId}`)
  return r
}

export async function updateTicket(tid: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx()
    const p = parseTicket(fd); if (!p.success) return invalid(p.error)
    const { data: prev } = await c.supabase.from('service_tickets').select('assigned_to,number').eq('id', tid).maybeSingle()
    if (!prev) return { error: 'Ticket not found.' }
    if (!c.can('records.edit') && prev.assigned_to !== c.userId) return { error: 'You are not allowed to do that.' }
    const v: Record<string, unknown> = { ...Object.fromEntries(TK.map(k => [k, (p.data as any)[k] ?? null])), chargeable: p.data.chargeable }
    if (!c.can('records.edit')) { v.assigned_to = prev.assigned_to; v.customer_id = undefined; v.warranty_id = undefined }
    const { error } = await c.supabase.from('service_tickets').update(v).eq('id', tid)
    if (error) throw error
    if (v.assigned_to && v.assigned_to !== prev.assigned_to) {
      await c.supabase.from('ticket_events').insert({ company_id: c.company.id, ticket_id: tid, kind: 'assigned', body: 'Reassigned', user_id: c.userId })
      await notifyUser(c, v.assigned_to as string, { title: `Service ticket ${prev.number} assigned to you`, body: p.data.title, link: `/tickets/${tid}`, key: `ticket_assigned:${tid}:${v.assigned_to}` })
    }
    touch(tid); return { ok: true, message: 'Ticket saved.' }
  })
}

export async function setTicketStatus(tid: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx()
    const status = z.enum(keys(TICKET_STATUS)).parse(str(fd, 'status'))
    const resolution = str(fd, 'resolution')?.slice(0, 4000) ?? null
    if ((status === 'resolved' || status === 'closed') && !resolution) {
      const { data: t } = await c.supabase.from('service_tickets').select('resolution').eq('id', tid).maybeSingle()
      if (!t?.resolution) return { error: 'Write what was done (resolution) before resolving the ticket.' }
    }
    const { data: prev } = await c.supabase.from('service_tickets').select('status').eq('id', tid).maybeSingle()
    if (!prev) return { error: 'Ticket not found.' }
    const { data, error } = await c.supabase.from('service_tickets').update({ status, ...(resolution ? { resolution } : {}) }).eq('id', tid).select('id')
    if (error) throw error
    if (!data?.length) return { error: 'You are not allowed to do that.' }
    await c.supabase.from('ticket_events').insert({ company_id: c.company.id, ticket_id: tid, kind: 'status', body: `${TICKET_STATUS[prev.status]?.label ?? prev.status} → ${TICKET_STATUS[status].label}${resolution ? `: ${resolution}` : ''}`.slice(0, 4000), user_id: c.userId })
    touch(tid); return { ok: true, message: `Status: ${TICKET_STATUS[status].label}.` }
  })
}

export async function addTicketNote(tid: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx()
    const body = z.string().trim().min(1, 'Write a note').max(4000).parse(str(fd, 'body') ?? '')
    const { data: t } = await c.supabase.from('service_tickets').select('id').eq('id', tid).maybeSingle()
    if (!t) return { error: 'Ticket not found.' }
    const { error } = await c.supabase.from('ticket_events').insert({ company_id: c.company.id, ticket_id: tid, kind: str(fd, 'kind') === 'customer' ? 'customer' : 'note', body, user_id: c.userId })
    if (error) throw error
    touch(tid); return { ok: true, message: 'Note added.' }
  })
}

// ───────────── warranties ─────────────
const warrantySchema = z.object({
  title: z.string().trim().min(2, 'What does the warranty cover?').max(200), terms: opt(4000),
  customer_id: id, project_id: id, invoice_id: id, start_date: date, end_date: date,
}).refine(v => v.end_date >= v.start_date, { message: 'The end date is before the start date', path: ['end_date'] })
const WK = ['title', 'terms', 'customer_id', 'project_id', 'invoice_id', 'start_date', 'end_date']

export async function saveWarranty(wid: string | null, _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    const months = Number(str(fd, 'months') ?? 0)
    const raw: Record<string, unknown> = Object.fromEntries(WK.map(k => [k, str(fd, k)]))
    if (!raw.end_date && raw.start_date && months > 0 && months <= 240) { const d = new Date(`${raw.start_date}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + months); d.setUTCDate(d.getUTCDate() - 1); raw.end_date = d.toISOString().slice(0, 10) }
    const p = warrantySchema.safeParse(raw); if (!p.success) return invalid(p.error)
    if (!p.data.customer_id && !p.data.project_id) return { error: 'Choose the customer or the project the warranty belongs to.' }
    const row = Object.fromEntries(WK.map(k => [k, (p.data as any)[k] ?? null]))
    const { error } = wid ? await c.supabase.from('warranties').update({ ...row, updated_at: new Date().toISOString() }).eq('id', wid)
      : await c.supabase.from('warranties').insert({ ...row, number: await nextNo(c, 'warranty'), company_id: c.company.id, created_by: c.userId })
    if (error) throw error
    revalidatePath('/tickets'); if (p.data.customer_id) revalidatePath(`/parties/${p.data.customer_id}`)
    return { ok: true, message: wid ? 'Warranty saved.' : 'Warranty recorded.' }
  })
}

// ───────────── knowledge base ─────────────
const kbSchema = z.object({
  title: z.string().trim().min(3, 'Give the article a title').max(200), category: z.string().trim().min(1).max(60),
  body: z.string().max(60000, 'The article is too long (60,000 characters)'), status: z.enum(['draft', 'published']),
})
const tagsOf = (fd: FormData) => [...new Set((str(fd, 'tags') ?? '').split(',').map(t => t.trim().toLowerCase()).filter(Boolean))].slice(0, 12).map(t => t.slice(0, 30))

export async function saveKbArticle(aid: string | null, _: ActionState, fd: FormData): Promise<ActionState> {
  let created: string | null = null
  const r = await safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    const v = kbSchema.parse({ title: str(fd, 'title') ?? '', category: str(fd, 'category') ?? KB_CATEGORIES[0], body: String(fd.get('body') ?? ''), status: str(fd, 'status') === 'draft' ? 'draft' : 'published' })
    const row = { ...v, tags: tagsOf(fd), pinned: fd.get('pinned') === 'on' }
    if (aid) {
      const { data, error } = await c.supabase.from('kb_articles').update({ ...row, updated_by: c.userId }).eq('id', aid).select('id,version').single()
      if (error) throw error
      revalidatePath('/kb'); revalidatePath(`/kb/${aid}`)
      return { ok: true, message: `Saved (version ${data.version}).` }
    }
    const { data, error } = await c.supabase.from('kb_articles').insert({ ...row, company_id: c.company.id, created_by: c.userId, updated_by: c.userId }).select('id').single()
    if (error) throw error
    created = data.id; revalidatePath('/kb')
  })
  if (created) redirect(`/kb/${created}`)
  return r
}
