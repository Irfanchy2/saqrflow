import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sb = await createClient()
  const { data: e } = await sb.from('employees').select('photo_path').eq('id', id).maybeSingle()          // RLS decides who may see the employee
  if (!e?.photo_path) return new NextResponse(null, { status: 404 })
  const { data } = await createAdminClient().storage.from('vault').createSignedUrl(e.photo_path, 60)
  if (!data) return new NextResponse(null, { status: 404 })
  return NextResponse.redirect(data.signedUrl, { status: 302, headers: { 'Cache-Control': 'private, max-age=30' } })
}
