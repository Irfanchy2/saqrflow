import type { Ctx } from '@/lib/auth'
import type { PortalSettings } from '@/lib/me'
import { zonedToUtc } from '@/lib/time'
import { PortalCard } from './stat'
import { TodayCard, type TodayRecord } from './today-card'

/**
 * The "Today" card (portal home and Attendance). Closes anything left running first (a forgotten check-out ends at the
 * working day's end, forgotten overtime at the maximum), then shows today's record, or overtime still running from
 * before midnight.
 */
export async function Today({ c, empId, settings }: { c: Ctx; empId: string; settings: PortalSettings }) {
  await c.supabase.rpc('attendance_autoclose', { p_company: null })
  const cols = 'work_date,status,check_in_at,check_out_at,overtime_start_at,overtime_end_at'
  const [{ data: today }, { data: open }] = await Promise.all([
    c.supabase.from('attendance_records').select(cols).eq('employee_id', empId).eq('work_date', c.today).maybeSingle(),
    c.supabase.from('attendance_records').select(cols).eq('employee_id', empId).not('overtime_start_at', 'is', null).is('overtime_end_at', null).order('work_date', { ascending: false }).limit(1),
  ])
  const rec = (open?.[0] ?? today ?? null) as (TodayRecord & { work_date: string }) | null
  const day = rec?.work_date ?? c.today
  return <PortalCard title="Today" sub={`Working hours ${settings.workStart}–${settings.workEnd}`}>
    <div className="px-4 pb-4 sm:px-5" data-today>
      <TodayCard rec={rec} dayEnd={zonedToUtc(day, settings.workEnd, c.company.timezone).toISOString()} workStart={settings.workStart} workEnd={settings.workEnd}
        otMaxHours={settings.overtimeMaxHours} tz={c.company.timezone} serverNow={new Date().toISOString()} />
    </div>
  </PortalCard>
}
