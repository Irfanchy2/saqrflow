import 'server-only'
import type { Ctx } from './auth'
import { createAdminClient } from './supabase/admin'
import { scanUpload, sha256Hex, storagePath, validateUpload } from './files'
import { securityEvent } from './security'

// Supporting attachments for Employee Petty Cash (a photo or PDF of a voucher, transfer slip or receipt). The file is
// checked (type from its bytes, size, active content) before anything is written, then stored in the vault as a
// document owned by the employee's petty cash (owner_type 'petty_cash', owner_id = employee): visible to that employee,
// to petty cash managers and to finance (can_view_document, migration 0038). Written with the service role, so an
// employee never needs upload rights; callers check permission first.

export type Upload = { file: File; buf: Uint8Array; mime: string }

export async function readAttachment(c: Ctx, fd: FormData, field = 'attachment'): Promise<Upload | { error: string } | null> {
  const f = fd.get(field)
  if (!(f instanceof File) || f.size === 0) return null
  const buf = new Uint8Array(await f.arrayBuffer())
  const check = validateUpload({ name: f.name, size: f.size, type: f.type }, buf.slice(0, 16))
  if (!check.ok) return { error: `The attachment was not accepted: ${check.error}` }
  if (!/^(image\/|application\/pdf$)/.test(check.mime)) return { error: 'The attachment must be a photo (JPG, PNG, WEBP) or a PDF.' }
  const bad = scanUpload(buf, check.mime)
  if (bad) { await securityEvent('upload_rejected', { companyId: c.company.id, userId: c.userId, detail: `${f.name}: ${bad}` }); return { error: bad } }
  return { file: f, buf, mime: check.mime }
}

/** Stores a checked attachment as a new petty cash document of the employee; returns the document id. */
export async function storeAttachment(c: Ctx, employeeId: string, name: string, date: string, r: Upload): Promise<string> {
  const admin = createAdminClient()
  const { data: d, error } = await admin.from('documents').insert({
    company_id: c.company.id, owner_type: 'petty_cash', owner_id: employeeId, folder: 'Expenses/Petty cash', reminders_active: false,
    created_by: c.userId, name: name.slice(0, 250), issue_date: date,
  }).select('id').single()
  if (error) throw error
  const path = storagePath(c.company.id, d.id, 1, r.file.name)
  const up = await admin.storage.from('vault').upload(path, r.buf, { contentType: r.mime, upsert: false })
  if (up.error) { await admin.from('documents').update({ deleted_at: new Date().toISOString() }).eq('id', d.id); throw new Error('The attachment could not be uploaded. Please try again.') }
  const { data: ver, error: e2 } = await admin.from('document_versions').insert({
    company_id: c.company.id, document_id: d.id, version_no: 1, storage_path: path, file_name: r.file.name, mime_type: r.mime, size_bytes: r.file.size, sha256: sha256Hex(r.buf), uploaded_by: c.userId,
  }).select('id').single()
  if (e2) throw e2
  await admin.from('documents').update({ current_version_id: ver.id }).eq('id', d.id)
  await admin.from('document_access_logs').insert({ company_id: c.company.id, document_id: d.id, user_id: c.userId, action: 'upload' })
  return d.id
}

/** A stored attachment that was not used (the posting was refused): hidden, so the vault does not keep orphans. */
export async function discardAttachment(id: string) {
  try { await createAdminClient().from('documents').update({ deleted_at: new Date().toISOString() }).eq('id', id) } catch { /* best effort */ }
}
