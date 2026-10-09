import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ClipboardCheck, Plus } from 'lucide-react'
import { getCtx } from '@/lib/auth'
import { PAGE_SIZE, flat, pageOf, sanitizeQ } from '@/lib/queries'
import { Card, EmptyState, LinkButton, Metrics, PageHeader, Pagination, StatCard, Td, Th, TableWrap } from '@/components/ui/primitives'
import { DialogButton } from '@/components/ui/dialog'
import { ActionForm } from '@/components/ui/action-form'
import { SiteReportFields } from '@/components/crm/fields'
import { createSiteReport } from '@/app/actions/operations'
import { addDays, formatShortDate } from '@/lib/time'
import { SavedViews } from '@/components/saved-views'

export const metadata = { title: 'Daily Site Reports' }

export default async function SiteReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await getCtx(); if (!c.can('documents.view')) redirect('/')
  const sp = await flat(searchParams)
  const page = pageOf(sp.page), term = sanitizeQ(sp.q), edit = c.can('records.edit')
  let q = c.supabase.from('daily_site_reports').select('id,number,report_date,progress,work_done,issues,delays,project:projects(id,name),work_order:work_orders(id,number),supervisor:employees!daily_site_reports_supervisor_id_fkey(full_name),site_report_attendance(employee_id)', { count: 'exact' })
  if (sp.project && /^[0-9a-f-]{36}$/.test(sp.project)) q = q.eq('project_id', sp.project)
  if (sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from)) q = q.gte('report_date', sp.from)
  if (sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to)) q = q.lte('report_date', sp.to)
  if (term) q = q.or(`number.ilike.%${term}%,work_done.ilike.%${term}%,issues.ilike.%${term}%`)
  const head = { count: 'exact' as const, head: true }
  const [{ data: rows, count }, today, week, withIssues, { data: projects }, opts] = await Promise.all([
    q.order('report_date', { ascending: false }).order('created_at', { ascending: false }).range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1),
    c.supabase.from('daily_site_reports').select('id', head).eq('report_date', c.today),
    c.supabase.from('daily_site_reports').select('id', head).gte('report_date', addDays(c.today, -6)),
    c.supabase.from('daily_site_reports').select('id', head).gte('report_date', addDays(c.today, -6)).or('issues.not.is.null,delays.not.is.null'),
    c.supabase.from('projects').select('id,name').in('status', ['planning', 'active', 'on_hold']).order('name').limit(500),
    edit ? Promise.all([
      c.supabase.from('work_orders').select('id,number,title').not('status', 'in', '(completed,cancelled)').order('created_at', { ascending: false }).limit(500),
      c.supabase.from('employees').select('id,full_name').neq('status', 'archived').order('full_name').limit(1000),
    ]) : Promise.resolve(null),
  ])
  const [wos, employees] = opts ? opts.map(r => r.data ?? []) : [[], []]
  const projOpts = (projects ?? []).map((p: any) => ({ id: p.id, name: p.name }))
  const add = <DialogButton wide label="New daily report" title="Daily site report" icon={<Plus size={15} />} openParam="site_report"><ActionForm action={createSiteReport} submit="Save report" idempotent>
    <SiteReportFields projects={projOpts} workOrders={wos.map((w: any) => ({ id: w.id, name: `${w.number}: ${w.title}` }))} employees={employees.map((e: any) => ({ id: e.id, name: e.full_name }))} today={c.today} r={{ project_id: sp.project }} /></ActionForm></DialogButton>
  const filtered = !!(term || sp.project || sp.from || sp.to)
  const cls = 'h-9 rounded-md border border-border bg-surface px-3 text-sm'

  return <>
    <PageHeader title="Daily Site Reports" sub="What happened on site each day: work done, manpower, issues, safety and photos." actions={<><SavedViews page="/site-reports" />{edit && add}</>} />
    <Metrics className="mb-5" cols={3}>
      <StatCard label="Reports today" value={today.count ?? 0} />
      <StatCard label="Last 7 days" value={week.count ?? 0} />
      <StatCard label="With issues or delays (7 days)" value={withIssues.count ?? 0} tone={withIssues.count ? 'red' : 'neutral'} />
    </Metrics>
    <Card>
      <form className="flex flex-wrap gap-2 border-b border-border p-3">
        <input name="q" type="search" defaultValue={sp.q} aria-label="Search reports" placeholder="Search work done, issues…" className={`${cls} min-w-48 flex-1`} />
        <select name="project" defaultValue={sp.project ?? ''} aria-label="Project" className={`${cls} max-w-56`}><option value="">All projects</option>{projOpts.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <input name="from" type="date" defaultValue={sp.from} aria-label="From" className={cls} /><input name="to" type="date" defaultValue={sp.to} aria-label="To" className={cls} />
        <button className={`${cls} cursor-pointer`}>Filter</button>{filtered && <LinkButton href="/site-reports" variant="ghost">Clear</LinkButton>}</form>
      {!rows?.length ? <EmptyState icon={ClipboardCheck} title={filtered ? 'No reports match' : 'No daily reports yet'} body={!filtered ? 'The site supervisor files one per day from a phone: work done, who was on site, photos.' : undefined} action={edit && !filtered ? add : undefined} />
        : <TableWrap><thead><tr><Th>Date</Th><Th>Project</Th><Th>Work done</Th><Th>Manpower</Th><Th>Progress</Th><Th>Flags</Th><Th>Supervisor</Th></tr></thead>
          <tbody className="divide-y divide-border">{rows.map((r: any) => <tr key={r.id} className="hover:bg-surface-2/40">
            <Td className="whitespace-nowrap"><Link href={`/site-reports/${r.id}`} className="font-medium tabular-nums hover:text-primary">{formatShortDate(r.report_date)}</Link><div className="font-mono text-xs text-muted">{r.number}</div></Td>
            <Td className="max-w-[200px] truncate">{r.project?.name}{r.work_order && <div className="font-mono text-xs text-muted">{r.work_order.number}</div>}</Td>
            <Td className="max-w-[320px]"><div className="line-clamp-2 text-muted">{r.work_done}</div></Td>
            <Td className="tabular-nums">{r.site_report_attendance?.length ?? 0}</Td>
            <Td className="tabular-nums">{r.progress != null ? `${r.progress}%` : '—'}</Td>
            <Td className="text-xs">{[r.issues && 'Issues', r.delays && 'Delays'].filter(Boolean).join(' · ') ? <span className="font-medium text-danger">{[r.issues && 'Issues', r.delays && 'Delays'].filter(Boolean).join(' · ')}</span> : <span className="text-muted/60">None</span>}</Td>
            <Td className="text-muted">{r.supervisor?.full_name ?? '—'}</Td></tr>)}</tbody></TableWrap>}
      <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} params={sp} base="/site-reports" />
    </Card>
  </>
}
