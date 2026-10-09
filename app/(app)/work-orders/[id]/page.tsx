import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft, CalendarCheck, CheckCircle2, Circle, ClipboardCheck, MapPin, Pencil, Plus, Trash2, Truck, UserPlus, Users } from 'lucide-react'
import { getCtx } from '@/lib/auth'
import { Badge, Card, CardHeader, Field, Input, Select } from '@/components/ui/primitives'
import { DialogButton } from '@/components/ui/dialog'
import { ActionButton, ActionForm } from '@/components/ui/action-form'
import { SiteReportFields, TaskFields, WorkOrderFields } from '@/components/crm/fields'
import { OpsMedia } from '@/components/crm/ops-media'
import { Progress } from '@/components/projects/project-fields'
import { createSiteReport, createTask, removeWorkOrderAsset, removeWorkOrderMember, setTaskStatus, setWorkOrderAsset, setWorkOrderMember, setWorkOrderStatus, updateWorkOrder } from '@/app/actions/operations'
import { trashRecord } from '@/app/actions/trash'
import { PRIORITY, TASK_STATUS, WO_STATUS, isOverdue, tasksCompletion } from '@/lib/crm'
import { opsFiles } from '@/lib/ops'
import { formatShortDate } from '@/lib/time'
import { cn } from '@/lib/utils'
import { RecordActivity } from '@/components/record-activity'
import { CustomFieldsCard } from '@/components/custom-fields-card'

export const metadata = { title: 'Work order' }
const FLOW = ['pending', 'approved', 'scheduled', 'in_fabrication', 'ready_for_site', 'installation', 'inspection', 'completed']

export default async function WorkOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const c = await getCtx(); if (!c.can('documents.view')) redirect('/')
  const { data: w } = await c.supabase.from('work_orders').select('*, project:projects(id,name,code), customer:customers(id,name)').eq('id', id).maybeSingle()
  if (!w) notFound()
  const edit = c.can('records.edit')
  const [{ data: tasks }, { data: crew }, { data: gear }, { data: reports }, media, { data: users }, { data: quote }, opts] = await Promise.all([
    c.supabase.from('tasks').select('id,title,status,due_date,completion,priority,owner_id,employee:employees(full_name)').eq('work_order_id', id).order('position').order('due_date', { nullsFirst: false }).order('created_at'),
    c.supabase.from('work_order_members').select('employee_id,role,employee:employees(id,full_name,designation)').eq('work_order_id', id),
    c.supabase.from('work_order_assets').select('asset_id,asset:assets(id,name,plate_or_serial,kind,status)').eq('work_order_id', id),
    c.supabase.from('daily_site_reports').select('id,number,report_date,progress,work_done').eq('work_order_id', id).order('report_date', { ascending: false }).limit(30),
    opsFiles(c, 'work_order', id),
    c.supabase.from('profiles').select('id,full_name').eq('is_active', true).order('full_name'),
    w.quotation_id && c.can('finance.view') ? c.supabase.from('invoices').select('id,number').eq('id', w.quotation_id).maybeSingle() : Promise.resolve({ data: null }),
    edit ? Promise.all([
      c.supabase.from('customers').select('id,name').order('name').limit(2000),
      c.supabase.from('projects').select('id,name').order('name').limit(500),
      c.supabase.from('employees').select('id,full_name').neq('status', 'archived').order('full_name').limit(1000),
      c.supabase.from('assets').select('id,name,plate_or_serial').is('archived_at', null).not('status', 'in', '(sold,disposed,retired)').order('name').limit(1000),
    ]) : Promise.resolve(null),
  ])
  const [customers, projects, employees, assets] = opts ? opts.map(r => r.data ?? []) : [[], [], [], []]
  const o = (rows: any[], label: (r: any) => string) => rows.map(r => ({ id: r.id, name: label(r) }))
  const names = new Map((users ?? []).map((u: any) => [u.id, u.full_name as string]))
  const pct = tasksCompletion(tasks ?? []), st = WO_STATUS[w.status]
  const at = FLOW.indexOf(w.status), next = at >= 0 && at < FLOW.length - 1 ? FLOW[at + 1] : null
  const late = !['completed', 'cancelled'].includes(w.status) && w.target_date && w.target_date < c.today
  const empOpts = o(employees, (e: any) => e.full_name), userOpts = o(users ?? [], (u: any) => u.full_name)

  return <>
    <Link href="/work-orders" className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg"><ArrowLeft size={14} />Work orders</Link>
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold tracking-tight">{w.title}</h1><Badge tone={st?.tone}>{st?.label}</Badge>{w.priority !== 'normal' && <Badge tone={PRIORITY[w.priority]?.tone}>{PRIORITY[w.priority]?.label}</Badge>}</div>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
          <span className="font-mono">{w.number}</span>
          {w.project && <Link href={`/projects/${w.project.id}`} className="hover:text-primary hover:underline">{w.project.name}</Link>}
          {w.customer && <Link href={`/parties/${w.customer.id}`} className="hover:text-primary hover:underline">{w.customer.name}</Link>}
          {quote && <Link href={`/invoices/${quote.id}`} className="hover:text-primary hover:underline">Quotation {quote.number}</Link>}
          {w.site_location && <span className="inline-flex items-center gap-1"><MapPin size={13} aria-hidden />{w.site_location}</span>}
          {(w.start_date || w.target_date) && <span className={cn('inline-flex items-center gap-1', late && 'font-medium text-danger')}><CalendarCheck size={13} aria-hidden />{w.start_date ? formatShortDate(w.start_date) : '—'} → {w.target_date ? formatShortDate(w.target_date) : '—'}{late ? ' (late)' : ''}</span>}
          {w.manager_id && <span>Manager: {names.get(w.manager_id) ?? '—'}</span>}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {edit && next && <ActionButton size="md" variant="primary" action={setWorkOrderStatus.bind(null, id, next)}>Move to {WO_STATUS[next].label}</ActionButton>}
        {edit && !['on_hold', 'completed', 'cancelled'].includes(w.status) && <ActionButton size="md" action={setWorkOrderStatus.bind(null, id, 'on_hold')}>Put on hold</ActionButton>}
        {edit && <DialogButton wide variant="secondary" label="Edit" title="Edit work order" icon={<Pencil size={14} />}><ActionForm action={updateWorkOrder.bind(null, id)} resetOnSuccess={false}>
          <WorkOrderFields w={w} customers={o(customers, (x: any) => x.name)} projects={o(projects, (x: any) => x.name)} users={userOpts} /></ActionForm></DialogButton>}
        {c.can('records.delete') && <ActionButton variant="ghost" size="md" action={trashRecord.bind(null, 'work_order', id)} confirm="Move this work order to the trash? Its tasks stay with it and it can be restored."><Trash2 size={14} />Delete</ActionButton>}
      </div>
    </div>

    <ol aria-label="Work order stages" className="mb-5 flex overflow-x-auto rounded-lg border border-border bg-surface text-xs">
      {FLOW.map((s, i) => <li key={s} aria-current={s === w.status ? 'step' : undefined} className={cn('flex min-w-[104px] flex-1 items-center gap-1.5 border-e border-border px-3 py-2 last:border-e-0',
        at > i || w.status === 'completed' ? 'text-success' : s === w.status ? 'bg-primary-soft font-medium text-primary' : 'text-muted')}><span className="truncate">{WO_STATUS[s].label}</span></li>)}
    </ol>

    <div className="grid gap-5 xl:grid-cols-3 [&>*]:min-w-0">
      <Card className="xl:col-span-2"><CardHeader title="Tasks" sub={pct == null ? 'Break the job into steps; completion is the average of its tasks' : `${pct}% complete · ${(tasks ?? []).filter((t: any) => t.status === 'completed').length} of ${(tasks ?? []).filter((t: any) => t.status !== 'cancelled').length} done`}
        action={edit ? <DialogButton wide size="sm" label="Add task" title="Add task to this work order" icon={<Plus size={14} />}><ActionForm action={createTask} submit="Add task" idempotent>
          <TaskFields users={userOpts} employees={empOpts} projects={[]} fixed={{ work_order_id: id, project_id: w.project_id ?? undefined, related_type: 'work_order', related_id: id }} t={{ due_date: w.target_date ?? '' }} /></ActionForm></DialogButton> : null} />
        {pct != null && <div className="border-b border-border px-4 py-3"><Progress label="Work order completion" value={pct} /></div>}
        {!(tasks ?? []).length ? <p className="px-4 py-6 text-sm text-muted">No tasks yet. Typical steps: shop drawings, cutting, welding, painting, delivery, installation, inspection.</p>
          : <ul className="divide-y divide-border">{(tasks ?? []).map((t: any) => { const od = isOverdue(t, c.today), done = t.status === 'completed'
            return <li key={t.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <ActionButton variant="ghost" action={setTaskStatus.bind(null, t.id, done ? 'todo' : 'completed')} className="h-9 w-9 px-0">{done ? <CheckCircle2 size={18} className="text-success" /> : <Circle size={18} />}<span className="sr-only">{done ? 'Reopen' : 'Mark done'}: {t.title}</span></ActionButton>
              <Link href={`/tasks?open=${t.id}`} className={cn('min-w-0 flex-1 hover:text-primary', done && 'text-muted line-through')}><span className="block truncate">{t.title}</span>
                <span className="block truncate text-xs text-muted">{[t.employee?.full_name, names.get(t.owner_id)].filter(Boolean).join(' · ')}</span></Link>
              {t.status === 'in_progress' && <span className="text-xs tabular-nums text-muted">{t.completion}%</span>}
              {t.due_date && <span className={cn('text-xs tabular-nums', od ? 'font-medium text-danger' : 'text-muted')}>{formatShortDate(t.due_date)}</span>}
              <Badge tone={od ? 'red' : TASK_STATUS[t.status]?.tone}>{od ? 'Overdue' : TASK_STATUS[t.status]?.label}</Badge></li> })}</ul>}
      </Card>

      <div className="space-y-5">
        <Card><CardHeader title="Crew" action={edit ? <DialogButton size="sm" variant="secondary" label="Assign" title="Assign to crew" icon={<UserPlus size={14} />}><ActionForm action={setWorkOrderMember.bind(null, id)} submit="Assign">
          <Field label="Employee *"><Select name="employee_id" required defaultValue="">{[<option key="" value="">Choose…</option>, ...empOpts.map(e => <option key={e.id} value={e.id}>{e.name}</option>)]}</Select></Field>
          <Field label="Role"><Input name="role" maxLength={80} placeholder="e.g. Foreman, Welder, Fitter, Painter" /></Field></ActionForm></DialogButton> : null} />
          {!(crew ?? []).length ? <p className="px-4 py-4 text-sm text-muted">No one assigned.</p>
            : <ul className="divide-y divide-border text-sm">{(crew ?? []).map((m: any) => <li key={m.employee_id} className="flex items-center gap-3 px-4 py-2.5"><Users size={14} className="text-muted" aria-hidden />
              <Link href={`/employees/${m.employee_id}`} className="min-w-0 flex-1 truncate hover:text-primary">{m.employee?.full_name}<span className="ms-2 text-xs text-muted">{m.role ?? m.employee?.designation ?? ''}</span></Link>
              {edit && <ActionButton variant="ghost" action={removeWorkOrderMember.bind(null, id, m.employee_id)}><Trash2 size={13} /><span className="sr-only">Remove</span></ActionButton>}</li>)}</ul>}</Card>

        <Card><CardHeader title="Vehicles & equipment" action={edit ? <DialogButton size="sm" variant="secondary" label="Add" title="Add vehicle or equipment" icon={<Truck size={14} />}><ActionForm action={setWorkOrderAsset.bind(null, id)} submit="Add">
          <Field label="Vehicle / equipment *"><Select name="asset_id" required defaultValue="">{[<option key="" value="">Choose…</option>, ...assets.map((a: any) => <option key={a.id} value={a.id}>{a.name}{a.plate_or_serial ? ` (${a.plate_or_serial})` : ''}</option>)]}</Select></Field></ActionForm></DialogButton> : null} />
          {!(gear ?? []).length ? <p className="px-4 py-4 text-sm text-muted">{w.equipment ? 'Listed in the scope; link company assets here.' : 'None linked.'}</p>
            : <ul className="divide-y divide-border text-sm">{(gear ?? []).map((g: any) => <li key={g.asset_id} className="flex items-center gap-3 px-4 py-2.5"><Truck size={14} className="text-muted" aria-hidden />
              <Link href={`/assets/${g.asset_id}`} className="min-w-0 flex-1 truncate hover:text-primary">{g.asset?.name}<span className="ms-2 text-xs text-muted">{g.asset?.plate_or_serial ?? ''}</span></Link>
              {edit && <ActionButton variant="ghost" action={removeWorkOrderAsset.bind(null, id, g.asset_id)}><Trash2 size={13} /><span className="sr-only">Remove</span></ActionButton>}</li>)}</ul>}
          {w.equipment && <p className="whitespace-pre-line border-t border-border px-4 py-2.5 text-xs text-muted">{w.equipment}</p>}</Card>
      </div>

      <Card className="xl:col-span-2"><CardHeader title="Scope & instructions" />
        <div className="space-y-3 px-4 py-3 text-sm">
          {w.scope ? <p className="whitespace-pre-line break-words">{w.scope}</p> : <p className="text-muted">No scope written yet.</p>}
          {w.instructions && <div><div className="text-xs font-medium text-muted">Special instructions</div><p className="mt-1 whitespace-pre-line break-words">{w.instructions}</p></div>}
        </div></Card>

      <Card><CardHeader title="Daily site reports" action={edit && w.project_id ? <DialogButton wide size="sm" variant="secondary" label="New" title="Daily site report" icon={<ClipboardCheck size={14} />}><ActionForm action={createSiteReport} submit="Save report" idempotent>
        <SiteReportFields projects={[]} workOrders={[{ id, name: `${w.number}: ${w.title}` }]} employees={o((crew ?? []).map((m: any) => m.employee).filter(Boolean), (e: any) => e.full_name).concat(empOpts.filter(e => !(crew ?? []).some((m: any) => m.employee_id === e.id)))}
          attendance={(crew ?? []).map((m: any) => m.employee_id)} today={c.today} fixedProject={w.project_id} r={{ work_order_id: id, site: w.site_location }} /></ActionForm></DialogButton> : null} />
        {!w.project_id ? <p className="px-4 py-4 text-sm text-muted">Link this work order to a project to file daily reports.</p>
          : !(reports ?? []).length ? <p className="px-4 py-4 text-sm text-muted">No reports yet.</p>
          : <ul className="divide-y divide-border text-sm">{(reports ?? []).map((r: any) => <li key={r.id}><Link href={`/site-reports/${r.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2/60">
            <span className="min-w-0 flex-1"><span className="block tabular-nums">{formatShortDate(r.report_date)}</span><span className="block truncate text-xs text-muted">{r.work_done}</span></span>{r.progress != null && <span className="text-xs tabular-nums text-muted">{r.progress}%</span>}</Link></li>)}</ul>}</Card>

      <OpsMedia kind="work_order" id={id} photos={media.photos} files={media.files} canUpload={c.can('documents.upload')} tz={c.company.timezone} className="xl:col-span-3" />
    </div>
    <div className="mt-5 grid gap-5 xl:grid-cols-2 [&>*]:min-w-0"><CustomFieldsCard c={c} entity="work_order" recordId={id} customStatusId={w.custom_status_id} /><RecordActivity c={c} table="work_orders" id={id} /></div>
  </>
}
