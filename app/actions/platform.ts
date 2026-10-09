'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getCtx, need, type Ctx } from '@/lib/auth'
import { safe, str } from '@/lib/action'
import { createAdminClient } from '@/lib/supabase/admin'
import { isEvent } from '@/lib/events'
import { deliverWebhooks, newWebhookSecret } from '@/lib/event-worker'
import { urlProblem } from '@/lib/net-guard'
import { SCOPES, hashApiKey, newApiKey } from '@/lib/api'
import { SECTIONS, latestOccurrence } from '@/lib/report-periods'
import { sendSchedule, type ScheduleRow } from '@/lib/scheduled-reports'
import { processBatch } from '@/lib/reminders/dispatch'
import { makeSenders, supabaseStore } from '@/lib/reminders/engine'
import { sessionIdFromJwt } from '@/lib/device'
import type { ActionState } from '@/lib/utils'

const UUID = /^[0-9a-f-]{36}$/i
const CHANNELS = ['in_app', 'email', 'whatsapp'] as const
const all = (fd: FormData, k: string) => fd.getAll(k).map(String).filter(Boolean)
const settingsPath = () => revalidatePath('/settings')

/** Recipients must be this company's; returns the valid ids (RLS-scoped read). */
async function validRecipients(c: Ctx, ids: string[]) {
  const clean = [...new Set(ids.filter(x => UUID.test(x)))].slice(0, 50)
  if (!clean.length) return []
  const { data } = await c.supabase.from('notification_recipients').select('id').in('id', clean)
  return (data ?? []).map(r => r.id)
}

// ───────────── notification rules ─────────────
export async function saveNotificationRule(id: string | null, _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'settings.manage')
    const event = str(fd, 'event') ?? ''
    if (!isEvent(event)) return { error: 'Choose what should trigger the alert.', fieldErrors: { event: 'Required' } }
    const channels = z.array(z.enum(CHANNELS)).min(1, 'Choose at least one channel').parse(all(fd, 'channels'))
    const recipient_ids = await validRecipients(c, all(fd, 'recipients'))
    if (!recipient_ids.length) return { error: 'Choose at least one recipient (add people under Reminders → Recipients).' }
    const min = str(fd, 'min_amount'), min_amount = min ? z.coerce.number().min(0).max(1e12).parse(min) : null
    const row = { name: z.string().trim().min(1, 'Give the rule a name').max(120).parse(str(fd, 'name') ?? ''), event, min_amount, channels, recipient_ids }
    const q = id && UUID.test(id) ? c.supabase.from('notification_rules').update(row).eq('id', id) : c.supabase.from('notification_rules').insert({ ...row, company_id: c.company.id, created_by: c.userId })
    const { error } = await q; if (error) throw error
    settingsPath(); return { ok: true, message: id ? 'Rule saved.' : 'Rule created. It applies to everything that happens from now on.' }
  })
}
export async function setRuleEnabled(id: string, on: boolean): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'settings.manage'); if (!UUID.test(id)) return { error: 'Unknown rule.' }
    const { error } = await c.supabase.from('notification_rules').update({ enabled: on }).eq('id', id); if (error) throw error
    settingsPath(); return { ok: true }
  })
}
export async function deleteRule(id: string): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'settings.manage'); if (!UUID.test(id)) return { error: 'Unknown rule.' }
    const { error } = await c.supabase.from('notification_rules').delete().eq('id', id); if (error) throw error
    settingsPath(); return { ok: true, message: 'Rule removed.' }
  })
}

// ───────────── webhooks ─────────────
export async function saveWebhook(_: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'settings.manage')
    const url = (str(fd, 'url') ?? '').trim(), bad = urlProblem(url)
    if (bad) return { error: bad, fieldErrors: { url: bad } }
    const events = [...new Set(all(fd, 'events'))].filter(e => e === '*' || isEvent(e))
    if (!events.length) return { error: 'Choose at least one event to send.' }
    const { count } = await c.supabase.from('webhook_endpoints').select('id', { count: 'exact', head: true })
    if ((count ?? 0) >= 10) return { error: 'Up to 10 webhook endpoints per company.' }
    const secret = newWebhookSecret()
    const { data: ep, error } = await c.supabase.from('webhook_endpoints').insert({ company_id: c.company.id, url, events: events.includes('*') ? ['*'] : events, description: str(fd, 'description')?.slice(0, 200) ?? null, secret_hint: secret.slice(-4), created_by: c.userId }).select('id').single()
    if (error) throw error
    const { error: e2 } = await createAdminClient().from('webhook_secrets').insert({ endpoint_id: ep.id, company_id: c.company.id, secret })
    if (e2) { await c.supabase.from('webhook_endpoints').delete().eq('id', ep.id); throw e2 }
    settingsPath()
    return { ok: true, message: 'Webhook added. Copy the signing secret now; it is not shown again.', data: { secret, label: 'Signing secret' } }
  })
}
export async function rotateWebhookSecret(id: string): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'settings.manage'); if (!UUID.test(id)) return { error: 'Unknown webhook.' }
    const { data: ep } = await c.supabase.from('webhook_endpoints').select('id').eq('id', id).maybeSingle(); if (!ep) return { error: 'Unknown webhook.' }
    const secret = newWebhookSecret()
    const { error } = await createAdminClient().from('webhook_secrets').upsert({ endpoint_id: id, company_id: c.company.id, secret, rotated_at: new Date().toISOString() }); if (error) throw error
    await c.supabase.from('webhook_endpoints').update({ secret_hint: secret.slice(-4) }).eq('id', id)
    settingsPath(); return { ok: true, message: 'New signing secret (the old one stops working now). Copy it; it is not shown again.', data: { secret, label: 'Signing secret' } }
  })
}
export async function setWebhookEnabled(id: string, on: boolean): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'settings.manage'); if (!UUID.test(id)) return { error: 'Unknown webhook.' }
    const { error } = await c.supabase.from('webhook_endpoints').update({ enabled: on, ...(on ? { failure_count: 0, disabled_reason: null } : {}) }).eq('id', id); if (error) throw error
    settingsPath(); return { ok: true }
  })
}
export async function deleteWebhook(id: string): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'settings.manage'); if (!UUID.test(id)) return { error: 'Unknown webhook.' }
    const { error } = await c.supabase.from('webhook_endpoints').delete().eq('id', id); if (error) throw error
    settingsPath(); return { ok: true, message: 'Webhook removed.' }
  })
}
/** Sends a signed `ping` right away and reports what the endpoint answered. */
export async function sendTestWebhook(id: string): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'settings.manage'); if (!UUID.test(id)) return { error: 'Unknown webhook.' }
    const { data: ep } = await c.supabase.from('webhook_endpoints').select('id,enabled').eq('id', id).maybeSingle()
    if (!ep) return { error: 'Unknown webhook.' }
    if (!ep.enabled) return { error: 'Switch the webhook on first.' }
    const admin = createAdminClient()
    const { data: d, error } = await admin.from('webhook_deliveries').insert({ company_id: c.company.id, endpoint_id: id, event: 'ping',
      payload: { id: `evt_test_${Date.now()}`, type: 'ping', created_at: new Date().toISOString(), data: { message: `Test from Averiqo (${c.company.name})` } } }).select('id').single()
    if (error) throw error
    await deliverWebhooks(admin, 25)
    const { data: r } = await admin.from('webhook_deliveries').select('status,response_status,last_error').eq('id', d.id).single()
    settingsPath()
    return r?.status === 'sent' ? { ok: true, message: `Delivered (HTTP ${r.response_status}).` } : { error: `Not delivered: ${r?.last_error ?? 'no response'}. It will be retried automatically.` }
  })
}

// ───────────── API keys ─────────────
export async function createApiKey(_: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'settings.manage')
    const scopes = [...new Set(all(fd, 'scopes'))].filter(s => s in SCOPES)
    if (!scopes.length) return { error: 'Choose what the key may read.' }
    const days = Number(str(fd, 'days') ?? '365')
    const expires_at = days > 0 ? new Date(Date.now() + Math.min(730, days) * 864e5).toISOString() : null
    const key = newApiKey()
    const { error } = await c.supabase.from('api_keys').insert({ company_id: c.company.id, name: z.string().trim().min(1, 'Name the key (who uses it)').max(80).parse(str(fd, 'name') ?? ''), prefix: key.slice(0, 12), key_hash: hashApiKey(key), scopes, expires_at, created_by: c.userId })
    if (error) throw error
    settingsPath(); return { ok: true, message: 'API key created. Copy it now; only a fingerprint is kept, so it cannot be shown again.', data: { secret: key, label: 'API key' } }
  })
}
export async function revokeApiKey(id: string): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'settings.manage'); if (!UUID.test(id)) return { error: 'Unknown key.' }
    const { error } = await c.supabase.from('api_keys').update({ revoked_at: new Date().toISOString() }).eq('id', id).is('revoked_at', null); if (error) throw error
    settingsPath(); return { ok: true, message: 'Key revoked. Requests using it are refused from now on.' }
  })
}

// ───────────── scheduled reports ─────────────
export async function saveReportSchedule(id: string | null, _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'settings.manage')
    const frequency = z.enum(['weekly', 'monthly']).parse(str(fd, 'frequency'))
    const weekday = frequency === 'weekly' ? z.coerce.number().int().min(1).max(7).parse(str(fd, 'weekday') ?? '1') : null
    const month_day = frequency === 'monthly' ? z.coerce.number().int().min(1).max(28).parse(str(fd, 'month_day') ?? '1') : null
    const sections = [...new Set(all(fd, 'sections'))].filter(s => s in SECTIONS)
    if (!sections.length) return { error: 'Choose at least one section for the report.' }
    const channels = z.array(z.enum(CHANNELS)).min(1, 'Choose at least one channel').parse(all(fd, 'channels'))
    const recipient_ids = await validRecipients(c, all(fd, 'recipients'))
    if (!recipient_ids.length) return { error: 'Choose at least one recipient (add people under Reminders → Recipients).' }
    const row = { name: z.string().trim().min(1, 'Name the report').max(120).parse(str(fd, 'name') ?? ''), frequency, weekday, month_day, sections, channels, recipient_ids,
      last_period: latestOccurrence({ frequency, weekday, month_day }, c.today).key }   // the first one goes out on the next send day, not immediately
    const q = id && UUID.test(id) ? c.supabase.from('report_schedules').update(row).eq('id', id) : c.supabase.from('report_schedules').insert({ ...row, company_id: c.company.id, created_by: c.userId })
    const { error } = await q; if (error) throw error
    settingsPath(); return { ok: true, message: id ? 'Schedule saved.' : 'Report scheduled. It goes out with the morning run on the chosen day.' }
  })
}
export async function setScheduleEnabled(id: string, on: boolean): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'settings.manage'); if (!UUID.test(id)) return { error: 'Unknown schedule.' }
    const { error } = await c.supabase.from('report_schedules').update({ enabled: on }).eq('id', id); if (error) throw error
    settingsPath(); return { ok: true }
  })
}
export async function deleteSchedule(id: string): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'settings.manage'); if (!UUID.test(id)) return { error: 'Unknown schedule.' }
    const { error } = await c.supabase.from('report_schedules').delete().eq('id', id); if (error) throw error
    settingsPath(); return { ok: true, message: 'Schedule removed.' }
  })
}
/** Sends the latest period's report now (in addition to the schedule). */
export async function sendReportNow(id: string): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'settings.manage'); if (!UUID.test(id)) return { error: 'Unknown schedule.' }
    const { data: s } = await c.supabase.from('report_schedules').select('*').eq('id', id).maybeSingle()
    if (!s) return { error: 'Unknown schedule.' }
    const admin = createAdminClient(), occ = latestOccurrence(s, c.today)
    const r = await sendSchedule(admin, s as ScheduleRow, occ, c.today, true)
    if (!r.queued) return { error: 'Nobody could receive it: check the recipients have the chosen channels (WhatsApp needs opt-in, email needs an address).' }
    await processBatch(supabaseStore(admin), makeSenders(admin), { tz: c.company.timezone, emailFallback: false, batch: 50 })
    revalidatePath('/reminders'); return { ok: true, message: `Report for ${occ.label} sent to ${r.queued} channel(s). See Reminders → Delivery log.` }
  })
}

// ───────────── device sessions ─────────────
async function currentSid(c: Ctx) { return sessionIdFromJwt((await c.supabase.auth.getSession()).data.session?.access_token) }

export async function revokeSession(sid: string): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); if (!UUID.test(sid)) return { error: 'Unknown session.' }
    if (sid === await currentSid(c)) return { error: 'This is the device you are using. Use Sign out instead.' }
    const { data, error } = await c.supabase.rpc('revoke_session', { p_sid: sid }); if (error) throw error
    revalidatePath('/settings'); revalidatePath('/users/activity')
    return data ? { ok: true, message: 'Signed out. That device must sign in again.' } : { error: 'That session has already ended.' }
  })
}
export async function revokeOtherSessions(userId?: string): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx()
    const target = userId && UUID.test(userId) ? userId : c.userId
    if (target !== c.userId) need(c, 'users.manage')
    const keep = target === c.userId ? await currentSid(c) : null
    const { data, error } = await c.supabase.rpc('revoke_other_sessions', { p_keep: keep, p_user: target }); if (error) throw error
    if (target === c.userId) { try { await c.supabase.auth.signOut({ scope: 'others' }) } catch { /* the app-level revocation above already applies */ } }
    revalidatePath('/settings'); revalidatePath('/users/activity')
    return { ok: true, message: data ? `Signed out ${data} other device(s).` : 'No other devices were signed in.' }
  })
}
