'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getCtx, need } from '@/lib/auth'
import { safe, str } from '@/lib/action'
import { saveVersion } from '@/lib/doc-upload'
import { parseOffsets } from '@/lib/reminders/schedule'
import type { ActionState } from '@/lib/utils'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date').optional()
const docSchema = z.object({
  name: z.string().min(1, 'Document name is required').max(250),
  category_id: z.string().uuid('Choose a category').optional(),
  reference_no: z.string().max(100).optional(), issuing_authority: z.string().max(200).optional(),
  issue_date: isoDate, expiry_date: isoDate,
  responsible_user_id: z.string().uuid().optional(),
  renewal_fee: z.coerce.number().min(0).max(100_000_000).optional(),
  notes: z.string().max(4000).optional(), folder: z.string().max(120).optional(),
}).refine(d => !d.issue_date || !d.expiry_date || d.expiry_date >= d.issue_date, { message: 'Expiry date must be on or after the issue date', path: ['expiry_date'] })

function parseDoc(fd: FormData) {
  const raw: Record<string, unknown> = {}
  for (const k of ['name', 'category_id', 'reference_no', 'issuing_authority', 'issue_date', 'expiry_date', 'responsible_user_id', 'renewal_fee', 'notes', 'folder']) raw[k] = str(fd, k)
  const parsed = docSchema.parse(raw)
  const offsetsRaw = str(fd, 'reminder_days')
  const reminder_days = offsetsRaw ? parseOffsets(offsetsRaw) : null
  return { ...parsed, reminder_days: reminder_days?.length ? reminder_days : null }
}
const fileOf = (fd: FormData) => { const f = fd.get('file'); return f instanceof File && f.size > 0 ? f : null }
const fileList = (fd: FormData) => fd.getAll('file').filter((f): f is File => f instanceof File && f.size > 0)

export async function createDocument(_: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'documents.upload')
    const ownerType = z.enum(['company', 'employee', 'project', 'asset', 'cheque', 'vault']).parse(str(fd, 'owner_type') ?? 'company')
    const ownerId = str(fd, 'owner_id')
    const d = parseDoc(fd)
    const { data: doc, error } = await c.supabase.from('documents').insert({
      ...d, company_id: c.company.id, owner_type: ownerType, owner_id: ownerId ?? null, created_by: c.userId,
      responsible_user_id: d.responsible_user_id ?? c.userId,
    }).select('id').single()
    if (error) throw error
    await c.supabase.from('document_access_logs').insert({ company_id: c.company.id, document_id: doc.id, user_id: c.userId, action: 'upload' })
    let message = 'Document saved.'
    const f = fileOf(fd)
    if (f) {
      try { const v = await saveVersion(c, doc.id, f); if (v.duplicateOf.length) message += ` Note: identical file already stored as “${v.duplicateOf.join('”, “')}”.` }
      catch (e) { revalidatePath('/', 'layout'); return { error: `Document was saved, but the file was rejected: ${(e as Error).message}` } }
    }
    revalidatePath('/', 'layout')
    return { ok: true, message }
  })
}

/** Vault bulk/drag-and-drop upload: one document per file, metadata inferred from the file name. */
export async function bulkUpload(_: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'documents.upload')
    const files = fileList(fd); if (!files.length) return { error: 'Choose at least one file.' }
    if (files.length > 20) return { error: 'Upload at most 20 files at a time.' }
    const category_id = str(fd, 'category_id'), folder = str(fd, 'folder')
    let ok = 0; const problems: string[] = []; const dupes: string[] = []
    for (const f of files) {
      const { data: doc, error } = await c.supabase.from('documents').insert({
        company_id: c.company.id, owner_type: 'vault', name: f.name.replace(/\.[^.]+$/, '').slice(0, 250), category_id: category_id ?? null,
        folder: folder ?? null, created_by: c.userId, responsible_user_id: c.userId, reminders_active: false,   // no expiry known → nothing to remind
      }).select('id').single()
      if (error) { problems.push(`${f.name}: not allowed`); continue }
      try { const v = await saveVersion(c, doc.id, f); ok++; if (v.duplicateOf.length) dupes.push(`${f.name} ≈ ${v.duplicateOf[0]}`) }
      catch (e) { problems.push(`${f.name}: ${(e as Error).message}`) }
    }
    revalidatePath('/vault')
    const msg = `${ok} of ${files.length} file(s) uploaded.${dupes.length ? ` Possible duplicates: ${dupes.join('; ')}.` : ''}`
    return problems.length ? { error: `${msg} Problems: ${problems.join(' | ')}` } : { ok: true, message: msg }
  })
}

export async function updateDocument(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    const d = parseDoc(fd)
    const { data, error } = await c.supabase.from('documents').update({ ...d, reminders_active: fd.get('reminders_active') === 'on' }).eq('id', id).select('id')
    if (error) throw error
    if (!data?.length) return { error: 'Document not found or you cannot edit it.' }
    revalidatePath('/', 'layout'); return { ok: true, message: 'Saved.' }
  })
}

export async function replaceFile(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'documents.upload')
    const f = fileOf(fd); if (!f) return { error: 'Choose a file.' }
    const v = await saveVersion(c, id, f, str(fd, 'note'), 'replace')
    revalidatePath(`/documents/${id}`)
    return { ok: true, message: `Saved as version ${v.versionNo}. Earlier versions are kept.${v.duplicateOf.length ? ` Identical to “${v.duplicateOf[0]}”.` : ''}` }
  })
}

export async function recordRenewal(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    const v = z.object({ new_expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the new expiry date'), new_issue: isoDate, fee: z.coerce.number().min(0).optional(), notes: z.string().max(2000).optional() })
      .parse({ new_expiry: str(fd, 'new_expiry'), new_issue: str(fd, 'new_issue'), fee: str(fd, 'fee'), notes: str(fd, 'notes') })
    const { data: doc } = await c.supabase.from('documents').select('expiry_date').eq('id', id).maybeSingle()
    if (!doc) return { error: 'Document not found.' }
    if (doc.expiry_date && v.new_expiry <= doc.expiry_date) return { error: 'The new expiry date must be later than the current one.' }
    const { error } = await c.supabase.from('document_renewals').insert({ company_id: c.company.id, document_id: id, previous_expiry: doc.expiry_date, new_expiry: v.new_expiry, fee: v.fee ?? null, notes: v.notes ?? null, performed_by: c.userId })
    if (error) throw error
    const upd: Record<string, unknown> = { expiry_date: v.new_expiry, status: 'active' }; if (v.new_issue) upd.issue_date = v.new_issue
    const { error: e2 } = await c.supabase.from('documents').update(upd).eq('id', id); if (e2) throw e2
    const f = fileOf(fd); if (f) await saveVersion(c, id, f, 'Renewal', 'replace')
    revalidatePath('/', 'layout'); return { ok: true, message: 'Renewal recorded. Reminders restart for the new expiry date.' }
  })
}

export async function setDeleted(id: string, deleted: boolean): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.delete')
    const { error } = await c.supabase.from('documents').update(deleted ? { deleted_at: new Date().toISOString(), deleted_by: c.userId } : { deleted_at: null, deleted_by: null }).eq('id', id)
    if (error) throw error
    await c.supabase.from('document_access_logs').insert({ company_id: c.company.id, document_id: id, user_id: c.userId, action: deleted ? 'delete' : 'restore' })
    revalidatePath('/', 'layout'); return { ok: true, message: deleted ? 'Moved to recycle bin.' : 'Restored.' }
  })
}

export async function createCategory(_: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    const v = z.object({ name: z.string().min(1, 'Name required').max(120), scope: z.enum(['company', 'employee', 'vehicle', 'other']) }).parse({ name: str(fd, 'name'), scope: str(fd, 'scope') ?? 'company' })
    const days = str(fd, 'reminder_days'); const offs = days ? parseOffsets(days) : []
    const { error } = await c.supabase.from('document_categories').insert({ company_id: c.company.id, name: v.name, scope: v.scope, default_reminder_days: offs.length ? offs : null })
    if (error) throw error
    revalidatePath('/', 'layout'); return { ok: true, message: 'Category added.' }
  })
}
