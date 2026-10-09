import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'
import { EVENTS, amountPasses, webhookBody, type EventData } from './events'
import { hmacSha256Hex } from './crypto'
import { postJson } from './net-guard'
import { appUrl } from './portal'
import { sanitizeParam } from './whatsapp/templates'
import { processBatch } from './reminders/dispatch'
import { makeSenders, supabaseStore } from './reminders/engine'

type Admin = SupabaseClient
type Ev = { id: number; company_id: string; event: string; entity: string; entity_id: string | null; data: EventData; actor: string | null; created_at: string }
type Rule = { id: string; company_id: string; name: string; event: string; min_amount: number | null; channels: string[]; recipient_ids: string[] }
type Recipient = { id: string; user_id: string | null; email: string | null; whatsapp_number: string | null; whatsapp_opt_in: string; is_active: boolean }

export const newWebhookSecret = () => `whsec_${randomBytes(24).toString('base64url')}`
/** Header value: `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">` (same scheme as Stripe; docs/API.md). */
export const signature = (secret: string, ts: number, body: string) => `t=${ts},v1=${hmacSha256Hex(secret, `${ts}.${body}`)}`

const RETRY_S = [60, 300, 1800, 7200, 43200]   // 1 min, 5 min, 30 min, 2 h, 12 h → then failed
export const MAX_ATTEMPTS = RETRY_S.length + 1
const DISABLE_AFTER = 15                        // consecutive failed deliveries switch the endpoint off

export function channelOk(ch: string, r: Recipient) {
  if (!r.is_active) return false
  return ch === 'in_app' ? !!r.user_id : ch === 'email' ? !!r.email : !!r.whatsapp_number && r.whatsapp_opt_in === 'opted_in'
}

/** Events → rule notifications (queued in notification_logs) + webhook deliveries. Idempotent: every row has a unique key. */
export async function processEvents(admin: Admin, limit = 200) {
  const { data, error } = await admin.rpc('claim_app_events', { p_limit: limit })
  if (error) throw error
  const evs = (data ?? []) as Ev[]
  if (!evs.length) return { events: 0, notifications: 0, deliveries: 0 }
  const companies = [...new Set(evs.map(e => e.company_id))], kinds = [...new Set(evs.map(e => e.event))]
  const [{ data: rules }, { data: hooks }, { data: recs }] = await Promise.all([
    admin.from('notification_rules').select('id,company_id,name,event,min_amount,channels,recipient_ids').in('company_id', companies).in('event', kinds).eq('enabled', true),
    admin.from('webhook_endpoints').select('id,company_id,events').in('company_id', companies).eq('enabled', true),
    admin.from('notification_recipients').select('id,company_id,user_id,email,whatsapp_number,whatsapp_opt_in,is_active').in('company_id', companies),
  ])
  const recById = new Map((recs ?? []).map((r: any) => [r.id, r as Recipient & { company_id: string }]))
  const base = appUrl()
  const logs: Record<string, unknown>[] = [], deliveries: Record<string, unknown>[] = [], fired = new Map<string, number>()
  for (const e of evs) {
    const def = EVENTS[e.event]; if (!def) continue
    const title = def.title(e.data).slice(0, 200), link = e.entity_id ? def.link(e.entity_id, e.data) : '/'
    for (const r of ((rules ?? []) as Rule[]).filter(x => x.company_id === e.company_id && x.event === e.event && amountPasses(x.min_amount, e.data))) {
      let n = 0
      for (const rid of r.recipient_ids) {
        const rec = recById.get(rid); if (!rec || rec.company_id !== e.company_id) continue
        for (const ch of r.channels) {
          if (!channelOk(ch, rec)) continue
          if (ch === 'in_app' && rec.user_id && rec.user_id === e.actor) continue   // no bell for your own action
          logs.push({
            company_id: e.company_id, recipient_id: rid, channel: ch, template: 'event_alert', source_type: 'rule', source_id: r.id,
            dedupe_key: `rule:${r.id}:${e.id}:${ch}:${rid}`,
            params: { rule: sanitizeParam(r.name), event: sanitizeParam(title, 200), _title: title, _link: link, _severity: /overdue|returned|rejected|lost/.test(e.event) ? 'warning' : 'info',
              _subject: `Averiqo: ${title}`.slice(0, 150), _text: `${title}\n\nRule: ${r.name}\n${base ? `${base}${link}` : `Open Averiqo → ${link}`}` },
          }); n++
        }
      }
      if (n) fired.set(r.id, (fired.get(r.id) ?? 0) + 1)
    }
    for (const h of (hooks ?? []).filter((x: any) => x.company_id === e.company_id && (x.events.includes(e.event) || x.events.includes('*'))))
      deliveries.push({ company_id: e.company_id, endpoint_id: h.id, event_id: e.id, event: e.event, payload: webhookBody(e, base) })
  }
  for (let i = 0; i < logs.length; i += 500) { const { error: x } = await admin.from('notification_logs').upsert(logs.slice(i, i + 500), { onConflict: 'company_id,dedupe_key', ignoreDuplicates: true }); if (x) throw x }
  for (let i = 0; i < deliveries.length; i += 500) { const { error: x } = await admin.from('webhook_deliveries').upsert(deliveries.slice(i, i + 500), { onConflict: 'endpoint_id,event_id', ignoreDuplicates: true }); if (x) throw x }
  const now = new Date().toISOString()
  for (const [id, n] of fired) {
    const { data: cur } = await admin.from('notification_rules').select('fire_count').eq('id', id).maybeSingle()
    await admin.from('notification_rules').update({ fire_count: (cur?.fire_count ?? 0) + n, last_fired_at: now }).eq('id', id)
  }
  const { error: done } = await admin.from('app_events').update({ processed_at: now }).in('id', evs.map(e => e.id))
  if (done) throw done
  return { events: evs.length, notifications: logs.length, deliveries: deliveries.length }
}

/** Sends due webhook deliveries (signed), with retries and automatic switch-off of endpoints that keep failing. */
export async function deliverWebhooks(admin: Admin, limit = 25) {
  const { data, error } = await admin.rpc('claim_webhook_deliveries', { p_limit: limit })
  if (error) throw error
  const rows = (data ?? []) as { id: number; endpoint_id: string; event: string; payload: unknown; attempts: number }[]
  let sent = 0, failed = 0
  for (const d of rows) {
    const [{ data: ep }, { data: sec }] = await Promise.all([
      admin.from('webhook_endpoints').select('id,url,enabled,failure_count').eq('id', d.endpoint_id).maybeSingle(),
      admin.from('webhook_secrets').select('secret').eq('endpoint_id', d.endpoint_id).maybeSingle(),
    ])
    if (!ep || !ep.enabled || !sec) { await admin.from('webhook_deliveries').update({ status: 'failed', last_error: 'Endpoint switched off or removed', claimed_at: null }).eq('id', d.id); failed++; continue }
    const body = JSON.stringify(d.payload), ts = Math.floor(Date.now() / 1000)
    const r = await postJson(ep.url, body, { 'x-averiqo-event': d.event, 'x-averiqo-delivery': String(d.id), 'x-averiqo-signature': signature(sec.secret, ts, body) })
    const ok = r.status !== null && r.status >= 200 && r.status < 300, attempts = d.attempts + 1, now = new Date()
    if (ok) {
      await admin.from('webhook_deliveries').update({ status: 'sent', attempts, response_status: r.status, response_ms: r.ms, last_error: null, delivered_at: now.toISOString(), claimed_at: null }).eq('id', d.id)
      await admin.from('webhook_endpoints').update({ failure_count: 0, last_status: r.status, last_success_at: now.toISOString() }).eq('id', ep.id)
      sent++; continue
    }
    const err = (r.error ?? `HTTP ${r.status}`).slice(0, 500), retry = attempts < MAX_ATTEMPTS && !(r.status && r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429)
    await admin.from('webhook_deliveries').update({ status: retry ? 'retry' : 'failed', attempts, response_status: r.status, response_ms: r.ms, last_error: err, claimed_at: null,
      ...(retry ? { next_attempt_at: new Date(now.getTime() + RETRY_S[attempts - 1] * 1000).toISOString() } : {}) }).eq('id', d.id)
    const fc = (ep.failure_count ?? 0) + 1
    await admin.from('webhook_endpoints').update({ failure_count: fc, last_status: r.status, last_failure_at: now.toISOString(),
      ...(fc >= DISABLE_AFTER ? { enabled: false, disabled_reason: `Switched off after ${fc} failed deliveries in a row (last: ${err.slice(0, 100)})` } : {}) }).eq('id', ep.id)
    failed++
  }
  return { attempted: rows.length, sent, failed }
}

/** Everything that should happen soon after a change: events → messages/deliveries, then send what is due. Never throws. */
export async function runEventWork(admin: Admin) {
  try {
    const ev = await processEvents(admin)
    const wh = await deliverWebhooks(admin)
    const msg = ev.notifications ? await processBatch(supabaseStore(admin), makeSenders(admin), { tz: 'Asia/Dubai', emailFallback: false, batch: 50 }) : null
    return { ...ev, webhooks: wh, messages: msg }
  } catch (e) { console.warn('[events]', (e as Error).message); return null }
}
