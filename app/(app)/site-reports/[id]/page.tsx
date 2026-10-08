import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft, CloudSun, Pencil, Printer, Trash2, Users } from 'lucide-react'
import { getCtx } from '@/lib/auth'
import { Badge, Card, CardHeader, LinkButton } from '@/components/ui/primitives'
import { DialogButton } from '@/components/ui/dialog'
import { ActionButton, ActionForm } from '@/components/ui/action-form'
import { SiteReportFields } from '@/components/crm/fields'
import { OpsMedia } from '@/components/crm/ops-media'
import { updateSiteReport } from '@/app/actions/operations'
import { trashRecord } from '@/app/actions/trash'
import { opsFiles } from '@/lib/ops'
import { formatLongDate } from '@/lib/time'

export const metadata = { title: 'Daily site report' }

export default async function SiteReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const c = await getCtx(); if (!c.can('documents.view')) redirect('/')
  const { data: r } = await c.supabase.from('daily_site_reports').select('*, project:projects(id,name,code), work_order:work_orders(id,number,title), supervisor:employees!daily_site_reports_supervisor_id_fkey(id,full_name)').eq('id', id).maybeSingle()
  if (!r) notFound()
  const edit = c.can('records.edit')
  const [{ data: att }, media, opts] = await Promise.all([
    c.supabase.from('site_report_attendance').select('employee_id,employee:employees(id,full_name,designation)').eq('report_id', id),
    opsFiles(c, 'site_report', id),
    edit ? Promise.all([
      c.supabase.from('work_orders').select('id,number,title').eq('project_id', r.project_id).order('created_at', { ascending: false }).limit(200),
      c.supabase.from('employees').select('id,full_name').neq('status', 'archived').order('full_name').limit(1000),
    ]) : Promise.resolve(null),
  ])
  const [wos, employees] = opts ? opts.map(x => x.data ?? []) : [[], []]
  const blocks: [string, string | null, boolean?][] = [['Work completed', r.work_done], ['Planned for next day', r.work_planned], ['Issues', r.issues, true], ['Delays', r.delays, true], ['Safety observations', r.safety_notes], ['Customer instructions', r.customer_instructions], ['Materials delivered to site', r.materials_delivered], ['Equipment used', r.equipment_used], ['Notes', r.notes]]

  return <>
    <Link href={`/site-reports?project=${r.project_id}`} className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg"><ArrowLeft size={14} />Daily site reports</Link>
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold tracking-tight">{formatLongDate(r.report_date)}</h1>{r.progress != null && <Badge tone="blue">{r.progress}% progress</Badge>}{(r.issues || r.delays) && <Badge tone="red">{r.issues && r.delays ? 'Issues & delays' : r.issues ? 'Issues' : 'Delays'}</Badge>}</div>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
          <span className="font-mono">{r.number}</span>
          {r.project && <Link href={`/projects/${r.project.id}`} className="hover:text-primary hover:underline">{r.project.name}</Link>}
          {r.work_order && <Link href={`/work-orders/${r.work_order.id}`} className="hover:text-primary hover:underline">{r.work_order.number}</Link>}
          {r.supervisor && <span>Supervisor: {r.supervisor.full_name}</span>}
          {r.weather && <span className="inline-flex items-center gap-1"><CloudSun size={13} aria-hidden />{r.weather}</span>}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {edit && <DialogButton wide variant="secondary" label="Edit" title="Edit daily report" icon={<Pencil size={14} />}><ActionForm action={updateSiteReport.bind(null, id)} resetOnSuccess={false}>
          <SiteReportFields r={r} projects={[]} fixedProject={r.project_id} workOrders={wos.map((w: any) => ({ id: w.id, name: `${w.number}: ${w.title}` }))} employees={employees.map((e: any) => ({ id: e.id, name: e.full_name }))} attendance={(att ?? []).map((a: any) => a.employee_id)} today={c.today} /></ActionForm></DialogButton>}
        <LinkButton variant="secondary" href={`/print/report/site_report/${id}`} target="_blank"><Printer size={14} />Print / PDF</LinkButton>
        {c.can('records.delete') && <ActionButton variant="ghost" size="md" action={trashRecord.bind(null, 'site_report', id)} confirm="Move this report to the trash?"><Trash2 size={14} />Delete</ActionButton>}
      </div>
    </div>
    <div className="grid gap-5 xl:grid-cols-3 [&>*]:min-w-0">
      <Card className="xl:col-span-2"><CardHeader title="Report" />
        <dl className="divide-y divide-border text-sm">{blocks.filter(([, t]) => t).map(([k, t, flag]) => <div key={k} className="px-4 py-3"><dt className={flag ? 'text-xs font-medium text-danger' : 'text-xs font-medium text-muted'}>{k}</dt><dd className="mt-1 whitespace-pre-line break-words">{t}</dd></div>)}</dl></Card>
      <Card><CardHeader title="On site" sub={`${(att ?? []).length} worker${(att ?? []).length === 1 ? '' : 's'}`} action={<Users size={15} className="text-muted" aria-hidden />} />
        {!(att ?? []).length ? <p className="px-4 py-4 text-sm text-muted">No attendance recorded.</p>
          : <ul className="divide-y divide-border text-sm">{(att ?? []).map((a: any) => <li key={a.employee_id}><Link href={`/employees/${a.employee_id}`} className="flex items-center justify-between gap-3 px-4 py-2 hover:bg-surface-2/60"><span className="truncate">{a.employee?.full_name}</span><span className="truncate text-xs text-muted">{a.employee?.designation ?? ''}</span></Link></li>)}</ul>}</Card>
      <OpsMedia kind="site_report" id={id} photos={media.photos} files={media.files} canUpload={c.can('documents.upload')} tz={c.company.timezone} className="xl:col-span-3" />
    </div>
  </>
}
