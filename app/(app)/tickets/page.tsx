import Link from 'next/link'
import { Plus, ShieldCheck, Wrench } from 'lucide-react'
import { getCtx } from '@/lib/auth'
import { PAGE_SIZE, flat, pageOf, sanitizeQ } from '@/lib/queries'
import { Badge, Card, EmptyState, LinkButton, Metrics, PageHeader, Pagination, StatCard } from '@/components/ui/primitives'
import { DialogButton } from '@/components/ui/dialog'
import { ActionForm } from '@/components/ui/action-form'
import { TicketFields, WarrantyFields } from '@/components/service/fields'
import { createTicket, saveWarranty } from '@/app/actions/service'
import { OPEN_TICKET, TICKET_CATEGORY, TICKET_PRIORITY, TICKET_STATUS, ticketOverdue, warrantyState } from '@/lib/service'
import { addDays, formatShortDate } from '@/lib/time'
import { cn } from '@/lib/utils'
import { SavedViews } from '@/components/saved-views'

export const metadata = { title: 'Service & warranty' }
const TABS = [['open', 'Open'], ['mine', 'Assigned to me'], ['overdue', 'Overdue'], ['done', 'Resolved & closed'], ['all', 'All'], ['warranties', 'Warranties']] as const

/** After-sales: service tickets (repairs, maintenance, defects, complaints) and the warranties they are checked against. */
export default async function TicketsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await getCtx(); const sp = await flat(searchParams)
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : 'open'
  const page = pageOf(sp.page), term = sanitizeQ(sp.q), edit = c.can('records.edit'), head = { count: 'exact' as const, head: true }
  const opt = (rows: any[] | null, label: (r: any) => string) => (rows ?? []).map(r => ({ id: r.id, name: label(r) }))
  const [customers, projects, assets, users, employees, warrantiesOpt, invoices] = edit ? await Promise.all([
    c.supabase.from('customers').select('id,name').order('name').limit(2000),
    c.supabase.from('projects').select('id,name,code').order('created_at', { ascending: false }).limit(500),
    c.supabase.from('assets').select('id,name,plate_or_serial').is('archived_at', null).order('name').limit(500),
    c.supabase.from('profiles').select('id,full_name').eq('is_active', true).order('full_name'),
    c.can('employees.view') ? c.supabase.from('employees').select('id,full_name').eq('status', 'active').order('full_name').limit(1000) : Promise.resolve({ data: [] as any[] }),
    c.supabase.from('warranties').select('id,number,title').gte('end_date', c.today).order('end_date').limit(500),
    c.can('finance.view') ? c.supabase.from('invoices').select('id,number,customer_name').eq('doc_type', 'invoice').not('status', 'in', '(draft,cancelled)').order('issue_date', { ascending: false }).limit(500) : Promise.resolve({ data: [] as any[] }),
  ]) : Array(7).fill({ data: [] })
  const fieldOpts = { customers: opt(customers.data, r => r.name), projects: opt(projects.data, r => r.code ? `${r.code} · ${r.name}` : r.name), assets: opt(assets.data, r => [r.name, r.plate_or_serial].filter(Boolean).join(' · ')),
    users: opt(users.data, r => r.full_name), employees: opt(employees.data, r => r.full_name), warranties: opt(warrantiesOpt.data, r => `${r.number} · ${r.title}`) }
  const qs = (x: Record<string, string>) => `/tickets?${new URLSearchParams({ ...Object.fromEntries(Object.entries(sp).filter(([k, v]) => v && !['page'].includes(k))) as Record<string, string>, ...x })}`
  const addTicket = <DialogButton wide label="New ticket" title="New service ticket" icon={<Plus size={15} />} openParam="ticket"><ActionForm draftKey="ticket:new" action={createTicket} submit="Open ticket" idempotent><TicketFields {...fieldOpts} /></ActionForm></DialogButton>
  const addWarranty = <DialogButton wide variant="secondary" label="Record warranty" title="Record a warranty" icon={<ShieldCheck size={15} />} openParam="warranty"><ActionForm action={saveWarranty.bind(null, null)} submit="Save warranty">
    <WarrantyFields customers={fieldOpts.customers} projects={fieldOpts.projects} invoices={opt(invoices.data, r => `${r.number}${r.customer_name ? ` · ${r.customer_name}` : ''}`)} w={{ start_date: c.today }} /></ActionForm></DialogButton>

  const [openN, overdueN, mineN, activeW] = await Promise.all([
    c.supabase.from('service_tickets').select('id', head).in('status', OPEN_TICKET),
    c.supabase.from('service_tickets').select('id', head).in('status', OPEN_TICKET).lt('due_date', c.today),
    c.supabase.from('service_tickets').select('id', head).in('status', OPEN_TICKET).eq('assigned_to', c.userId),
    c.supabase.from('warranties').select('id', head).lte('start_date', c.today).gte('end_date', c.today),
  ])

  let rows: any[] = [], count = 0
  if (tab === 'warranties') {
    let q = c.supabase.from('warranties').select('id,number,title,start_date,end_date,customer:customers(id,name),project:projects(id,name)', { count: 'exact' })
    if (term) q = q.or(`title.ilike.%${term}%,number.ilike.%${term}%`)
    if (sp.state === 'active') q = q.lte('start_date', c.today).gte('end_date', c.today)
    else if (sp.state === 'expiring') q = q.gte('end_date', c.today).lte('end_date', addDays(c.today, 60))
    const r = await q.order('end_date').range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1); rows = r.data ?? []; count = r.count ?? 0
  } else {
    let q = c.supabase.from('service_tickets').select('id,number,title,status,priority,category,due_date,under_warranty,chargeable,assigned_to,customer:customers(id,name),project:projects(id,name)', { count: 'exact' })
    if (tab === 'open') q = q.in('status', OPEN_TICKET)
    else if (tab === 'mine') q = q.in('status', OPEN_TICKET).eq('assigned_to', c.userId)
    else if (tab === 'overdue') q = q.in('status', OPEN_TICKET).lt('due_date', c.today)
    else if (tab === 'done') q = q.in('status', ['resolved', 'closed'])
    if (term) q = q.or(`title.ilike.%${term}%,number.ilike.%${term}%,contact_name.ilike.%${term}%`)
    if (sp.priority && sp.priority in TICKET_PRIORITY) q = q.eq('priority', sp.priority)
    if (sp.category && sp.category in TICKET_CATEGORY) q = q.eq('category', sp.category)
    const r = await q.order(tab === 'done' ? 'updated_at' : 'due_date', { ascending: tab !== 'done', nullsFirst: false }).range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1); rows = r.data ?? []; count = r.count ?? 0
  }

  return <>
    <PageHeader title="Service & warranty" sub="Repairs, maintenance, installation defects and complaints, checked against the customer’s warranty. Due dates follow the priority." actions={<><SavedViews page="/tickets" />{edit && addWarranty}{edit && addTicket}</>} />
    <Metrics className="mb-5" cols={4}>
      <StatCard label="Open tickets" value={openN.count ?? 0} href="/tickets?tab=open" />
      <StatCard label="Overdue" value={overdueN.count ?? 0} tone={overdueN.count ? 'red' : 'neutral'} href="/tickets?tab=overdue" />
      <StatCard label="Assigned to me" value={mineN.count ?? 0} href="/tickets?tab=mine" />
      <StatCard label="Active warranties" value={activeW.count ?? 0} href="/tickets?tab=warranties&state=active" />
    </Metrics>
    <nav aria-label="Service views" className="mb-4 flex gap-1 overflow-x-auto border-b border-border">{TABS.map(([k, l]) => <Link key={k} href={`/tickets?tab=${k}`} aria-current={tab === k ? 'page' : undefined}
      className={cn('-mb-px shrink-0 border-b-2 px-3 py-2 text-sm transition-colors', tab === k ? 'border-primary font-medium text-fg' : 'border-transparent text-muted hover:text-fg')}>{l}</Link>)}</nav>
    <Card>
      <form className="flex flex-wrap gap-2 border-b border-border p-3"><input type="hidden" name="tab" value={tab} />
        <input name="q" type="search" defaultValue={sp.q} aria-label="Search" placeholder={tab === 'warranties' ? 'Search warranties…' : 'Search tickets, contacts…'} className="h-9 min-w-48 flex-1 rounded-md border border-border bg-surface px-3 text-sm" />
        {tab === 'warranties' ? <select name="state" defaultValue={sp.state ?? ''} aria-label="Warranty state" className="h-9 rounded-md border border-border bg-surface px-3 text-sm"><option value="">All</option><option value="active">Active</option><option value="expiring">Ending in 60 days</option></select>
          : <><select name="priority" defaultValue={sp.priority ?? ''} aria-label="Priority" className="h-9 rounded-md border border-border bg-surface px-3 text-sm"><option value="">Any priority</option>{Object.entries(TICKET_PRIORITY).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}</select>
            <select name="category" defaultValue={sp.category ?? ''} aria-label="Category" className="h-9 rounded-md border border-border bg-surface px-3 text-sm"><option value="">Any category</option>{Object.entries(TICKET_CATEGORY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></>}
        <button className="h-9 cursor-pointer rounded-md border border-border bg-surface px-3 text-sm">Filter</button>{(term || sp.priority || sp.category || sp.state) && <LinkButton href={`/tickets?tab=${tab}`} variant="ghost">Clear</LinkButton>}</form>
      {!rows.length ? <EmptyState icon={tab === 'warranties' ? ShieldCheck : Wrench} title={tab === 'warranties' ? 'No warranties recorded' : tab === 'overdue' ? 'Nothing overdue' : 'No tickets here'} body={tab === 'warranties' ? 'Record the warranty you give with a job; tickets for that customer or project are checked against it automatically.' : 'Tickets come from the office, the customer portal and the public service-request form.'} />
        : tab === 'warranties' ? <ul className="divide-y divide-border">{rows.map((w: any) => { const s = warrantyState(w, c.today)
          return <li key={w.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
            <span className="min-w-0 flex-1"><span className="block truncate font-medium">{w.number} · {w.title}</span>
              <span className="block truncate text-xs text-muted">{[w.customer?.name, w.project?.name].filter(Boolean).join(' · ') || '—'} · {formatShortDate(w.start_date)} – {formatShortDate(w.end_date)}</span></span>
            <Badge tone={s.tone}>{s.label}</Badge></li> })}</ul>
        : <ul className="divide-y divide-border">{rows.map((t: any) => { const od = ticketOverdue(t, c.today)
          return <li key={t.id}><Link href={`/tickets/${t.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm hover:bg-surface-2/50">
            <span className="min-w-0 flex-1"><span className="block truncate font-medium">{t.number} · {t.title}</span>
              <span className="block truncate text-xs text-muted">{[t.customer?.name, t.project?.name, TICKET_CATEGORY[t.category]].filter(Boolean).join(' · ')}</span></span>
            {t.under_warranty && <Badge tone="green" className="hidden sm:inline-flex">Warranty</Badge>}
            {t.priority !== 'normal' && <Badge tone={TICKET_PRIORITY[t.priority]?.tone}>{TICKET_PRIORITY[t.priority]?.label}</Badge>}
            {t.due_date && <span className={cn('shrink-0 text-xs tabular-nums', od ? 'font-medium text-danger' : 'text-muted')}>{t.due_date === c.today ? 'Today' : formatShortDate(t.due_date)}</span>}
            <Badge tone={od ? 'red' : TICKET_STATUS[t.status]?.tone}>{od ? 'Overdue' : TICKET_STATUS[t.status]?.label}</Badge></Link></li> })}</ul>}
      <Pagination page={page} pageSize={PAGE_SIZE} total={count} params={sp} base="/tickets" />
    </Card>
  </>
}
