'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { getCtx, need, type Ctx } from '@/lib/auth'
import { safe, str } from '@/lib/action'
import { saveVersion } from '@/lib/doc-upload'
import { notifyUser } from '@/lib/notify'
import { EXPENSE_CATS } from '@/lib/projects'
import { PRIORITY, TASK_STATUS, VISIT_STATUS, WO_STATUS } from '@/lib/crm'
import type { ActionState } from '@/lib/utils'

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date')
const t = (max: number) => z.string().trim().max(max, `At most ${max} characters`).optional()
const uuid = z.string().uuid()
const keysOf = <T extends Record<string, string | { label: string }>>(o: T) => Object.keys(o) as [string, ...string[]]
const invalid = (e: z.ZodError): ActionState => ({ error: e.issues[0].message, fieldErrors: Object.fromEntries(e.issues.map(i => [i.path.join('.'), i.message])) })
const pick = (fd: FormData, keys: string[]) => Object.fromEntries(keys.map(k => [k, str(fd, k)]))
/** empty optional fields clear the stored value on update */
const withNulls = (v: Record<string, unknown>, keys: string[], keep: string[]) => ({ ...v, ...Object.fromEntries(keys.filter(k => !keep.includes(k)).map(k => [k, v[k] ?? null])) })
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
/** idempotent numbered insert → id (a double click / retry with the same token returns the first record) */
async function insertOnce(c: Ctx, table: string, numberType: string | null, row: Record<string, unknown>, tok: string | null) {
  const dup = await byToken(c, table, tok); if (dup) return dup
  const { data, error } = await c.supabase.from(table).insert({ ...row, ...(numberType ? { number: await nextNo(c, numberType) } : {}), company_id: c.company.id, client_token: tok, created_by: c.userId }).select('id').single()
  if (error) { if (error.code === '23505') { const d = await byToken(c, table, tok); if (d) return d }; throw error }
  return data.id as string
}

// ───────────── site visits ─────────────
const visitSchema = z.object({
  lead_id: uuid.optional(), customer_id: uuid.optional(), project_id: uuid.optional(),
  location: t(300), scheduled_date: date, scheduled_time: z.string().regex(/^\d{2}:\d{2}$/, 'Use a valid time').optional(),
  employee_id: uuid.optional(), contact_person: t(120), contact_phone: t(40), attendees: t(500),
  notes: t(4000), measurements: t(4000), requirements: t(4000), recommendations: t(4000), followup_action: t(1000),
  status: z.enum(keysOf(VISIT_STATUS)).default('scheduled'),
})
const VKEYS = Object.keys(visitSchema.shape)
const touchVisit = (id?: string) => { revalidatePath('/site-visits'); if (id) revalidatePath(`/site-visits/${id}`); revalidatePath('/calendar') }

export async function createSiteVisit(_: ActionState, fd: FormData): Promise<ActionState> {
  let id: string | null = null
  const r = await safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    const p = visitSchema.safeParse(pick(fd, VKEYS)); if (!p.success) return invalid(p.error)
    const v = p.data
    if (!v.lead_id && !v.customer_id && !v.project_id) return { error: 'Link the visit to a lead, customer or project.' }
    // a visit for a lead inherits its contact and location when those were left empty
    if (v.lead_id) {
      const { data: l } = await c.supabase.from('leads').select('location,contact_person,phone,customer_id').eq('id', v.lead_id).maybeSingle()
      if (!l) return { error: 'Lead not found.' }
      v.location ??= l.location ?? undefined; v.contact_person ??= l.contact_person ?? undefined; v.contact_phone ??= l.phone ?? undefined; v.customer_id ??= l.customer_id ?? undefined
    }
    id = await insertOnce(c, 'site_visits', 'site_visit', { ...v, prepared_by: c.userId }, token(fd))
    if (v.lead_id) {
      await c.supabase.from('lead_activities').insert({ company_id: c.company.id, lead_id: v.lead_id, kind: 'site_visit', body: `Site visit scheduled for ${v.scheduled_date}${v.scheduled_time ? ` ${v.scheduled_time}` : ''}`, user_id: c.userId })
      await c.supabase.from('leads').update({ stage: 'site_visit_required' }).eq('id', v.lead_id).in('stage', ['new', 'contacted'])
      revalidatePath(`/leads/${v.lead_id}`)
    }
    touchVisit()
  })
  if (id) redirect(`/site-visits/${id}`)
  return r
}

export async function updateSiteVisit(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    const p = visitSchema.safeParse(pick(fd, VKEYS)); if (!p.success) return invalid(p.error)
    const { data: prev } = await c.supabase.from('site_visits').select('status,lead_id,number').eq('id', id).maybeSingle()
    if (!prev) return { error: 'Site visit not found.' }
    const v = p.data
    if (!v.lead_id && !v.customer_id && !v.project_id) return { error: 'Link the visit to a lead, customer or project.' }
    const done = v.status === 'completed' && prev.status !== 'completed'
    const { error } = await c.supabase.from('site_visits').update({ ...withNulls(v, VKEYS, ['scheduled_date', 'status']), ...(done ? { completed_at: new Date().toISOString() } : v.status !== 'completed' ? { completed_at: null } : {}), updated_at: new Date().toISOString() }).eq('id', id)
    if (error) throw error
    if (done && prev.lead_id) {
      await c.supabase.from('lead_activities').insert({ company_id: c.company.id, lead_id: prev.lead_id, kind: 'site_visit', body: `Site visit ${prev.number} completed`, user_id: c.userId })
      await c.supabase.from('leads').update({ stage: 'site_visit_completed' }).eq('id', prev.lead_id).in('stage', ['new', 'contacted', 'site_visit_required'])
      revalidatePath(`/leads/${prev.lead_id}`)
    }
    touchVisit(id); return { ok: true, message: done ? 'Visit completed.' : 'Saved.' }
  })
}

/** Site visit → project (customer, site and scope copied from the visit and its lead). */
export async function createProjectFromVisit(visitId: string): Promise<ActionState> {
  let id: string | null = null
  const r = await safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    const { data: v } = await c.supabase.from('site_visits').select('id,number,project_id,customer_id,lead_id,location,requirements').eq('id', visitId).maybeSingle()
    if (!v) return { error: 'Site visit not found.' }
    if (v.project_id) { id = v.project_id; return }
    const { data: l } = v.lead_id ? await c.supabase.from('leads').select('company_name,service,customer_id,estimated_value').eq('id', v.lead_id).maybeSingle() : { data: null }
    const { data: code } = await c.supabase.rpc('next_document_number', { p_doc_type: 'project' })
    const { data: p, error } = await c.supabase.from('projects').insert({
      company_id: c.company.id, name: ([l?.service, l?.company_name].filter(Boolean).join(' – ') || `Project from ${v.number}`).slice(0, 200), code: code ?? null,
      customer_id: v.customer_id ?? l?.customer_id ?? null, location: v.location, status: 'planning', manager_id: c.userId,
      description: v.requirements ? `From site visit ${v.number}:\n${v.requirements}`.slice(0, 4000) : `From site visit ${v.number}`,
    }).select('id').single()
    if (error) throw error
    await c.supabase.from('site_visits').update({ project_id: p.id }).eq('id', visitId)
    if (v.lead_id) await c.supabase.from('leads').update({ project_id: p.id }).eq('id', v.lead_id).is('project_id', null)
    id = p.id; revalidatePath('/projects'); touchVisit(visitId)
  })
  if (id) redirect(`/projects/${id}`)
  return r
}

// ───────────── photos & files on visits / work orders / site reports (private, versioned documents) ─────────────
const OWNER = { site_visit: { table: 'site_visits', folder: 'Site visits', path: '/site-visits/' }, work_order: { table: 'work_orders', folder: 'Work orders', path: '/work-orders/' }, site_report: { table: 'daily_site_reports', folder: 'Site reports', path: '/site-reports/' } } as const
export async function uploadOpsFiles(kind: keyof typeof OWNER, id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'documents.upload')
    const o = OWNER[kind]; if (!o) return { error: 'Unknown record.' }
    const files = fd.getAll('file').filter((f): f is File => f instanceof File && f.size > 0)
    if (!files.length) return { error: 'Choose at least one file.' }
    if (files.length > 30) return { error: 'Upload up to 30 files at a time.' }
    const photo = fd.get('as') === 'photo'
    if (photo && files.some(f => !/^image\//.test(f.type))) return { error: 'Only images (JPG, PNG, WEBP, HEIC) can be added as photos.' }
    const { data: rec } = await c.supabase.from(o.table).select('id,number,project_id').eq('id', id).maybeSingle()
    if (!rec) return { error: 'Not found.' }
    const caption = str(fd, 'caption')?.slice(0, 500) ?? null
    const role = photo ? `photo_${z.enum(['before', 'progress', 'measurement', 'issue', 'completed']).catch('progress').parse(str(fd, 'category'))}` : z.enum(['drawing', 'measurement', 'attachment']).catch('attachment').parse(str(fd, 'category'))
    // site reports live under their project (documents.owner_type has no site_report): the relationship points at the report
    const owner = kind === 'site_report' ? { owner_type: 'project', owner_id: rec.project_id } : { owner_type: kind, owner_id: id }
    const errors: string[] = []
    for (const f of files) {
      const { data: doc, error } = await c.supabase.from('documents').insert({
        company_id: c.company.id, ...owner, name: (caption ?? `${rec.number} ${photo ? 'photo' : f.name}`).slice(0, 250), notes: caption, issue_date: c.today,
        folder: `${o.folder}/${rec.number}/${photo ? 'Photos' : 'Files'}`, reminders_active: false, created_by: c.userId,
      }).select('id').single()
      if (error) throw error
      try { await saveVersion(c, doc.id, f) } catch (e) { errors.push(`${f.name}: ${(e as Error).message}`); await c.supabase.from('documents').update({ deleted_at: new Date().toISOString() }).eq('id', doc.id); continue }
      await c.supabase.from('document_relationships').insert({ company_id: c.company.id, document_id: doc.id, related_type: kind, related_id: id, role, created_by: c.userId })
      if (kind === 'site_report' && rec.project_id && photo) await c.supabase.from('document_relationships').insert({ company_id: c.company.id, document_id: doc.id, related_type: 'project', related_id: rec.project_id, role: 'photo_progress', created_by: c.userId })
    }
    revalidatePath(o.path + id); if (rec.project_id) revalidatePath(`/projects/${rec.project_id}`)
    if (errors.length) return { error: `${files.length - errors.length} added. Rejected: ${errors.join(' · ')}` }
    return { ok: true, message: `${files.length} ${photo ? 'photo' : 'file'}${files.length === 1 ? '' : 's'} added.` }
  })
}

// ───────────── projects from the sales flow ─────────────
/** Accepted quotation → project (customer, site and contract value copied). Reuses the project already linked. */
async function projectForQuotation(c: Ctx, q: any): Promise<string> {
  if (q.project_id) return q.project_id
  const { data: code } = await c.supabase.rpc('next_document_number', { p_doc_type: 'project' })
  const { data: p, error } = await c.supabase.from('projects').insert({
    company_id: c.company.id, name: (q.subject || `${q.customer_name ?? 'Project'} – ${q.number}`).slice(0, 200), code: code ?? null,
    customer_id: q.customer_id, location: q.site, contract_value: Math.round((Number(q.total) - Number(q.vat_amount ?? 0)) * 100) / 100 || null,
    status: 'active', start_date: c.today, manager_id: c.userId, description: q.reference ? `From quotation ${q.number} (${q.reference})` : `From quotation ${q.number}`,
  }).select('id').single()
  if (error) throw error
  await c.supabase.from('invoices').update({ project_id: p.id }).eq('id', q.id)
  if (q.lead_id) await c.supabase.from('leads').update({ project_id: p.id }).eq('id', q.lead_id).is('project_id', null)
  return p.id
}
export async function createProjectFromQuotation(quotationId: string): Promise<ActionState> {
  let id: string | null = null
  const r = await safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    const { data: q } = await c.supabase.from('invoices').select('id,number,doc_type,status,customer_id,customer_name,project_id,site,subject,total,vat_amount,reference,lead_id').eq('id', quotationId).maybeSingle()
    if (!q || q.doc_type !== 'quotation') return { error: 'Quotation not found.' }
    if (!['accepted', 'converted'].includes(q.status)) return { error: 'Mark the quotation as accepted first.' }
    id = await projectForQuotation(c, q)
    revalidatePath('/projects'); revalidatePath(`/invoices/${quotationId}`)
  })
  if (id) redirect(`/projects/${id}`)
  return r
}

// ───────────── work orders ─────────────
const woSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200), customer_id: uuid.optional(), project_id: uuid.optional(), quotation_id: uuid.optional(),
  scope: t(8000), site_location: t(300), start_date: date.optional(), target_date: date.optional(), manager_id: uuid.optional(),
  equipment: t(2000), instructions: t(4000), priority: z.enum(keysOf(PRIORITY)).default('normal'), status: z.enum(keysOf(WO_STATUS)).default('pending'),
}).refine(v => !v.start_date || !v.target_date || v.target_date >= v.start_date, { message: 'Target date must be on or after the start date', path: ['target_date'] })
const WKEYS = ['title', 'customer_id', 'project_id', 'quotation_id', 'scope', 'site_location', 'start_date', 'target_date', 'manager_id', 'equipment', 'instructions', 'priority', 'status']
const touchWo = (id?: string, projectId?: string | null) => { revalidatePath('/work-orders'); if (id) revalidatePath(`/work-orders/${id}`); if (projectId) revalidatePath(`/projects/${projectId}`) }

export async function createWorkOrder(_: ActionState, fd: FormData): Promise<ActionState> {
  let id: string | null = null
  const r = await safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    const p = woSchema.safeParse(pick(fd, WKEYS)); if (!p.success) return invalid(p.error)
    const v = p.data
    if (v.project_id && !v.customer_id) { const { data: pr } = await c.supabase.from('projects').select('customer_id,location').eq('id', v.project_id).maybeSingle(); v.customer_id ??= pr?.customer_id ?? undefined; v.site_location ??= pr?.location ?? undefined }
    id = await insertOnce(c, 'work_orders', 'work_order', { ...v, manager_id: v.manager_id ?? c.userId }, token(fd))
    await notifyUser(c, v.manager_id, { title: `Work order assigned: ${v.title}`, link: `/work-orders/${id}`, key: `wo_assigned:${id}:${v.manager_id}` })
    touchWo(undefined, v.project_id)
  })
  if (id) redirect(`/work-orders/${id}`)
  return r
}

/** Accepted quotation → work order: the project is created (or reused) and the quotation lines become the scope. */
export async function createWorkOrderFromQuotation(quotationId: string, tok?: string): Promise<ActionState> {
  let id: string | null = null
  const r = await safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    const tk = uuid.safeParse(tok).data ?? null
    if ((id = await byToken(c, 'work_orders', tk))) return
    const { data: q } = await c.supabase.from('invoices').select('id,number,doc_type,status,customer_id,customer_name,project_id,site,subject,total,vat_amount,reference,lead_id').eq('id', quotationId).maybeSingle()
    if (!q || q.doc_type !== 'quotation') return { error: 'Quotation not found.' }
    if (!['accepted', 'converted'].includes(q.status)) return { error: 'Mark the quotation as accepted before creating a work order.' }
    const projectId = await projectForQuotation(c, q)
    const { data: items } = await c.supabase.from('invoice_items').select('description,quantity,unit').eq('invoice_id', quotationId).order('position')
    const scope = (items ?? []).map((i: any) => `• ${i.description}${i.quantity ? ` (${Number(i.quantity)}${i.unit ? ` ${i.unit}` : ''})` : ''}`).join('\n').slice(0, 8000)
    id = await insertOnce(c, 'work_orders', 'work_order', {
      title: (q.subject || `Work order for ${q.number}`).slice(0, 200), customer_id: q.customer_id, project_id: projectId, quotation_id: q.id,
      scope: scope || null, site_location: q.site, start_date: c.today, manager_id: c.userId, status: 'approved',
    }, tk)
    touchWo(undefined, projectId); revalidatePath(`/invoices/${quotationId}`)
  })
  if (id) redirect(`/work-orders/${id}`)
  return r
}

export async function updateWorkOrder(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    const p = woSchema.safeParse(pick(fd, WKEYS)); if (!p.success) return invalid(p.error)
    const { data: prev } = await c.supabase.from('work_orders').select('status,manager_id').eq('id', id).maybeSingle()
    if (!prev) return { error: 'Work order not found.' }
    const v = p.data
    const { error } = await c.supabase.from('work_orders').update({ ...withNulls(v, WKEYS, ['title', 'priority', 'status']), completed_at: v.status === 'completed' ? (prev.status === 'completed' ? undefined : new Date().toISOString()) : null, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) throw error
    if (v.manager_id && v.manager_id !== prev.manager_id) await notifyUser(c, v.manager_id, { title: `Work order assigned: ${v.title}`, link: `/work-orders/${id}`, key: `wo_assigned:${id}:${v.manager_id}` })
    touchWo(id, v.project_id); return { ok: true, message: 'Work order saved.' }
  })
}

export async function setWorkOrderStatus(id: string, status: string): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    const s = z.enum(keysOf(WO_STATUS)).parse(status)
    const { data, error } = await c.supabase.from('work_orders').update({ status: s, completed_at: s === 'completed' ? new Date().toISOString() : null, updated_at: new Date().toISOString() }).eq('id', id).select('id,project_id')
    if (error) throw error
    if (!data?.length) return { error: 'Not found or not allowed.' }
    touchWo(id, data[0].project_id); return { ok: true }
  })
}

export async function setWorkOrderMember(woId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    const emp = uuid.safeParse(str(fd, 'employee_id')); if (!emp.success) return { error: 'Choose an employee.' }
    const { error } = await c.supabase.from('work_order_members').upsert({ company_id: c.company.id, work_order_id: woId, employee_id: emp.data, role: str(fd, 'role')?.slice(0, 80) ?? null })
    if (error) throw error
    touchWo(woId); return { ok: true, message: 'Crew updated.' }
  })
}
export async function removeWorkOrderMember(woId: string, employeeId: string): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    const { error } = await c.supabase.from('work_order_members').delete().eq('work_order_id', woId).eq('employee_id', employeeId); if (error) throw error
    touchWo(woId); return { ok: true, message: 'Removed from the crew.' }
  })
}
export async function setWorkOrderAsset(woId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    const a = uuid.safeParse(str(fd, 'asset_id')); if (!a.success) return { error: 'Choose a vehicle or equipment.' }
    const { error } = await c.supabase.from('work_order_assets').upsert({ company_id: c.company.id, work_order_id: woId, asset_id: a.data })
    if (error) throw error
    touchWo(woId); return { ok: true, message: 'Equipment added.' }
  })
}
export async function removeWorkOrderAsset(woId: string, assetId: string): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    const { error } = await c.supabase.from('work_order_assets').delete().eq('work_order_id', woId).eq('asset_id', assetId); if (error) throw error
    touchWo(woId); return { ok: true, message: 'Removed.' }
  })
}

// ───────────── tasks ─────────────
const RELATED = ['project', 'customer', 'employee', 'document', 'vehicle', 'asset', 'invoice', 'quotation', 'lead', 'supplier', 'work_order', 'site_visit'] as const
const taskSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200), description: t(4000),
  owner_id: uuid.optional(), employee_id: uuid.optional(), start_date: date.optional(), due_date: date.optional(),
  priority: z.enum(keysOf(PRIORITY)).default('normal'), status: z.enum(keysOf(TASK_STATUS)).default('todo'),
  completion: z.coerce.number({ message: 'Completion must be a number' }).int().min(0).max(100).optional(),
  related_type: z.enum(RELATED).optional(), related_id: uuid.optional(), project_id: uuid.optional(), work_order_id: uuid.optional(),
}).refine(v => !v.start_date || !v.due_date || v.due_date >= v.start_date, { message: 'Due date must be on or after the start date', path: ['due_date'] })
  .refine(v => !!v.related_type === !!v.related_id, { message: 'Choose what the task is linked to', path: ['related_id'] })
const TKEYS = ['title', 'description', 'owner_id', 'employee_id', 'start_date', 'due_date', 'priority', 'status', 'completion', 'related_type', 'related_id', 'project_id', 'work_order_id']
const touchTask = (v: { project_id?: string | null; work_order_id?: string | null }) => { revalidatePath('/tasks'); revalidatePath('/'); if (v.project_id) revalidatePath(`/projects/${v.project_id}`); if (v.work_order_id) revalidatePath(`/work-orders/${v.work_order_id}`) }

export async function createTask(_: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    const p = taskSchema.safeParse(pick(fd, TKEYS)); if (!p.success) return invalid(p.error)
    const v = p.data
    if (v.work_order_id && !v.project_id) { const { data: w } = await c.supabase.from('work_orders').select('project_id').eq('id', v.work_order_id).maybeSingle(); v.project_id = w?.project_id ?? undefined }
    if (v.related_type === 'project' && !v.project_id) v.project_id = v.related_id
    const tok = token(fd)
    if (await byToken(c, 'tasks', tok)) return { ok: true, message: 'Task added.' }
    const { data, error } = await c.supabase.from('tasks').insert({ ...v, completion: v.completion ?? 0, owner_id: v.owner_id ?? c.userId, company_id: c.company.id, client_token: tok, created_by: c.userId }).select('id').single()
    if (error) { if (error.code === '23505' && tok) return { ok: true, message: 'Task added.' }; throw error }
    await notifyUser(c, v.owner_id, { title: `Task assigned to you: ${v.title}`, body: v.due_date ? `Due ${v.due_date}` : undefined, link: `/tasks?open=${data.id}`, key: `task_assigned:${data.id}:${v.owner_id}`, severity: v.priority === 'urgent' ? 'warning' : 'info' })
    touchTask(v); return { ok: true, message: 'Task added.' }
  })
}

export async function updateTask(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx()
    const p = taskSchema.safeParse(pick(fd, TKEYS)); if (!p.success) return invalid(p.error)
    const { data: prev } = await c.supabase.from('tasks').select('owner_id,project_id,work_order_id').eq('id', id).maybeSingle()
    if (!prev) return { error: 'Task not found.' }
    // the assignee may update their own task (status, %, notes) without edit rights; reassigning needs records.edit
    if (!c.can('records.edit') && prev.owner_id !== c.userId) return { error: 'You are not allowed to do that.' }
    const v = p.data
    if (!c.can('records.edit')) v.owner_id = prev.owner_id
    const { data, error } = await c.supabase.from('tasks').update({ ...withNulls(v, TKEYS, ['title', 'priority', 'status']), completion: v.completion ?? 0, project_id: v.project_id ?? prev.project_id, work_order_id: v.work_order_id ?? prev.work_order_id }).eq('id', id).select('id')
    if (error) throw error
    if (!data?.length) return { error: 'Not found or not allowed.' }
    if (v.owner_id && v.owner_id !== prev.owner_id) await notifyUser(c, v.owner_id, { title: `Task assigned to you: ${v.title}`, link: `/tasks?open=${id}`, key: `task_assigned:${id}:${v.owner_id}` })
    touchTask(prev); return { ok: true, message: 'Task saved.' }
  })
}

/** One-tap status from a list or the mobile view (Start / Done / Reopen). */
export async function setTaskStatus(id: string, status: string): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx()
    const s = z.enum(keysOf(TASK_STATUS)).parse(status)
    const { data, error } = await c.supabase.from('tasks').update({ status: s, ...(s === 'todo' ? { completion: 0 } : {}) }).eq('id', id).select('id,project_id,work_order_id,title,created_by,owner_id')
    if (error) throw error
    if (!data?.length) return { error: 'Not found or not allowed.' }
    const tk = data[0]
    if (s === 'completed' && tk.created_by && tk.created_by !== c.userId) await notifyUser(c, tk.created_by, { title: `Task completed: ${tk.title}`, body: `by ${c.profile.full_name}`, link: `/tasks?open=${id}`, key: `task_done:${id}` })
    touchTask(tk); return { ok: true }   // the row itself shows the new state (no inline text next to the check button)
  })
}

// ───────────── daily site reports ─────────────
const dsrSchema = z.object({
  project_id: uuid, work_order_id: uuid.optional(), report_date: date, site: t(300), supervisor_id: uuid.optional(),
  work_done: z.string().trim().min(1, 'Describe the work completed today').max(8000), work_planned: t(4000),
  progress: z.coerce.number({ message: 'Progress must be a number' }).int().min(0).max(100).optional(),
  issues: t(4000), delays: t(4000), safety_notes: t(4000), customer_instructions: t(4000), materials_delivered: t(4000),
  equipment_used: t(2000), weather: t(120), notes: t(4000),
})
const DKEYS = Object.keys(dsrSchema.shape)
const attendance = (fd: FormData) => [...new Set(fd.getAll('attendance').map(String).filter(x => uuid.safeParse(x).success))].slice(0, 300)

export async function createSiteReport(_: ActionState, fd: FormData): Promise<ActionState> {
  let id: string | null = null
  const r = await safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    const p = dsrSchema.safeParse(pick(fd, DKEYS)); if (!p.success) return invalid(p.error)
    const v = p.data
    if (v.report_date > c.today) return { error: 'A daily report cannot be dated in the future.', fieldErrors: { report_date: 'In the future' } }
    if (!v.site) { const { data: pr } = await c.supabase.from('projects').select('location').eq('id', v.project_id).maybeSingle(); v.site = pr?.location ?? undefined }
    const tok = token(fd), dup = await byToken(c, 'daily_site_reports', tok)
    id = dup ?? await insertOnce(c, 'daily_site_reports', 'site_report', v, tok)
    if (!dup) {
      const att = attendance(fd)
      if (att.length) { const { error } = await c.supabase.from('site_report_attendance').insert(att.map(e => ({ company_id: c.company.id, report_id: id, employee_id: e }))); if (error) throw error }
      // the report's progress figure updates the project's site progress (never lowers it automatically)
      if (v.progress != null) await c.supabase.from('projects').update({ site_progress: v.progress, updated_at: new Date().toISOString() }).eq('id', v.project_id).lt('site_progress', v.progress)
    }
    revalidatePath('/site-reports'); revalidatePath(`/projects/${v.project_id}`)
  })
  if (id) redirect(`/site-reports/${id}`)
  return r
}

export async function updateSiteReport(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    const p = dsrSchema.safeParse(pick(fd, DKEYS)); if (!p.success) return invalid(p.error)
    const v = p.data
    if (v.report_date > c.today) return { error: 'A daily report cannot be dated in the future.', fieldErrors: { report_date: 'In the future' } }
    const { data, error } = await c.supabase.from('daily_site_reports').update({ ...withNulls(v, DKEYS, ['project_id', 'report_date', 'work_done']), updated_at: new Date().toISOString() }).eq('id', id).select('id')
    if (error) throw error
    if (!data?.length) return { error: 'Not found or not allowed.' }
    const att = attendance(fd)
    await c.supabase.from('site_report_attendance').delete().eq('report_id', id)
    if (att.length) { const { error: e } = await c.supabase.from('site_report_attendance').insert(att.map(e => ({ company_id: c.company.id, report_id: id, employee_id: e }))); if (e) throw e }
    revalidatePath('/site-reports'); revalidatePath(`/site-reports/${id}`); revalidatePath(`/projects/${v.project_id}`)
    return { ok: true, message: 'Report saved.' }
  })
}

// ───────────── project cost control & progress ─────────────
export async function saveProjectBudget(projectId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.edit'); need(c, 'finance.view')
    const rows: { category: string; amount: number }[] = []
    for (const k of Object.keys(EXPENSE_CATS)) {
      const raw = str(fd, `budget_${k}`); if (raw == null) continue
      const n = Number(raw.replace(/,/g, ''))
      if (!Number.isFinite(n) || n < 0 || n > 1e11) return { error: `${EXPENSE_CATS[k]}: enter a valid amount.`, fieldErrors: { [`budget_${k}`]: 'Invalid' } }
      rows.push({ category: k, amount: Math.round(n * 100) / 100 })
    }
    const { error: d } = await c.supabase.from('project_budgets').delete().eq('project_id', projectId).not('category', 'in', `(${rows.map(r => r.category).join(',') || 'none'})`)
    if (d) throw d
    if (rows.length) { const { error } = await c.supabase.from('project_budgets').upsert(rows.map(r => ({ ...r, company_id: c.company.id, project_id: projectId, updated_by: c.userId, updated_at: new Date().toISOString() }))); if (error) throw error }
    revalidatePath(`/projects/${projectId}`); return { ok: true, message: rows.length ? 'Estimated costs saved.' : 'Estimate cleared.' }
  })
}

export async function updateProjectProgress(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    const pct = z.coerce.number({ message: 'Progress must be a number' }).int().min(0, 'Progress: 0–100').max(100, 'Progress: 0–100')
    const v = z.object({ fabrication_progress: pct, site_progress: pct, inspection_progress: pct, overall_progress: pct.optional() })
      .safeParse({ fabrication_progress: str(fd, 'fabrication_progress') ?? 0, site_progress: str(fd, 'site_progress') ?? 0, inspection_progress: str(fd, 'inspection_progress') ?? 0, overall_progress: str(fd, 'overall_progress') })
    if (!v.success) return invalid(v.error)
    const all = v.data.fabrication_progress === 100 && v.data.site_progress === 100
    const { data, error } = await c.supabase.from('projects').update({ ...v.data, overall_progress: v.data.overall_progress ?? null, ...(all && fd.get('complete') ? { status: 'completed' } : {}), updated_at: new Date().toISOString() }).eq('id', id).select('id')
    if (error) throw error
    if (!data?.length) return { error: 'Project not found.' }
    revalidatePath(`/projects/${id}`); revalidatePath('/projects'); return { ok: true, message: 'Progress updated.' }
  })
}
