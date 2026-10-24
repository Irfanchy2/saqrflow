import 'server-only'
import { cache } from 'react'
import { getCtx, type Ctx } from './auth'

// The Employee Portal reads only through the signed-in user's own session: the database (0030) shows an employee
// nothing but their own employee record, salary, advances, attendance, leave, documents and expense claims.

export interface MyEmployee {
  id: string; employee_no: string; full_name: string; department: string | null; designation: string | null; phone: string | null
  nationality: string | null; joining_date: string | null; status: string; work_location: string | null; photo_path: string | null
}
export interface PortalSettings { checkin: boolean; advanceLimitPct: number }

/** The signed-in user and the employee record linked to their login (null when the login is not linked to one). */
export const getMe = cache(async (): Promise<{ c: Ctx; emp: MyEmployee | null }> => {
  const c = await getCtx()
  const { data } = await c.supabase.from('employees')
    .select('id,employee_no,full_name,department,designation,phone,nationality,joining_date,status,work_location,photo_path')
    .eq('user_id', c.userId).is('deleted_at', null).maybeSingle()
  return { c, emp: (data as MyEmployee | null) ?? null }
})

/** Company switches for the portal (Settings → Employee portal). */
export async function portalSettings(c: Ctx): Promise<PortalSettings> {
  const { data } = await c.supabase.from('app_settings').select('key,value').in('key', ['portal.checkin', 'portal.advance_limit_pct'])
  const m = Object.fromEntries((data ?? []).map(r => [r.key, r.value]))
  const pct = Number(m['portal.advance_limit_pct'])
  return { checkin: m['portal.checkin'] === true, advanceLimitPct: Number.isFinite(pct) && pct > 0 ? Math.min(100, pct) : 0 }
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
