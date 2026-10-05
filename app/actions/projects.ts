'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { getCtx, need } from '@/lib/auth'
import { safe, str } from '@/lib/action'
import { saveVersion } from '@/lib/doc-upload'
import type { ActionState } from '@/lib/utils'

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date')
const uuid = z.string().uuid()
const projectSchema = z.object({
  name: z.string().min(2, 'Project name is required').max(200), code: z.string().max(40).optional(), customer_id: uuid.optional(),
  location: z.string().max(300).optional(), contract_value: z.coerce.number().min(0).max(1e11).optional(),
  start_date: date.optional(), expected_completion: date.optional(), status: z.enum(['planning', 'active', 'on_hold', 'completed', 'cancelled']).default('planning'),
  description: z.string().max(4000).optional(), notes: z.string().max(4000).optional(),
}).refine(v => !v.start_date || !v.expected_completion || v.expected_completion >= v.start_date, { message: 'Completion date must be after the start date', path: ['expected_completion'] })
const KEYS = ['name', 'code', 'customer_id', 'location', 'contract_value', 'start_date', 'expected_completion', 'status', 'description', 'notes']
const parse = (fd: FormData) => projectSchema.parse(Object.fromEntries(KEYS.map(k => [k, str(fd, k)])))
const touch = (id?: string) => { revalidatePath('/projects'); if (id) revalidatePath(`/projects/${id}`); revalidatePath('/') }

export async function createProject(_: ActionState, fd: FormData): Promise<ActionState> {
  let id: string | null = null
  const r = await safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    const v = parse(fd)
    const { data, error } = await c.supabase.from('projects').insert({ ...v, company_id: c.company.id, manager_id: c.userId }).select('id').single()
    if (error) throw error
    id = data.id; touch()
  })
  if (id) redirect(`/projects/${id}`)
  return r
}

export async function updateProject(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    const v = parse(fd)
    const { data, error } = await c.supabase.from('projects').update({ ...v, customer_id: v.customer_id ?? null, updated_at: new Date().toISOString() }).eq('id', id).select('id')
    if (error) throw error
    if (!data?.length) return { error: 'Project not found.' }
    touch(id); return { ok: true, message: 'Project updated.' }
  })
}

export async function updateProgress(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    const pct = z.coerce.number().int().min(0).max(100)
    const v = { fabrication_progress: pct.parse(str(fd, 'fabrication_progress') ?? 0), site_progress: pct.parse(str(fd, 'site_progress') ?? 0) }
    const status = v.fabrication_progress === 100 && v.site_progress === 100 && fd.get('complete') === 'on' ? { status: 'completed' } : {}
    const { error } = await c.supabase.from('projects').update({ ...v, ...status, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) throw error
    touch(id); return { ok: true, message: 'Progress updated.' }
  })
}

const expenseSchema = z.object({
  spent_on: date, category: z.enum(['material', 'labour', 'transport', 'subcontract', 'equipment', 'other']),
  description: z.string().min(1, 'Describe the expense').max(500), amount: z.coerce.number({ message: 'Enter the amount' }).positive('Amount must be greater than zero').max(1e10),
  reference: z.string().max(120).optional(), supplier_id: uuid.optional(),
})
export async function addExpense(projectId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    const v = expenseSchema.parse(Object.fromEntries(['spent_on', 'category', 'description', 'amount', 'reference', 'supplier_id'].map(k => [k, str(fd, k)])))
    const { error } = await c.supabase.from('project_expenses').insert({ ...v, project_id: projectId, company_id: c.company.id, created_by: c.userId })
    if (error) throw error
    touch(projectId); return { ok: true, message: 'Expense added.' }
  })
}
export async function deleteExpense(id: string): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.delete')
    const { data, error } = await c.supabase.from('project_expenses').delete().eq('id', id).select('project_id')
    if (error) throw error
    touch(data?.[0]?.project_id); return { ok: true, message: 'Expense removed.' }
  })
}

export async function addMilestone(projectId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    const v = z.object({ title: z.string().min(1, 'Enter a milestone').max(200), due_date: date }).parse({ title: str(fd, 'title'), due_date: str(fd, 'due_date') })
    const { error } = await c.supabase.from('project_milestones').insert({ ...v, project_id: projectId, company_id: c.company.id })
    if (error) throw error
    touch(projectId); return { ok: true, message: 'Milestone added — it will appear in Smart Reminders.' }
  })
}
export async function toggleMilestone(id: string, done: boolean): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    const { data, error } = await c.supabase.from('project_milestones').update({ done, done_at: done ? new Date().toISOString() : null }).eq('id', id).select('project_id')
    if (error) throw error
    touch(data?.[0]?.project_id); return { ok: true }
  })
}
export async function deleteMilestone(id: string): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.delete')
    const { data, error } = await c.supabase.from('project_milestones').delete().eq('id', id).select('project_id')
    if (error) throw error
    touch(data?.[0]?.project_id); return { ok: true }
  })
}

/** Drawings, LPOs, photos, variation orders… stored as project-owned documents (private storage, versioned). */
export async function uploadProjectFiles(projectId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'documents.upload')
    const files = fd.getAll('file').filter((f): f is File => f instanceof File && f.size > 0)
    if (!files.length) return { error: 'Choose at least one file.' }
    if (files.length > 20) return { error: 'Upload up to 20 files at a time.' }
    const { data: p } = await c.supabase.from('projects').select('name,customer_id').eq('id', projectId).maybeSingle()
    if (!p) return { error: 'Project not found.' }
    const kind = z.enum(['drawing', 'lpo', 'photo', 'variation', 'contract', 'other']).catch('other').parse(str(fd, 'kind'))
    const label: Record<string, string> = { drawing: 'Drawings', lpo: 'LPO & Contracts', contract: 'LPO & Contracts', photo: 'Site Photos', variation: 'Variation Orders', other: 'Files' }
    const errors: string[] = []
    for (const f of files) {
      const { data: doc, error } = await c.supabase.from('documents').insert({
        company_id: c.company.id, owner_type: 'project', owner_id: projectId, name: f.name.replace(/\.[^.]+$/, '').slice(0, 250) || 'Project file',
        folder: `Projects/${p.name.replace(/[\\/]/g, '-').slice(0, 80)}/${label[kind]}`, reminders_active: false, created_by: c.userId, responsible_user_id: c.userId,
      }).select('id').single()
      if (error) throw error
      try { await saveVersion(c, doc.id, f) } catch (e) {
        errors.push(`${f.name}: ${(e as Error).message}`)
        await c.supabase.from('documents').update({ deleted_at: new Date().toISOString(), deleted_by: c.userId }).eq('id', doc.id)
        continue
      }
      await c.supabase.from('document_relationships').insert([
        { company_id: c.company.id, document_id: doc.id, related_type: 'project', related_id: projectId, role: kind, created_by: c.userId },
        ...(p.customer_id ? [{ company_id: c.company.id, document_id: doc.id, related_type: 'customer', related_id: p.customer_id, role: kind, created_by: c.userId }] : []),
      ])
    }
    touch(projectId); revalidatePath('/vault')
    if (errors.length) return { error: `${files.length - errors.length} uploaded. Rejected — ${errors.join(' · ')}` }
    return { ok: true, message: `${files.length} file${files.length === 1 ? '' : 's'} uploaded.` }
  })
}

export async function updateParty(kind: 'customers' | 'suppliers', id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    const v = z.object({ name: z.string().min(2, 'Name is required').max(200), contact_person: z.string().max(120).optional(), phone: z.string().max(40).optional(), email: z.string().email('Enter a valid email').optional(), trn: z.string().max(30).optional(), address: z.string().max(400).optional(), notes: z.string().max(2000).optional() })
      .parse(Object.fromEntries(['name', 'contact_person', 'phone', 'email', 'trn', 'address', 'notes'].map(k => [k, str(fd, k)])))
    const { error } = await c.supabase.from(z.enum(['customers', 'suppliers']).parse(kind)).update({ contact_person: null, phone: null, email: null, trn: null, address: null, notes: null, ...v }).eq('id', id)
    if (error) throw error
    revalidatePath('/parties'); revalidatePath(`/parties/${id}`); return { ok: true, message: 'Saved.' }
  })
}
