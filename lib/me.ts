import 'server-only'
import { cache } from 'react'
import { getCtx, requestUser, type Ctx } from './auth'
import { zonedToUtc } from './time'

// The Employee Portal reads only through the signed-in user's own session: the database (0030) shows an employee
// nothing but their own employee record, salary, advances, attendance, leave, documents and expense claims.

export interface MyEmployee {
  id: string; employee_no: string; full_name: string; department: string | null; designation: string | null; phone: string | null
  nationality: string | null; joining_date: string | null; status: string; work_location: string | null; photo_path: string | null
}
export interface PortalSettings { checkin: boolean; advanceLimitPct: number; workStart: string; workEnd: string; overtimeMaxHours: number }

/** The signed-in user and the employee record linked to their login (null when the login is not linked to one). */
export const getMe = cache(async (): Promise<{ c: Ctx; emp: MyEmployee | null }> => {
  const { supabase, userId } = await requestUser()
  // the employee record is read together with the profile (one round trip, not two); RLS still decides what it returns
  const [c, { data }] = await Promise.all([getCtx(), supabase.from('employees')
    .select('id,employee_no,full_name,department,designation,phone,nationality,joining_date,status,work_location,photo_path')
    .eq('user_id', userId).is('deleted_at', null).maybeSingle()])
  return { c, emp: (data as MyEmployee | null) ?? null }
})

/** Company switches for the portal (Settings → Employee portal). */
export async function portalSettings(c: Ctx): Promise<PortalSettings> {
  const { data } = await c.supabase.from('app_settings').select('key,value').in('key', ['portal.checkin', 'portal.advance_limit_pct', 'portal.work_start', 'portal.work_end', 'portal.overtime_max_hours'])
  const m = Object.fromEntries((data ?? []).map(r => [r.key, r.value]))
  const pct = Number(m['portal.advance_limit_pct']), ot = Number(m['portal.overtime_max_hours'])
  const hm = (v: unknown, d: string) => (typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : d)
  let workStart = hm(m['portal.work_start'], '08:00'), workEnd = hm(m['portal.work_end'], '18:00')
  if (workEnd <= workStart) { workStart = workStart < '17:00' ? workStart : '17:00'; workEnd = '18:00' }   // same rule as attendance_settings()
  return { checkin: m['portal.checkin'] === true, advanceLimitPct: Number.isFinite(pct) && pct > 0 ? Math.min(100, pct) : 0, workStart, workEnd,
    overtimeMaxHours: Number.isFinite(ot) && ot > 0 && ot <= 12 ? ot : 5 }
}

/**
 * A check-in past the end of its working day, or overtime past the maximum, that nobody stopped (same rules as
 * attendance_autoclose() in 0031). Pages close those before showing them, and skip that round trip otherwise.
 */
export function leftRunning(rows: { work_date: string; check_in_at?: string | null; check_out_at?: string | null; overtime_start_at?: string | null; overtime_end_at?: string | null }[], s: PortalSettings, tz: string, now = Date.now()) {
  return rows.some(r => (r.check_in_at && !r.check_out_at && now >= zonedToUtc(r.work_date, s.workEnd, tz).getTime())
    || (r.overtime_start_at && !r.overtime_end_at && now >= new Date(r.overtime_start_at).getTime() + s.overtimeMaxHours * 36e5))
}

/** Current project names the employee can put an expense on (no project figures: see my_project_choices() in 0033). */
export async function myProjects(c: Ctx): Promise<{ id: string; name: string }[]> {
  const { data } = await c.supabase.rpc('my_project_choices')
  return ((data ?? []) as { id: string; name: string; code: string | null }[]).map(p => ({ id: p.id, name: p.code ? `${p.name} (${p.code})` : p.name }))
}

/** Advances not yet settled, and how much more may be asked for (a share of the monthly salary set by the company). */
export function advanceBalance(salary: number | null, advances: { kind: string; amount: number | string; settled: boolean }[], limitPct: number) {
  const outstanding = Math.round(advances.filter(a => a.kind === 'advance' && !a.settled).reduce((s, a) => s + Number(a.amount), 0) * 100) / 100
  const limit = salary && limitPct > 0 ? Math.round(salary * limitPct) / 100 : 0
  return { outstanding, limit, available: limitPct > 0 ? Math.max(0, Math.round((limit - outstanding) * 100) / 100) : null }
}

export const CLAIM_STATUS: Record<string, { label: string; tone: 'amber' | 'green' | 'red' | 'blue' | 'neutral' }> = {
  pending: { label: 'Pending approval', tone: 'amber' }, approved: { label: 'Approved', tone: 'green' }, rejected: { label: 'Rejected', tone: 'red' },
  correction_requested: { label: 'Correction needed', tone: 'blue' }, withdrawn: { label: 'Withdrawn', tone: 'neutral' },
}

/** Attendance days of one month, summed by status. */
export function attendanceSummary(rows: { status: string; overtime_hours?: number | string | null }[]) {
  const s = { present: 0, absent: 0, half_day: 0, leave: 0, holiday: 0, overtime: 0 }
  for (const r of rows) { if (r.status in s) (s as Record<string, number>)[r.status]++; s.overtime += Number(r.overtime_hours ?? 0) }
  return s
}

/** "October 2026" for a period date (first of the month). */
export const monthName = (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(`${iso.slice(0, 7)}-01T00:00:00Z`))
/** "08:02" in the company's time zone. */
export const clock = (ts: string | null | undefined, tz: string) => (ts ? new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ts)) : null)
/** Hours between check-in and check-out, one decimal. */
export const workedHours = (a: string | null | undefined, b: string | null | undefined) => (a && b ? Math.round(((new Date(b).getTime() - new Date(a).getTime()) / 36e5) * 10) / 10 : null)
export const ATTENDANCE: Record<string, { label: string; tone: 'green' | 'red' | 'amber' | 'blue' | 'neutral' }> = {
  present: { label: 'Present', tone: 'green' }, absent: { label: 'Absent', tone: 'red' }, half_day: { label: 'Half day', tone: 'amber' },
  leave: { label: 'Leave', tone: 'blue' }, holiday: { label: 'Holiday', tone: 'neutral' },
}

/** Hours between two times as "3 h 05 min". */
export const duration = (ms: number) => { const m = Math.max(0, Math.floor(ms / 60000)); return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min` }
