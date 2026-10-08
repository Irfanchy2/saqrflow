'use client'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

const axis = { fontSize: 11, fill: 'hsl(var(--muted))' }
const tip = { contentStyle: { background: 'hsl(var(--surface))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }, cursor: { fill: 'hsl(var(--surface-2))' } }

export function ExpiryChart({ data }: { data: { month: string; employee: number; company: number }[] }) {
  return <div role="img" aria-label="Document expiries by month" className="h-56 w-full"><ResponsiveContainer>
    <BarChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
      <CartesianGrid vertical={false} stroke="hsl(var(--border))" /><XAxis dataKey="month" tick={axis} axisLine={false} tickLine={false} />
      <YAxis allowDecimals={false} tick={axis} axisLine={false} tickLine={false} /><Tooltip {...tip} /><Legend wrapperStyle={{ fontSize: 12 }} />
      <Bar isAnimationActive={false} dataKey="company" name="Company docs" stackId="a" fill="hsl(var(--primary))" radius={[0, 0, 0, 0]} />
      <Bar isAnimationActive={false} dataKey="employee" name="Employee docs" stackId="a" fill="hsl(var(--primary) / .45)" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div>
}
export function ChequeChart({ data }: { data: { month: string; incoming: number; outgoing: number }[] }) {
  return <div role="img" aria-label="Cheque amounts by month" className="h-56 w-full"><ResponsiveContainer>
    <BarChart data={data} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
      <CartesianGrid vertical={false} stroke="hsl(var(--border))" /><XAxis dataKey="month" tick={axis} axisLine={false} tickLine={false} />
      <YAxis tick={axis} axisLine={false} tickLine={false} tickFormatter={v => (v >= 1000 ? `${Math.round(v / 1000)}k` : v)} />
      <Tooltip {...tip} formatter={(v: number) => `AED ${v.toLocaleString('en-US')}`} /><Legend wrapperStyle={{ fontSize: 12 }} />
      <Bar isAnimationActive={false} dataKey="incoming" name="Incoming" fill="hsl(var(--success))" radius={[4, 4, 0, 0]} /><Bar isAnimationActive={false} dataKey="outgoing" name="Outgoing" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div>
}

// ───────────── Reports: every chart answers one question and has a table view below it on the page ─────────────
const aed = (v: number) => `AED ${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const k = (v: number) => (Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(v))
export type Series = { key: string; name: string; slot: 1 | 2 | 3 }
const SLOT = (s: 1 | 2 | 3) => `var(--series-${s})`

/** Grouped bars over time, one y-axis (money or counts). Used for invoiced vs received, quoted vs accepted. */
export function TimeBars({ data, series, money = true, label }: { data: Record<string, number | string>[]; series: Series[]; money?: boolean; label: string }) {
  return <div role="img" aria-label={label} className="h-64 w-full"><ResponsiveContainer>
    <BarChart data={data} margin={{ top: 8, right: 8, left: money ? -4 : -20, bottom: 0 }} barGap={2} barCategoryGap="22%">
      <CartesianGrid vertical={false} stroke="hsl(var(--border))" /><XAxis dataKey="label" tick={axis} axisLine={false} tickLine={false} interval="preserveStartEnd" />
      <YAxis tick={axis} axisLine={false} tickLine={false} allowDecimals={!money} tickFormatter={money ? k : undefined} />
      <Tooltip {...tip} formatter={(v: number) => (money ? aed(v) : v.toLocaleString('en-US'))} />
      {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} iconType="square" iconSize={10} />}
      {series.map(s => <Bar key={s.key} isAnimationActive={false} dataKey={s.key} name={s.name} fill={SLOT(s.slot)} radius={[4, 4, 0, 0]} maxBarSize={22} />)}
    </BarChart></ResponsiveContainer></div>
}
/** Receivables ageing: one series, ordered buckets, value labels on the bars. */
export function AgeingBars({ data }: { data: { label: string; value: number }[] }) {
  return <div role="img" aria-label={`Outstanding by age: ${data.map(d => `${d.label} ${aed(d.value)}`).join(', ')}`} className="h-56 w-full"><ResponsiveContainer>
    <BarChart data={data} layout="vertical" margin={{ top: 4, right: 72, left: 8, bottom: 0 }}>
      <CartesianGrid horizontal={false} stroke="hsl(var(--border))" /><XAxis type="number" tick={axis} axisLine={false} tickLine={false} tickFormatter={k} />
      <YAxis type="category" dataKey="label" tick={axis} axisLine={false} tickLine={false} width={96} />
      <Tooltip {...tip} formatter={(v: number) => aed(v)} />
      <Bar isAnimationActive={false} dataKey="value" name="Outstanding" fill={SLOT(1)} radius={[0, 4, 4, 0]} maxBarSize={18}
        label={{ position: 'right', fontSize: 11, fill: 'hsl(var(--muted))', formatter: (v: number) => (v ? k(v) : '') }} />
    </BarChart></ResponsiveContainer></div>
}
/** Stacked counts per month (document expiries by group); a 2 px surface gap separates the segments. */
export function StackBars({ data, series, label }: { data: Record<string, number | string>[]; series: Series[]; label: string }) {
  return <div role="img" aria-label={label} className="h-56 w-full"><ResponsiveContainer>
    <BarChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }} barCategoryGap="28%">
      <CartesianGrid vertical={false} stroke="hsl(var(--border))" /><XAxis dataKey="label" tick={axis} axisLine={false} tickLine={false} />
      <YAxis allowDecimals={false} tick={axis} axisLine={false} tickLine={false} /><Tooltip {...tip} /><Legend wrapperStyle={{ fontSize: 12 }} iconType="square" iconSize={10} />
      {series.map((s, i) => <Bar key={s.key} isAnimationActive={false} dataKey={s.key} name={s.name} stackId="a" fill={SLOT(s.slot)} stroke="hsl(var(--surface))" strokeWidth={2} maxBarSize={28} radius={i === series.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]} />)}
    </BarChart></ResponsiveContainer></div>
}
