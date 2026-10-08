// Shared by the middleware (edge) and lib/auth (node): a server-only token proving the "verified user" request headers
// were set by our middleware. Derived from a server secret, never sent to the browser. Without it the headers are ignored.
export const VERIFIED_UID = 'x-averiqo-verified-uid'
export const VERIFIED_EMAIL = 'x-averiqo-verified-email'
export const VERIFIED_SIG = 'x-averiqo-verified-sig'
let cached: Promise<string | null> | null = null
export function verifiedToken(): Promise<string | null> {
  return (cached ??= (async () => {
    const seed = process.env.AVERIQO_MIDDLEWARE_SECRET || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!seed) return null
    const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`averiqo-mw:${seed}`))
    return Array.from(new Uint8Array(d), b => b.toString(16).padStart(2, '0')).join('')
  })())
}
