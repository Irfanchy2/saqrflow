import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/auth'
import { flat } from '@/lib/queries'
import { Badge, PageHeader } from '@/components/ui/primitives'
import { MonthGrid } from '@/components/ui/month-grid'
import { addDays, daysBetween, endOfMonth, formatAed } from '@/lib/time'

export const metadata = { title: 'Calendar' }
export default async function Calendar({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await getCtx(); if (!c.can('documents.view') && !c.can('finance.view')) redirect('/'); const sp = await flat(searchParams)
  const month = /^\d{4}-\d{2}$/.test(sp.m ?? '') ? sp.m! : c.today.slice(0, 7)
  const from = addDays(month + '-01', -7), to = addDays(endOfMonth(month + '-01'), 7)
  const { data } = await c.supabase.from('reminder_sources').select('source_type,source_id,title,subject,owner_type,due_date,amount,direction,link').gte('due_date', from).lte('due_date', to).limit(1000)   // RLS: only what this user may see
  const items = (data ?? []).map((r: any) => ({
    date: r.due_date, href: r.link,
    label: r.source_type === 'cheque' ? `${r.direction === 'incoming' ? '↓' : '↑'} ${formatAed(r.amount)} ${r.subject ?? ''}` : r.subject ? `${r.title} · ${r.subject}` : r.title,
    tone: (daysBetween(c.today, r.due_date) < 0 ? 'red' : r.source_type === 'cheque' ? 'blue' : r.source_type === 'document' ? (r.owner_type === 'employee' ? 'amber' : 'blue') : 'neutral') as any,
  }))
  return <><PageHeader title="Calendar" sub="Every expiry, cheque date and custom reminder in one place." actions={<div className="flex gap-2 text-xs"><Badge tone="amber">Employee documents</Badge><Badge tone="blue">Company / cheques</Badge><Badge tone="red">Overdue</Badge></div>} />
    <MonthGrid month={month} today={c.today} items={items} base="/calendar" /></>
}
