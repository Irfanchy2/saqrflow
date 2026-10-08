import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft, CalendarClock, CheckSquare, HardHat, MapPin, Pencil, Phone, Plus, Printer, Trash2, User } from 'lucide-react'
import { getCtx } from '@/lib/auth'
import { Badge, Card, CardHeader, LinkButton } from '@/components/ui/primitives'
import { DialogButton } from '@/components/ui/dialog'
import { ActionButton, ActionForm } from '@/components/ui/action-form'
import { TaskFields, VisitFields } from '@/components/crm/fields'
import { OpsMedia } from '@/components/crm/ops-media'
import { NewSalesButtons } from '@/components/sales/new-buttons'
import { createProjectFromVisit, createTask, updateSiteVisit } from '@/app/actions/operations'
import { trashRecord } from '@/app/actions/trash'
import { TASK_STATUS, VISIT_STATUS } from '@/lib/crm'
import { opsFiles } from '@/lib/ops'
import { formatLongDate, formatShortDate } from '@/lib/time'

export const metadata = { title: 'Site visit' }

export default async function SiteVisitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const c = await getCtx(); if (!c.can('documents.view')) redirect('/')
  const { data: v } = await c.supabase.from('site_visits').select('*, lead:leads(id,company_name,number), customer:customers(id,name), project:projects(id,name), employee:employees(id,full_name)').eq('id', id).maybeSingle()
  if (!v) notFound()
  const edit = c.can('records.edit'), fin = c.can('finance.view')
  const [media, { data: tasks }, opts, { data: users }] = await Promise.all([
    opsFiles(c, 'site_visit', id),
    c.supabase.from('tasks').select('id,title,status,due_date').eq('related_type', 'site_visit').eq('related_id', id).order('due_date', { nullsFirst: false }),
    edit ? Promise.all([
      c.can('crm.view') ? c.supabase.from('leads').select('id,company_name,number').order('created_at', { ascending: false }).limit(500) : Promise.resolve({ data: [] as any[] }),
      c.supabase.from('customers').select('id,name').order('name').limit(2000),
      c.supabase.from('projects').select('id,name').order('name').limit(500),
      c.supabase.from('employees').select('id,full_name').neq('status', 'archived').order('full_name').limit(1000),
    ]) : Promise.resolve(null),
    edit ? c.supabase.from('profiles').select('id,full_name').eq('is_active', true).order('full_name') : Promise.resolve({ data: [] as any[] }),
  ])
  const [leads, customers, projects, employees] = opts ? opts.map(r => r.data ?? []) : [[], [], [], []]
  const o = (rows: any[], label: (r: any) => string) => rows.map(r => ({ id: r.id, name: label(r) }))
  const st = VISIT_STATUS[v.status], late = ['scheduled', 'rescheduled'].includes(v.status) && v.scheduled_date < c.today
  const findings: [string, string | null][] = [['Customer requirements', v.requirements], ['Measurements', v.measurements], ['Site notes', v.notes], ['Recommendations', v.recommendations], ['Follow-up action', v.followup_action]]
  const visitForm = (extra?: Record<string, any>) => <VisitFields v={{ ...v, ...extra }} leads={o(leads, (l: any) => `${l.company_name} (${l.number})`)} customers={o(customers, (x: any) => x.name)} projects={o(projects, (x: any) => x.name)} employees={o(employees, (e: any) => e.full_name)} />

  return <>
    <Link href="/site-visits" className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg"><ArrowLeft size={14} />Site visits</Link>
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold tracking-tight">Site visit <span className="font-mono">{v.number}</span></h1><Badge tone={late ? 'red' : st?.tone}>{late ? 'Overdue' : st?.label}</Badge></div>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
          <span className="inline-flex items-center gap-1"><CalendarClock size={13} aria-hidden />{formatLongDate(v.scheduled_date)}{v.scheduled_time ? `, ${v.scheduled_time.slice(0, 5)}` : ''}</span>
          {v.location && <a href={/^https?:\/\//.test(v.location) ? v.location : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(v.location)}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-primary"><MapPin size={13} aria-hidden />{v.location}</a>}
          {v.employee && <span className="inline-flex items-center gap-1"><User size={13} aria-hidden />{v.employee.full_name}</span>}
          {v.contact_phone && <a href={`tel:${v.contact_phone.replace(/[^\d+]/g, '')}`} className="inline-flex items-center gap-1 hover:text-primary"><Phone size={13} aria-hidden />{v.contact_person ?? 'Site contact'} {v.contact_phone}</a>}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 text-sm">
          {v.lead && <Link href={`/leads/${v.lead.id}`} className="text-primary hover:underline">Lead {v.lead.number}: {v.lead.company_name}</Link>}
          {v.customer && <Link href={`/parties/${v.customer.id}`} className="text-primary hover:underline">{v.customer.name}</Link>}
          {v.project && <Link href={`/projects/${v.project.id}`} className="text-primary hover:underline">Project: {v.project.name}</Link>}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {edit && v.status !== 'completed' && <DialogButton wide label="Complete visit" title="Record visit findings" icon={<CheckSquare size={14} />}><ActionForm action={updateSiteVisit.bind(null, id)} submit="Save as completed" resetOnSuccess={false}>{visitForm({ status: 'completed' })}</ActionForm></DialogButton>}
        {edit && <DialogButton wide variant="secondary" label="Edit" title="Edit site visit" icon={<Pencil size={14} />}><ActionForm action={updateSiteVisit.bind(null, id)} resetOnSuccess={false}>{visitForm()}</ActionForm></DialogButton>}
        <LinkButton variant="secondary" href={`/print/report/site_visit/${id}`} target="_blank"><Printer size={14} />Visit report</LinkButton>
        {edit && fin && <NewSalesButtons siteVisitId={id} customerId={v.customer_id ?? undefined} projectId={v.project_id ?? undefined} only={['quotation']} variant="secondary" />}
        {edit && !v.project_id && <ActionButton size="md" action={createProjectFromVisit.bind(null, id)}><HardHat size={14} />Create project</ActionButton>}
        {c.can('records.delete') && <ActionButton variant="ghost" size="md" action={trashRecord.bind(null, 'site_visit', id)} confirm="Move this site visit to the trash?"><Trash2 size={14} />Delete</ActionButton>}
      </div>
    </div>

    <div className="grid gap-5 xl:grid-cols-3 [&>*]:min-w-0">
      <Card className="xl:col-span-2"><CardHeader title="Findings" sub={v.status === 'completed' ? `Completed${v.completed_at ? ` ${new Date(v.completed_at).toLocaleDateString('en-GB', { timeZone: c.company.timezone })}` : ''}` : 'Recorded on site; printed on the visit report'} />
        {findings.every(([, t]) => !t) ? <p className="px-4 py-6 text-sm text-muted">Nothing recorded yet. Use “Complete visit” to enter requirements and measurements.</p>
          : <dl className="divide-y divide-border text-sm">{findings.filter(([, t]) => t).map(([k, t]) => <div key={k} className="px-4 py-3"><dt className="text-xs font-medium text-muted">{k}</dt><dd className="mt-1 whitespace-pre-line break-words">{t}</dd></div>)}</dl>}
        {v.attendees && <p className="border-t border-border px-4 py-2.5 text-xs text-muted">Attendees: {v.attendees}</p>}
      </Card>
      <Card><CardHeader title="Tasks" action={edit ? <DialogButton wide size="sm" variant="secondary" label="Add" title="Add task" icon={<Plus size={14} />}><ActionForm action={createTask} submit="Add task" idempotent>
        <TaskFields users={o(users ?? [], (u: any) => u.full_name)} employees={o(employees, (e: any) => e.full_name)} projects={[]} fixed={{ related_type: 'site_visit', related_id: id, ...(v.project_id ? { project_id: v.project_id } : {}) }} t={{ due_date: c.today }} /></ActionForm></DialogButton> : null} />
        {!(tasks ?? []).length ? <p className="px-4 py-4 text-sm text-muted">No tasks.</p>
          : <ul className="divide-y divide-border text-sm">{(tasks ?? []).map((t: any) => <li key={t.id}><Link href={`/tasks?open=${t.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2/60">
            <span className="min-w-0 flex-1 truncate">{t.title}</span>{t.due_date && <span className="text-xs tabular-nums text-muted">{formatShortDate(t.due_date)}</span>}<Badge tone={TASK_STATUS[t.status]?.tone}>{TASK_STATUS[t.status]?.label}</Badge></Link></li>)}</ul>}
      </Card>
      <OpsMedia kind="site_visit" id={id} photos={media.photos} files={media.files} canUpload={c.can('documents.upload')} tz={c.company.timezone} className="xl:col-span-3" />
    </div>
  </>
}
