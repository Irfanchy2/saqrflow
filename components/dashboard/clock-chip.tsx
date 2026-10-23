'use client'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, ChevronDown, Loader2, Search } from '@/components/icons'
import { saveTimezone } from '@/app/actions/admin'
import { toast } from '@/components/ui/toast'
import { ZONES, allZones, placeOf } from '@/lib/time-zones'
import { popIn, warmGsap } from '@/lib/gsap-pop'
import { cn } from '@/lib/utils'

const fmt = (tz: string) => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date())

/**
 * The live clock at the top of the dashboard: the company's local time (it keeps ticking), the place, and what the day
 * holds. Tapping it picks the company's time zone, which "today", due dates and this clock all follow.
 */
export function ClockChip({ tz, initial, chip, canEdit, demo }: { tz: string; initial: string; chip: string[]; canEdit: boolean; demo: boolean }) {
  const [time, setTime] = useState(initial), [open, setOpen] = useState(false), [q, setQ] = useState(''), [busy, start] = useTransition()
  const box = useRef<HTMLDivElement>(null), panel = useRef<HTMLDivElement>(null), router = useRouter()
  useEffect(() => { setTime(fmt(tz)); const t = setInterval(() => setTime(fmt(tz)), 10_000); return () => clearInterval(t) }, [tz])
  useLayoutEffect(() => { if (open) { popIn(panel.current, { items: '[data-zone]' }); panel.current?.querySelector('input')?.focus() } }, [open])
  useEffect(() => {
    if (!open) return
    const out = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    addEventListener('pointerdown', out); addEventListener('keydown', key)
    return () => { removeEventListener('pointerdown', out); removeEventListener('keydown', key) }
  }, [open])
  const zones = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return ZONES
    const named = ZONES.filter(([z, p]) => (z + ' ' + p).toLowerCase().includes(s))
    const more = allZones().filter(z => z.toLowerCase().replace(/_/g, ' ').includes(s) && !named.some(n => n[0] === z)).slice(0, 30).map(z => [z, placeOf(z)] as [string, string])
    return [...named, ...more]
  }, [q])
  const pick = (z: string) => { if (z === tz) { setOpen(false); return }
    start(async () => { const r = (await saveTimezone(z)) ?? {}; toast(r.error ?? r.message ?? 'Saved', r.error ? 'error' : 'success'); if (!r.error) { setOpen(false); router.refresh() } }) }

  const face = <>
    <span className="relative grid h-2 w-2 place-items-center" aria-hidden><span className="absolute h-2 w-2 animate-ping rounded-full bg-success/60 motion-reduce:hidden" /><span className="h-2 w-2 rounded-full bg-success" /></span>
    <span className="font-tech text-[13.5px] font-semibold tabular-nums tracking-[0.02em]" suppressHydrationWarning>{time}</span><span className="text-muted">· {placeOf(tz)}</span>{chip.map(c => <span key={c} className="text-muted">· {c}</span>)}</>
  const pill = 'inline-flex max-w-full flex-wrap items-center gap-x-2 gap-y-0.5 rounded-full border border-white/70 bg-surface/70 px-3 py-1.5 text-[12.5px] font-medium shadow-card backdrop-blur-xl dark:border-white/[.06]'
  if (!canEdit) return <p className={pill}>{face}</p>
  return <div ref={box} className="relative inline-block max-w-full">
    <button type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(o => !o)} {...warmGsap}
      className={cn(pill, 'cursor-pointer text-start transition-shadow hover:shadow-lift')} title="Change the time zone">
      {face}<ChevronDown size={13} weight="bold" className={cn('text-muted transition-transform duration-200', open && 'rotate-180')} aria-hidden /><span className="sr-only">Change the time zone</span></button>
    {open && <div ref={panel} role="dialog" aria-label="Time zone" className="absolute start-0 top-[calc(100%+10px)] z-pop w-[19rem] max-w-[calc(100vw-2rem)] rounded-[22px] border border-border/80 bg-surface p-2 shadow-pop">
      <p className="px-2.5 pb-2 pt-1.5 text-[13px] text-muted">{demo ? 'The shared demo stays on Dubai time. In your own account this sets the company time zone.' : 'Company time zone. Today, due dates and this clock follow it.'}</p>
      <label className="relative mb-1 block"><span className="sr-only">Search time zones</span><Search size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search a city or country" className="h-11 w-full rounded-xl bg-surface-2 ps-9 pe-3 text-[15px] outline-none ring-primary/40 focus:ring-2" /></label>
      <ul className="max-h-72 overflow-y-auto overscroll-contain py-1">{zones.map(([z, p]) => <li key={z}>
        <button type="button" data-zone disabled={busy || demo} onClick={() => pick(z)}
          className="flex h-11 w-full cursor-pointer items-center gap-3 rounded-xl px-2.5 text-start text-[14.5px] hover:bg-surface-2 disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent">
          <span className="min-w-0 flex-1 truncate">{p}</span><span className="font-tech text-[12.5px] tabular-nums text-muted" suppressHydrationWarning>{fmt(z)}</span>
          {busy ? null : z === tz ? <Check size={16} weight="bold" className="text-primary" aria-label="Current" /> : <span className="w-4" />}</button></li>)}
        {!zones.length && <li className="px-2.5 py-3 text-[13.5px] text-muted">No time zone matches “{q}”.</li>}</ul>
      {busy && <p className="flex items-center gap-2 px-2.5 py-2 text-[13px] text-muted"><Loader2 size={14} className="animate-spin" aria-hidden />Saving…</p>}
    </div>}
  </div>
}
