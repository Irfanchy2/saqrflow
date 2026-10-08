import Link from 'next/link'
import { redirect } from 'next/navigation'
import { MapPinned, Plus } from 'lucide-react'
import { getCtx } from '@/lib/auth'
import { PAGE_SIZE, flat, pageOf, sanitizeQ } from '@/lib/queries'
import { Badge, Card, EmptyState, LinkButton, Metrics, PageHeader, Pagination, StatCard, Td, Th, TableWrap } from '@/components/ui/primitives'
import { DialogButton } from '@/components/ui/dialog'
import { ActionForm } from '@/components/ui/action-form'
import { VisitFields } from '@/components/crm/fields'
import { createSiteVisit } from '@/app/actions/operations'
import { VISIT_STATUS } from '@/lib/crm'
import { addDays, formatShortDate } from '@/lib/time'
import { cn } from '@/lib/utils'

export const metadata = { title: 'Site Visits' }
const TABS = [['upcoming', 'Upcoming'], ['followup', 'Follow-up required'], ['completed', 'Completed'], ['all', 'All']] as const

export default async function SiteVisitsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await getCtx(); if (!c.can('documents.view')) redirect('/')
  const sp = await flat(searchParams)
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : 'upcoming'
  const page = pageOf(sp.page), term = sanitizeQ(sp.q), edit = c.can('records.edit')
  let q = c.supabase.from('site_visits').select('id,number,scheduled_date,scheduled_time,status,location,contact_person,lead:leads(id,company_name),customer:customers(id,name),project:projects(id,name),employee:employees(id,full_name)', { count: 'exact' })
  if (tab === 'upcoming') q = q.in('status', ['scheduled', 'rescheduled'])
  else if (tab === 'followup') q = q.eq('status', 'follow_up_required')
  else if (tab === 'completed') q = q.eq('status', 'completed')
  if (term) q = q.or(`number.ilike.%${term}%,location.ilike.%${term}%,contact_person.ilike.%${term}%`)
  const head = { count: 'exact' as const, head: true }
  const [{ data: rows, count }, today, week, overdue, follow, opts] = await Promise.all([
    q.order('scheduled_date', { ascending: tab === 'upcoming' }).order('scheduled_time', { ascending: true, nullsFirst: false }).range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1),
    c.supabase.from('site_visits').select('id', head).in('status', ['scheduled', 'rescheduled']).eq('scheduled_date', c.today),
    c.supabase.from('site_visits').select('id', head).in('status', ['scheduled', 'rescheduled']).gte('scheduled_date', c.today).lte('scheduled_date', addDays(c.today, 6)),
    c.supabase.from('site_visits').select('id', head).in('status', ['scheduled', 'rescheduled']).lt('scheduled_date', c.today),
    c.supabase.from('site_visits').select('id', head).eq('status', 'follow_up_required'),
    edit ? Promise.all([
      c.can('crm.view') ? c.supabase.from('leads').select('id,company_name,number').not('stage', 'in', '(won,lost)').order('created_at', { ascending: false }).limit(500) : Promise.resolve({ data: [] as any[] }),
      c.supabase.from('customers').select('id,name').order('name').limit(2000),
      c.supabase.from('projects').select('id,name').in('status', ['planning', 'active', 'on_hold']).order('name').limit(500),
      c.supabase.from('employees').select('id,full_name').neq('status', 'archived').order('full_name').limit(1000),
    ]) : Promise.resolve(null),
  ])
  const [leads, customers, projects, employees] = opts ? opts.map(r => r.data ?? []) : [[], [], [], []]
  const form = <VisitFields v={{ scheduled_date: c.today }} leads={leads.map((l: any) => ({ id: l.id, name: `${l.company_name} (${l.number})` }))} customers={customers.map((x: any) => ({ id: x.id, name: x.name }))}
    projects={projects.map((x: any) => ({ id: x.id, name: x.name }))} employees={employees.map((e: any) => ({ id: e.id, name: e.full_name }))} />
  const add = <DialogButton wide label="Schedule visit" title="Schedule site visit" icon={<Plus size={15} />} openParam="site_visit"><ActionForm action={createSiteVisit} submit="Schedule visit" idempotent>{form}</ActionForm></DialogButton>

  return <>
    <PageHeader title="Site Visits" sub="Measurement and survey visits before quotation, with a printable visit report." actions={edit ? add : undefined} />
    <Metrics className="mb-5" cols={4}>
      <StatCard label="Today" value={today.count ?? 0} href="/site-visits?tab=upcoming" />
      <StatCard label="Next 7 days" value={week.count ?? 0} href="/site-visits?tab=upcoming" />
      <StatCard label="Past date, not completed" value={overdue.count ?? 0} tone={overdue.count ? 'red' : 'neutral'} hint="Complete or reschedule" href="/site-visits?tab=upcoming" />
      <StatCard label="Follow-up required" value={follow.count ?? 0} href="/site-visits?tab=followup" />
    </Metrics>
    <nav aria-label="Visit lists" className="mb-4 flex gap-1 overflow-x-auto border-b border-border">{TABS.map(([k, l]) => <Link key={k} href={`/site-visits?tab=${k}`} aria-current={tab === k ? 'page' : undefined}
      className={cn('-mb-px shrink-0 border-b-2 px-3 py-2 text-sm transition-colors', tab === k ? 'border-primary font-medium text-fg' : 'border-transparent text-muted hover:text-fg')}>{l}</Link>)}</nav>
    <Card>
      <form className="flex flex-wrap gap-2 border-b border-border p-3"><input type="hidden" name="tab" value={tab} />
        <input name="q" type="search" defaultValue={sp.q} aria-label="Search visits" placeholder="Search number, location, contact…" className="h-9 min-w-52 flex-1 rounded-md border border-border bg-surface px-3 text-sm" />
        <button className="h-9 cursor-pointer rounded-md border border-border bg-surface px-3 text-sm">Search</button>{term && <LinkButton href={`/site-visits?tab=${tab}`} variant="ghost">Clear</LinkButton>}</form>
      {!rows?.length ? <EmptyState icon={MapPinned} title={term ? 'No visits match' : tab === 'upcoming' ? 'No visits scheduled' : 'Nothing here yet'} body={tab === 'upcoming' && !term ? 'Schedule a measurement visit from a lead, or here.' : undefined} action={edit && !term && tab === 'upcoming' ? add : undefined} />
        : <TableWrap><thead><tr><Th>Visit</Th><Th>Date</Th><Th>For</Th><Th>Location</Th><Th>Assigned</Th><Th>Status</Th></tr></thead>
          <tbody className="divide-y divide-border">{rows.map((v: any) => { const late = ['scheduled', 'rescheduled'].includes(v.status) && v.scheduled_date < c.today
            return <tr key={v.id} className="hover:bg-surface-2/40">
              <Td><Link href={`/site-visits/${v.id}`} className="font-mono text-[13px] font-medium hover:text-primary">{v.number}</Link></Td>
              <Td className={cn('whitespace-nowrap tabular-nums', late && 'font-medium text-danger')}>{formatShortDate(v.scheduled_date)}{v.scheduled_time && <span className="ms-1 text-muted">{v.scheduled_time.slice(0, 5)}</span>}</Td>
              <Td className="max-w-[220px] truncate">{v.lead?.company_name ?? v.customer?.name ?? v.project?.name ?? '—'}{v.project && (v.lead || v.customer) && <div className="truncate text-xs text-muted">{v.project.name}</div>}</Td>
              <Td className="max-w-[200px] truncate text-muted" title={v.location ?? undefined}>{v.location ?? '—'}</Td>
              <Td className="text-muted">{v.employee?.full_name ?? '—'}</Td>
              <Td><Badge tone={late ? 'red' : VISIT_STATUS[v.status]?.tone}>{late ? 'Overdue' : VISIT_STATUS[v.status]?.label}</Badge></Td></tr> })}</tbody></TableWrap>}
      <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} params={sp} base="/site-visits" />
    </Card>
  </>
}
