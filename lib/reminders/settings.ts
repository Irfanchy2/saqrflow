import type { ScheduleOptions } from './schedule'
import { DEFAULT_OFFSETS } from './schedule'

export interface ReminderSettings extends ScheduleOptions {
  emailFallback: boolean
  digestEnabled: boolean; digestHour: number          // local company hour (0-23)
  whatsappMode: 'auto' | 'sandbox'; whatsappCostPerMessage: number | null
  phoneNumberId: string | null; wabaId: string | null
}
export const DEFAULT_SETTINGS: ReminderSettings = {
  offsets: DEFAULT_OFFSETS, overdueEveryDays: 7, overdueMax: 4, emailFallback: true,
  digestEnabled: true, digestHour: 8, whatsappMode: 'auto', whatsappCostPerMessage: null, phoneNumberId: null, wabaId: null,
}
/** app_settings rows → typed settings (invalid/missing values fall back to defaults). */
export function parseSettings(rows: { key: string; value: any }[]): ReminderSettings {
  const m = Object.fromEntries(rows.map(r => [r.key, r.value]))
  const num = (v: unknown, d: number, lo: number, hi: number) => (typeof v === 'number' && v >= lo && v <= hi ? v : d)
  return {
    offsets: Array.isArray(m['reminders.offsets']) && m['reminders.offsets'].length ? m['reminders.offsets'].filter((n: unknown) => Number.isInteger(n)) : DEFAULT_OFFSETS,
    overdueEveryDays: num(m['reminders.overdue_every_days'], 7, 0, 90), overdueMax: num(m['reminders.overdue_max'], 4, 0, 52),
    emailFallback: m['reminders.email_fallback'] !== false,
    digestEnabled: m['reminders.digest_enabled'] !== false, digestHour: num(m['reminders.digest_hour'], 8, 0, 23),
    whatsappMode: m['whatsapp.mode'] === 'sandbox' ? 'sandbox' : 'auto',
    whatsappCostPerMessage: typeof m['whatsapp.cost_per_message'] === 'number' ? m['whatsapp.cost_per_message'] : null,
    phoneNumberId: typeof m['whatsapp.phone_number_id'] === 'string' ? m['whatsapp.phone_number_id'] : null,
    wabaId: typeof m['whatsapp.waba_id'] === 'string' ? m['whatsapp.waba_id'] : null,
  }
}
