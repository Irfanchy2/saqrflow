import { nextOccurrence, type ScheduleOptions } from './schedule'
import { documentParams, paymentParams, type Params, type TemplateName } from '../whatsapp/templates'

export interface Source {
  company_id: string; source_type: 'document' | 'cheque' | 'custom' | 'invoice' | 'milestone'; source_id: string
  title: string; subject: string | null; category: string; owner_type: string | null
  due_date: string; offsets: number[] | null; amount: number | null; direction: string | null; link: string
}
export interface Recipient {
  id: string; user_id: string | null; whatsapp_number: string | null; email: string | null
  channels: string[]; whatsapp_opt_in: 'pending' | 'opted_in' | 'opted_out'
  receives_cheque_alerts: boolean; receives_hr_alerts: boolean; is_active: boolean
}
export interface PlannedLog {
  company_id: string; recipient_id: string; channel: 'whatsapp' | 'email' | 'in_app'; template: TemplateName
  params: Params; source_type: string; source_id: string; dedupe_key: string; link: string; severity: 'info' | 'warning' | 'critical'
}

const isFinanceSource = (s: Source) => s.source_type === 'cheque' || s.source_type === 'invoice'

export function recipientWantsSource(r: Recipient, s: Source): boolean {
  if (isFinanceSource(s)) return r.receives_cheque_alerts
  if (s.source_type === 'document' && s.owner_type === 'employee') return r.receives_hr_alerts
  return true
}
export function channelAvailable(r: Recipient, ch: string): boolean {
  if (ch === 'whatsapp') return !!r.whatsapp_number && r.whatsapp_opt_in === 'opted_in'   // explicit opt-in required
  if (ch === 'email') return !!r.email
  if (ch === 'in_app') return !!r.user_id
  return false
}

export function planNotifications(sources: Source[], recipients: Recipient[], today: string, settings: ScheduleOptions): PlannedLog[] {
  const out: PlannedLog[] = []
  for (const s of sources) {
    const occ = nextOccurrence(s.due_date, today, { ...settings, offsets: s.offsets ?? settings.offsets })
    if (!occ) continue
    const template: TemplateName = isFinanceSource(s) ? 'payment_alert' : 'document_reminder'
    const params = isFinanceSource(s)
      ? paymentParams({ direction: s.direction, kind: s.source_type === 'cheque' ? 'Cheque' : 'Invoice', party: s.subject ?? s.title, amount: s.amount, date: s.due_date, daysRemaining: occ.daysRemaining })
      : documentParams({ title: s.title, subject: s.subject, expiry: s.due_date, daysRemaining: occ.daysRemaining })
    if (s.source_type === 'milestone') params.status = occ.daysRemaining < 0 ? `Project milestone overdue by ${-occ.daysRemaining} day(s)` : occ.daysRemaining === 0 ? 'Project milestone due today' : 'Project milestone coming up'
    const severity = occ.daysRemaining < 0 ? 'critical' : occ.daysRemaining <= 7 ? 'warning' : 'info'
    for (const r of recipients) {
      if (!r.is_active || !recipientWantsSource(r, s)) continue
      for (const ch of r.channels) {
        if (!channelAvailable(r, ch) || !['whatsapp', 'email', 'in_app'].includes(ch)) continue
        out.push({
          company_id: s.company_id, recipient_id: r.id, channel: ch as PlannedLog['channel'], template, params,
          source_type: s.source_type, source_id: s.source_id, link: s.link, severity,
          // due date is part of the key: renewing (new date) restarts the schedule; re-running never duplicates.
          dedupe_key: `${s.source_type}:${s.source_id}:${occ.key}:${s.due_date}:${ch}:${r.id}`,
        })
      }
    }
  }
  return out
}
