import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
/** Email links (confirm sign-up, password reset) land here: exchange the one-time code, then go on to a page of this app only. */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code'), next = req.nextUrl.searchParams.get('next') ?? '/'
  if (code) await (await createClient()).auth.exchangeCodeForSession(code)
  const safe = next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/'
  return NextResponse.redirect(new URL(safe, req.nextUrl.origin))
}
