import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/** Marks one notification as read (RLS: only your own) and opens the related record. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sb = await createClient()
  const { data } = /^[0-9a-f-]{36}$/i.test(id) ? await sb.from('in_app_notifications').update({ read_at: new Date().toISOString() }).eq('id', id).is('read_at', null).select('link').maybeSingle() : { data: null }
  let link = data?.link
  if (!link) link = (await sb.from('in_app_notifications').select('link').eq('id', id).maybeSingle()).data?.link
  const safeLink = link && link.startsWith('/') && !link.startsWith('//') ? link : '/'
  return NextResponse.redirect(new URL(safeLink, req.url), { status: 303 })
}
