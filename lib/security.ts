import 'server-only'
import { createAdminClient } from './supabase/admin'
import { requestMeta } from './sessions'

/*
 * Server-side security helpers (service role). Monitoring and limits must never break the request that triggered them:
 * every helper catches its own errors.
 */

export type SecurityEventKind =
  | 'sign_in_failed' | 'sign_in_locked' | 'mfa_failed' | 'new_device' | 'password_reset_requested' | 'password_changed'
  | 'permission_denied' | 'rate_limited' | 'api_key_rejected' | 'webhook_signature_rejected' | 'upload_rejected'

/**
 * Shared fixed-window limit (all server instances count together, unlike the in-memory limiter in middleware).
 * Returns true while the caller is within the limit. If the counter itself is unavailable the request is allowed and the
 * problem logged: a database hiccup must not lock everyone out.
 */
export async function rateLimit(key: string, max: number, windowSeconds: number): Promise<boolean> {
  try {
    const { data, error } = await createAdminClient().rpc('rate_limit_hit', { p_key: key, p_max: max, p_window_seconds: windowSeconds })
    if (error) throw error
    return data !== false
  } catch (e) { console.warn('[rate-limit] unavailable', (e as Error).message); return true }
}

/** Records a security event (failed / locked sign-ins, permission denials, rejected keys and signatures…) for monitoring. */
export async function securityEvent(kind: SecurityEventKind, a: { companyId?: string | null; userId?: string | null; detail?: string } = {}) {
  try {
    const { ip } = await requestMeta().catch(() => ({ ip: null }))
    await createAdminClient().from('security_events').insert({ kind, company_id: a.companyId ?? null, user_id: a.userId ?? null, detail: a.detail?.slice(0, 500) ?? null, ip })
  } catch (e) { console.warn('[security-event]', kind, (e as Error).message) }
}

/**
 * In-app alert to every active user of the company who can manage users. `throttleKey` limits it to one alert per hour,
 * so an attack produces a single notification instead of hundreds.
 */
export async function alertAdmins(companyId: string, n: { title: string; body?: string; link?: string; throttleKey: string; severity?: 'warning' | 'critical' }) {
  try {
    if (!(await rateLimit(`alert:${companyId}:${n.throttleKey}`, 1, 3600))) return
    const admin = createAdminClient()
    const [{ data: users }, { data: rp }] = await Promise.all([
      admin.from('profiles').select('id, role').eq('company_id', companyId).eq('is_active', true),
      admin.from('role_permissions').select('role').eq('permission', 'users.manage'),
    ])
    const roles = new Set((rp ?? []).map(x => x.role)), ids = (users ?? []).filter(u => roles.has(u.role)).map(u => u.id)
    if (!ids.length) return
    const key = `sec:${n.throttleKey}:${new Date().toISOString().slice(0, 13)}`
    await admin.from('in_app_notifications').upsert(ids.map(id => ({ company_id: companyId, user_id: id, title: n.title.slice(0, 200), body: n.body?.slice(0, 500) ?? null,
      link: n.link ?? '/users/activity', severity: n.severity ?? 'warning', dedupe_key: key.slice(0, 200) })), { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true })
  } catch (e) { console.warn('[security-alert]', (e as Error).message) }
}

/** Notification to one user about their own account (new device, password changed). */
export async function alertUser(companyId: string, userId: string, n: { title: string; body?: string; link?: string; key: string; severity?: 'info' | 'warning' }) {
  try {
    await createAdminClient().from('in_app_notifications').upsert({ company_id: companyId, user_id: userId, title: n.title.slice(0, 200), body: n.body?.slice(0, 500) ?? null,
      link: n.link ?? '/settings#account', severity: n.severity ?? 'warning', dedupe_key: n.key.slice(0, 200) }, { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true })
  } catch (e) { console.warn('[security-alert]', (e as Error).message) }
}

/** Password rules: 10+ characters, not mostly one character, not the email name, not a common password. */
const COMMON = new Set(['password', 'password1', 'password12', 'password123', '1234567890', '12345678910', 'qwertyuiop', 'qwerty1234', 'iloveyou12', 'welcome123',
  'admin12345', 'letmein123', 'abc1234567', 'passw0rd12', 'p@ssw0rd12', 'changeme12', 'dubai12345', 'uae1234567', 'averiqo123', 'company123'])
export function passwordProblem(pw: string, email?: string | null): string | null {
  if (pw.length < 10) return 'Use at least 10 characters.'
  if (pw.length > 128) return 'Use at most 128 characters.'
  if (new Set(pw.toLowerCase()).size < 5) return 'Use more varied characters.'
  if (COMMON.has(pw.toLowerCase())) return 'This password is too common. Choose another.'
  const local = (email ?? '').split('@')[0]?.toLowerCase()
  if (local && local.length >= 4 && pw.toLowerCase().includes(local)) return 'Do not use your email name in the password.'
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter(r => r.test(pw)).length
  if (pw.length < 14 && classes < 2) return 'Mix letters with numbers or symbols (or use 14+ characters).'
  return null
}

/**
 * A refused action (role check or row-level security). Logged for monitoring; a user who is refused 10 times within
 * 10 minutes (probing for data they may not see) triggers one alert to the company's admins.
 */
export async function recordDenied(c: { userId: string; company: { id: string }; profile: { full_name: string; role: string } }, detail: string) {
  try {
    await securityEvent('permission_denied', { companyId: c.company.id, userId: c.userId, detail: `${c.profile.full_name} (${c.profile.role}): ${detail}` })
    if (!(await rateLimit(`deny:${c.userId}`, 10, 600)))
      await alertAdmins(c.company.id, { title: 'Repeated refused actions', body: `${c.profile.full_name} was refused 10+ actions in 10 minutes. Review the security events.`, throttleKey: `deny:${c.userId}` })
  } catch (e) { console.warn('[security-denied]', (e as Error).message) }
}

/** Audit-log entry for an admin action whose table is not audited row by row (secrets: the value itself is never logged). */
export async function auditAction(companyId: string, userId: string | null, action: 'SECRET_SET' | 'SECRET_REMOVED', table: string, changes: Record<string, unknown>) {
  try { await createAdminClient().from('audit_logs').insert({ company_id: companyId, user_id: userId, action, table_name: table, record_id: null, changes }) }
  catch (e) { console.warn('[audit]', action, (e as Error).message) }
}
