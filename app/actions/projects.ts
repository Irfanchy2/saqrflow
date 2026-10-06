'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { getCtx, need } from '@/lib/auth'
import { safe, str } from '@/lib/action'
import { saveVersion } from '@/lib/doc-upload'
import type { ActionState } from '@/lib/utils'
import { readParty } from '@/lib/parties'
import { PHOTO_CATS } from '@/lib/projects'

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
    // blank code → project reference from the numbering engine (Settings → Document numbering → Project reference)
    if (!v.code) { const { data: n } = await c.supabase.rpc('next_document_number', { p_doc_type: 'project' }); if (n) v.code = n as string }
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
  spent_on: date, category: z.enum(['material', 'labour', 'transport', 'fuel', 'equipment', 'subcontract', 'accommodation', 'food', 'maintenance', 'other'], { message: 'Choose a category' }),
  description: z.string().min(1, 'Describe the expense').max(500), amount: z.coerce.number({ message: 'Enter the amount' }).positive('Amount must be greater than zero').max(1e10).transform(n => Math.round(n * 100) / 100),
  vat_amount: z.coerce.number({ message: 'VAT must be a number' }).min(0, 'VAT cannot be negative').max(1e10).default(0).transform(n => Math.round(n * 100) / 100),
  reference: z.string().max(120).optional(), supplier_id: uuid.optional(), supplier_name: z.string().max(200).optional(),
  payment_method: z.enum(['cash', 'bank_transfer', 'cheque', 'card', 'credit', 'other']).optional(), employee_id: uuid.optional(), project_id: uuid.optional(),
  notes: z.string().max(2000).optional(), idempotency_key: uuid.optional(),
}).refine(v => v.vat_amount <= v.amount, { message: 'VAT looks larger than the amount — enter the amount before VAT', path: ['vat_amount'] })
const EXP_KEYS = ['spent_on', 'category', 'description', 'amount', 'vat_amount', 'reference', 'supplier_id', 'supplier_name', 'payment_method', 'employee_id', 'project_id', 'notes', 'idempotency_key']

/** Expense with optional project and receipt file. Receipt OCR only pre-fills the form — this saves exactly what the user confirmed. */
export async function saveExpense(id: string | null, fixedProject: string | null, _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.edit'); need(c, 'finance.view')
    const r = expenseSchema.safeParse(Object.fromEntries(EXP_KEYS.map(k => [k, str(fd, k)])))
    if (!r.success) return { error: r.error.issues[0].message, fieldErrors: Object.fromEntries(r.error.issues.map(i => [i.path.join('.'), i.message])) }
    const v = r.data
    if (v.spent_on > c.today) return { error: 'The expense date cannot be in the future.', fieldErrors: { spent_on: 'In the future' } }
    if (!id && v.idempotency_key) { const { data: dup } = await c.supabase.from('project_expenses').select('id').eq('idempotency_key', v.idempotency_key).maybeSingle(); if (dup) return { ok: true, message: 'Expense already saved.' } }
    const projectId = fixedProject ?? v.project_id ?? null
    let receiptId: string | null = null
    const f = fd.get('file')
    if (f instanceof File && f.size > 0 && c.can('documents.upload')) {
      const { data: d, error: de } = await c.supabase.from('documents').insert({ company_id: c.company.id, owner_type: projectId ? 'project' : 'vault', owner_id: projectId, name: `Receipt — ${v.supplier_name ?? v.description}`.slice(0, 250), reference_no: v.reference ?? null, issue_date: v.spent_on, folder: 'Expenses/Receipts', reminders_active: false, created_by: c.userId }).select('id').single()
      if (de) throw de
      try { await saveVersion(c, d.id, f) } catch (e) { await c.supabase.from('documents').update({ deleted_at: new Date().toISOString() }).eq('id', d.id); return { error: `Expense not saved — the receipt was rejected: ${(e as Error).message}` } }
      receiptId = d.id
    }
    const row = { ...v, project_id: projectId, supplier_name: v.supplier_name ?? null, reference: v.reference ?? null, notes: v.notes ?? null, payment_method: v.payment_method ?? null, employee_id: v.employee_id ?? null, ...(receiptId ? { receipt_document_id: receiptId } : {}) }
    const { error } = id ? await c.supabase.from('project_expenses').update({ ...row, idempotency_key: undefined }).eq('id', id)
      : await c.supabase.from('project_expenses').insert({ ...row, company_id: c.company.id, created_by: c.userId })
    if (error) { if (error.code === '23505') return { ok: true, message: 'Expense already saved.' }; throw error }
    touch(projectId ?? undefined); revalidatePath('/expenses'); revalidatePath('/')
    return { ok: true, message: id ? 'Expense updated.' : 'Expense added.' }
  })
}
/** kept for the project page's existing form */
export async function addExpense(projectId: string, prev: ActionState, fd: FormData): Promise<ActionState> { return saveExpense(null, projectId, prev, fd) }
export async function deleteExpense(id: string): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.delete')
    const { data, error } = await c.supabase.from('project_expenses').delete().eq('id', id).select('project_id')
    if (error) throw error
    touch(data?.[0]?.project_id ?? undefined); revalidatePath('/expenses'); return { ok: true, message: 'Expense removed.' }
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
    const table = z.enum(['customers', 'suppliers']).parse(kind)
    const r = readParty(fd)
    if (!r.success) return { error: r.error.issues[0].message, fieldErrors: Object.fromEntries(r.error.issues.map(i => [i.path.join('.'), i.message])) }
    const blank = { contact_person: null, phone: null, whatsapp: null, email: null, trn: null, address: null, notes: null }
    const row: Record<string, unknown> = { ...blank, ...r.data }
    if (table === 'customers') Object.assign(row, { credit_days: r.data.credit_days ?? null, opening_balance: r.data.opening_balance ?? 0, opening_balance_date: r.data.opening_balance_date ?? null, updated_at: new Date().toISOString() })
    else { delete row.credit_days; delete row.opening_balance; delete row.opening_balance_date }
    const { error } = await c.supabase.from(table).update(row).eq('id', id)
    if (error) { if (error.code === '23505') return { error: 'Another record already uses this name.' }; throw error }
    revalidatePath('/parties'); revalidatePath(`/parties/${id}`); return { ok: true, message: 'Saved.' }
  })
}

/** Before / progress / after photos: stored privately, shown on the project page as small thumbnails (originals untouched). */
export async function uploadProjectPhotos(projectId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'documents.upload')
    const files = fd.getAll('file').filter((f): f is File => f instanceof File && f.size > 0)
    if (!files.length) return { error: 'Choose at least one photo.' }
    if (files.length > 30) return { error: 'Upload up to 30 photos at a time.' }
    if (files.some(f => !/^image\//.test(f.type))) return { error: 'Only images (JPG, PNG, WEBP, HEIC) can be added as photos. Use “Project files” for PDFs.' }
    const cat = z.enum(['before', 'fabrication', 'installation', 'progress', 'completed']).catch('progress').parse(str(fd, 'category'))
    const taken = str(fd, 'taken_on') && /^\d{4}-\d{2}-\d{2}$/.test(str(fd, 'taken_on')!) ? str(fd, 'taken_on')! : c.today
    const caption = str(fd, 'caption')?.slice(0, 500) ?? null
    const { data: p } = await c.supabase.from('projects').select('name').eq('id', projectId).maybeSingle()
    if (!p) return { error: 'Project not found.' }
    const errors: string[] = []
    for (const f of files) {
      const { data: doc, error } = await c.supabase.from('documents').insert({
        company_id: c.company.id, owner_type: 'project', owner_id: projectId, name: (caption ?? `${PHOTO_CATS[cat]} photo`).slice(0, 250), notes: caption, issue_date: taken,
        folder: `Projects/${p.name.replace(/[\\/]/g, '-').slice(0, 80)}/Photos/${PHOTO_CATS[cat]}`, reminders_active: false, created_by: c.userId,
      }).select('id').single()
      if (error) throw error
      try { await saveVersion(c, doc.id, f) } catch (e) { errors.push(`${f.name}: ${(e as Error).message}`); await c.supabase.from('documents').update({ deleted_at: new Date().toISOString() }).eq('id', doc.id); continue }
      await c.supabase.from('document_relationships').insert({ company_id: c.company.id, document_id: doc.id, related_type: 'project', related_id: projectId, role: `photo_${cat}`, created_by: c.userId })
    }
    touch(projectId)
    if (errors.length) return { error: `${files.length - errors.length} added. Rejected — ${errors.join(' · ')}` }
    return { ok: true, message: `${files.length} photo${files.length === 1 ? '' : 's'} added.` }
  })
}
export async function setProjectMember(projectId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    const emp = uuid.safeParse(str(fd, 'employee_id')); if (!emp.success) return { error: 'Choose an employee.' }
    const { error } = await c.supabase.from('project_members').upsert({ company_id: c.company.id, project_id: projectId, employee_id: emp.data, role: str(fd, 'role')?.slice(0, 80) ?? null })
    if (error) throw error
    touch(projectId); return { ok: true, message: 'Team updated.' }
  })
}
export async function removeProjectMember(projectId: string, employeeId: string): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    const { error } = await c.supabase.from('project_members').delete().eq('project_id', projectId).eq('employee_id', employeeId); if (error) throw error
    touch(projectId); return { ok: true, message: 'Removed from the project.' }
  })
}
