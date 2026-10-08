import 'server-only'
import { createAdminClient } from './supabase/admin'
import type { Ctx } from './auth'

/**
 * In-app notification to another user of the SAME company (e.g. "task assigned to you").
 * Users may only read / mark their own notifications (RLS), so the insert goes through the service role, after
 * checking that the recipient belongs to the caller's company. Never notifies the caller about their own action.
 */
export async function notifyUser(c: Ctx, userId: string | null | undefined, n: { title: string; body?: string; link: string; key: string; severity?: 'info' | 'warning' | 'critical' }) {
  if (!userId || userId === c.userId) return
  try {
    const admin = createAdminClient()
    const { data: p } = await admin.from('profiles').select('company_id').eq('id', userId).maybeSingle()
    if (!p || p.company_id !== c.company.id) return
    await admin.from('in_app_notifications').upsert({
      company_id: c.company.id, user_id: userId, title: n.title.slice(0, 200), body: n.body?.slice(0, 500) ?? null,
      link: n.link, severity: n.severity ?? 'info', dedupe_key: n.key.slice(0, 200),
    }, { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true })
  } catch (e) { console.warn('[notify]', (e as Error).message) }   // a notification must never break the save
}
