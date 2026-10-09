import 'server-only'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { VERIFIED_EMAIL, VERIFIED_SIG, VERIFIED_UID, verifiedToken } from './verified-user'
import { cache } from 'react'
import { createClient } from './supabase/server'
import { can, ForbiddenError, type Permission, type Role } from './permissions'
import { todayInTz } from './time'
import { sessionIdFromJwt } from './device'

export interface Ctx {
  supabase: Awaited<ReturnType<typeof createClient>>
  userId: string; email: string
  profile: { id: string; company_id: string; full_name: string; role: Role; locale: string }
  company: { id: string; name: string; timezone: string; currency: string; locale: string }
  today: string
  can: (p: Permission) => boolean
}

/**
 * Loads the signed-in user, profile, company. Redirects to login/onboarding as needed. Cached per request.
 * The middleware has already verified the session with the auth server and passes the user id on (it strips any
 * client-sent copy), so a normal request needs one database round trip here instead of three.
 */
export const getCtx = cache(async (): Promise<Ctx> => {
  const supabase = await createClient()
  const h = await headers()
  const token = await verifiedToken()
  const trusted = !!token && h.get(VERIFIED_SIG) === token   // only our middleware knows the token; a forged header is ignored
  let userId = trusted ? h.get(VERIFIED_UID) : null, email = trusted ? decodeURIComponent(h.get(VERIFIED_EMAIL) ?? '') : ''
  if (!userId) {   // middleware did not vouch for this request (static-looking path, tests): verify with the auth server here
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) redirect('/login')
    userId = user.id; email = user.email ?? ''
  }
  const sid = sessionIdFromJwt((await supabase.auth.getSession()).data.session?.access_token)
  const ip = (h.get('x-forwarded-for')?.split(',')[0]?.trim() || '').slice(0, 64) || null, ua = (h.get('user-agent') ?? '').slice(0, 300) || null
  const [{ data: row }, touch] = await Promise.all([
    supabase.from('profiles').select('id, company_id, full_name, role, locale, company:companies(id, name, timezone, currency, locale)').eq('id', userId).maybeSingle(),
    sid ? supabase.rpc('touch_session', { p_sid: sid, p_ip: ip, p_ua: ua }) : Promise.resolve({ data: false }),
  ])
  if (touch.data === true) redirect('/auth/signout?reason=revoked')   // this device was signed out from another device / by an admin
  if (!row) redirect('/onboarding')
  const company = (Array.isArray(row.company) ? row.company[0] : row.company) as Ctx['company'] | null
  if (!company) redirect('/onboarding')
  const role = row.role as Role
  const profile = { id: row.id, company_id: row.company_id, full_name: row.full_name, role, locale: row.locale }
  return { supabase, userId, email, profile, company, today: todayInTz(new Date(), company.timezone), can: p => can(role, p) }
})

/** Server-action guard: throws (turned into a friendly message by `safe`) when the role lacks the permission. The DB re-checks via RLS. */
export function need(ctx: Ctx, perm: Permission) { if (!ctx.can(perm)) throw new ForbiddenError(perm) }
