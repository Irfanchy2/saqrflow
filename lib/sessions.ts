import 'server-only'
import { headers } from 'next/headers'
import { createAdminClient } from './supabase/admin'

export type LoginEvent = 'sign_in' | 'sign_in_failed' | 'sign_in_locked' | 'mfa_verified' | 'mfa_failed' | 'sign_out' | 'password_reset_requested' | 'password_changed' | 'new_device'

/** Caller IP (first X-Forwarded-For hop, set by Vercel) and User-Agent, trimmed. */
export async function requestMeta() {
  const h = await headers()
  return { ip: (h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || '').slice(0, 64) || null, ua: (h.get('user-agent') ?? '').slice(0, 300) || null }
}

/** Sign-in history row (service role; the table has no insert policy). Failures never break signing in. Returns who it matched. */
export async function logLogin(event: LoginEvent, a: { userId?: string | null; email?: string | null; sessionId?: string | null; detail?: string }): Promise<{ userId: string | null; companyId: string | null }> {
  let userId = a.userId ?? null, companyId: string | null = null
  try {
    const admin = createAdminClient(), m = await requestMeta()
    if (!userId && a.email) { const { data } = await admin.rpc('profile_for_email', { p_email: a.email }); userId = data?.[0]?.id ?? null; companyId = data?.[0]?.company_id ?? null }
    else if (userId) { const { data } = await admin.from('profiles').select('company_id').eq('id', userId).maybeSingle(); companyId = data?.company_id ?? null }
    await admin.from('login_events').insert({ event, user_id: userId, company_id: companyId, email: a.email?.toLowerCase().slice(0, 320) ?? null, session_id: a.sessionId ?? null, ip: m.ip, user_agent: m.ua, detail: a.detail?.slice(0, 300) ?? null })
    if (event === 'sign_in' && a.sessionId && userId && companyId)
      await admin.from('user_sessions').upsert({ id: a.sessionId, user_id: userId, company_id: companyId, ip: m.ip, user_agent: m.ua }, { onConflict: 'id', ignoreDuplicates: true })
  } catch (e) { console.warn('[login-events]', (e as Error).message) }
  return { userId, companyId }
}

/** Failed sign-ins for this email in the last 15 minutes (the lockout counter; shared by every server instance). */
export async function recentFailedSignIns(email: string): Promise<number> {
  try {
    const { count } = await createAdminClient().from('login_events').select('id', { count: 'exact', head: true })
      .eq('event', 'sign_in_failed').eq('email', email.toLowerCase()).gte('created_at', new Date(Date.now() - 15 * 60_000).toISOString())
    return count ?? 0
  } catch { return 0 }
}

/** A sign-in from a browser this account has not used in 90 days: history entry, security event, alert to the user. */
export async function checkNewDevice(userId: string, companyId: string, email: string, sessionId: string | null) {
  try {
    const admin = createAdminClient(), m = await requestMeta()
    const since = new Date(Date.now() - 90 * 86_400_000).toISOString()
    const { data: prev } = await admin.from('login_events').select('ip, user_agent').eq('user_id', userId).eq('event', 'sign_in').gte('created_at', since)
      .neq('session_id', sessionId ?? '00000000-0000-0000-0000-000000000000').limit(200)
    if (!prev?.length) return                                                           // first sign-in: nothing to compare with
    if (prev.some(p => p.user_agent === m.ua)) return                                 // a browser this account already uses (networks change too often to count)
    const device = describeAgent(m.ua)
    await admin.from('login_events').insert({ event: 'new_device', user_id: userId, company_id: companyId, email: email.toLowerCase(), session_id: sessionId, ip: m.ip, user_agent: m.ua, detail: device.slice(0, 300) })
    const { securityEvent, alertUser } = await import('./security')
    await securityEvent('new_device', { companyId, userId, detail: `${email}: ${device}${m.ip ? ` from ${m.ip}` : ''}` })
    await alertUser(companyId, userId, { title: 'New sign-in to your account', body: `${device}${m.ip ? ` · ${m.ip}` : ''}. If this was not you, sign out that device in Settings → Account and change your password.`, key: `new-device:${sessionId ?? Date.now()}` })
  } catch (e) { console.warn('[new-device]', (e as Error).message) }
}
/** "Chrome on Windows" from a User-Agent string (best effort, for people to read). */
export function describeAgent(ua: string | null): string {
  if (!ua) return 'Unknown device'
  const b = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'A browser'
  const o = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad|iOS/.test(ua) ? 'iOS' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'an unknown system'
  return `${b} on ${o}`
}
