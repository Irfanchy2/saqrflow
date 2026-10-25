import type { Ctx } from '@/lib/auth'
import { leftRunning, type PortalSettings } from '@/lib/me'
import { zonedToUtc } from '@/lib/time'
import { PortalCard } from './stat'
import { TodayCard, type TodayRecord } from './today-card'

type TodayRow = TodayRecord & { work_date: string }

/**
 * Today's record, or overtime still running from before midnight. Runs in the page's own round of queries; only when
 * something was left running past its end (a forgotten check-out ends at the working day's end, forgotten overtime at the
 * maximum) is it closed first and read again.
 */
export async function loadToday(c: Ctx, empId: string, settings: Promise<PortalSettings>): Promise<TodayRow | null> {
  const cols = 'work_date,status,check_in_at,check_out_at,overtime_start_at,overtime_end_at'
  // the second read selects one more column: Next reuses an identical GET from earlier in the same render (stale rows)
  const read = (again = false) => Promise.all([
    c.supabase.from('attendance_records').select(again ? `${cols},id` : cols).eq('employee_id', empId).eq('work_date', c.today).maybeSingle(),
    c.supabase.from('attendance_records').select(again ? `${cols},id` : cols).eq('employee_id', empId).not('overtime_start_at', 'is', null).is('overtime_end_at', null).order('work_date', { ascending: false }).limit(1),
  ]).then(([{ data: today }, { data: open }]) => (open?.[0] ?? today ?? null) as TodayRow | null)
  const [s, rec] = await Promise.all([settings, read()])
  if (!rec || !leftRunning([rec], s, c.company.timezone)) return rec
  await c.supabase.rpc('attendance_autoclose', { p_company: null })
  return read(true)
}

/** The "Today" card (portal home and Attendance): check in / out and overtime. */
export function Today({ c, rec, settings }: { c: Ctx; rec: TodayRow | null; settings: PortalSettings }) {
  const day = rec?.work_date ?? c.today
  return <PortalCard title="Today" sub={`Working hours ${settings.workStart}–${settings.workEnd}`}>
    <div className="px-4 pb-4 sm:px-5" data-today>
      <TodayCard rec={rec} dayEnd={zonedToUtc(day, settings.workEnd, c.company.timezone).toISOString()} workStart={settings.workStart} workEnd={settings.workEnd}
        otMaxHours={settings.overtimeMaxHours} tz={c.company.timezone} serverNow={new Date().toISOString()} />
    </div>
  </PortalCard>
}
