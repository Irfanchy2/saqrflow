import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { thumbUrl } from '@/lib/thumbs'

export const runtime = 'nodejs'
/** Thumbnail of an image document (project photos, receipts). RLS on `documents` decides access; the full file is never sent. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse(null, { status: 404 })
  const sb = await createClient()
  const { data: d } = await sb.from('documents').select('id, version:document_versions!documents_current_version_fk(storage_path,mime_type)').eq('id', id).is('deleted_at', null).maybeSingle()
  const v: any = d?.version
  if (!v?.storage_path || !String(v.mime_type).startsWith('image/')) return new NextResponse(null, { status: 404 })
  const url = await thumbUrl(v.storage_path, Number(req.nextUrl.searchParams.get('w')) || 320)
  if (!url) return new NextResponse(null, { status: 404 })
  return NextResponse.redirect(url, { status: 302, headers: { 'Cache-Control': 'private, max-age=30' } })
}
