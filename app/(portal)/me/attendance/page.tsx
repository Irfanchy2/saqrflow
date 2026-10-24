import Link from 'next/link'
import { getMe, portalSettings, attendanceSummary, monthName, clock, workedHours, ATTENDANCE } from '@/lib/me'
import { flat } from '@/lib/queries'
import { addMonths, endOfMonth, formatShortDate, startOfMonth } from '@/lib/time'
import { Badge, EmptyState } from '@/components/ui/primitives'
import { CalendarCheck, ChevronRight, ArrowLeft, CheckCircle2 } from '@/components/icons'
import { PortalCard } from '@/components/portal/stat'
import { PunchButton } from '@/components/portal/punch'

export const metadata = { title: 'My attendance' }
const LEAVE: Record<string, string> = { annual: 'Annual leave', sick: 'Sick leave', unpaid: 'Unpaid leave', emergency: 'Emergency leave', other: 'Leave' }

/** The employee's own attendance by month (read-only: HR records it; self check-in only when the company turned it on). */
export default async function MyAttendance({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await flat(searchParams)
  const { c, emp } = await getMe()
  if (!emp) return null
  const cur = startOfMonth(c.today)
  const month = sp.m && /^\d{4}-\d{2}$/.test(sp.m) && `${sp.m}-01` <= cur ? `${sp.m}-01` : cur
  const end = endOfMonth(month), tz = c.company.timezone
  const [settings, { data: rows }, { data: leave }] = await Promise.all([
    portalSettings(c),
    c.supabase.from('attendance_records').select('id,work_date,status,overtime_hours,notes,check_in_at,check_out_at,source').eq('employee_id', emp.id).gte('work_date', month).lte('work_date', end).order('work_date', { ascending: false }),
    c.supabase.from('leave_records').select('id,leave_type,start_date,end_date,status').eq('employee_id', emp.id).lte('start_date', end).gte('end_date', month).order('start_date', { ascending: false }),
  ])
  const sum = attendanceSummary(rows ?? [])
  const today = month === cur ? (rows ?? []).find(r => r.work_date === c.today) : undefined
  const prev = addMonths(month, -1).slice(0, 7), next = month < cur ? addMonths(month, 1).slice(0, 7) : null
  const nav = 'grid h-11 w-11 place-items-center rounded-full border border-border bg-surface shadow-key hover:bg-surface-2'
  return <div className="space-y-4">
    <div className="flex items-center justify-between gap-3 pt-1">
      <h1 className="text-[26px] font-semibold tracking-[-0.03em] sm:text-[30px]">Attendance</h1>
      <div className="flex items-center gap-2">
        <Link href={`/me/attendance?m=${prev}`} aria-label="Previous month" className={nav}><ArrowLeft size={17} className="rtl:rotate-180" /></Link>
        <span className="min-w-[120px] text-center text-[14px] font-semibold" data-month>{monthName(month)}</span>
        {next ? <Link href={`/me/attendance?m=${next}`} aria-label="Next month" className={nav}><ChevronRight size={17} className="rtl:rotate-180" /></Link> : <span className="h-11 w-11" />}
      </div>
    </div>

    {settings.checkin && month === cur && <PortalCard title="Today" sub={today?.check_in_at ? `In at ${clock(today.check_in_at, tz)}${today.check_out_at ? ` · out at ${clock(today.check_out_at, tz)}` : ''}` : 'Not checked in yet'}>
      <div className="px-4 pb-4 sm:px-5">{!today?.check_in_at ? (today && ['leave', 'holiday'].includes(today.status) ? <p className="text-[14px] text-muted">No check-in needed today.</p> : <PunchButton kind="in" />)
        : !today.check_out_at ? <PunchButton kind="out" /> : <p className="flex items-center gap-2 text-[14px] font-medium text-success"><CheckCircle2 size={17} aria-hidden />Day complete ({workedHours(today.check_in_at, today.check_out_at)} h).</p>}</div>
    </PortalCard>}

    <div className="grid grid-cols-3 gap-2 sm:grid-cols-6" data-attendance-summary>
      {([['Present', sum.present], ['Half day', sum.half_day], ['Absent', sum.absent], ['Leave', sum.leave], ['Holiday', sum.holiday], ['Overtime h', sum.overtime]] as const).map(([l, v]) =>
        <div key={l} className="rounded-2xl border border-border/80 bg-surface px-2 py-3 text-center shadow-card"><div className="text-[20px] font-semibold tabular-nums">{v}</div><div className="mt-0.5 text-[11.5px] text-muted">{l}</div></div>)}
    </div>

    <PortalCard title="Daily records" sub="Recorded by HR. Ask HR if something is wrong.">
      {(rows ?? []).length ? <ul className="divide-y divide-border/70" data-attendance-days>{rows!.map(r => { const a = ATTENDANCE[r.status] ?? ATTENDANCE.present, h = workedHours(r.check_in_at, r.check_out_at)
        return <li key={r.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
          <div className="w-12 shrink-0 text-center"><div className="text-[18px] font-semibold leading-none tabular-nums">{Number(r.work_date.slice(8))}</div><div className="mt-1 text-[11px] uppercase text-muted">{new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short' }).format(new Date(`${r.work_date}T00:00:00Z`))}</div></div>
          <div className="min-w-0 flex-1 text-[13px] text-muted">{r.check_in_at ? <>In {clock(r.check_in_at, tz)}{r.check_out_at ? ` · Out ${clock(r.check_out_at, tz)}` : ''}{h !== null ? ` · ${h} h` : ''}</> : r.source === 'admin' ? 'Recorded by HR' : ''}
            {Number(r.overtime_hours) > 0 && <span className="text-fg"> · {Number(r.overtime_hours)} h overtime</span>}{r.notes && <span className="block truncate">{r.notes}</span>}</div>
          <Badge tone={a.tone}>{a.label}</Badge></li> })}</ul>
        : <EmptyState compact icon={CalendarCheck} title="No records this month" body="Days appear here once HR records them." />}
    </PortalCard>

    {(leave ?? []).length > 0 && <PortalCard title="Leave">
      <ul className="divide-y divide-border/70">{leave!.map(l => <li key={l.id} className="flex items-center justify-between gap-3 px-4 py-3 text-[14px] sm:px-5">
        <span><span className="font-medium">{LEAVE[l.leave_type] ?? 'Leave'}</span><span className="block text-[13px] text-muted">{formatShortDate(l.start_date)}{l.end_date !== l.start_date ? ` – ${formatShortDate(l.end_date)}` : ''}</span></span>
        <Badge tone={l.status === 'approved' ? 'green' : l.status === 'rejected' ? 'red' : 'amber'}>{l.status === 'approved' ? 'Approved' : l.status === 'rejected' ? 'Rejected' : 'Pending'}</Badge></li>)}</ul>
    </PortalCard>}
  </div>
}
