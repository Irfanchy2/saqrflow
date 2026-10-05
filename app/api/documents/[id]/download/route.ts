import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Secure file access. Permission is decided by RLS on the caller's own session (the document row is invisible
 * to anyone who may not view it). The file is then served either via a 60-second signed URL (download) or
 * proxied with a locked-down CSP (preview). Every access is logged. There is no public URL for any file.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const mode = req.nextUrl.searchParams.get('mode') === 'preview' ? 'preview' : 'download'
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return new NextResponse('Unauthorized', { status: 401 })

  const { data: doc } = await sb.from('documents').select('id, company_id, current_version_id').eq('id', id).maybeSingle()
  if (!doc) return new NextResponse('Not found', { status: 404 })           // hidden by RLS ⇒ same as not existing
  const vid = req.nextUrl.searchParams.get('v') ?? doc.current_version_id
  if (!vid) return new NextResponse('This document has no file attached.', { status: 404 })
  const { data: ver } = await sb.from('document_versions').select('storage_path, file_name, mime_type').eq('id', vid).eq('document_id', id).maybeSingle()
  if (!ver) return new NextResponse('Not found', { status: 404 })

  await sb.from('document_access_logs').insert({ company_id: doc.company_id, document_id: id, user_id: user.id, action: mode === 'preview' ? 'view' : 'download' })
  const admin = createAdminClient()
  const { data: signed, error } = await admin.storage.from('vault').createSignedUrl(ver.storage_path, 60, mode === 'download' ? { download: ver.file_name } : undefined)
  if (error || !signed) return new NextResponse('File is unavailable.', { status: 502 })
  if (mode === 'download') return NextResponse.redirect(signed.signedUrl, { status: 302, headers: { 'Cache-Control': 'no-store' } })

  const upstream = await fetch(signed.signedUrl)
  if (!upstream.ok || !upstream.body) return new NextResponse('File is unavailable.', { status: 502 })
  return new NextResponse(upstream.body, { headers: {
    'Content-Type': ver.mime_type, 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(ver.file_name)}`,
    'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': ver.mime_type === 'application/pdf' ? "default-src 'none'; frame-ancestors 'self'" : "sandbox; default-src 'none'; img-src 'self' data:; frame-ancestors 'self'",
  } })
}
