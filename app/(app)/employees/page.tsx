import Link from 'next/link'
import { LayoutGrid, List, Plus, Users } from '@/components/icons'
import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/auth'
import { PAGE_SIZE, flat, pageOf, sanitizeQ } from '@/lib/queries'
import { Badge, Card, EmptyState, Field, Input, LinkButton, PageHeader, Pagination, Select, SortTh, Td, Th, TableWrap, Textarea } from '@/components/ui/primitives'
import { DialogButton } from '@/components/ui/dialog'
import { ActionForm } from '@/components/ui/action-form'
import { createEmployee } from '@/app/actions/employees'
import { employeeChecklist } from '@/lib/compliance'
import { EmployeeFields, EMP_STATUS } from '@/components/employees/employee-fields'
import { SavedViews } from '@/components/saved-views'
import { EmployeeCard, type EmpCardExtra } from '@/components/employees/employee-card'
import { LoginAsButton } from '@/components/employees/login-as'
import { EmployeeDropCard } from '@/components/employees/drop-card'
import { cn } from '@/lib/utils'

export const metadata = { title: 'Employees & labour' }
export default async function Employees({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await getCtx(); const sp = await flat(searchParams)
  if (!c.can('employees.view')) {            // "employee" role: straight to their own profile
    const { data } = await c.supabase.from('employees').select('id').eq('user_id', c.userId).maybeSingle()
    if (data) redirect(`/employees/${data.id}`)
    // staff whose role does not include the employee list (e.g. an accountant) and who have no employee record of their own
    return <><PageHeader title="Employees" /><Card><EmptyState icon={Users} title="Your role does not include the employee list" body="Ask an administrator if you need it. If you are also an employee here, HR can link your login to your employee record so your own profile opens." /></Card></>
  }
  const page = pageOf(sp.page), term = sanitizeQ(sp.q), view = sp.view === 'table' ? 'table' : 'cards', size = view === 'cards' ? 24 : PAGE_SIZE
  const canDocs = c.can('employees.view_sensitive'), canUpload = canDocs && c.can('documents.upload')
  let q = c.supabase.from('employees').select(`id,employee_no,full_name,nationality,department,designation,phone,status,work_location,joining_date,photo_path${canDocs ? ',emergency_contact_name,emergency_contact_phone,accommodation' : ''}`, { count: 'exact' })
  if (term) q = q.or(`full_name.ilike.%${term}%,employee_no.ilike.%${term}%,designation.ilike.%${term}%`)
  if (sp.status) q = q.eq('status', sp.status); else q = q.neq('status', 'archived')
  if (sp.department) q = q.eq('department', sp.department)
  const sort = ['full_name', 'employee_no', 'department', 'joining_date'].includes(sp.sort ?? '') ? sp.sort! : 'employee_no'
  const { data: list, count } = await q.order(sort, { ascending: sp.dir !== 'desc' }).range((page - 1) * size, page * size - 1)
  const rows = (list ?? []) as unknown as (import('@/components/employees/employee-card').EmpCardData)[]
  const ids = rows.map(r => r.id), none = Promise.resolve({ data: [] as any[] }), cards = view === 'cards' && ids.length > 0
  // everything the cards show, for the people on this page only, in one parallel round
  const [{ data: docs }, { data: depts }, { count: activeCount }, { data: pay }, { data: leave }, { data: assets }, { data: crew }, { data: cats }, { data: people }] = await Promise.all([
    canDocs && ids.length ? c.supabase.from('documents').select('owner_id,expiry_date,status,category:document_categories(name)').eq('owner_type', 'employee').is('deleted_at', null).in('owner_id', ids) : none,
    c.supabase.from('employees').select('department').not('department', 'is', null),
    c.supabase.from('employees').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    cards && c.can('salary.view') ? c.supabase.from('employee_compensation').select('employee_id,monthly_salary').in('employee_id', ids) : none,
    cards && canDocs ? c.supabase.from('leave_records').select('employee_id,leave_type,end_date').eq('status', 'approved').lte('start_date', c.today).gte('end_date', c.today).in('employee_id', ids) : none,
    cards && c.can('documents.view') ? c.supabase.from('assets').select('name,plate_or_serial,assigned_to').is('archived_at', null).in('assigned_to', ids) : none,
    cards && c.can('documents.view') ? c.supabase.from('work_order_members').select('employee_id,wo:work_orders!inner(number,title,status,deleted_at)').in('employee_id', ids).not('wo.status', 'in', '(completed,cancelled)').is('wo.deleted_at', null) : none,
    cards && canUpload ? c.supabase.from('document_categories').select('id,name,scope').eq('scope', 'employee').order('name') : none,
    cards && canUpload ? c.supabase.from('profiles').select('id,full_name').eq('is_active', true).order('full_name') : none,
  ])
  // "Log in as employee": owners only, for active Employee portal logins
  const portalLogins = new Set<string>()
  if (cards && c.can('users.manage') && ids.length) {
    const { data: linked } = await c.supabase.from('employees').select('id,user_id').in('id', ids).not('user_id', 'is', null)
    const uids = (linked ?? []).map(l => l.user_id as string)
    const { data: logins } = uids.length ? await c.supabase.from('profiles').select('id').in('id', uids).eq('role', 'employee').eq('is_active', true) : { data: [] as { id: string }[] }
    const ok = new Set((logins ?? []).map(l => l.id))
    for (const l of linked ?? []) if (ok.has(l.user_id as string) && l.user_id !== c.userId) portalLogins.add(l.id)
  }
  const deptList = [...new Set((depts ?? []).map(d => d.department as string))].sort()
  const cls = 'h-9 rounded-md border border-border bg-surface px-3 text-sm'
  const docsOf = (id: string) => (docs ?? []).filter((d: any) => d.owner_id === id).map((d: any) => ({ category_name: d.category?.name, expiry_date: d.expiry_date, status: d.status }))
  const extra = (id: string): EmpCardExtra => {
    const p = (pay ?? []).find((x: any) => x.employee_id === id), l = (leave ?? []).find((x: any) => x.employee_id === id)
    return {
      checklist: canDocs ? employeeChecklist(docsOf(id), c.today) : undefined,
      salary: c.can('salary.view') ? (p ? Number(p.monthly_salary) : null) : undefined,
      leave: l ? { type: l.leave_type, until: l.end_date } : null,
      assets: (assets ?? []).filter((a: any) => a.assigned_to === id).map((a: any) => [a.name, a.plate_or_serial].filter(Boolean).join(' · ')),
      jobs: (crew ?? []).filter((m: any) => m.employee_id === id).map((m: any) => `${m.wo.number} · ${m.wo.title}`),
    }
  }
  const qs = (v: string) => { const u = new URLSearchParams(Object.entries(sp).filter(([k, x]) => x && k !== 'page' && k !== 'view') as [string, string][]); if (v === 'table') u.set('view', 'table'); const s = u.toString(); return `/employees${s ? `?${s}` : ''}` }

  return <>
    <PageHeader title="Employees & labour" sub={`${activeCount ?? 0} active employee${activeCount === 1 ? '' : 's'}`}
      actions={<><SavedViews page="/employees" />{c.can('data.export') && c.can('employees.view_sensitive') && <LinkButton href="/api/export/employees" variant="secondary">Export CSV</LinkButton>}
        {c.can('records.edit') && c.can('employees.view_sensitive') && <DialogButton wide openParam="employee" label="Add employee" title="Add employee" icon={<Plus size={15} />}>
          <ActionForm action={createEmployee} submit="Create employee"><EmployeeFields withSalary={c.can('salary.view')} /></ActionForm></DialogButton>}</>} />
    <form className="mb-4 flex flex-wrap gap-2"><input name="q" type="search" aria-label="Search employees" defaultValue={sp.q} placeholder="Search name, ID, designation…" className={`${cls} min-w-52 flex-1`} />
      <select name="status" aria-label="Employee status" defaultValue={sp.status ?? ''} className={cls}><option value="">Current staff</option>{EMP_STATUS.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</select>
      <select name="department" aria-label="Department" defaultValue={sp.department ?? ''} className={cls}><option value="">All departments</option>{deptList.map(d => <option key={d}>{d}</option>)}</select>
      {view === 'table' && <input type="hidden" name="view" value="table" />}
      <button className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-fg">Filter</button>
      <nav aria-label="Layout" className="ms-auto inline-flex rounded-full bg-surface-2 p-1 ring-1 ring-border/70">{([['cards', 'Cards', LayoutGrid], ['table', 'Table', List]] as const).map(([k, l, I]) =>
        <Link key={k} href={qs(k)} aria-current={view === k ? 'page' : undefined} className={cn('inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors', view === k ? 'bg-surface text-fg shadow-card' : 'text-muted hover:text-fg')}><I size={14} aria-hidden />{l}</Link>)}</nav></form>
    {view === 'cards' && rows.length > 0 && canUpload && <p className="mb-3 text-[13px] text-muted"><span className="max-sm:hidden">Tip: drag a passport, visa or Emirates ID file onto a person’s card to add it to their documents.</span><span className="sm:hidden">Tip: tap Add document on a person’s card to file their passport, visa or Emirates ID.</span></p>}
    {view === 'cards' ? (!rows.length ? <Card><EmptyState icon={Users} title={term || sp.status || sp.department ? 'No employees match' : 'No employees yet'} body="Add your first employee to start tracking passports, Emirates IDs, visas and labour documents." /></Card> : <>
      <ul className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3" aria-label="Employees">{rows.map(r => <li key={r.id} className="min-w-0">
        <EmployeeDropCard id={r.id} name={r.full_name} cats={(cats ?? []) as any} people={(people ?? []) as any} canUpload={canUpload}
          className="h-full rounded-2xl border border-border/80 bg-surface p-5 shadow-card transition-shadow hover:shadow-lift">
          <EmployeeCard e={r} x={extra(r.id)} today={c.today} sensitive={canDocs} upload={canUpload}
            action={portalLogins.has(r.id) ? <LoginAsButton id={r.id} name={r.full_name} /> : undefined} /></EmployeeDropCard></li>)}</ul>
      <Card className="mt-4"><Pagination page={page} pageSize={size} total={count ?? 0} params={sp} base="/employees" /></Card></>) :
    <Card className="overflow-hidden">{!rows.length ? <EmptyState icon={Users} title={term || sp.status || sp.department ? 'No employees match' : 'No employees yet'} body="Add your first employee to start tracking passports, Emirates IDs, visas and labour documents." /> : <>
      <TableWrap><thead className="border-b border-border bg-surface-2/60"><tr><SortTh label="ID" col="employee_no" params={sp} base="/employees" /><SortTh label="Name" col="full_name" params={sp} base="/employees" />
        <SortTh label="Department" col="department" params={sp} base="/employees" /><Th>Designation</Th><Th>Location</Th><Th>Status</Th>{canDocs && <Th>Documents</Th>}</tr></thead>
        <tbody className="divide-y divide-border">{rows.map(r => {
          const cl = employeeChecklist(docsOf(r.id), c.today)
          return <tr key={r.id} className="hover:bg-surface-2/50"><Td className="font-mono text-xs text-muted">{r.employee_no}</Td>
            <Td><Link href={`/employees/${r.id}`} className="font-medium hover:text-primary">{r.full_name}</Link><div className="text-xs text-muted">{r.nationality}</div></Td>
            <Td>{r.department ?? '—'}</Td><Td className="text-muted">{r.designation ?? '—'}</Td><Td className="text-muted">{r.work_location ?? '—'}</Td>
            <Td><Badge tone={r.status === 'active' ? 'green' : r.status === 'archived' || r.status === 'terminated' ? 'neutral' : 'amber'}>{r.status.replace('_', ' ')}</Badge></Td>
            {canDocs && <Td><Badge tone={cl.issues ? 'red' : cl.score === 100 ? 'green' : 'amber'}>{cl.score}% complete{cl.issues ? ` · ${cl.issues} issue${cl.issues > 1 ? 's' : ''}` : ''}</Badge></Td>}</tr> })}</tbody></TableWrap>
      <Pagination page={page} pageSize={size} total={count ?? 0} params={sp} base="/employees" /></>}</Card>}</>
}
