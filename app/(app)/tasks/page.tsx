import Link from 'next/link'
import { CheckCircle2, Circle, ListTodo, Play, Plus, X } from 'lucide-react'
import { getCtx } from '@/lib/auth'
import { PAGE_SIZE, flat, pageOf, sanitizeQ } from '@/lib/queries'
import { Badge, Card, CardHeader, EmptyState, LinkButton, Metrics, PageHeader, Pagination, StatCard } from '@/components/ui/primitives'
import { DialogButton } from '@/components/ui/dialog'
import { ActionButton, ActionForm } from '@/components/ui/action-form'
import { TaskFields } from '@/components/crm/fields'
import { createTask, setTaskStatus, updateTask } from '@/app/actions/operations'
import { trashRecord } from '@/app/actions/trash'
import { PRIORITY, TASK_STATUS, isOverdue } from '@/lib/crm'
import { addDays, formatShortDate } from '@/lib/time'
import { cn } from '@/lib/utils'

export const metadata = { title: 'Tasks' }
const VIEWS = [['mine', 'My tasks'], ['today', 'Today'], ['overdue', 'Overdue'], ['week', 'This week'], ['open', 'All open'], ['done', 'Completed']] as const
const LINK: Record<string, (id: string) => string> = { project: id => `/projects/${id}`, customer: id => `/parties/${id}`, employee: id => `/employees/${id}`, document: id => `/documents/${id}`, vehicle: id => `/assets/${id}`, asset: id => `/assets/${id}`, invoice: id => `/invoices/${id}`, quotation: id => `/invoices/${id}`, lead: id => `/leads/${id}`, supplier: id => `/parties/${id}`, work_order: id => `/work-orders/${id}`, site_visit: id => `/site-visits/${id}` }
const REL_LABEL: Record<string, string> = { project: 'Project', customer: 'Customer', employee: 'Employee', document: 'Document', vehicle: 'Vehicle', asset: 'Asset', invoice: 'Invoice', quotation: 'Quotation', lead: 'Lead', supplier: 'Supplier', work_order: 'Work order', site_visit: 'Site visit' }

/** One list for every task in the company. Field users without other access still see the tasks assigned to them (RLS). */
export default async function TasksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await getCtx()
  const sp = await flat(searchParams)
  const view = VIEWS.some(([k]) => k === sp.view) ? sp.view! : 'mine'
  const page = pageOf(sp.page), term = sanitizeQ(sp.q), edit = c.can('records.edit'), week = addDays(c.today, 6)
  const OPEN = ['todo', 'in_progress', 'waiting']
  let q = c.supabase.from('tasks').select('id,title,description,status,priority,due_date,start_date,completion,owner_id,employee_id,related_type,related_id,project_id,work_order_id,project:projects(id,name),work_order:work_orders(id,number),employee:employees(full_name)', { count: 'exact' })
  if (view === 'done') q = q.in('status', ['completed', 'cancelled']); else q = q.in('status', OPEN)
  if (view === 'mine') q = q.eq('owner_id', c.userId)
  if (view === 'today') q = q.eq('due_date', c.today)
  if (view === 'overdue') q = q.lt('due_date', c.today)
  if (view === 'week') q = q.gte('due_date', c.today).lte('due_date', week)
  if (sp.project && /^[0-9a-f-]{36}$/.test(sp.project)) q = q.eq('project_id', sp.project)
  if (sp.priority && sp.priority in PRIORITY) q = q.eq('priority', sp.priority)
  if (term) q = q.ilike('title', `%${term}%`)
  const head = { count: 'exact' as const, head: true }
  const open = () => c.supabase.from('tasks').select('id', head).in('status', OPEN)
  const [{ data: rows, count }, mine, today, overdue, wk, { data: users }, { data: projects }, { data: employees }, { data: focus }] = await Promise.all([
    q.order(view === 'done' ? 'completed_at' : 'due_date', { ascending: view !== 'done', nullsFirst: false }).order('created_at', { ascending: false }).range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1),
    open().eq('owner_id', c.userId), open().eq('due_date', c.today), open().lt('due_date', c.today), open().gte('due_date', c.today).lte('due_date', week),
    c.supabase.from('profiles').select('id,full_name').eq('is_active', true).order('full_name'),
    c.can('documents.view') ? c.supabase.from('projects').select('id,name').in('status', ['planning', 'active', 'on_hold']).order('name').limit(500) : Promise.resolve({ data: [] as any[] }),
    edit ? c.supabase.from('employees').select('id,full_name').neq('status', 'archived').order('full_name').limit(1000) : Promise.resolve({ data: [] as any[] }),
    sp.open && /^[0-9a-f-]{36}$/.test(sp.open) ? c.supabase.from('tasks').select('*').eq('id', sp.open).maybeSingle() : Promise.resolve({ data: null }),
  ])
  const names = new Map((users ?? []).map((u: any) => [u.id, u.full_name as string]))
  const o = (rows: any[], label: (r: any) => string) => rows.map(r => ({ id: r.id, name: label(r) }))
  const userOpts = o(users ?? [], (u: any) => u.full_name), projOpts = o(projects ?? [], (p: any) => p.name), empOpts = o(employees ?? [], (e: any) => e.full_name)
  const qs = (x: Record<string, string>) => `/tasks?${new URLSearchParams({ ...Object.fromEntries(Object.entries(sp).filter(([k, v]) => v && !['page', 'open'].includes(k))) as Record<string, string>, ...x })}`
  const add = <DialogButton wide label="New task" title="New task" icon={<Plus size={15} />} openParam="task"><ActionForm action={createTask} submit="Add task" idempotent><TaskFields users={userOpts} employees={empOpts} projects={projOpts} t={{ due_date: c.today, project_id: sp.project }} /></ActionForm></DialogButton>
  const canEditFocus = focus && (edit || focus.owner_id === c.userId)

  return <>
    <PageHeader title="Tasks" sub="Assigned work across projects, work orders, leads and the office. Overdue is worked out from the due date." actions={edit ? add : undefined} />
    <Metrics className="mb-5" cols={4}>
      <StatCard label="My open tasks" value={mine.count ?? 0} href="/tasks?view=mine" />
      <StatCard label="Due today" value={today.count ?? 0} href="/tasks?view=today" />
      <StatCard label="Overdue" value={overdue.count ?? 0} tone={overdue.count ? 'red' : 'neutral'} href="/tasks?view=overdue" />
      <StatCard label="Due this week" value={wk.count ?? 0} href="/tasks?view=week" />
    </Metrics>

    {focus && <Card className="mb-5"><CardHeader title={focus.title} sub={`${TASK_STATUS[focus.status]?.label}${focus.due_date ? ` · due ${formatShortDate(focus.due_date)}` : ''}${focus.owner_id ? ` · ${names.get(focus.owner_id) ?? ''}` : ''}`}
      action={<Link href={qs({})} aria-label="Close task" className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-fg"><X size={16} /></Link>} />
      <div className="p-4">{canEditFocus ? <ActionForm action={updateTask.bind(null, focus.id)} resetOnSuccess={false} submit="Save task">
        <TaskFields t={focus} users={userOpts} employees={empOpts} projects={projOpts} canAssign={edit} fixed={focus.work_order_id ? { work_order_id: focus.work_order_id } : undefined} /></ActionForm>
        : <p className="whitespace-pre-line text-sm">{focus.description ?? 'No details.'}</p>}
        <div className="mt-3 flex flex-wrap gap-3 text-sm">{focus.related_type && LINK[focus.related_type] && <Link href={LINK[focus.related_type](focus.related_id)} className="text-primary hover:underline">Open {REL_LABEL[focus.related_type]?.toLowerCase()}</Link>}
          {c.can('records.delete') && <ActionButton variant="ghost" action={trashRecord.bind(null, 'task', focus.id)} confirm="Move this task to the trash?">Delete task</ActionButton>}</div></div></Card>}

    <nav aria-label="Task views" className="mb-4 flex gap-1 overflow-x-auto border-b border-border">{VIEWS.map(([k, l]) => <Link key={k} href={qs({ view: k })} aria-current={view === k ? 'page' : undefined}
      className={cn('-mb-px shrink-0 border-b-2 px-3 py-2 text-sm transition-colors', view === k ? 'border-primary font-medium text-fg' : 'border-transparent text-muted hover:text-fg')}>{l}</Link>)}</nav>
    <Card>
      <form className="flex flex-wrap gap-2 border-b border-border p-3"><input type="hidden" name="view" value={view} />
        <input name="q" type="search" defaultValue={sp.q} aria-label="Search tasks" placeholder="Search tasks…" className="h-9 min-w-48 flex-1 rounded-md border border-border bg-surface px-3 text-sm" />
        {projOpts.length > 0 && <select name="project" defaultValue={sp.project ?? ''} aria-label="Project" className="h-9 max-w-56 rounded-md border border-border bg-surface px-3 text-sm"><option value="">All projects</option>{projOpts.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
        <select name="priority" defaultValue={sp.priority ?? ''} aria-label="Priority" className="h-9 rounded-md border border-border bg-surface px-3 text-sm"><option value="">Any priority</option>{Object.entries(PRIORITY).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}</select>
        <button className="h-9 cursor-pointer rounded-md border border-border bg-surface px-3 text-sm">Filter</button>{(term || sp.project || sp.priority) && <LinkButton href={`/tasks?view=${view}`} variant="ghost">Clear</LinkButton>}</form>
      {!rows?.length ? <EmptyState icon={ListTodo} title={view === 'overdue' ? 'Nothing overdue' : view === 'mine' ? 'No open tasks assigned to you' : 'No tasks here'} action={edit && view !== 'done' ? add : undefined} />
        : <ul className="divide-y divide-border">{rows.map((t: any) => { const od = isOverdue(t, c.today), done = t.status === 'completed', mineOrEdit = edit || t.owner_id === c.userId
          return <li key={t.id} className={cn('flex items-center gap-3 px-3 py-2.5 text-sm sm:px-4', sp.open === t.id && 'bg-primary-soft/40')}>
            {mineOrEdit ? <ActionButton variant="ghost" action={setTaskStatus.bind(null, t.id, done ? 'todo' : 'completed')} className="h-10 w-10 shrink-0 px-0">{done ? <CheckCircle2 size={19} className="text-success" /> : <Circle size={19} />}<span className="sr-only">{done ? 'Reopen' : 'Mark done'}: {t.title}</span></ActionButton>
              : <span className="grid h-10 w-10 shrink-0 place-items-center">{done ? <CheckCircle2 size={19} className="text-success" /> : <Circle size={19} className="text-muted" />}</span>}
            <Link href={qs({ open: t.id })} scroll={false} className="min-w-0 flex-1">
              <span className={cn('block truncate font-medium hover:text-primary', done && 'text-muted line-through')}>{t.title}</span>
              <span className="block truncate text-xs text-muted">{[t.project?.name, t.work_order?.number, t.related_type && !['project', 'work_order'].includes(t.related_type) ? REL_LABEL[t.related_type] : null, t.employee?.full_name, names.get(t.owner_id)].filter(Boolean).join(' · ') || 'General'}</span>
            </Link>
            {t.priority !== 'normal' && <Badge tone={PRIORITY[t.priority]?.tone} className="hidden sm:inline-flex">{PRIORITY[t.priority]?.label}</Badge>}
            {t.due_date && <span className={cn('shrink-0 text-xs tabular-nums', od ? 'font-medium text-danger' : 'text-muted')}>{t.due_date === c.today ? 'Today' : formatShortDate(t.due_date)}</span>}
            {mineOrEdit && t.status === 'todo' && <ActionButton variant="ghost" action={setTaskStatus.bind(null, t.id, 'in_progress')} className="hidden sm:inline-flex"><Play size={13} />Start</ActionButton>}
            <Badge tone={od ? 'red' : TASK_STATUS[t.status]?.tone} className="shrink-0">{od ? 'Overdue' : TASK_STATUS[t.status]?.label}</Badge>
          </li> })}</ul>}
      <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} params={sp} base="/tasks" />
    </Card>
  </>
}
