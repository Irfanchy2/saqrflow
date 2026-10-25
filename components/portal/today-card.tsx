'use client'
import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Clock, Hourglass as Timer, Loader2, LogOut } from '@/components/icons'
import { toast } from '@/components/ui/toast'
import { punch } from '@/app/actions/me'
import { cn } from '@/lib/utils'

export interface TodayRecord { status: string; check_in_at: string | null; check_out_at: string | null; overtime_start_at: string | null; overtime_end_at: string | null }
type Kind = 'in' | 'out' | 'ot_start' | 'ot_stop'

const fmtClock = (iso: string, tz: string) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso))
const fmtDur = (ms: number) => { const m = Math.max(0, Math.floor(ms / 60000)); return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min` }

function Btn({ kind, label, busy, onClick, tone }: { kind: Kind; label: string; busy: boolean; onClick: () => void; tone: 'arc' | 'ink' | 'amber' }) {
  const Icon = kind === 'in' ? Clock : kind === 'ot_start' ? Timer : LogOut
  return <button type="button" onClick={onClick} disabled={busy} data-punch={kind}
    className={cn('inline-flex h-14 w-full cursor-pointer items-center justify-center gap-2.5 rounded-2xl text-[16px] font-semibold shadow-solid transition-transform duration-150 active:scale-[.98] disabled:opacity-60',
      tone === 'arc' ? 'arc text-white' : tone === 'amber' ? 'bg-warning text-white' : 'bg-ink text-ink-fg')}>
    {busy ? <Loader2 size={20} className="animate-spin" aria-hidden /> : <Icon size={20} aria-hidden />}{label}</button>
}

/**
 * Today's attendance: check in, the working day (stops by itself at the end time), then optional overtime that stops by
 * itself after the company's maximum. Times come from the server; the clock on screen only counts along.
 */
export function TodayCard({ rec, dayEnd, workStart, workEnd, otMaxHours, tz, serverNow }: {
  rec: TodayRecord | null; dayEnd: string; workStart: string; workEnd: string; otMaxHours: number; tz: string; serverNow: string
}) {
  const [busy, start] = useTransition(), router = useRouter()
  const [skew] = useState(() => new Date(serverNow).getTime() - Date.now())   // a phone clock that is off does not matter
  const [now, setNow] = useState(() => new Date(serverNow).getTime())
  useEffect(() => { const t = setInterval(() => setNow(Date.now() + skew), 15_000); return () => clearInterval(t) }, [skew])
  const go = (kind: Kind) => start(async () => {
    const r = await punch(kind)
    if (r?.error) toast(r.error, 'error'); else { toast(r?.message ?? 'Saved.'); router.refresh() }
  })
  const end = new Date(dayEnd).getTime(), otMax = otMaxHours * 36e5
  const t = (iso: string) => fmtClock(iso, tz)
  const line = 'text-[14px] text-muted'

  if (rec && ['leave', 'holiday'].includes(rec.status) && !rec.check_in_at) return <p className={line} data-today-state="off">Today is recorded as {rec.status}. No check-in needed.</p>
  if (!rec?.check_in_at) return <div className="space-y-3" data-today-state="out">
    <p className={line}>Working hours {workStart}–{workEnd}. The day stops by itself at {workEnd}.</p>
    {now < end ? <Btn kind="in" label="Check in" tone="arc" busy={busy} onClick={() => go('in')} /> : <p className="text-[14px] font-medium">The working day has ended. Ask HR if today needs recording.</p>}
  </div>

  const inAt = new Date(rec.check_in_at).getTime()
  const dayStop = rec.check_out_at ? new Date(rec.check_out_at).getTime() : now >= end ? Math.max(inAt, end) : null
  if (dayStop === null) return <div className="space-y-3" data-today-state="working">
    <div className="flex items-baseline justify-between gap-3"><span className="text-[14px] font-medium">Working since {t(rec.check_in_at)}</span><span className="font-tech text-[18px] font-semibold tabular-nums" data-timer>{fmtDur(now - inAt)}</span></div>
    <p className={line}>Your day stops by itself at {workEnd}. Check out earlier if you leave.</p>
    <Btn kind="out" label="Check out" tone="ink" busy={busy} onClick={() => go('out')} />
  </div>

  const day = <p className="flex items-center gap-2 text-[14px] font-medium text-success"><CheckCircle2 size={17} aria-hidden />Day {t(rec.check_in_at)}–{t(new Date(dayStop).toISOString())} · {fmtDur(dayStop - inAt)}</p>
  if (!rec.overtime_start_at) return <div className="space-y-3" data-today-state="day-done">{day}
    {now >= end ? <><p className={line}>Still working? Start overtime. It stops by itself after {otMaxHours} h if you forget.</p>
      <Btn kind="ot_start" label="Start overtime" tone="amber" busy={busy} onClick={() => go('ot_start')} /></>
      : <p className={line}>Overtime can start after {workEnd}.</p>}
  </div>

  const otAt = new Date(rec.overtime_start_at).getTime()
  const otStop = rec.overtime_end_at ? new Date(rec.overtime_end_at).getTime() : now >= otAt + otMax ? otAt + otMax : null
  if (otStop === null) return <div className="space-y-3" data-today-state="overtime">{day}
    <div className="flex items-baseline justify-between gap-3"><span className="text-[14px] font-medium text-warning">Overtime since {t(rec.overtime_start_at)}</span><span className="font-tech text-[18px] font-semibold tabular-nums text-warning" data-timer>{fmtDur(now - otAt)}</span></div>
    <p className={line}>Stops by itself at {t(new Date(otAt + otMax).toISOString())} ({otMaxHours} h maximum).</p>
    <Btn kind="ot_stop" label="Stop overtime" tone="ink" busy={busy} onClick={() => go('ot_stop')} />
  </div>
  return <div className="space-y-2" data-today-state="done">{day}
    <p className="flex items-center gap-2 text-[14px] font-medium text-warning"><Timer size={17} aria-hidden />Overtime {t(rec.overtime_start_at)}–{t(new Date(otStop).toISOString())} · {fmtDur(otStop - otAt)}</p>
  </div>
}
