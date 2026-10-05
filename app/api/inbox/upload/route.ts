import { NextResponse, type NextRequest } from 'next/server'
import { getCtx } from '@/lib/auth'
import { MAX_INBOX_FILES, storeInboxUpload } from '@/lib/inbox/upload'

export const runtime = 'nodejs'
export const maxDuration = 60
/** Stores files privately and returns their inbox ids; the browser then asks for each to be processed (live progress). */
export async function POST(req: NextRequest) {
  const c = await getCtx()
  if (!c.can('documents.upload')) return NextResponse.json({ error: 'You are not allowed to upload documents.' }, { status: 403 })
  const fd = await req.formData()
  const files = fd.getAll('file').filter((f): f is File => f instanceof File && f.size > 0)
  if (!files.length) return NextResponse.json({ error: 'Choose at least one file.' }, { status: 400 })
  if (files.length > MAX_INBOX_FILES) return NextResponse.json({ error: `Upload at most ${MAX_INBOX_FILES} files at a time.` }, { status: 400 })
  const source = fd.get('source') === 'mobile' ? 'mobile' : 'upload'
  const items: { id: string; name: string }[] = [], problems: string[] = []
  for (const f of files) {
    const r = await storeInboxUpload(c, f, source)
    if ('error' in r) problems.push(r.error); else items.push({ id: r.id, name: r.file_name })
  }
  return NextResponse.json({ items, problems }, { status: items.length ? 200 : 400 })
}
