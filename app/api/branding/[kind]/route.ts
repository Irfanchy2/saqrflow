import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

const KINDS = ['header', 'header_invoice', 'footer', 'stamp', 'signature']
/** Company letterhead / footer / stamp / signature — signed-in members of the company only (stamp & signature are sensitive). */
export async function GET(_: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params
  if (!KINDS.includes(kind)) return new NextResponse('Not found', { status: 404 })
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser(); if (!user) return new NextResponse('Unauthorized', { status: 401 })
  const { data: me } = await sb.from('profiles').select('company_id').eq('id', user.id).maybeSingle()
  const { data: s } = await sb.from('app_settings').select('value').eq('key', `branding.${kind}`).maybeSingle()   // RLS: own company only
  const path = typeof s?.value === 'string' ? s.value : null
  if (!me || !path || !path.startsWith(me.company_id + '/')) return new NextResponse('Not found', { status: 404 })
  const { data } = await createAdminClient().storage.from('vault').download(path)
  if (!data) return new NextResponse('Not found', { status: 404 })
  return new NextResponse(data.stream(), { headers: { 'Content-Type': /\.png$/i.test(path) ? 'image/png' : /\.webp$/i.test(path) ? 'image/webp' : 'image/jpeg', 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff' } })
}
