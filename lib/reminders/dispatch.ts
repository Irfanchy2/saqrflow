import { nextAllowedSendTime } from '../time'
import { renderText, type Params, type TemplateName } from '../whatsapp/templates'
import type { SendResult } from '../whatsapp/client'

export interface LogRow {
  id: string; company_id: string; recipient_id: string | null; channel: 'whatsapp' | 'email' | 'in_app'; template: TemplateName
  params: Params; source_type: string | null; source_id: string | null; dedupe_key: string
  attempts: number; max_attempts: number; fallback_of: string | null; link?: string | null
}
export interface RecipientInfo {
  id: string; user_id: string | null; name: string; whatsapp_number: string | null; email: string | null
  whatsapp_opt_in: string; quiet_start: string | null; quiet_end: string | null; is_active: boolean
}
export interface Patch { status?: string; attempts?: number; next_attempt_at?: string; last_error?: string | null; provider_message_id?: string | null; sent_at?: string; sandbox?: boolean; claimed_at?: null }
export interface Store {
  claim(limit: number): Promise<LogRow[]>
  recipient(id: string): Promise<RecipientInfo | null>
  update(id: string, patch: Patch): Promise<void>
  enqueueEmailFallback(from: LogRow, to: RecipientInfo): Promise<void>
  createInApp(log: LogRow, r: RecipientInfo): Promise<void>
}
export interface Senders {
  whatsapp(to: string, t: TemplateName, p: Params, companyId: string): Promise<SendResult>
  email(to: string, subject: string, text: string, companyId: string): Promise<SendResult>
}

const SUBJECT: Partial<Record<TemplateName, string>> = { daily_summary: 'Averiqo daily summary', event_alert: 'Averiqo alert', scheduled_report: 'Averiqo report' }
/** `_subject` / `_text` (set by scheduled reports and rules) give email a fuller message than the fixed WhatsApp template. */
const emailSubject = (log: LogRow) => (log.params._subject || SUBJECT[log.template] || 'Averiqo reminder').slice(0, 150)

const BASE_MS = 60_000, CAP_MS = 6 * 3600_000
/** attempt 1 → 1 min, 2 → 2, 3 → 4, 4 → 8 … capped at 6 h. */
export const backoffMs = (attempt: number) => Math.min(BASE_MS * 2 ** Math.max(0, attempt - 1), CAP_MS)

export interface Stats { sent: number; sandbox: number; retried: number; failed: number; skipped: number; deferred: number; fallbacks: number }

export async function processBatch(store: Store, senders: Senders, opts: { now?: Date; tz: string; emailFallback: boolean; batch?: number }): Promise<Stats> {
  const now = opts.now ?? new Date()
  const stats: Stats = { sent: 0, sandbox: 0, retried: 0, failed: 0, skipped: 0, deferred: 0, fallbacks: 0 }
  for (const log of await store.claim(opts.batch ?? 50)) {
    const r = log.recipient_id ? await store.recipient(log.recipient_id) : null
    if (!r || !r.is_active) { await store.update(log.id, { status: 'skipped', last_error: 'Recipient missing or inactive' }); stats.skipped++; continue }

    if (log.channel === 'whatsapp' && (r.whatsapp_opt_in !== 'opted_in' || !r.whatsapp_number)) {
      await store.update(log.id, { status: 'skipped', last_error: 'Recipient has not opted in to WhatsApp' }); stats.skipped++; continue
    }
    if (log.channel !== 'in_app') {
      const at = nextAllowedSendTime(now, r.quiet_start, r.quiet_end, opts.tz)
      if (at.getTime() > now.getTime()) {              // quiet hours: defer without consuming an attempt
        await store.update(log.id, { status: 'queued', next_attempt_at: at.toISOString(), claimed_at: null }); stats.deferred++; continue
      }
    }

    let res: SendResult
    try {
      if (log.channel === 'in_app') { await store.createInApp(log, r); res = { ok: true, sandbox: false } }
      else if (log.channel === 'whatsapp') res = await senders.whatsapp(r.whatsapp_number!, log.template, log.params, log.company_id)
      else if (!r.email) res = { ok: false, retryable: false, error: 'Recipient has no email address' }
      else res = await senders.email(r.email, emailSubject(log), log.params._text || renderText(log.template, log.params), log.company_id)
    } catch (e) { res = { ok: false, retryable: true, error: (e as Error).message } }

    const attempts = log.attempts + 1
    if (res.ok) {
      await store.update(log.id, { status: res.sandbox ? 'sandbox' : 'sent', sandbox: res.sandbox, attempts, sent_at: now.toISOString(), provider_message_id: res.messageId ?? null, last_error: null, claimed_at: null })
      res.sandbox ? stats.sandbox++ : stats.sent++
      continue
    }
    if (res.retryable && attempts < log.max_attempts) {
      await store.update(log.id, { status: 'retry', attempts, last_error: res.error, next_attempt_at: new Date(now.getTime() + backoffMs(attempts)).toISOString(), claimed_at: null })
      stats.retried++; continue
    }
    await store.update(log.id, { status: 'failed', attempts, last_error: res.error, claimed_at: null }); stats.failed++
    if (opts.emailFallback && log.channel === 'whatsapp' && !log.fallback_of && r.email) {
      await store.enqueueEmailFallback(log, r); stats.fallbacks++
    }
  }
  return stats
}
