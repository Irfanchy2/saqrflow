'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getCtx, need } from '@/lib/auth'
import { safe, str } from '@/lib/action'
import { safeFileName, sha256Hex, validateUpload } from '@/lib/files'
import { pool, processInboxItem } from '@/lib/inbox/pipeline'
import { defaultsFor, fileInboxItem, fileSchema } from '@/lib/inbox/file'
import { claudeAvailable } from '@/lib/inbox/claude'
import { createAdminClient } from '@/lib/supabase/admin'
import type { ActionState } from '@/lib/utils'

const MAX_FILES = 20

/** Universal upload: store privately, analyse, suggest a destination. Nothing is filed without confirmation. */
export async function uploadToInbox(_: ActionState, fd: FormData): Promise<ActionState> {
  let batch: string[] = []
  const res = await safe(async () => {
    const c = await getCtx(); need(c, 'documents.upload')
    const files = fd.getAll('file').filter((f): f is File => f instanceof File && f.size > 0)
    if (!files.length) return { error: 'Choose at least one file.' }
    if (files.length > MAX_FILES) return { error: `Upload at most ${MAX_FILES} files at a time.` }
    const source = str(fd, 'source') === 'mobile' ? 'mobile' : 'upload'
    const problems: string[] = []
    const queued: { id: string; sha256: string; mime_type: string; buf: Uint8Array }[] = []
    for (const f of files) {
      const buf = new Uint8Array(await f.arrayBuffer())
      const chk = validateUpload({ name: f.name, size: f.size, type: f.type }, buf.slice(0, 16))
      if (!chk.ok) { problems.push(`${f.name}: ${chk.error}`); continue }
      const id = crypto.randomUUID(), sha = sha256Hex(buf)
      const path = `${c.company.id}/inbox/${id}/${safeFileName(f.name)}`
      const up = await c.supabase.storage.from('vault').upload(path, buf, { contentType: chk.mime, upsert: false })
      if (up.error) { problems.push(`${f.name}: upload failed`); continue }
      const { error } = await c.supabase.from('document_inbox').insert({ id, company_id: c.company.id, uploaded_by: c.userId, source, storage_path: path, file_name: f.name, mime_type: chk.mime, size_bytes: f.size, sha256: sha })
      if (error) { problems.push(`${f.name}: ${error.message}`); continue }
      queued.push({ id, sha256: sha, mime_type: chk.mime, buf })
    }
    await pool(queued, 3, q => processInboxItem(c, q, q.buf))
    batch = queued.map(q => q.id)
    revalidatePath('/inbox'); revalidatePath('/')
    if (!batch.length) return { error: problems.join(' | ') || 'Nothing was uploaded.' }
    if (problems.length) return { error: `${batch.length} processed. Skipped: ${problems.join(' | ')}` }
  })
  if (res?.error && !batch.length) return res
  redirect(`/inbox?batch=${batch.join(',')}${res?.error ? `&warn=${encodeURIComponent(res.error)}` : ''}`)
}

function parseFileForm(fd: FormData) {
  return fileSchema.parse({
    doc_type: str(fd, 'doc_type'), category_id: str(fd, 'category_id'), owner_id: str(fd, 'owner_id'), name: str(fd, 'name'),
    reference_no: str(fd, 'reference_no'), issuing_authority: str(fd, 'issuing_authority'), issue_date: str(fd, 'issue_date'), expiry_date: str(fd, 'expiry_date'),
    reminders: fd.get('reminders') === 'on', mode: str(fd, 'mode') ?? 'new', target_document_id: str(fd, 'mode') === 'version' ? str(fd, 'target_document_id') : undefined,
    plate_number: str(fd, 'plate_number'),
  })
}

export async function confirmAndFile(inboxId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  let docId = ''
  const res = await safe(async () => {
    const c = await getCtx()
    const r = await fileInboxItem(c, inboxId, parseFileForm(fd))
    docId = r.documentId
    revalidatePath('/', 'layout')
  })
  if (res?.error) return res
  redirect(`/documents/${docId}`)
}

/** One click for every high-confidence suggestion (still an explicit human action). */
export async function confirmAllReady(): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'documents.upload')
    const { data: items } = await c.supabase.from('document_inbox').select('*').eq('status', 'ready').limit(50)
    let ok = 0; const failed: string[] = []
    for (const it of items ?? []) {
      const { data: x } = await c.supabase.from('document_extractions').select('fields').eq('inbox_id', it.id).order('created_at', { ascending: false }).limit(1).maybeSingle()
      const d = defaultsFor(it, x)
      try {
        await fileInboxItem(c, it.id, fileSchema.parse({ ...d, owner_id: d.owner_id || undefined, target_document_id: d.mode === 'version' ? d.target_document_id : undefined,
          reference_no: d.reference_no || undefined, issuing_authority: d.issuing_authority || undefined, issue_date: d.issue_date || undefined, expiry_date: d.expiry_date || undefined,
          plate_number: d.plate_number || undefined, reminders: true }))
        ok++
      } catch (e) { failed.push(`${it.file_name}: ${(e as Error).message}`) }
    }
    revalidatePath('/', 'layout')
    return failed.length ? { error: `${ok} filed. Not filed: ${failed.join(' | ')}` } : { ok: true, message: `${ok} document(s) filed.` }
  })
}

export async function rejectInboxItem(inboxId: string): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'documents.upload')
    const { data, error } = await c.supabase.from('document_inbox').update({ status: 'rejected' }).eq('id', inboxId).neq('status', 'filed').select('id')
    if (error) throw error; if (!data?.length) return { error: 'Not found or already filed.' }
    revalidatePath('/inbox'); return { ok: true, message: 'Removed from the inbox (the file is kept in the audit trail).' }
  })
}

/** Re-run analysis (e.g. after enabling AI OCR or adding the missing employee). */
export async function reprocessInboxItem(inboxId: string): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'documents.upload')
    const { data: it } = await c.supabase.from('document_inbox').select('id,sha256,mime_type,storage_path,status').eq('id', inboxId).maybeSingle()
    if (!it) return { error: 'Not found.' }
    if (it.status === 'filed') return { error: 'Already filed.' }
    const { data: blob, error } = await createAdminClient().storage.from('vault').download(it.storage_path)   // row visibility was checked via RLS above
    if (error || !blob) return { error: 'The stored file could not be read.' }
    await c.supabase.from('document_inbox').update({ status: 'processing' }).eq('id', inboxId)
    const d = await processInboxItem(c, it, new Uint8Array(await blob.arrayBuffer()))
    revalidatePath(`/inbox/${inboxId}`); revalidatePath('/inbox')
    return d ? { ok: true, message: `Re-analysed: ${d.status === 'ready' ? 'ready to file' : d.status.replace('_', ' ')}.` } : { error: 'Analysis failed — see the error on the item.' }
  })
}

export async function setAiOcr(enabled: boolean): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'settings.manage')
    if (enabled && !claudeAvailable()) return { error: 'ANTHROPIC_API_KEY is not set on the server.' }
    const { error } = await c.supabase.from('app_settings').upsert({ company_id: c.company.id, key: 'ai.ocr_provider', value: enabled ? 'claude' : 'rules', updated_at: new Date().toISOString() })
    if (error) throw error
    revalidatePath('/settings'); revalidatePath('/inbox')
    return { ok: true, message: enabled ? 'AI reading enabled.' : 'AI reading disabled — local rules only.' }
  })
}
