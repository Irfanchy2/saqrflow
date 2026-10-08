import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { supabaseConfigured, supabasePublishableKey, supabaseUrl } from './lib/env'

// ── naive per-instance rate limiter (fixed window). Use Redis/Upstash when running >1 instance. ──
const hits = new Map<string, { n: number; reset: number }>()
function limited(key: string, max: number, windowMs: number) {
  const now = Date.now(), h = hits.get(key)
  if (!h || h.reset < now) { hits.set(key, { n: 1, reset: now + windowMs }); if (hits.size > 5000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k); return false }
  return ++h.n > max
}
const PUBLIC = ['/login', '/signup', '/api/webhooks', '/api/cron', '/api/health', '/auth']

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const strict = (pathname === '/login' || pathname === '/signup') && req.method === 'POST'
  // In-app router requests (link prefetches from dense tables, tabs and drill-down cards, and client-side navigations) get their own
  // larger bucket, so an office sharing one public IP is not locked out by background prefetching. Full page loads, API calls and
  // sign-ins keep their stricter limits. Next strips its router headers before middleware; the `_rsc` query parameter remains.
  const rsc = req.nextUrl.searchParams.has('_rsc') || req.headers.get('rsc') === '1'
  const bucket = strict ? 'auth' : pathname.startsWith('/api') ? 'api' : rsc ? 'rsc' : 'web'
  const max = { auth: 10, api: 120, rsc: 3000, web: 600 }[bucket]
  if (limited(`${bucket}:${ip}`, max, 60_000)) {
    console.warn(`[rate-limit] ${bucket} limit (${max}/min) reached for ${ip} on ${req.method} ${pathname}`)
    return new NextResponse('Too many requests. Please wait a minute and try again.', { status: 429, headers: { 'Retry-After': '60' } })
  }

  if (!supabaseConfigured()) return NextResponse.next()      // setup screen is rendered by the layout
  let res = NextResponse.next({ request: req })
  const supabase = createServerClient(supabaseUrl(), supabasePublishableKey(), {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list: { name: string; value: string; options: CookieOptions }[]) => { list.forEach(({ name, value }) => req.cookies.set(name, value)); res = NextResponse.next({ request: req }); list.forEach(({ name, value, options }) => res.cookies.set(name, value, options)) },
    },
  })
  const { data: { user } } = await supabase.auth.getUser()
  const isPublic = PUBLIC.some(p => pathname === p || pathname.startsWith(p + '/'))
  if (!user && !isPublic) { const u = req.nextUrl.clone(); u.pathname = '/login'; u.searchParams.set('next', pathname); return NextResponse.redirect(u) }
  if (user && (pathname === '/login' || pathname === '/signup')) { const u = req.nextUrl.clone(); u.pathname = '/'; u.search = ''; return NextResponse.redirect(u) }
  return res
}
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|ico|webp)$).*)'] }
