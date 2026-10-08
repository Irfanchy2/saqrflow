import 'server-only'
import { z } from 'zod'
import type { Ctx } from '../auth'
import { need } from '../auth'
import { DOC_TYPES, typeDef } from './catalog'
import { registerExistingVersion } from '../doc-upload'

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date').optional()
export const fileSchema = z.object({
  doc_type: z.enum(DOC_TYPES.map(d => d.key) as [string, ...string[]], { message: 'Choose the document type' }),
  category_id: z.string().uuid().optional(),
  owner_id: z.string().uuid().optional(),          // employee / customer / supplier / project / vehicle(asset) id
  new_employee_name: z.string().trim().min(2).max(200).optional(),   // reviewer explicitly chose “Create new employee”
  project_id: z.string().uuid().optional(),        // optional extra link (e.g. invoice → project)
  name: z.string().min(1, 'Document name is required').max(250),
  reference_no: z.string().max(100).optional(),
  issuing_authority: z.string().max(200).optional(),
  issue_date: date, expiry_date: date,
  reminders: z.boolean(),
  mode: z.enum(['new', 'version', 'metadata']),
  target_document_id: z.string().uuid().optional(),
  plate_number: z.string().max(40).optional(),
}).refine(v => !v.issue_date || !v.expiry_date || v.expiry_date >= v.issue_date, { message: 'Expiry date must be on or after the issue date', path: ['expiry_date'] })
  .refine(v => v.mode === 'new' || !!v.target_document_id, { message: 'Choose the existing document to add a version to', path: ['target_document_id'] })
export type FileInput = z.infer<typeof fileSchema>

async function categoryFor(c: Ctx, docType: string, explicit?: string): Promise<{ id: string; isDefault: boolean }> {
  const def = typeDef(docType)!
  if (explicit) return { id: explicit, isDefault: false }
  const { data: learned } = await c.supabase.from('document_type_mappings').select('category_id').eq('doc_type', docType).maybeSingle()
  if (learned) return { id: learned.category_id, isDefault: true }
  const { data: cat } = await c.supabase.from('document_categories').select('id').eq('name', def.category).eq('scope', def.categoryScope).maybeSingle()
  if (cat) return { id: cat.id, isDefault: true }
  const { data: created, error } = await c.supabase.from('document_categories').insert({ company_id: c.company.id, name: def.category, scope: def.categoryScope }).select('id').single()
  if (error) throw error
  return { id: created.id, isDefault: true }
}

/** Human-confirmed filing of an inbox item. One stored file; the document row + relationships point at it. */
export async function fileInboxItem(c: Ctx, inboxId: string, input: FileInput): Promise<{ documentId: string; renewed: boolean; version: number }> {
  need(c, 'documents.upload')
  let v = input
  const { data: item } = await c.supabase.from('document_inbox').select('*').eq('id', inboxId).maybeSingle()
  if (!item) throw new Error('Upload not found.')
  if (item.status === 'filed') throw new Error('This document has already been filed.')
  const def = typeDef(v.doc_type)!
  if (def.owner === 'employee') need(c, 'employees.view_sensitive')
  if (def.owner === 'employee' && !v.owner_id && v.new_employee_name) {
    // only on an explicit reviewer choice — never automatically (avoids duplicate people)
    const { data: same } = await c.supabase.from('employees').select('id,full_name').ilike('full_name', v.new_employee_name).limit(1)
    if (same?.length) throw new Error(`An employee named “${same[0].full_name}” already exists. Choose them from the list instead.`)
    const { count } = await c.supabase.from('employees').select('id', { count: 'exact', head: true })
    let created: string | null = null
    for (let n = (count ?? 0) + 1; n < (count ?? 0) + 20 && !created; n++) {
      const { data, error } = await c.supabase.from('employees').insert({ company_id: c.company.id, employee_no: `EMP-${String(n).padStart(3, '0')}`, full_name: v.new_employee_name }).select('id').single()
      if (error?.code === '23505') continue
      if (error) throw error
      created = data.id
    }
    if (!created) throw new Error('Could not create the employee record.')
    v = { ...v, owner_id: created }
  }
  if (def.owner === 'employee' && !v.owner_id) throw new Error('Choose the employee this document belongs to.')
  const file = { storage_path: item.storage_path, file_name: item.file_name, mime_type: item.mime_type, size_bytes: item.size_bytes, sha256: item.sha256 }
  let documentId: string, renewed = false

  if (v.mode === 'metadata') {
    // duplicate resolution “Replace metadata”: keep the existing file, correct its details from this upload
    const upd: Record<string, unknown> = {}
    if (v.reference_no) upd.reference_no = v.reference_no
    if (v.issuing_authority) upd.issuing_authority = v.issuing_authority
    if (v.issue_date) upd.issue_date = v.issue_date
    if (v.expiry_date) { upd.expiry_date = v.expiry_date; upd.reminders_active = v.reminders }
    const { data, error } = await c.supabase.from('documents').update(upd).eq('id', v.target_document_id!).select('id')
    if (error) throw error
    if (!data?.length) throw new Error('The existing document could not be found.')
    const { error: e3 } = await c.supabase.from('document_inbox').update({ status: 'filed', doc_type: v.doc_type, filed_document_id: v.target_document_id, filed_by: c.userId, filed_at: new Date().toISOString() }).eq('id', inboxId)
    if (e3) throw e3
    return { documentId: v.target_document_id!, renewed: false, version: 0 }
  }
  if (v.mode === 'version') {
    const { data: target } = await c.supabase.from('documents').select('id,expiry_date,issue_date').eq('id', v.target_document_id!).maybeSingle()
    if (!target) throw new Error('The existing document could not be found.')
    documentId = target.id
    if (v.expiry_date && (!target.expiry_date || v.expiry_date > target.expiry_date)) {
      const { error } = await c.supabase.from('document_renewals').insert({ company_id: c.company.id, document_id: target.id, previous_expiry: target.expiry_date, new_expiry: v.expiry_date, notes: 'Renewed copy filed from Smart Inbox', performed_by: c.userId })
      if (error) throw error
      const upd: Record<string, unknown> = { expiry_date: v.expiry_date, status: 'active', reminders_active: v.reminders }
      if (v.issue_date) upd.issue_date = v.issue_date
      if (v.reference_no) upd.reference_no = v.reference_no
      const { error: e2 } = await c.supabase.from('documents').update(upd).eq('id', target.id); if (e2) throw e2
      renewed = true
    }
  } else {
    const cat = await categoryFor(c, v.doc_type, v.category_id)
    const ownerName = await ownerLabel(c, def.owner, v.owner_id) ?? (item.suggestion as any)?.owner?.name
    const ownerType = def.owner === 'employee' ? 'employee' : ['customer', 'supplier'].includes(def.owner) ? 'vault' : def.owner === 'project' ? (v.owner_id ? 'project' : 'company')
      : def.owner === 'vehicle' ? (v.owner_id ? 'asset' : 'company') : 'company'
    const ownerIdCol = ['employee', 'project', 'vehicle'].includes(def.owner) ? v.owner_id ?? null : null
    const folder = def.owner === 'vehicle' ? `Vehicles/${v.plate_number ?? ownerName ?? 'Unassigned'}` : def.owner === 'customer' ? `Customers/${ownerName ?? 'Unmatched'}/${def.path.at(-1)}`
      : def.owner === 'supplier' ? `Suppliers/${ownerName ?? 'Unmatched'}/${def.path.at(-1)}` : def.owner === 'project' ? `Projects/${ownerName ?? 'Unassigned'}/${def.path.at(-1)}` : null
    const { data: doc, error } = await c.supabase.from('documents').insert({
      company_id: c.company.id, owner_type: ownerType, owner_id: ownerIdCol, category_id: cat.id,
      name: v.name, reference_no: v.reference_no ?? null, issuing_authority: v.issuing_authority ?? null, issue_date: v.issue_date ?? null,
      expiry_date: v.expiry_date ?? null, reminders_active: v.reminders && !!v.expiry_date, folder, created_by: c.userId, responsible_user_id: c.userId,
      source_inbox_id: inboxId,
    }).select('id').single()
    if (error) throw error
    documentId = doc.id
    if (!cat.isDefault) {   // learn: next time this doc type goes to the category the reviewer chose
      const { data: m } = await c.supabase.from('document_type_mappings').select('times_used').eq('doc_type', v.doc_type).maybeSingle()
      await c.supabase.from('document_type_mappings').upsert({ company_id: c.company.id, doc_type: v.doc_type, category_id: cat.id, times_used: (m?.times_used ?? 0) + 1, updated_by: c.userId, updated_at: new Date().toISOString() })
    }
  }
  const ver = await registerExistingVersion(c, documentId, file, v.mode === 'version' ? (renewed ? 'Renewal (Smart Inbox)' : 'New version (Smart Inbox)') : 'Filed from Smart Inbox')
  // one stored file, many links (no copies)
  const REL: Record<string, string> = { employee: 'employee', customer: 'customer', supplier: 'supplier', project: 'project', vehicle: 'vehicle' }
  const links: { related_type: string; related_id: string | null }[] = [{ related_type: 'company', related_id: c.company.id }]
  if (v.owner_id && REL[def.owner]) links.push({ related_type: REL[def.owner], related_id: v.owner_id })
  if (v.project_id && def.owner !== 'project') links.push({ related_type: 'project', related_id: v.project_id })
  const { error: relErr } = await c.supabase.from('document_relationships').upsert(links.map(l => ({ ...l, company_id: c.company.id, document_id: documentId, role: v.doc_type, created_by: c.userId })), { onConflict: 'document_id,related_type,related_id', ignoreDuplicates: true })
  if (relErr) console.warn('[file] relationships', relErr.message)
  const { error: e3 } = await c.supabase.from('document_inbox').update({ status: 'filed', doc_type: v.doc_type, filed_document_id: documentId, filed_by: c.userId, filed_at: new Date().toISOString() }).eq('id', inboxId)
  if (e3) throw e3
  return { documentId, renewed, version: ver.versionNo }
}

async function ownerLabel(c: Ctx, owner: string, id?: string): Promise<string | null> {
  if (!id) return null
  const t = owner === 'customer' ? 'customers' : owner === 'supplier' ? 'suppliers' : owner === 'project' ? 'projects' : owner === 'vehicle' ? 'assets' : owner === 'employee' ? 'employees' : null
  if (!t) return null
  const { data } = await c.supabase.from(t).select(t === 'employees' ? 'full_name' : 'name').eq('id', id).maybeSingle()
  return ((data as any)?.name ?? (data as any)?.full_name ?? null)?.replace(/[\\/]/g, '-') ?? null
}

/** Defaults for the confirm form, derived from the stored suggestion + extraction. */
export function defaultsFor(item: any, x: any) {
  const def = typeDef(item.doc_type)
  const f = (k: string) => x?.fields?.[k]?.value as string | undefined
  const holder = f('holder_name')
  const s = item.suggestion ?? {}
  const renewal = (s.duplicates ?? []).find((d: any) => d.kind === 'renewal' || d.kind === 'same_number')
  const year = f('expiry_date')?.slice(0, 4)
  return {
    doc_type: item.doc_type && def ? item.doc_type : '',
    name: def ? (def.owner === 'employee' && (s.owner?.name || holder) ? `${def.label} – ${s.owner?.name ?? holder}` : ['customer', 'supplier', 'project'].includes(def.owner) ? `${def.label} ${f('document_number') ?? ''}`.trim() : def.owner === 'vehicle' ? `${def.label}${f('plate_number') ? ' – ' + f('plate_number') : ''}` : `${def.label}${year ? ' ' + year : ''}`) : item.file_name.replace(/\.[^.]+$/, ''),
    owner_id: s.owner?.id ?? '', reference_no: f('document_number') ?? f('trn') ?? '', issuing_authority: f('issuing_authority') ?? '',
    issue_date: f('issue_date') ?? '', expiry_date: f('expiry_date') ?? '', plate_number: f('plate_number') ?? '',
    mode: renewal ? 'version' : 'new', target_document_id: renewal?.documentId ?? '', project_id: s.project?.id ?? '',
  }
}
