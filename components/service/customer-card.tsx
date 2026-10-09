import Link from 'next/link'
import { Plus } from 'lucide-react'
import type { Ctx } from '@/lib/auth'
import { Badge, Card, CardHeader } from '@/components/ui/primitives'
import { DialogButton } from '@/components/ui/dialog'
import { ActionForm } from '@/components/ui/action-form'
import { TicketFields } from './fields'
import { createTicket } from '@/app/actions/service'
import { TICKET_STATUS, ticketOverdue, warrantyState } from '@/lib/service'
import { formatShortDate } from '@/lib/time'

/** Customer page: their service tickets and warranties, with "New ticket" pre-filled for the customer. */
export async function CustomerServiceCard({ c, customerId, className }: { c: Ctx; customerId: string; className?: string }) {
  const edit = c.can('records.edit')
  const [{ data: tickets }, { data: warranties }, lists] = await Promise.all([
    c.supabase.from('service_tickets').select('id,number,title,status,due_date').eq('customer_id', customerId).order('created_at', { ascending: false }).limit(10),
    c.supabase.from('warranties').select('id,number,title,start_date,end_date').eq('customer_id', customerId).order('end_date', { ascending: false }).limit(10),
    edit ? Promise.all([
      c.supabase.from('projects').select('id,name,code').eq('customer_id', customerId).limit(200), c.supabase.from('assets').select('id,name,plate_or_serial').is('archived_at', null).order('name').limit(500),
      c.supabase.from('profiles').select('id,full_name').eq('is_active', true).order('full_name'),
      c.can('employees.view') ? c.supabase.from('employees').select('id,full_name').eq('status', 'active').order('full_name').limit(1000) : Promise.resolve({ data: [] as any[] }),
    ]) : null,
  ])
  const o = (rows: any[] | null | undefined, f: (r: any) => string) => (rows ?? []).map(r => ({ id: r.id, name: f(r) }))
  const add = edit && lists ? <DialogButton wide size="sm" variant="secondary" label="New ticket" title="New service ticket" icon={<Plus size={14} />}><ActionForm action={createTicket} submit="Open ticket" idempotent>
    <TicketFields fixedCustomer={customerId} customers={[]} projects={o(lists[0].data, r => r.code ? `${r.code} · ${r.name}` : r.name)} assets={o(lists[1].data, r => [r.name, r.plate_or_serial].filter(Boolean).join(' · '))}
      users={o(lists[2].data, r => r.full_name)} employees={o(lists[3].data, r => r.full_name)} warranties={o(warranties, r => `${r.number} · ${r.title}`)} /></ActionForm></DialogButton> : undefined
  return <Card className={className}><CardHeader title="Service & warranty" action={add} />
    {!(tickets ?? []).length && !(warranties ?? []).length ? <p className="px-4 py-4 text-sm text-muted">No service tickets or warranties yet.</p> : <ul className="divide-y divide-border text-sm">
      {(warranties ?? []).map(w => { const s = warrantyState(w, c.today); return <li key={w.id} className="flex items-center gap-3 px-4 py-2.5"><span className="min-w-0 flex-1 truncate">Warranty {w.number} · {w.title}</span>
        <span className="shrink-0 text-xs text-muted">until {formatShortDate(w.end_date)}</span><Badge tone={s.tone}>{s.label}</Badge></li> })}
      {(tickets ?? []).map(t => { const od = ticketOverdue(t, c.today); return <li key={t.id}><Link href={`/tickets/${t.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2/60">
        <span className="min-w-0 flex-1 truncate">{t.number} · {t.title}</span><Badge tone={od ? 'red' : TICKET_STATUS[t.status]?.tone}>{od ? 'Overdue' : TICKET_STATUS[t.status]?.label}</Badge></Link></li> })}
    </ul>}</Card>
}
