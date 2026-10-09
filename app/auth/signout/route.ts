import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sessionIdFromJwt } from '@/lib/device'

export const dynamic = 'force-dynamic'

/** Ends a session that was signed out from another device. Only acts when the session really is revoked (no logout CSRF). */
export async function GET(req: NextRequest) {
  const sb = await createClient()
  const sid = sessionIdFromJwt((await sb.auth.getSession()).data.session?.access_token)
  const { data: revoked } = sid ? await sb.rpc('touch_session', { p_sid: sid, p_ip: null, p_ua: null }) : { data: false }
  if (revoked !== true) return NextResponse.redirect(new URL('/', req.nextUrl.origin))
  await sb.auth.signOut({ scope: 'local' })
  const u = new URL('/login', req.nextUrl.origin); u.searchParams.set('m', 'revoked')
  return NextResponse.redirect(u)
}
