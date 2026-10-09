import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AlertTriangle, ArrowLeft, CheckCircle2, CircleDashed, Plus, UserRound } from 'lucide-react'
import { getCtx } from '@/lib/auth'
import { flat } from '@/lib/queries'
import { Badge, Card, CardHeader, EmptyState, Field, Input, PageHeader, Select, Td, Th, TableWrap, Textarea, type Tone } from '@/components/ui/primitives'
import { DialogButton } from '@/components/ui/dialog'
import { ActionForm } from '@/components/ui/action-form'
import { EmployeeFields } from '@/components/employees/employee-fields'
import { DocFields } from '@/components/documents/doc-fields'
import { StatusBadge } from '@/components/documents/status-badge'
import { addAdvance, addLeave, addSalaryPayment, setSalary, updateEmployee, uploadPhoto } from '@/app/actions/employees'
import { createDocument } from '@/app/actions/documents'
import { employeeChecklist } from '@/lib/compliance'
import { daysBetween, formatAed, localDate } from '@/lib/time'
import { cn } from '@/lib/utils'
import { documentTimeline } from '@/lib/timeline'
import { Timeline } from '@/components/timeline'
import { RecordActivity } from '@/components/record-activity'
import { RecordTasks } from '@/components/record-tasks'
import { CustomFieldsCard } from '@/components/custom-fields-card'

export const metadata = { title: 'Employee' }
const TABS = [['personal', 'Personal'], ['documents', 'Documents'], ['salary', 'Salary'], ['leave', 'Leave'], ['history', 'History']] as const

export default async function EmployeePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params; const sp = await flat(searchParams); const c = await getCtx()
  const { data: e } = await c.supabase.from('employees').select('*').eq('id', id).maybeSingle()
  if (!e) notFound()
  const canSens = c.can('employees.view_sensitive'), canSalary = c.can('salary.view'), canEdit = c.can('records.edit') && canSens
  const tabs = TABS.filter(([k]) => (k === 'salary' ? canSalary : k === 'leave' || k === 'history' ? canSens : true))
  const tab = tabs.some(([k]) => k === sp.tab) ? sp.tab! : 'personal'
  const isSelf = e.user_id === c.userId

  const [{ data: docs }, { data: cats }, { data: people }] = await Promise.all([
    canSens || isSelf ? c.supabase.from('documents').select('id,name,reference_no,expiry_date,status,issuing_authority,current_version_id,category:document_categories(name)').eq('owner_type', 'employee').eq('owner_id', id).is('deleted_at', null).order('expiry_date', { nullsFirst: false }) : Promise.resolve({ data: [] as any[] }),
    c.supabase.from('document_categories').select('id,name,scope').eq('scope', 'employee').order('name'),
    c.supabase.from('profiles').select('id,full_name').eq('is_active', true).order('full_name'),
  ])
  const checklist = employeeChecklist((docs ?? []).map((d: any) => ({ category_name: d.category?.name, expiry_date: d.expiry_date, status: d.status })), c.today)
  const stateTone: Record<string, Tone> = { valid: 'green', expiring_soon: 'amber', expired: 'red', missing: 'red', no_expiry: 'green', renewal_in_progress: 'blue', cancelled: 'neutral' }

  return <>
    <Link href="/employees" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-fg"><ArrowLeft size={14} />Employees</Link>
    <div className="mb-5 flex items-center gap-4">
      <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-full bg-primary-soft text-primary">
        {e.photo_path ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={`/api/employees/${id}/photo?w=160`} alt="" loading="lazy" className="h-full w-full object-cover" /> : <UserRound size={28} />}</div>
      <div><h1 className="text-xl font-semibold tracking-tight">{e.full_name}</h1>
        <p className="text-sm text-muted">{[e.designation, e.department].filter(Boolean).join(' · ') || 'No designation'} · <span className="font-mono">{e.employee_no}</span></p>
        <div className="mt-1 flex gap-2"><Badge tone={e.status === 'active' ? 'green' : 'amber'}>{e.status.replace('_', ' ')}</Badge>{canSens && <Badge tone={checklist.issues ? 'red' : 'green'}>{checklist.score}% documents complete</Badge>}</div></div></div>
    <div className="mb-5 flex gap-1 overflow-x-auto border-b border-border">
      {tabs.map(([k, label]) => <Link key={k} href={`/employees/${id}?tab=${k}`} className={cn('-mb-px border-b-2 px-4 py-2 text-sm', tab === k ? 'border-primary font-medium text-primary' : 'border-transparent text-muted hover:text-fg')}>{label}</Link>)}</div>

    {tab === 'personal' && <div className="grid gap-5 lg:grid-cols-3">
      <Card className="lg:col-span-2"><CardHeader title="Personal & employment information" />
        <div className="p-4">{canEdit ? <ActionForm action={updateEmployee.bind(null, id)} resetOnSuccess={false}><EmployeeFields d={e} /></ActionForm>
          : <dl className="grid grid-cols-2 gap-4 text-sm">{[['Nationality', e.nationality], ['Department', e.department], ['Designation', e.designation], ['Contact', e.phone], ['Joined', e.joining_date], ['Location', e.work_location]].map(([k, v]) => <div key={k as string}><dt className="text-xs text-muted">{k}</dt><dd>{v ?? '—'}</dd></div>)}</dl>}</div></Card>
      <div className="space-y-5">
        {canSens && <Card><CardHeader title="Emergency contact" /><div className="p-4 text-sm">{e.emergency_contact_name ? <><div className="font-medium">{e.emergency_contact_name}</div><div className="text-muted">{e.emergency_contact_phone}</div></> : <span className="text-muted">Not recorded</span>}</div></Card>}
        {canSens && <Card><CardHeader title="Accommodation" /><div className="p-4 text-sm">{e.accommodation ?? <span className="text-muted">Not recorded</span>}</div></Card>}
        {canEdit && <Card><CardHeader title="Photograph" /><div className="p-4"><ActionForm action={uploadPhoto.bind(null, id)} submit="Upload photo"><input type="file" name="photo" accept=".jpg,.jpeg,.png,.webp" className="text-sm" required /></ActionForm></div></Card>}
      </div></div>}

    {tab === 'documents' && <div className="grid gap-5 lg:grid-cols-3">
      <Card className="lg:col-span-2"><CardHeader title="Documents" action={c.can('documents.upload') && canSens ? <DialogButton size="sm" wide label="Add" icon={<Plus size={14} />} title={`Add document for ${e.full_name}`}>
        <ActionForm action={createDocument} submit="Save document"><input type="hidden" name="owner_type" value="employee" /><input type="hidden" name="owner_id" value={id} />
          <DocFields categories={cats ?? []} people={people ?? []} fileRequired /></ActionForm></DialogButton> : undefined} />
        {!docs?.length ? <EmptyState title="No documents on file" body="Add the passport, Emirates ID, residence visa, work permit, labour contract and medical insurance." /> :
          <TableWrap><thead className="border-b border-border"><tr><Th>Document</Th><Th>Number</Th><Th>Expiry</Th><Th>Status</Th></tr></thead>
            <tbody className="divide-y divide-border">{docs.map((d: any) => <tr key={d.id} className="hover:bg-surface-2/50"><Td><Link className="font-medium hover:text-primary" href={`/documents/${d.id}`}>{d.category?.name ?? d.name}</Link><div className="text-xs text-muted">{d.name}</div></Td>
              <Td className="font-mono text-xs text-muted">{d.reference_no ?? '—'}</Td><Td className="tabular-nums">{d.expiry_date ?? '—'}</Td><Td><StatusBadge doc={d} today={c.today} /></Td></tr>)}</tbody></TableWrap>}</Card>
      <Card><CardHeader title="Compliance checklist" sub={`${checklist.score}% complete`} />
        <ul className="divide-y divide-border">{checklist.items.map(i => <li key={i.name} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
          <span className="flex items-center gap-2">{i.state === 'missing' || i.state === 'expired' ? <AlertTriangle size={15} className="text-danger" /> : i.state === 'expiring_soon' ? <CircleDashed size={15} className="text-warning" /> : <CheckCircle2 size={15} className="text-success" />}{i.name}</span>
          <Badge tone={stateTone[i.state]}>{i.state === 'missing' ? 'Missing' : i.state.replace(/_/g, ' ')}</Badge></li>)}</ul></Card></div>}

    {tab === 'personal' && <div className="mt-5 grid gap-5 xl:grid-cols-2 [&>*]:min-w-0"><CustomFieldsCard c={c} entity="employee" recordId={id} /><RecordTasks c={c} type="employee" id={id} /></div>}
    {tab === 'history' && canSens && <RecordActivity c={c} table="employees" id={id} className="mb-5" />}
    {tab === 'salary' && canSalary && <SalaryTab id={id} c={c} />}
    {tab === 'leave' && canSens && <LeaveTab id={id} c={c} />}
    {tab === 'history' && canSens && <HistoryTab id={id} c={c} e={e} />}
  </>
}

async function SalaryTab({ id, c }: { id: string; c: Awaited<ReturnType<typeof getCtx>> }) {
  const [{ data: comp }, { data: pays }, { data: adv }] = await Promise.all([
    c.supabase.from('employee_compensation').select('monthly_salary').eq('employee_id', id).maybeSingle(),
    c.supabase.from('salary_payments').select('*').eq('employee_id', id).order('period', { ascending: false }).limit(24),
    c.supabase.from('employee_advances').select('*').eq('employee_id', id).order('given_on', { ascending: false }),
  ])
  const outstanding = (adv ?? []).filter(a => a.kind === 'advance' && !a.settled).reduce((s, a) => s + Number(a.amount), 0)
  return <div className="grid gap-5 lg:grid-cols-3">
    <Card><CardHeader title="Monthly salary" /><div className="p-4"><div className="mb-3 text-2xl font-semibold tabular-nums">{comp ? formatAed(comp.monthly_salary) : 'Not set'}</div>
      <ActionForm action={setSalary.bind(null, id)} submit="Update" resetOnSuccess={false}><Field label="Monthly salary (AED)"><Input name="monthly_salary" type="number" step="0.01" min="0" defaultValue={comp?.monthly_salary} required /></Field></ActionForm>
      <p className="mt-3 text-xs text-muted">Visible only to roles with salary access. Changes are audit-logged (amounts are redacted in the log).</p>
      <p className="mt-2 text-xs text-muted">WPS (SIF) export file generation is planned. The bank/agent specification must be confirmed first.</p></div></Card>
    <Card className="lg:col-span-2"><CardHeader title="Salary payments" action={<DialogButton size="sm" label="Record payment" icon={<Plus size={14} />} title="Record salary payment">
      <ActionForm action={addSalaryPayment.bind(null, id)}><div className="grid gap-4 sm:grid-cols-2"><Field label="Month *"><Input type="month" name="period" required /></Field><Field label="Amount (AED) *"><Input type="number" step="0.01" min="0" name="amount" defaultValue={comp?.monthly_salary} required /></Field>
        <Field label="Paid on"><Input type="date" name="paid_on" /></Field><Field label="Method"><Select name="method"><option value="">—</option><option value="wps">WPS</option><option value="bank_transfer">Bank transfer</option><option value="cash">Cash</option><option value="cheque">Cheque</option></Select></Field></div><Field label="Notes"><Textarea name="notes" /></Field></ActionForm></DialogButton>} />
      {!pays?.length ? <EmptyState title="No payments recorded" /> : <TableWrap><thead className="border-b border-border"><tr><Th>Period</Th><Th>Amount</Th><Th>Paid on</Th><Th>Method</Th></tr></thead><tbody className="divide-y divide-border">
        {pays.map(p => <tr key={p.id}><Td>{p.period.slice(0, 7)}</Td><Td className="tabular-nums">{formatAed(p.amount)}</Td><Td>{p.paid_on ?? '—'}</Td><Td className="uppercase text-muted">{p.method ?? '—'}</Td></tr>)}</tbody></TableWrap>}</Card>
    <Card className="lg:col-span-3"><CardHeader title="Advances & deductions" sub={`Outstanding advances: ${formatAed(outstanding)}`} action={<DialogButton size="sm" label="Add" icon={<Plus size={14} />} title="Advance / deduction">
      <ActionForm action={addAdvance.bind(null, id)}><div className="grid gap-4 sm:grid-cols-2"><Field label="Type"><Select name="kind"><option value="advance">Advance</option><option value="deduction">Deduction</option></Select></Field><Field label="Amount (AED) *"><Input type="number" step="0.01" min="0.01" name="amount" required /></Field>
        <Field label="Date"><Input type="date" name="given_on" /></Field><Field label="Monthly recovery"><Input type="number" step="0.01" min="0" name="monthly_recovery" /></Field></div><Field label="Notes"><Textarea name="notes" /></Field></ActionForm></DialogButton>} />
      {!adv?.length ? <EmptyState title="None recorded" /> : <TableWrap><thead className="border-b border-border"><tr><Th>Date</Th><Th>Type</Th><Th>Amount</Th><Th>Recovery / month</Th><Th>Notes</Th></tr></thead><tbody className="divide-y divide-border">
        {adv.map(a => <tr key={a.id}><Td>{a.given_on}</Td><Td className="capitalize">{a.kind}</Td><Td className="tabular-nums">{formatAed(a.amount)}</Td><Td>{a.monthly_recovery ? formatAed(a.monthly_recovery) : '—'}</Td><Td className="text-muted">{a.notes ?? '—'}</Td></tr>)}</tbody></TableWrap>}</Card></div>
}

async function LeaveTab({ id, c }: { id: string; c: Awaited<ReturnType<typeof getCtx>> }) {
  const { data: leave } = await c.supabase.from('leave_records').select('*').eq('employee_id', id).order('start_date', { ascending: false })
  return <Card><CardHeader title="Leave records" action={c.can('records.edit') ? <DialogButton size="sm" label="Add leave" icon={<Plus size={14} />} title="Record leave">
    <ActionForm action={addLeave.bind(null, id)}><Field label="Type"><Select name="leave_type"><option value="annual">Annual</option><option value="sick">Sick</option><option value="unpaid">Unpaid</option><option value="emergency">Emergency</option><option value="other">Other</option></Select></Field>
      <div className="grid gap-4 sm:grid-cols-2"><Field label="From *"><Input type="date" name="start_date" required /></Field><Field label="To *"><Input type="date" name="end_date" required /></Field></div><Field label="Notes"><Textarea name="notes" /></Field></ActionForm></DialogButton> : undefined} />
    {!leave?.length ? <EmptyState title="No leave recorded" /> : <TableWrap><thead className="border-b border-border"><tr><Th>Type</Th><Th>From</Th><Th>To</Th><Th>Days</Th><Th>Notes</Th></tr></thead><tbody className="divide-y divide-border">
      {leave.map(l => <tr key={l.id}><Td className="capitalize">{l.leave_type}</Td><Td>{l.start_date}</Td><Td>{l.end_date}</Td><Td>{daysBetween(l.start_date, l.end_date) + 1}</Td><Td className="text-muted">{l.notes ?? '—'}</Td></tr>)}</tbody></TableWrap>}</Card>
}

async function HistoryTab({ id, c, e }: { id: string; c: Awaited<ReturnType<typeof getCtx>>; e: any }) {
  const { data: logs } = c.can('audit.view') ? await c.supabase.from('audit_logs').select('id,action,table_name,created_at').eq('record_id', id).order('created_at', { ascending: false }).limit(30) : { data: [] as any[] }
  const events = await documentTimeline(c, { type: 'employee', id })
  return <div className="grid gap-5 lg:grid-cols-2"><Card><CardHeader title="Document timeline" sub="Uploads, versions, renewals and reminders. Previous documents stay in history" /><div className="p-4"><Timeline events={events} /></div></Card><Card><CardHeader title="Employment history" />
    <ul className="divide-y divide-border text-sm"><li className="px-4 py-3">Joined <b>{e.joining_date ?? 'unknown date'}</b> · current status <b>{e.status.replace('_', ' ')}</b></li>
      <li className="px-4 py-3 text-muted">Record created {localDate(e.created_at, c.company.timezone)}</li>
      {c.can('audit.view') && (logs ?? []).map((l: any) => <li key={l.id} className="flex justify-between px-4 py-2.5"><span><b className="capitalize">{l.action.toLowerCase()}</b> {l.table_name.replace('_', ' ')}</span><span className="text-xs text-muted">{l.created_at.slice(0, 16).replace('T', ' ')}</span></li>)}</ul></Card></div>
}
