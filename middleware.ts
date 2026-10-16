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
/**
 * Content-Security-Policy with a fresh nonce per request: only scripts carrying the nonce (Next adds it to its own) and
 * the scripts they load run, so injected markup cannot execute script. Styles stay inline-capable (React style props).
 */
function contentSecurityPolicy(nonce: string, embeddable: boolean, https: boolean) {
  const sb = supabaseConfigured() ? supabaseUrl() : ''
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${sb ? ` ${sb}` : ''}`,
    `connect-src 'self'${sb ? ` ${sb} ${sb.replace('https://', 'wss://')}` : ''}`,
    "font-src 'self' data:", "worker-src 'self' blob:", "frame-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'",
    embeddable ? 'frame-ancestors *' : "frame-ancestors 'self'",   // public enquiry forms (/f/…) may sit in the company's own website
    ...(https ? ['upgrade-insecure-requests'] : []),   // only on an https site (a plain-http test server would break its own images)
  ].join('; ')
}
const API_UNCHECKED_ORIGIN = ['/api/webhooks', '/api/v1', '/api/cron', '/api/health']   // signed / key / secret auth, not cookies

const PUBLIC = ['/login', '/signup', '/api/webhooks', '/api/cron', '/api/health', '/api/v1', '/auth', '/offline', '/p', '/s', '/r', '/q', '/f']   // /p /s /r /q /f: token- or slug-scoped public pages (lib/portal.ts); /api/v1: API-key auth (lib/api.ts)

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

  // Cross-site request forgery: a browser always sends Origin on a cross-site POST, so a cookie-authenticated API write
  // from another site is refused here (server actions get the same check from Next itself).
  if (pathname.startsWith('/api') && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !API_UNCHECKED_ORIGIN.some(p => pathname.startsWith(p))) {
    // compare hosts with the Host the browser used (nextUrl can name the server's own bind address instead)
    const origin = req.headers.get('origin'), host = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
    let originHost: string | null = null; try { originHost = origin ? new URL(origin).host : null } catch { originHost = 'invalid' }
    if (origin && originHost !== host) {
      console.warn(`[csrf] refused ${req.method} ${pathname} from origin ${origin}`)
      return NextResponse.json({ error: 'Cross-site request refused.' }, { status: 403 })
    }
  }
  const nonce = btoa(crypto.randomUUID())
  const csp = pathname.startsWith('/api') ? null : contentSecurityPolicy(nonce, pathname.startsWith('/f/'), (req.headers.get('x-forwarded-proto') ?? req.nextUrl.protocol.replace(':', '')) === 'https')

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
  // Two-step verification: with an authenticator enrolled, a password-only session reaches nothing but the code screen.
  // (The database enforces the same rule: such a session sees no company data at all.)
  if (user && user.factors?.some(f => f.status === 'verified') && !['/login/mfa', '/login/reset', '/auth/signout', '/auth/callback'].includes(pathname)) {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    if (aal?.currentLevel !== 'aal2') {
      if (pathname.startsWith('/api')) return NextResponse.json({ error: 'Two-step verification required.' }, { status: 401 })
      const u = req.nextUrl.clone(); u.pathname = '/login/mfa'; u.search = ''; return NextResponse.redirect(u)
    }
  }
  // The user verified above is handed to the page (lib/auth reads it) so the request does not ask the auth server a second time.
  // A client-supplied copy of these headers is always removed first: only this middleware can set them.
  const headers = new Headers(req.headers)
  headers.delete(VERIFIED_UID); headers.delete(VERIFIED_EMAIL); headers.delete(VERIFIED_SIG)
  const token = await verifiedToken()
  if (user && token) { headers.set(VERIFIED_UID, user.id); headers.set(VERIFIED_EMAIL, encodeURIComponent(user.email ?? '')); headers.set(VERIFIED_SIG, token) }
  // Next reads the nonce from the request's CSP header and puts it on every script it renders
  if (csp) { headers.set('x-nonce', nonce); headers.set('Content-Security-Policy', csp) }
  const res = NextResponse.next({ request: { headers } })
  if (csp) res.headers.set('Content-Security-Policy', csp)
  refreshed.forEach(({ name, value, options }) => res.cookies.set(name, value, options))
  return res
}
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|.*\\.(?:svg|png|jpg|ico|webp)$).*)'] }
