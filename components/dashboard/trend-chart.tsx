'use client'
import { useState } from 'react'
import { ArrowDown, ArrowUp } from '@/components/icons'
import { cn } from '@/lib/utils'
import type { TrendMonth } from '@/lib/dashboard-trend'

type Key = 'sales' | 'collected' | 'expenses'
const SERIES: { key: Key; label: string; note: string }[] = [
  { key: 'sales', label: 'Sales', note: 'Tax invoices issued, excluding VAT' },
  { key: 'collected', label: 'Collected', note: 'Payments received, including VAT' },
  { key: 'expenses', label: 'Expenses', note: 'Project expenses recorded' },
]
const trim = (x: number) => String(Math.round(x * 10) / 10)
const compact = (n: number) => (n >= 1e6 ? `${trim(n / 1e6)}M` : n >= 1e3 ? `${trim(n / 1e3)}K` : String(Math.round(n)))
const aed = (n: number) => `AED ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
/** axis: a "nice" step (1, 2, 2.5 or 5 × 10^n) giving about four intervals, and the smallest multiple of it at or above the data */
const axis = (v: number) => { if (v <= 0) return { max: 4, step: 1 }; const raw = v / 4, p = 10 ** Math.floor(Math.log10(raw)); const step = [1, 2, 2.5, 5, 10].map(s => s * p).find(s => s >= raw)!; return { max: step * Math.ceil(v / step), step } }
const W = 1000, H = 200
/** smooth line through the points (Catmull-Rom → cubic Bézier), clamped so the curve never dips below the baseline */
function curve(pts: [number, number][]) {
  if (!pts.length) return ''
  let d = `M${pts[0][0]},${pts[0][1]}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, Math.min(H, p1[1] + (p2[1] - p0[1]) / 6)], c2 = [p2[0] - (p3[0] - p1[0]) / 6, Math.min(H, p2[1] - (p3[1] - p1[1]) / 6)]
    d += ` C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${p2[0]},${p2[1]}`
  }
  return d
}

/**
 * Sales overview: twelve months of one money series as an area chart. Hover or focus a month for its value;
 * the header shows the 12-month total and, for sales and collections, month-to-date vs the same days last month.
 */
export function TrendChart({ months, change = {}, title = 'Sales overview', action }: { months: TrendMonth[]; change?: Partial<Record<Key, number | null>>; title?: string; action?: React.ReactNode }) {
  const [key, setKey] = useState<Key>('sales')
  const [hover, setHover] = useState<number | null>(null)
  const vals = months.map(mo => mo[key]), { max, step } = axis(Math.max(...vals)), ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step)
  const total = vals.reduce((a, v) => a + v, 0), s = SERIES.find(x => x.key === key)!, delta = change[key]
  const n = months.length, pts = vals.map((v, i) => [((i + 0.5) / n) * W, H - (v / max) * H] as [number, number])
  const line = curve(pts), area = pts.length ? `${line} L${pts[n - 1][0]},${H} L${pts[0][0]},${H} Z` : ''
  const f = hover, xPct = (i: number) => ((i + 0.5) / n) * 100, yPct = (i: number) => (vals[i] / max) * 100
  return <div className="px-5 pb-4 pt-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0"><h3 className="text-[15px] font-semibold tracking-[-0.012em]">{title}</h3>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-[26px] font-bold leading-none tracking-[-0.03em] tabular-nums">{aed(total)}</span>
          {delta !== undefined && delta !== null && <span className={cn('inline-flex items-center gap-0.5 text-sm font-semibold tabular-nums', delta >= 0 ? 'text-success' : 'text-danger')}>{delta >= 0 ? <ArrowUp size={14} strokeWidth={2.5} aria-hidden /> : <ArrowDown size={14} strokeWidth={2.5} aria-hidden />}{Math.abs(delta)}%<span className="ms-1 font-normal text-muted">this month vs last</span></span>}
        </div><p className="mt-1 text-xs text-muted">Last 12 months · {s.note}</p></div>
      <div className="flex items-center gap-2">
        <div role="tablist" aria-label="Series" className="inline-flex gap-1">{SERIES.map(x => <button key={x.key} role="tab" type="button" aria-selected={key === x.key} onClick={() => setKey(x.key)}
          className={cn('h-8 cursor-pointer rounded-lg px-3 text-[13px] font-medium transition-colors', key === x.key ? 'bg-primary-soft text-primary' : 'text-muted hover:bg-surface-2 hover:text-fg')}>{x.label}</button>)}</div>
        {action}</div>
    </div>
    <div className="relative mt-5 h-[230px] pb-7 ps-11" onMouseLeave={() => setHover(null)}>
      <div className="absolute inset-x-0 bottom-7 top-0" aria-hidden>
        {ticks.map(t => <div key={t} className="absolute end-0 start-11 border-t border-border/80" style={{ top: `${(1 - t / max) * 100}%` }}>
          <span className="absolute -start-11 w-9 -translate-y-1/2 text-end text-[11px] tabular-nums text-muted">{compact(t)}</span></div>)}
      </div>
      <div className="relative h-full">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
          <defs><linearGradient id="trend-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity=".22" /><stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" /></linearGradient></defs>
          <path d={area} fill="url(#trend-fill)" />
          <path d={line} fill="none" stroke="hsl(var(--primary))" strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
          {f !== null && <line x1={pts[f][0]} x2={pts[f][0]} y1={0} y2={H} stroke="hsl(var(--primary))" strokeOpacity=".35" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />}
        </svg>
        {f !== null && <>
          <span aria-hidden className="pointer-events-none absolute h-3.5 w-3.5 rounded-full border-[3px] border-surface bg-primary shadow" style={{ left: `${xPct(f)}%`, bottom: `${yPct(f)}%`, transform: 'translate(-50%, 50%)' }} />
          <div aria-hidden className="pointer-events-none absolute z-10 whitespace-nowrap rounded-lg border border-border bg-surface px-3 py-2 shadow-md"
            style={{ left: `${Math.min(88, Math.max(12, xPct(f)))}%`, bottom: `calc(${Math.min(yPct(f), 70)}% + 14px)`, transform: 'translateX(-50%)' }}>
            <div className="text-[11px] text-muted">{months[f].label} {months[f].key.slice(0, 4)}</div><div className="text-[13px] font-semibold tabular-nums">{aed(vals[f])}</div></div></>}
        <div className="absolute inset-0 flex" role="img" aria-label={`${s.label}, last 12 months`}>
          {months.map((mo, i) => <button key={mo.key} type="button" onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} aria-label={`${mo.label} ${mo.key.slice(0, 4)}: ${aed(vals[i])}`}
            className="relative h-full flex-1 cursor-default focus-visible:ring-offset-0">
            <span className={cn('absolute inset-x-0 -bottom-6 text-center text-[11px]', i === f ? 'font-medium text-fg' : 'text-muted')}>{mo.label}</span></button>)}
        </div>
      </div>
    </div>
    <table className="sr-only"><caption>{s.label} by month</caption><tbody>{months.map((mo, i) => <tr key={mo.key}><th scope="row">{mo.label} {mo.key.slice(0, 4)}</th><td>{aed(vals[i])}</td></tr>)}</tbody></table>
  </div>
}
