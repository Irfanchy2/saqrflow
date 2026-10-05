import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/** Private preview/download of an inbox upload. Visibility decided by RLS on document_inbox; file served via 60 s signed URL. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser(); if (!user) return new NextResponse('Unauthorized', { status: 401 })
  const { data: it } = await sb.from('document_inbox').select('storage_path,file_name,mime_type').eq('id', id).maybeSingle()
  if (!it) return new NextResponse('Not found', { status: 404 })
  const download = req.nextUrl.searchParams.get('mode') === 'download'
  const { data: signed } = await createAdminClient().storage.from('vault').createSignedUrl(it.storage_path, 60, download ? { download: it.file_name } : undefined)
  if (!signed) return new NextResponse('File is unavailable.', { status: 502 })
  if (download) return NextResponse.redirect(signed.signedUrl, { status: 302, headers: { 'Cache-Control': 'no-store' } })
  const up = await fetch(signed.signedUrl); if (!up.ok || !up.body) return new NextResponse('File is unavailable.', { status: 502 })
  return new NextResponse(up.body, { headers: { 'Content-Type': it.mime_type, 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(it.file_name)}`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': it.mime_type === 'application/pdf' ? "default-src 'none'; frame-ancestors 'self'" : "sandbox; default-src 'none'; img-src 'self' data:; frame-ancestors 'self'" } })
}
