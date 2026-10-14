'use client'
import { useState } from 'react'
import { m } from 'framer-motion'
import { cn } from '@/lib/utils'
import type { TrendMonth } from '@/lib/dashboard-trend'
import { T } from '@/components/motion'

type Key = 'sales' | 'collected' | 'expenses'
const SERIES: { key: Key; label: string; note: string }[] = [
  { key: 'sales', label: 'Sales', note: 'Tax invoices issued, excluding VAT' },
  { key: 'collected', label: 'Collected', note: 'Payments received, including VAT' },
  { key: 'expenses', label: 'Expenses', note: 'Project expenses recorded' },
]
const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(Math.round(n)))
const aed = (n: number) => `AED ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
/** a "nice" axis maximum: 1, 2, 2.5 or 5 × 10^n */
const niceMax = (v: number) => { if (v <= 0) return 1; const p = 10 ** Math.floor(Math.log10(v)); return [1, 2, 2.5, 5, 10].map(s => s * p).find(s => s >= v)! }

/** Twelve months of one money series as bars; hover or focus a month for its value. The current month is emphasised. */
export function TrendChart({ months, show = ['sales', 'collected', 'expenses'] }: { months: TrendMonth[]; show?: Key[] }) {
  const series = SERIES.filter(s => show.includes(s.key))
  const [key, setKey] = useState<Key>(series[0]?.key ?? 'sales')
  const [hover, setHover] = useState<number | null>(null)
  const vals = months.map(mo => mo[key]), max = niceMax(Math.max(...vals)), ticks = [0, 0.25, 0.5, 0.75, 1].map(f => f * max)
  const cur = months.length - 1, focus = hover ?? cur
  const s = SERIES.find(x => x.key === key)!
  return <div>
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-3">
      <div role="tablist" aria-label="Series" className="inline-flex rounded-md bg-surface-2 p-0.5">
        {series.map(x => <button key={x.key} role="tab" type="button" aria-selected={key === x.key} onClick={() => setKey(x.key)}
          className={cn('relative h-7 cursor-pointer rounded px-2.5 text-[13px] font-medium transition-colors', key === x.key ? 'text-fg' : 'text-muted hover:text-fg')}>
          {key === x.key && <m.span layoutId="trend-tab" transition={T.base} className="absolute inset-0 rounded bg-surface shadow-sm ring-1 ring-border" aria-hidden />}
          <span className="relative">{x.label}</span></button>)}
      </div>
      <p className="text-xs text-muted">{s.note}</p>
    </div>
    <div className="px-4 pb-1 pt-3">
      <div className="text-xs text-muted">{months[focus].label} {months[focus].key.slice(0, 4)}{focus === cur ? ' (to date)' : ''}</div>
      <div className="text-xl font-semibold tabular-nums tracking-[-0.02em]">{aed(vals[focus])}</div>
    </div>
    <div className="relative h-[210px] px-4 pb-6 pt-2" onMouseLeave={() => setHover(null)}>
      <div className="absolute inset-x-4 bottom-6 top-2 ms-9" aria-hidden>
        {ticks.map(t => <div key={t} className="absolute inset-x-0 border-t border-dashed border-border" style={{ bottom: `${(t / max) * 100}%` }}>
          <span className="absolute -start-9 -translate-y-1/2 text-[11px] tabular-nums text-muted">{compact(t)}</span></div>)}
      </div>
      <div className="relative ms-9 flex h-full items-end gap-[6px]" role="img" aria-label={`${s.label}, last 12 months`}>
        {months.map((mo, i) => {
          const v = vals[i], pct = (v / max) * 100
          return <button key={mo.key} type="button" onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} aria-label={`${mo.label} ${mo.key.slice(0, 4)}: ${aed(v)}`}
            className="group relative flex h-full flex-1 cursor-default flex-col justify-end focus-visible:ring-offset-0">
            <m.span initial={false} animate={{ height: `${Math.max(pct, v > 0 ? 1.5 : 0)}%` }} transition={T.slow}
              className={cn('block w-full rounded-t-[3px] transition-colors', i === cur ? 'bg-primary' : focus === i ? 'bg-primary/70' : 'bg-primary/25 group-hover:bg-primary/45')} />
            <span className={cn('absolute -bottom-5 inset-x-0 text-center text-[11px]', i === focus ? 'font-medium text-fg' : 'text-muted')}>{mo.label}</span>
          </button>
        })}
      </div>
    </div>
    <table className="sr-only"><caption>{s.label} by month</caption><tbody>{months.map((mo, i) => <tr key={mo.key}><th scope="row">{mo.label} {mo.key.slice(0, 4)}</th><td>{aed(vals[i])}</td></tr>)}</tbody></table>
  </div>
}
