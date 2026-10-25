import { NextResponse, type NextRequest } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'

const OTP_TYPES = new Set(['recovery', 'invite', 'signup', 'magiclink', 'email', 'email_change'])
/** Did this session start from a password-reset link? (Supabase records the sign-in method in the token's `amr` claim.) */
function fromRecovery(accessToken: string | undefined) {
  try { const p = JSON.parse(Buffer.from(accessToken!.split('.')[1], 'base64url').toString()); return (p.amr ?? []).some((a: { method?: string }) => a.method === 'recovery') }
  catch { return false }
}

/**
 * Email links (confirm sign-up, invitation, password reset) land here: sign the person in for that step, then go on to a page
 * of this app only. Accepts every link format Supabase sends: a one-time `code` (PKCE) or a `token_hash` + `type` (works
 * even when the link is opened on another device). A reset link always ends on "Choose a new password"; an expired or used
 * link says so instead of showing a plain sign-in form.
 */
export async function GET(req: NextRequest) {
  // the address the browser used (nextUrl can name the server's own bind address), so the sign-in cookie set here applies
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
  const origin = host ? `${req.headers.get('x-forwarded-proto') ?? req.nextUrl.protocol.replace(':', '')}://${host}` : req.nextUrl.origin
  const sp = req.nextUrl.searchParams
  const code = sp.get('code'), tokenHash = sp.get('token_hash'), type = sp.get('type') ?? ''
  const next = sp.get('next') ?? '/'
  const sb = await createClient()
  let ok = true, recovery = type === 'recovery'
  if (tokenHash && OTP_TYPES.has(type)) {
    const { data, error } = await sb.auth.verifyOtp({ token_hash: tokenHash, type: type as EmailOtpType })
    ok = !error; recovery ||= fromRecovery(data.session?.access_token)
  } else if (code) {
    const { data, error } = await sb.auth.exchangeCodeForSession(code)
    ok = !error; recovery ||= fromRecovery(data.session?.access_token)
  }
  if (!ok && (code || tokenHash)) return NextResponse.redirect(new URL(recovery ? '/login/reset?expired=1' : '/login?link=expired', origin))
  const safe = next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/'
  return NextResponse.redirect(new URL(recovery ? '/login/reset' : safe, origin))
}
