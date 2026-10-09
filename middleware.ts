import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { supabaseConfigured, supabasePublishableKey, supabaseUrl } from './lib/env'
import { VERIFIED_EMAIL, VERIFIED_SIG, VERIFIED_UID, verifiedToken } from './lib/verified-user'

// ── naive per-instance rate limiter (fixed window). Use Redis/Upstash when running >1 instance. ──
const hits = new Map<string, { n: number; reset: number }>()
function limited(key: string, max: number, windowMs: number) {
  const now = Date.now(), h = hits.get(key)
  if (!h || h.reset < now) { hits.set(key, { n: 1, reset: now + windowMs }); if (hits.size > 5000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k); return false }
  return ++h.n > max
}
const PUBLIC = ['/login', '/signup', '/api/webhooks', '/api/cron', '/api/health', '/auth', '/p', '/s', '/r', '/q', '/f']   // /p /s /r /q /f: token- or slug-scoped public pages (lib/portal.ts)

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const strict = (pathname === '/login' || pathname === '/signup') && req.method === 'POST'
  // In-app router requests (link prefetches from dense tables, tabs and drill-down cards, and client-side navigations) get their own
  // larger bucket, so an office sharing one public IP is not locked out by background prefetching. Full page loads, API calls and
  // sign-ins keep their stricter limits. Next hides its router headers and `_rsc` from middleware, so a router fetch is recognised
  // as a GET that does not ask for an HTML document (browsers send Accept: text/html for real page loads). Still capped below.
  const rsc = req.method === 'GET' && !(req.headers.get('accept') ?? '').includes('text/html')
  const bucket = strict ? 'auth' : pathname.startsWith('/api') ? 'api' : rsc ? 'rsc' : 'web'
  const max = { auth: 10, api: 120, rsc: 3000, web: 600 }[bucket]
  if (limited(`${bucket}:${ip}`, max, 60_000)) {
    console.warn(`[rate-limit] ${bucket} limit (${max}/min) reached for ${ip} on ${req.method} ${pathname}`)
    return new NextResponse('Too many requests. Please wait a minute and try again.', { status: 429, headers: { 'Retry-After': '60' } })
  }

  if (!supabaseConfigured()) return NextResponse.next()      // setup screen is rendered by the layout
  const refreshed: { name: string; value: string; options: CookieOptions }[] = []
  const supabase = createServerClient(supabaseUrl(), supabasePublishableKey(), {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list: { name: string; value: string; options: CookieOptions }[]) => { list.forEach(({ name, value }) => req.cookies.set(name, value)); refreshed.push(...list) },
    },
  })
  const { data: { user } } = await supabase.auth.getUser()
  const isPublic = PUBLIC.some(p => pathname === p || pathname.startsWith(p + '/'))
  if (!user && !isPublic) { const u = req.nextUrl.clone(); u.pathname = '/login'; u.searchParams.set('next', pathname); return NextResponse.redirect(u) }
  if (user && (pathname === '/login' || pathname === '/signup')) { const u = req.nextUrl.clone(); u.pathname = '/'; u.search = ''; return NextResponse.redirect(u) }
  // The user verified above is handed to the page (lib/auth reads it) so the request does not ask the auth server a second time.
  // A client-supplied copy of these headers is always removed first: only this middleware can set them.
  const headers = new Headers(req.headers)
  headers.delete(VERIFIED_UID); headers.delete(VERIFIED_EMAIL); headers.delete(VERIFIED_SIG)
  const token = await verifiedToken()
  if (user && token) { headers.set(VERIFIED_UID, user.id); headers.set(VERIFIED_EMAIL, encodeURIComponent(user.email ?? '')); headers.set(VERIFIED_SIG, token) }
  const res = NextResponse.next({ request: { headers } })
  refreshed.forEach(({ name, value, options }) => res.cookies.set(name, value, options))
  return res
}
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\.(?:svg|png|jpg|ico|webp)$).*)'] }
