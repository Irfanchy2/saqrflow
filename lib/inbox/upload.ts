import 'server-only'
import type { Ctx } from '../auth'
import { safeFileName, sha256Hex, validateUpload } from '../files'

export const MAX_INBOX_FILES = 20
/** Step 1 of the pipeline: validate and store the original privately (status "uploaded"). Nothing is read yet. */
export async function storeInboxUpload(c: Ctx, f: File, source: 'upload' | 'mobile'): Promise<{ id: string; sha256: string; mime_type: string; file_name: string; buf: Uint8Array } | { error: string }> {
  const buf = new Uint8Array(await f.arrayBuffer())
  const chk = validateUpload({ name: f.name, size: f.size, type: f.type }, buf.slice(0, 16))
  if (!chk.ok) return { error: `${f.name}: ${chk.error}` }
  const id = crypto.randomUUID(), sha = sha256Hex(buf)
  const path = `${c.company.id}/inbox/${id}/${safeFileName(f.name)}`                     // company-id/…/uuid: never a person's name as the key
  const up = await c.supabase.storage.from('vault').upload(path, buf, { contentType: chk.mime, upsert: false })
  if (up.error) return { error: `${f.name}: upload failed` }
  const { error } = await c.supabase.from('document_inbox').insert({ id, company_id: c.company.id, uploaded_by: c.userId, source, storage_path: path, file_name: f.name, mime_type: chk.mime, size_bytes: f.size, sha256: sha, status: 'uploaded' })
  if (error) return { error: `${f.name}: ${error.message}` }
  return { id, sha256: sha, mime_type: chk.mime, file_name: f.name, buf }
}
