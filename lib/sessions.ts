import 'server-only'
import { headers } from 'next/headers'
import { createAdminClient } from './supabase/admin'

export type LoginEvent = 'sign_in' | 'sign_in_failed' | 'mfa_verified' | 'mfa_failed' | 'sign_out'

/** Caller IP (first X-Forwarded-For hop, set by Vercel) and User-Agent, trimmed. */
export async function requestMeta() {
  const h = await headers()
  return { ip: (h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || '').slice(0, 64) || null, ua: (h.get('user-agent') ?? '').slice(0, 300) || null }
}

/** Sign-in history row (service role; the table has no insert policy). Failures never break signing in. */
export async function logLogin(event: LoginEvent, a: { userId?: string | null; email?: string | null; sessionId?: string | null; detail?: string }) {
  try {
    const admin = createAdminClient(), m = await requestMeta()
    let userId = a.userId ?? null, companyId: string | null = null
    if (!userId && a.email) { const { data } = await admin.rpc('profile_for_email', { p_email: a.email }); userId = data?.[0]?.id ?? null; companyId = data?.[0]?.company_id ?? null }
    else if (userId) { const { data } = await admin.from('profiles').select('company_id').eq('id', userId).maybeSingle(); companyId = data?.company_id ?? null }
    await admin.from('login_events').insert({ event, user_id: userId, company_id: companyId, email: a.email?.slice(0, 320) ?? null, session_id: a.sessionId ?? null, ip: m.ip, user_agent: m.ua, detail: a.detail?.slice(0, 300) ?? null })
    if (event === 'sign_in' && a.sessionId && userId && companyId)
      await admin.from('user_sessions').upsert({ id: a.sessionId, user_id: userId, company_id: companyId, ip: m.ip, user_agent: m.ua }, { onConflict: 'id', ignoreDuplicates: true })
  } catch (e) { console.warn('[login-events]', (e as Error).message) }
}
