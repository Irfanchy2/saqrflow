import 'server-only'
import type { Ctx } from './auth'
import { sha256Hex, storagePath, validateUpload } from './files'

export interface SavedVersion { versionId: string; versionNo: number; duplicateOf: string[] }

/** Validate + store a file as a NEW immutable version of `docId`. Existing versions are never touched. */
export async function saveVersion(c: Ctx, docId: string, file: File, note?: string, action: 'upload' | 'replace' = 'upload'): Promise<SavedVersion> {
  const buf = new Uint8Array(await file.arrayBuffer())
  const check = validateUpload({ name: file.name, size: file.size, type: file.type }, buf.slice(0, 16))
  if (!check.ok) throw new Error(check.error)
  const sha = sha256Hex(buf)

  // Duplicate detection (same bytes already stored in this company) – warn, don't block.
  const { data: dups } = await c.supabase.from('document_versions').select('document_id, documents!document_versions_document_id_fkey(name)').eq('sha256', sha).neq('document_id', docId).limit(3)
  const duplicateOf = (dups ?? []).map((d: any) => d.documents?.name).filter(Boolean)

  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: last } = await c.supabase.from('document_versions').select('version_no').eq('document_id', docId).order('version_no', { ascending: false }).limit(1).maybeSingle()
    const versionNo = (last?.version_no ?? 0) + 1
    const path = storagePath(c.company.id, docId, versionNo, file.name)
    const up = await c.supabase.storage.from('vault').upload(path, buf, { contentType: check.mime, upsert: false })
    if (up.error && /exists|duplicate/i.test(up.error.message)) continue
    if (up.error) throw new Error('File upload failed. Please try again.')
    const { data: v, error } = await c.supabase.from('document_versions').insert({
      company_id: c.company.id, document_id: docId, version_no: versionNo, storage_path: path, file_name: file.name,
      mime_type: check.mime, size_bytes: file.size, sha256: sha, note: note || null, uploaded_by: c.userId,
    }).select('id').single()
    if (error?.code === '23505') continue                       // raced with another upload: take the next number
    if (error) throw error
    await c.supabase.from('documents').update({ current_version_id: v.id }).eq('id', docId)
    await c.supabase.from('document_access_logs').insert({ company_id: c.company.id, document_id: docId, user_id: c.userId, action })
    return { versionId: v.id, versionNo, duplicateOf }
  }
  throw new Error('Could not save the file version, please retry.')
}
