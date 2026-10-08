import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ClipboardList, Plus } from 'lucide-react'
import { getCtx } from '@/lib/auth'
import { PAGE_SIZE, flat, pageOf, sanitizeQ } from '@/lib/queries'
import { Badge, Card, EmptyState, LinkButton, Metrics, PageHeader, Pagination, StatCard, Td, Th, TableWrap } from '@/components/ui/primitives'
import { DialogButton } from '@/components/ui/dialog'
import { ActionForm } from '@/components/ui/action-form'
import { WorkOrderFields } from '@/components/crm/fields'
import { createWorkOrder } from '@/app/actions/operations'
import { PRIORITY, WO_STATUS, tasksCompletion } from '@/lib/crm'
import { formatShortDate } from '@/lib/time'
import { cn } from '@/lib/utils'

export const metadata = { title: 'Work Orders' }
const ACTIVE = ['pending', 'approved', 'scheduled', 'in_fabrication', 'ready_for_site', 'installation', 'inspection', 'on_hold']
const TABS = [['active', 'Active'], ['fabrication', 'Workshop'], ['site', 'On site'], ['completed', 'Completed'], ['all', 'All']] as const

export default async function WorkOrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await getCtx(); if (!c.can('documents.view')) redirect('/')
  const sp = await flat(searchParams)
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : 'active'
  const page = pageOf(sp.page), term = sanitizeQ(sp.q), edit = c.can('records.edit')
  let q = c.supabase.from('work_orders').select('id,number,title,status,priority,start_date,target_date,site_location,manager_id,project:projects(id,name),customer:customers(id,name),tasks(status,completion)', { count: 'exact' })
  if (tab === 'active') q = q.in('status', ACTIVE)
  else if (tab === 'fabrication') q = q.in('status', ['approved', 'scheduled', 'in_fabrication'])
  else if (tab === 'site') q = q.in('status', ['ready_for_site', 'installation', 'inspection'])
  else if (tab === 'completed') q = q.eq('status', 'completed')
  if (term) q = q.or(`number.ilike.%${term}%,title.ilike.%${term}%,site_location.ilike.%${term}%`)
  if (sp.priority && sp.priority in PRIORITY) q = q.eq('priority', sp.priority)
  const head = { count: 'exact' as const, head: true }
  const [{ data: rows, count }, act, late, urgent, opts] = await Promise.all([
    q.order('target_date', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false }).range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1),
    c.supabase.from('work_orders').select('id', head).in('status', ACTIVE),
    c.supabase.from('work_orders').select('id', head).in('status', ACTIVE).lt('target_date', c.today),
    c.supabase.from('work_orders').select('id', head).in('status', ACTIVE).eq('priority', 'urgent'),
    edit ? Promise.all([
      c.supabase.from('customers').select('id,name').order('name').limit(2000),
      c.supabase.from('projects').select('id,name').in('status', ['planning', 'active', 'on_hold']).order('name').limit(500),
      c.supabase.from('profiles').select('id,full_name').eq('is_active', true).order('full_name'),
    ]) : Promise.resolve(null),
  ])
  const [customers, projects, users] = opts ? opts.map(r => r.data ?? []) : [[], [], []]
  const names = new Map(users.map((u: any) => [u.id, u.full_name as string]))
  const add = <DialogButton wide label="New work order" title="New work order" icon={<Plus size={15} />} openParam="work_order"><ActionForm action={createWorkOrder} submit="Create work order" idempotent>
    <WorkOrderFields customers={customers.map((x: any) => ({ id: x.id, name: x.name }))} projects={projects.map((x: any) => ({ id: x.id, name: x.name }))} users={users.map((u: any) => ({ id: u.id, name: u.full_name }))} w={{ start_date: c.today }} /></ActionForm></DialogButton>

  return <>
    <PageHeader title="Work Orders" sub="Job cards for the workshop and site crews. Create one from an accepted quotation to copy its scope." actions={edit ? add : undefined} />
    <Metrics className="mb-5" cols={3}>
      <StatCard label="Active work orders" value={act.count ?? 0} href="/work-orders?tab=active" />
      <StatCard label="Past target date" value={late.count ?? 0} tone={late.count ? 'red' : 'neutral'} href="/work-orders?tab=active" />
      <StatCard label="Urgent" value={urgent.count ?? 0} href="/work-orders?tab=active&priority=urgent" />
    </Metrics>
    <nav aria-label="Work order lists" className="mb-4 flex gap-1 overflow-x-auto border-b border-border">{TABS.map(([k, l]) => <Link key={k} href={`/work-orders?tab=${k}`} aria-current={tab === k ? 'page' : undefined}
      className={cn('-mb-px shrink-0 border-b-2 px-3 py-2 text-sm transition-colors', tab === k ? 'border-primary font-medium text-fg' : 'border-transparent text-muted hover:text-fg')}>{l}</Link>)}</nav>
    <Card>
      <form className="flex flex-wrap gap-2 border-b border-border p-3"><input type="hidden" name="tab" value={tab} />
        <input name="q" type="search" defaultValue={sp.q} aria-label="Search work orders" placeholder="Search number, title, site…" className="h-9 min-w-52 flex-1 rounded-md border border-border bg-surface px-3 text-sm" />
        <select name="priority" defaultValue={sp.priority ?? ''} aria-label="Priority" className="h-9 rounded-md border border-border bg-surface px-3 text-sm"><option value="">Any priority</option>{Object.entries(PRIORITY).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}</select>
        <button className="h-9 cursor-pointer rounded-md border border-border bg-surface px-3 text-sm">Filter</button>{(term || sp.priority) && <LinkButton href={`/work-orders?tab=${tab}`} variant="ghost">Clear</LinkButton>}</form>
      {!rows?.length ? <EmptyState icon={ClipboardList} title={term ? 'No work orders match' : 'No work orders here'} body={!term ? 'Open an accepted quotation and choose “Create work order”, or create one here.' : undefined} action={edit && !term && tab === 'active' ? add : undefined} />
        : <TableWrap><thead><tr><Th>Work order</Th><Th>Project / customer</Th><Th>Target</Th><Th>Tasks</Th><Th>Manager</Th><Th>Priority</Th><Th>Status</Th></tr></thead>
          <tbody className="divide-y divide-border">{rows.map((w: any) => { const pct = tasksCompletion(w.tasks ?? []), overdue = ACTIVE.includes(w.status) && w.target_date && w.target_date < c.today
            return <tr key={w.id} className="hover:bg-surface-2/40">
              <Td className="max-w-[260px]"><Link href={`/work-orders/${w.id}`} className="block truncate font-medium hover:text-primary">{w.title}</Link><div className="font-mono text-xs text-muted">{w.number}</div></Td>
              <Td className="max-w-[220px] truncate text-muted">{w.project?.name ?? '—'}{w.customer && <div className="truncate text-xs">{w.customer.name}</div>}</Td>
              <Td className={cn('whitespace-nowrap tabular-nums', overdue ? 'font-medium text-danger' : 'text-muted')}>{w.target_date ? formatShortDate(w.target_date) : '—'}</Td>
              <Td>{pct == null ? <span className="text-muted/60">No tasks</span> : <div className="flex items-center gap-2"><div className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-2" aria-hidden><div className="h-full bg-primary" style={{ width: `${pct}%` }} /></div><span className="text-xs tabular-nums">{pct}%</span></div>}</Td>
              <Td className="text-muted">{names.get(w.manager_id) ?? '—'}</Td>
              <Td><Badge tone={PRIORITY[w.priority]?.tone}>{PRIORITY[w.priority]?.label}</Badge></Td>
              <Td><Badge tone={WO_STATUS[w.status]?.tone}>{WO_STATUS[w.status]?.label}</Badge></Td></tr> })}</tbody></TableWrap>}
      <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} params={sp} base="/work-orders" />
    </Card>
  </>
}
