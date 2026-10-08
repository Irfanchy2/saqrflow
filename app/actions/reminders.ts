'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getCtx, need } from '@/lib/auth'
import { safe, str } from '@/lib/action'
import { createAdminClient } from '@/lib/supabase/admin'
import { runReminderCycle, makeSenders, supabaseStore } from '@/lib/reminders/engine'
import { processBatch } from '@/lib/reminders/dispatch'
import { parseOffsets } from '@/lib/reminders/schedule'
import { toE164 } from '@/lib/phone'
import type { ActionState } from '@/lib/utils'

export async function createReminder(_: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'reminders.create')
    const v = z.object({ title: z.string().min(2, 'Title is required').max(200), due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date'), notes: z.string().max(2000).optional(), recurrence: z.enum(['none', 'monthly', 'quarterly', 'yearly']) })
      .parse({ title: str(fd, 'title'), due_date: str(fd, 'due_date'), notes: str(fd, 'notes'), recurrence: str(fd, 'recurrence') ?? 'none' })
    const offs = str(fd, 'offsets') ? parseOffsets(str(fd, 'offsets')!) : []
    const { error } = await c.supabase.from('reminders').insert({ ...v, offsets: offs.length ? offs : null, company_id: c.company.id, created_by: c.userId }); if (error) throw error
    revalidatePath('/reminders'); return { ok: true, message: 'Reminder created.' }
  })
}
export async function toggleReminder(id: string, enabled: boolean): Promise<ActionState> {
  return safe(async () => { const c = await getCtx(); need(c, 'reminders.create'); const { error } = await c.supabase.from('reminders').update({ enabled }).eq('id', id); if (error) throw error; revalidatePath('/reminders') })
}

const recipientSchema = z.object({
  name: z.string().min(2, 'Name is required').max(120), email: z.string().email('Enter a valid email').optional(),
  quiet_start: z.string().regex(/^\d{2}:\d{2}$/).optional(), quiet_end: z.string().regex(/^\d{2}:\d{2}$/).optional(),
})
export async function addRecipient(_: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'settings.manage')
    const v = recipientSchema.parse({ name: str(fd, 'name'), email: str(fd, 'email'), quiet_start: str(fd, 'quiet_start'), quiet_end: str(fd, 'quiet_end') })
    const raw = str(fd, 'whatsapp_number'); const wa = raw ? toE164(raw) : undefined
    if (raw && !wa) return { error: 'Enter a valid WhatsApp number, e.g. 050 123 4567 or +971501234567.' }
    const channels = ['in_app', 'whatsapp', 'email'].filter(k => fd.get(`ch_${k}`) === 'on')
    if (!channels.length) return { error: 'Choose at least one channel.' }
    if (channels.includes('whatsapp') && !wa) return { error: 'A WhatsApp number is required for the WhatsApp channel.' }
    if (channels.includes('email') && !v.email) return { error: 'An email address is required for the email channel.' }
    if ((v.quiet_start && !v.quiet_end) || (!v.quiet_start && v.quiet_end)) return { error: 'Set both quiet-hours times, or neither.' }
    const { error } = await c.supabase.from('notification_recipients').insert({
      company_id: c.company.id, name: v.name, email: v.email ?? null, whatsapp_number: wa ?? null, channels, user_id: str(fd, 'user_id') ?? null,
      quiet_start: v.quiet_start ?? null, quiet_end: v.quiet_end ?? null, receives_digest: fd.get('digest') === 'on',
      receives_cheque_alerts: fd.get('cheque_alerts') === 'on', receives_hr_alerts: fd.get('hr_alerts') === 'on',
    })
    if (error) throw error
    revalidatePath('/reminders'); return { ok: true, message: 'Recipient added. WhatsApp stays off until you record their opt-in.' }
  })
}
export async function setOptIn(id: string, state: 'opted_in' | 'opted_out', _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'settings.manage')
    if (state === 'opted_in' && fd.get('consent') !== 'on') return { error: 'Please confirm the recipient agreed to receive WhatsApp messages from your business.' }
    const { error } = await c.supabase.from('notification_recipients').update({ whatsapp_opt_in: state, opted_in_at: state === 'opted_in' ? new Date().toISOString() : null }).eq('id', id); if (error) throw error
    revalidatePath('/reminders'); return { ok: true, message: state === 'opted_in' ? 'Opt-in recorded.' : 'Recipient opted out.' }
  })
}
export async function setRecipientActive(id: string, active: boolean): Promise<ActionState> {
  return safe(async () => { const c = await getCtx(); need(c, 'settings.manage'); const { error } = await c.supabase.from('notification_recipients').update({ is_active: active }).eq('id', id); if (error) throw error; revalidatePath('/reminders') })
}

/** Send a test through the real pipeline and report exactly what happened (sandbox ≠ delivered). */
export async function sendTest(recipientId: string, channel: 'whatsapp' | 'email' | 'in_app'): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'reminders.create')
    const { data: r } = await c.supabase.from('notification_recipients').select('id').eq('id', recipientId).maybeSingle(); if (!r) return { error: 'Recipient not found.' }
    const admin = createAdminClient(); const key = `test:${crypto.randomUUID()}`
    const { data: log, error } = await admin.from('notification_logs').insert({ company_id: c.company.id, recipient_id: recipientId, channel, template: 'test_message', params: { note: `Test from ${c.profile.full_name}. No action needed.`, _link: '/reminders', _title: 'Averiqo test notification' }, dedupe_key: key, source_type: 'test' }).select('id').single()
    if (error) throw error
    await processBatch(supabaseStore(admin), makeSenders(admin), { tz: c.company.timezone, emailFallback: false })
    const { data: res } = await admin.from('notification_logs').select('status,last_error,sandbox').eq('id', log.id).single()
    revalidatePath('/reminders')
    const st = res?.status
    if (st === 'sandbox') return { ok: true, message: 'SANDBOX: recorded in the log only. Nothing was actually sent (credentials not configured or sandbox mode on).' }
    if (st === 'sent') return { ok: true, message: 'Accepted by the provider. Delivery confirmation arrives via webhook. Check the delivery log.' }
    if (st === 'queued') return { ok: true, message: 'Held for quiet hours; it will be sent when they end.' }
    return { error: `Not sent (${st}): ${res?.last_error ?? 'unknown reason'}` }
  })
}
export async function runNow(): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'settings.manage')
    const r = await runReminderCycle(createAdminClient(), new Date(), { companyId: c.company.id })
    revalidatePath('/reminders', 'layout')
    const d = r.dispatch
    return { ok: true, message: `Checked: ${r.inserted} new reminder(s) queued (${r.planned - r.inserted} already sent earlier). Dispatched. Sent ${d.sent}, sandbox ${d.sandbox}, retrying ${d.retried}, failed ${d.failed}, skipped ${d.skipped}.` }
  })
}
export async function retryLog(id: string): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'settings.manage')
    const { data } = await c.supabase.from('notification_logs').select('id,status').eq('id', id).maybeSingle()
    if (!data || data.status !== 'failed') return { error: 'Only failed messages can be retried.' }
    const { error } = await createAdminClient().from('notification_logs').update({ status: 'queued', attempts: 0, next_attempt_at: new Date().toISOString(), last_error: null }).eq('id', id).eq('company_id', c.company.id); if (error) throw error
    revalidatePath('/reminders'); return { ok: true, message: 'Re-queued.' }
  })
}
