'use client'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useTransition } from 'react'
import { ChevronLeft, ChevronRight, Loader2 } from '@/components/icons'

const shift = (m: string, by: number) => { const [y, mo] = m.split('-').map(Number); const d = new Date(Date.UTC(y, mo - 1 + by, 1)); return d.toISOString().slice(0, 7) }

/** Reporting month for the salary dashboard (?month=YYYY-MM): previous / next buttons and a month field. */
export function MonthPicker({ month, max }: { month: string; max: string }) {
  const router = useRouter(), path = usePathname(), sp = useSearchParams(), [pending, start] = useTransition()
  const go = (m: string) => { if (!/^\d{4}-\d{2}$/.test(m) || m > max) return; const q = new URLSearchParams(sp); if (m === max) q.delete('month'); else q.set('month', m); start(() => router.push(`${path}${q.size ? `?${q}` : ''}`, { scroll: false })) }
  const btn = 'grid h-11 w-11 cursor-pointer place-items-center text-muted transition-colors hover:bg-fg/[.05] hover:text-fg disabled:cursor-default disabled:opacity-40 sm:h-9 sm:w-9'
  return <div className="inline-flex items-center overflow-hidden rounded-full border border-border bg-surface shadow-key" data-month-picker>
    <button type="button" className={btn} aria-label="Previous month" onClick={() => go(shift(month, -1))}><ChevronLeft size={16} /></button>
    <label className="relative flex items-center"><span className="sr-only">Month</span>
      <input type="month" value={month} max={max} onChange={e => go(e.target.value)} className="h-11 w-[9.5rem] cursor-pointer border-x border-border bg-transparent px-2 text-center text-[14px] font-medium tabular-nums outline-none sm:h-9" />
      {pending && <Loader2 size={13} className="absolute end-2 animate-spin text-muted" aria-hidden />}</label>
    <button type="button" className={btn} aria-label="Next month" disabled={month >= max} onClick={() => go(shift(month, 1))}><ChevronRight size={16} /></button>
  </div>
}
