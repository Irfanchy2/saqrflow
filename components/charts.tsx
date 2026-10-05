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
