import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { planNotifications, type Recipient, type Source } from './planner'
import { processBatch, type LogRow, type RecipientInfo, type Senders, type Store } from './dispatch'
import { parseSettings, type ReminderSettings } from './settings'
import { digestParams, renderText, type Params } from '../whatsapp/templates'
import { sendEmail, sendWhatsApp, type WhatsAppConfig } from '../whatsapp/client'
import { decryptSecret } from '../crypto'
import { addDays, localHm, todayInTz } from '../time'
import { advanceDue } from './schedule'

type Admin = SupabaseClient

export async function loadWhatsAppConfig(admin: Admin, companyId: string, settings: ReminderSettings): Promise<WhatsAppConfig> {
  let token = process.env.WHATSAPP_ACCESS_TOKEN
  const { data } = await admin.from('integration_secrets').select('ciphertext').eq('company_id', companyId).eq('name', 'whatsapp_token').maybeSingle()
  if (data?.ciphertext) { try { token = decryptSecret(data.ciphertext) } catch { /* bad key → fall back to env */ } }
  return {
    phoneNumberId: settings.phoneNumberId ?? process.env.WHATSAPP_PHONE_NUMBER_ID, accessToken: token,
    apiVersion: process.env.WHATSAPP_API_VERSION ?? 'v21.0', forceSandbox: settings.whatsappMode === 'sandbox',
  }
}

export function makeSenders(admin: Admin): Senders {
  const cache = new Map<string, Promise<WhatsAppConfig>>()
  const cfg = (companyId: string) => {
    if (!cache.has(companyId)) cache.set(companyId, (async () => { const { data } = await admin.from('app_settings').select('key,value').eq('company_id', companyId); return loadWhatsAppConfig(admin, companyId, parseSettings(data ?? [])) })())
    return cache.get(companyId)!
  }
  return {
    whatsapp: async (to, t, p, companyId) => sendWhatsApp(await cfg(companyId), to, t, p),
    email: async (to, subject, text) => sendEmail({ apiKey: process.env.RESEND_API_KEY, from: process.env.EMAIL_FROM }, to, subject, text),
    party: async log => { const { deliverParty } = await import('../whatsapp/outbox'); return deliverParty(admin, log as any) },
  }
}

export function supabaseStore(admin: Admin): Store {
  return {
    async claim(limit) { const { data, error } = await admin.rpc('claim_notifications', { p_batch: limit }); if (error) throw error; return (data ?? []) as LogRow[] },
    async recipient(id) {
      const { data } = await admin.from('notification_recipients').select('id,user_id,name,whatsapp_number,email,whatsapp_opt_in,quiet_start,quiet_end,is_active').eq('id', id).maybeSingle()
      return (data as RecipientInfo | null)
    },
    async update(id, patch) { const { error } = await admin.from('notification_logs').update(patch).eq('id', id); if (error) throw error },
    async enqueueEmailFallback(from, to) {
      await admin.from('notification_logs').upsert({
        company_id: from.company_id, recipient_id: to.id, channel: 'email', template: from.template, params: from.params,
        source_type: from.source_type, source_id: from.source_id, dedupe_key: `fallback:${from.id}`, fallback_of: from.id,
      }, { onConflict: 'company_id,dedupe_key', ignoreDuplicates: true })
    },
    async createInApp(log, r) {
      if (!r.user_id) return
      const p = log.params as Params
      await admin.from('in_app_notifications').upsert({
        company_id: log.company_id, user_id: r.user_id, dedupe_key: log.dedupe_key,
        title: (p._title as string) ?? renderText(log.template, log.params).split('\n')[0],
        body: renderText(log.template, log.params).split('\n').slice(1).join(' · '),
        link: (p._link as string) ?? '/', severity: (p._severity as string) ?? 'info',
      }, { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true })
    },
  }
}

export interface CycleResult { companies: number; planned: number; inserted: number; digests: number; dispatch: Awaited<ReturnType<typeof processBatch>> }

/** One scheduler tick: plan (idempotent) → digest → dispatch. Safe to run as often as you like. */
export async function runReminderCycle(admin: Admin, now = new Date(), opts: { companyId?: string } = {}): Promise<CycleResult> {
  let q = admin.from('companies').select('id,timezone'); if (opts.companyId) q = q.eq('id', opts.companyId)
  const { data: companies, error } = await q
  if (error) throw error
  let planned = 0, inserted = 0, digests = 0
  let dispatchTz = 'Asia/Dubai'; let fallback = true

  // sent invoices past their due date become 'overdue' before reminders are planned
  if (!opts.companyId) { const { error: e } = await admin.rpc('mark_overdue_invoices'); if (e) console.warn('[reminders] mark_overdue_invoices', e.message) }
  for (const co of companies ?? []) {
    dispatchTz = co.timezone
    const today = todayInTz(now, co.timezone)
    // recurring custom reminders roll forward once their date has passed
    const { data: rec } = await admin.from('reminders').select('id,due_date,recurrence').eq('company_id', co.id).eq('enabled', true).neq('recurrence', 'none').lt('due_date', today)
    for (const r of rec ?? []) await admin.from('reminders').update({ due_date: advanceDue(r.due_date, r.recurrence, today) }).eq('id', r.id)
    const [{ data: st }, { data: recs }, { data: src }] = await Promise.all([
      admin.from('app_settings').select('key,value').eq('company_id', co.id),
      admin.from('notification_recipients').select('id,user_id,whatsapp_number,email,channels,whatsapp_opt_in,receives_cheque_alerts,receives_hr_alerts,is_active,receives_digest').eq('company_id', co.id).eq('is_active', true),
      admin.from('reminder_sources').select('*').eq('company_id', co.id).lte('due_date', addDays(today, 730)),
    ])
    const settings = parseSettings(st ?? []); fallback = settings.emailFallback
    const plan = planNotifications((src ?? []) as Source[], (recs ?? []) as Recipient[], today, settings)
      .map(({ link, severity, ...l }) => ({
        ...l, params: { ...l.params, _link: link, _severity: severity, _title: `${l.params.document ?? l.params.type ?? 'Reminder'}` },
        cost_estimate: l.channel === 'whatsapp' ? settings.whatsappCostPerMessage : null,
      }))
    planned += plan.length
    if (plan.length) {
      const { data, error: e } = await admin.from('notification_logs').upsert(plan, { onConflict: 'company_id,dedupe_key', ignoreDuplicates: true }).select('id')
      if (e) throw e
      inserted += data?.length ?? 0
    }
    digests += await planDigest(admin, co.id, co.timezone, now, today, settings, (recs ?? []) as (Recipient & { receives_digest: boolean })[])
  }
  const dispatch = await processBatch(supabaseStore(admin), makeSenders(admin), { now, tz: dispatchTz, emailFallback: fallback })
  return { companies: companies?.length ?? 0, planned, inserted, digests, dispatch }
}

async function planDigest(admin: Admin, companyId: string, tz: string, now: Date, today: string, s: ReminderSettings, recs: (Recipient & { receives_digest: boolean })[]) {
  if (!s.digestEnabled || Number(localHm(now, tz).slice(0, 2)) < s.digestHour) return 0
  const targets = recs.filter(r => r.receives_digest)
  if (!targets.length) return 0
  const head = { count: 'exact' as const, head: true }
  const [docs, chq, inv, ren] = await Promise.all([
    admin.from('documents').select('id', head).eq('company_id', companyId).is('deleted_at', null).gte('expiry_date', today).lte('expiry_date', addDays(today, 30)),
    admin.from('cheques').select('id', head).eq('company_id', companyId).in('status', ['received', 'issued', 'scheduled']).gte('cheque_date', today).lte('cheque_date', addDays(today, 6)),
    admin.from('invoices').select('id', head).eq('company_id', companyId).eq('doc_type', 'invoice').in('status', ['sent', 'partially_paid', 'overdue']),
    admin.from('documents').select('id', head).eq('company_id', companyId).is('deleted_at', null).eq('status', 'renewal_in_progress'),
  ])
  const params = { ...digestParams({ expiring: docs.count ?? 0, cheques: chq.count ?? 0, invoices: inv.count ?? 0, renewals: ren.count ?? 0 }), _link: '/', _severity: 'info', _title: 'Averiqo daily summary' }
  const rows = targets.flatMap(r => r.channels.filter(ch => ch === 'in_app' ? !!r.user_id : ch === 'email' ? !!r.email : !!r.whatsapp_number && r.whatsapp_opt_in === 'opted_in')
    .map(ch => ({ company_id: companyId, recipient_id: r.id, channel: ch, template: 'daily_summary', params, dedupe_key: `digest:${today}:${ch}:${r.id}`, source_type: 'digest' })))
  if (!rows.length) return 0
  const { data, error } = await admin.from('notification_logs').upsert(rows, { onConflict: 'company_id,dedupe_key', ignoreDuplicates: true }).select('id')
  if (error) throw error
  return data?.length ?? 0
}
