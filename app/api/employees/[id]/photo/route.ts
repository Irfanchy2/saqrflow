import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { thumbUrl } from '@/lib/thumbs'

export const runtime = 'nodejs'
/** Employee photo. `?w=96` returns a cached small WebP so lists never download the full-size photo. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sb = await createClient()
  const { data: e } = await sb.from('employees').select('photo_path').eq('id', id).maybeSingle()          // RLS decides who may see the employee
  if (!e?.photo_path) return new NextResponse(null, { status: 404 })
  const w = Number(req.nextUrl.searchParams.get('w'))
  const url = w ? await thumbUrl(e.photo_path, w) : (await createAdminClient().storage.from('vault').createSignedUrl(e.photo_path, 60)).data?.signedUrl
  if (!url) return new NextResponse(null, { status: 404 })
  return NextResponse.redirect(url, { status: 302, headers: { 'Cache-Control': 'private, max-age=30' } })
}
