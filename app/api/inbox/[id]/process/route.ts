import { NextResponse, type NextRequest } from 'next/server'
import { getCtx } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { processInboxItem } from '@/lib/inbox/pipeline'
import { isOcrMode } from '@/lib/ai/ocr'

export const runtime = 'nodejs'
export const maxDuration = 120
/** OCR → AI → matching for one stored upload. The caller must be able to see the item (RLS) and upload documents. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const c = await getCtx()
  if (!c.can('documents.upload')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { data: it } = await c.supabase.from('document_inbox').select('id,sha256,mime_type,storage_path,status,file_name').eq('id', id).maybeSingle()
  if (!it) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (['filed', 'rejected'].includes(it.status)) return NextResponse.json({ status: it.status })
  const { data: blob } = await createAdminClient().storage.from('vault').download(it.storage_path)   // visibility already checked through RLS
  if (!blob) return NextResponse.json({ error: 'The stored file could not be read.' }, { status: 500 })
  const ocr = req.nextUrl.searchParams.get('ocr')
  const d = await processInboxItem(c, it, new Uint8Array(await blob.arrayBuffer()), { ocr: isOcrMode(ocr) ? ocr : undefined })
  if (!d) {
    const { data: after } = await c.supabase.from('document_inbox').select('status,error').eq('id', id).maybeSingle()
    return NextResponse.json({ status: after?.status ?? 'failed', error: after?.error ?? 'Processing failed' })
  }
  return NextResponse.json({ status: d.status, label: d.suggestion.label, confidence: d.confidence })
}
