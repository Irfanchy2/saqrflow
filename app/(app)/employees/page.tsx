import Link from 'next/link'
import { Plus, Users } from 'lucide-react'
import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/auth'
import { PAGE_SIZE, flat, pageOf, sanitizeQ } from '@/lib/queries'
import { Badge, Card, EmptyState, Field, Input, LinkButton, PageHeader, Pagination, Select, SortTh, Td, Th, TableWrap, Textarea } from '@/components/ui/primitives'
import { DialogButton } from '@/components/ui/dialog'
import { ActionForm } from '@/components/ui/action-form'
import { createEmployee } from '@/app/actions/employees'
import { employeeChecklist } from '@/lib/compliance'
import { EmployeeFields, EMP_STATUS } from '@/components/employees/employee-fields'

export const metadata = { title: 'Employees & Labour' }
export default async function Employees({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await getCtx(); const sp = await flat(searchParams)
  if (!c.can('employees.view')) {            // "employee" role: straight to their own profile
    const { data } = await c.supabase.from('employees').select('id').eq('user_id', c.userId).maybeSingle()
    if (data) redirect(`/employees/${data.id}`)
    return <><PageHeader title="Employees" /><Card><EmptyState icon={Users} title="No employee record is linked to your account" body="Ask HR to link your login to your employee profile." /></Card></>
  }
  const page = pageOf(sp.page), term = sanitizeQ(sp.q)
  let q = c.supabase.from('employees').select('id,employee_no,full_name,nationality,department,designation,phone,status,work_location,joining_date', { count: 'exact' })
  if (term) q = q.or(`full_name.ilike.%${term}%,employee_no.ilike.%${term}%,designation.ilike.%${term}%`)
  if (sp.status) q = q.eq('status', sp.status); else q = q.neq('status', 'archived')
  if (sp.department) q = q.eq('department', sp.department)
  const sort = ['full_name', 'employee_no', 'department', 'joining_date'].includes(sp.sort ?? '') ? sp.sort! : 'employee_no'
  const { data: rows, count } = await q.order(sort, { ascending: sp.dir !== 'desc' }).range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
  const ids = (rows ?? []).map(r => r.id)
  const canDocs = c.can('employees.view_sensitive')
  const { data: docs } = canDocs && ids.length ? await c.supabase.from('documents').select('owner_id,expiry_date,status,category:document_categories(name)').eq('owner_type', 'employee').is('deleted_at', null).in('owner_id', ids) : { data: [] as any[] }
  const { data: depts } = await c.supabase.from('employees').select('department').not('department', 'is', null)
  const deptList = [...new Set((depts ?? []).map(d => d.department as string))].sort()
  const cls = 'h-9 rounded-md border border-border bg-surface px-3 text-sm'
  const { count: activeCount } = await c.supabase.from('employees').select('id', { count: 'exact', head: true }).eq('status', 'active')

  return <>
    <PageHeader title="Employees & Labour" sub={`${activeCount ?? 0} active employee${activeCount === 1 ? '' : 's'}`}
      actions={<>{c.can('data.export') && c.can('employees.view_sensitive') && <LinkButton href="/api/export/employees" variant="secondary">Export CSV</LinkButton>}
        {c.can('records.edit') && c.can('employees.view_sensitive') && <DialogButton wide openParam="employee" label="Add employee" title="Add employee" icon={<Plus size={15} />}>
          <ActionForm action={createEmployee} submit="Create employee"><EmployeeFields withSalary={c.can('salary.view')} /></ActionForm></DialogButton>}</>} />
    <form className="mb-4 flex flex-wrap gap-2"><input name="q" defaultValue={sp.q} placeholder="Search name, ID, designation…" className={`${cls} min-w-52 flex-1`} />
      <select name="status" defaultValue={sp.status ?? ''} className={cls}><option value="">Current staff</option>{EMP_STATUS.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</select>
      <select name="department" defaultValue={sp.department ?? ''} className={cls}><option value="">All departments</option>{deptList.map(d => <option key={d}>{d}</option>)}</select>
      <button className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-fg">Filter</button></form>
    <Card className="overflow-hidden">{!rows?.length ? <EmptyState icon={Users} title={term || sp.status || sp.department ? 'No employees match' : 'No employees yet'} body="Add your first employee to start tracking passports, Emirates IDs, visas and labour documents." /> : <>
      <TableWrap><thead className="border-b border-border bg-surface-2/60"><tr><SortTh label="ID" col="employee_no" params={sp} base="/employees" /><SortTh label="Name" col="full_name" params={sp} base="/employees" />
        <SortTh label="Department" col="department" params={sp} base="/employees" /><Th>Designation</Th><Th>Location</Th><Th>Status</Th>{canDocs && <Th>Documents</Th>}</tr></thead>
        <tbody className="divide-y divide-border">{rows.map(r => {
          const cl = employeeChecklist((docs ?? []).filter((d: any) => d.owner_id === r.id).map((d: any) => ({ category_name: d.category?.name, expiry_date: d.expiry_date, status: d.status })), c.today)
          return <tr key={r.id} className="hover:bg-surface-2/50"><Td className="font-mono text-xs text-muted">{r.employee_no}</Td>
            <Td><Link href={`/employees/${r.id}`} className="font-medium hover:text-primary">{r.full_name}</Link><div className="text-xs text-muted">{r.nationality}</div></Td>
            <Td>{r.department ?? '—'}</Td><Td className="text-muted">{r.designation ?? '—'}</Td><Td className="text-muted">{r.work_location ?? '—'}</Td>
            <Td><Badge tone={r.status === 'active' ? 'green' : r.status === 'archived' || r.status === 'terminated' ? 'neutral' : 'amber'}>{r.status.replace('_', ' ')}</Badge></Td>
            {canDocs && <Td><Badge tone={cl.issues ? 'red' : cl.score === 100 ? 'green' : 'amber'}>{cl.score}% complete{cl.issues ? ` · ${cl.issues} issue${cl.issues > 1 ? 's' : ''}` : ''}</Badge></Td>}</tr> })}</tbody></TableWrap>
      <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} params={sp} base="/employees" /></>}</Card></>
}
