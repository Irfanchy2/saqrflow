import { WhatsAppHistory } from '@/components/whatsapp/history'
import { LoginAsButton } from '@/components/employees/login-as'
import { WhatsAppSend } from '@/components/whatsapp/send'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AlertTriangle, ArrowLeft, CheckCircle2, CircleDashed, Download, FileText, Plus, Trash2, UserRound } from '@/components/icons'
import { getCtx } from '@/lib/auth'
import { flat } from '@/lib/queries'
import { trashRecord } from '@/app/actions/trash'
import { Badge, Card, CardHeader, CardLink, EmptyState, Field, Input, LinkButton, Money, PageHeader, Select, Td, Th, TableWrap, Textarea, type Tone } from '@/components/ui/primitives'
import { QuickPay } from '@/components/salary/quick-pay'
import { ShareSheet } from '@/components/whatsapp/share-sheet'
import { salaryAccount } from '@/lib/salary'
import { companyWhatsApp } from '@/lib/whatsapp/outbox'
import { methodLabel, splitOwed, sum } from '@/lib/salary-math'
import { DialogButton } from '@/components/ui/dialog'
import { ActionButton, ActionForm } from '@/components/ui/action-form'
import { EmployeeFields } from '@/components/employees/employee-fields'
import { DocFields } from '@/components/documents/doc-fields'
import { StatusBadge } from '@/components/documents/status-badge'
import { addLeave, grantPortalAccess, markAttendance, revokePortalAccess, setSalary, updateEmployee, uploadPhoto } from '@/app/actions/employees'
import { ATTENDANCE, attendanceSummary, clock, leftRunning, monthName, portalSettings } from '@/lib/me'
import { ROLE_LABELS, type Role } from '@/lib/permissions'
import { createDocument } from '@/app/actions/documents'
import { employeeChecklist } from '@/lib/compliance'
import { daysBetween, formatAed, localDate, showDate } from '@/lib/time'
import { cn } from '@/lib/utils'
import { documentTimeline } from '@/lib/timeline'
import { Timeline } from '@/components/timeline'
import { RecordActivity } from '@/components/record-activity'
import { RecordTasks } from '@/components/record-tasks'
import { CustomFieldsCard } from '@/components/custom-fields-card'
import { ShareLinks } from '@/components/share-links'

export const metadata = { title: 'Employee' }
const TABS = [['personal', 'Personal'], ['documents', 'Documents'], ['salary', 'Salary'], ['attendance', 'Attendance'], ['leave', 'Leave'], ['history', 'History']] as const

export default async function EmployeePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params; const sp = await flat(searchParams); const c = await getCtx()
  const { data: e } = await c.supabase.from('employees').select('*').eq('id', id).maybeSingle()
  if (!e) notFound()
  const canSens = c.can('employees.view_sensitive'), canSalary = c.can('salary.view'), canEdit = c.can('records.edit') && canSens
  const tabs = TABS.filter(([k]) => (k === 'salary' ? canSalary : k === 'leave' || k === 'history' || k === 'attendance' ? canSens : true))
  const tab = tabs.some(([k]) => k === sp.tab) ? sp.tab! : 'personal'
  const isSelf = e.user_id === c.userId

  const [{ data: docs }, { data: cats }, { data: people }] = await Promise.all([
    canSens || isSelf ? c.supabase.from('documents').select('id,name,reference_no,expiry_date,status,issuing_authority,current_version_id,category:document_categories(name)').eq('owner_type', 'employee').eq('owner_id', id).is('deleted_at', null).order('expiry_date', { nullsFirst: false }) : Promise.resolve({ data: [] as any[] }),
    c.supabase.from('document_categories').select('id,name,scope').eq('scope', 'employee').order('name'),
    c.supabase.from('profiles').select('id,full_name').eq('is_active', true).order('full_name'),
  ])
  // PDFs in the employee's file can be shared with the employee (free WhatsApp sharing); other file types are downloaded instead
  const verIds = canSens && c.can('documents.view') && tab === 'documents' ? (docs ?? []).map((d: any) => d.current_version_id).filter(Boolean) : []
  const pdfDocs = new Set(verIds.length ? ((await c.supabase.from('document_versions').select('document_id,mime_type').in('id', verIds)).data ?? []).filter(v => v.mime_type === 'application/pdf').map(v => v.document_id as string) : [])
  const checklist = employeeChecklist((docs ?? []).map((d: any) => ({ category_name: d.category?.name, expiry_date: d.expiry_date, status: d.status })), c.today)
  const stateTone: Record<string, Tone> = { valid: 'green', expiring_soon: 'amber', expired: 'red', missing: 'red', no_expiry: 'green', renewal_in_progress: 'blue', cancelled: 'neutral' }

  return <>
    <Link href="/employees" className="mb-1 -ms-1 inline-flex min-h-10 items-center gap-1.5 px-1 text-sm text-muted hover:text-fg sm:mb-3 sm:min-h-0"><ArrowLeft size={14} className="rtl:rotate-180" />Employees</Link>
    <div className="mb-5 flex flex-wrap items-center gap-4">
      <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-full bg-primary-soft text-primary">
        {e.photo_path ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={`/api/employees/${id}/photo?w=160`} alt="" loading="lazy" className="h-full w-full object-cover" /> : <UserRound size={28} />}</div>
      <div className="min-w-0"><h1 className="text-[22px] font-semibold leading-tight tracking-[-0.022em]">{e.full_name}</h1>
        <p className="text-sm text-muted">{[e.designation, e.department].filter(Boolean).join(' · ') || 'No designation'} · <span className="font-mono">{e.employee_no}</span></p>
        <div className="mt-1 flex gap-2"><Badge tone={e.status === 'active' ? 'green' : 'amber'}>{e.status.replace('_', ' ')}</Badge>{canSens && <Badge tone={checklist.issues ? 'red' : 'green'}>{checklist.score}% documents complete</Badge>}</div></div>
      {c.can('records.delete') && <div className="ms-auto"><ActionButton variant="ghost" size="md" action={trashRecord.bind(null, 'employee', id)} confirm={`Move ${e.full_name} to the trash? Their documents, salary history and assignments are kept and they can be restored from Trash.`}><Trash2 size={14} />Move to trash</ActionButton></div>}</div>
    <div className="tabstrip mb-5 flex gap-1 overflow-x-auto border-b border-border">
      {tabs.map(([k, label]) => <Link key={k} href={`/employees/${id}?tab=${k}`} className={cn('-mb-px border-b-2 px-4 py-2 text-sm', tab === k ? 'border-primary font-medium text-primary' : 'border-transparent text-muted hover:text-fg')}>{label}</Link>)}</div>

    {tab === 'personal' && <div className="grid gap-5 lg:grid-cols-3">
      <Card className="lg:col-span-2"><CardHeader title="Personal & employment information" />
        <div className="p-4">{canEdit ? <ActionForm action={updateEmployee.bind(null, id)} resetOnSuccess={false}><EmployeeFields d={e} /></ActionForm>
          : <dl className="grid grid-cols-2 gap-4 text-sm">{[['Nationality', e.nationality], ['Department', e.department], ['Designation', e.designation], ['Contact', e.phone], ['Joined', e.joining_date], ['Location', e.work_location]].map(([k, v]) => <div key={k as string}><dt className="text-xs text-muted">{k}</dt><dd>{v ?? '—'}</dd></div>)}</dl>}</div></Card>
      <div className="space-y-5">
        {canSens && <Card><CardHeader title="Emergency contact" /><div className="p-4 text-sm">{e.emergency_contact_name ? <><div className="font-medium">{e.emergency_contact_name}</div><div className="text-muted">{e.emergency_contact_phone}</div></> : <span className="text-muted">Not recorded</span>}</div></Card>}
        {canSens && <Card><CardHeader title="Accommodation" /><div className="p-4 text-sm">{e.accommodation ?? <span className="text-muted">Not recorded</span>}</div></Card>}
        {c.can('users.manage') && canSens && <PortalAccess id={id} c={c} e={e} />}
        {canEdit && <Card><CardHeader title="Photograph" /><div className="p-4"><ActionForm action={uploadPhoto.bind(null, id)} submit="Upload photo"><input type="file" name="photo" aria-label="Employee photo" accept=".jpg,.jpeg,.png,.webp" className="text-sm" required /></ActionForm></div></Card>}
      </div></div>}

    {tab === 'documents' && <div className="grid gap-5 lg:grid-cols-3">
      <Card className="lg:col-span-2"><CardHeader title="Documents" action={c.can('documents.upload') && canSens ? <DialogButton size="sm" wide label="Add" icon={<Plus size={14} />} title={`Add document for ${e.full_name}`}>
        <ActionForm action={createDocument} submit="Save document"><input type="hidden" name="owner_type" value="employee" /><input type="hidden" name="owner_id" value={id} />
          <DocFields categories={cats ?? []} people={people ?? []} fileRequired /></ActionForm></DialogButton> : undefined} />
        {!docs?.length ? <EmptyState title="No documents on file" body="Add the passport, Emirates ID, residence visa, work permit, labour contract and medical insurance." /> :
          <TableWrap><thead className="border-b border-border"><tr><Th>Document</Th><Th>Number</Th><Th>Expiry</Th><Th>Status</Th>{(canEdit || pdfDocs.size > 0) && <Th><span className="sr-only">Share or remind</span></Th>}</tr></thead>
            <tbody className="divide-y divide-border">{docs.map((d: any) => <tr key={d.id} className="hover:bg-surface-2/50"><Td><Link className="font-medium hover:text-primary" href={`/documents/${d.id}`}>{d.category?.name ?? d.name}</Link><div className="text-xs text-muted">{d.name}</div></Td>
              <Td className="font-mono text-xs text-muted">{d.reference_no ?? '—'}</Td><Td className="tabular-nums">{showDate(d.expiry_date, '—')}</Td><Td><StatusBadge doc={d} today={c.today} /></Td>{(canEdit || pdfDocs.size > 0) && <Td className="text-right"><div className="flex justify-end gap-1">{pdfDocs.has(d.id) && <ShareSheet kind="employee_document" recordId={d.id} variant="ghost" iconOnly label={`Share ${d.category?.name ?? d.name} with ${e.full_name} via WhatsApp`} />}{canEdit && d.expiry_date && <WhatsAppSend kind="document_expiry" recordId={d.id} label="Remind" ariaLabel={`Send ${d.category?.name ?? d.name} expiry reminder via WhatsApp`} variant="ghost" />}</div></Td>}</tr>)}</tbody></TableWrap>}</Card>
      <Card><CardHeader title="Compliance checklist" sub={`${checklist.score}% complete`} />
        <ul className="divide-y divide-border">{checklist.items.map(i => <li key={i.name} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
          <span className="flex items-center gap-2">{i.state === 'missing' || i.state === 'expired' ? <AlertTriangle size={15} className="text-danger" /> : i.state === 'expiring_soon' ? <CircleDashed size={15} className="text-warning" /> : <CheckCircle2 size={15} className="text-success" />}{i.name}</span>
          <Badge tone={stateTone[i.state]}>{i.state === 'missing' ? 'Missing' : i.state.replace(/_/g, ' ')}</Badge></li>)}</ul></Card></div>}

    {tab === 'personal' && <div className="mt-5 grid gap-5 xl:grid-cols-2 [&>*]:min-w-0"><CustomFieldsCard c={c} entity="employee" recordId={id} /><RecordTasks c={c} type="employee" id={id} /></div>}
    {tab === 'history' && canSens && <RecordActivity c={c} table="employees" id={id} className="mb-5" />}
    {tab === 'history' && (canSens || canSalary) && <div className="mb-5"><WhatsAppHistory c={c} partyType="employee" partyId={id} /></div>}
    {tab === 'documents' && canEdit && <div className="mt-5"><ShareLinks c={c} kind="document_request" target="employee" targetId={id} title="Request documents" recipient={e.full_name} sub="Send a secure upload link (WhatsApp or email) for passport, visa, Emirates ID and similar. Files arrive in Smart Inbox for review." shareText={`${c.company.name}: please upload your documents`} /></div>}
    {tab === 'salary' && canSalary && <SalaryTab id={id} c={c} />}
    {tab === 'leave' && canSens && <LeaveTab id={id} c={c} />}
    {tab === 'attendance' && canSens && <AttendanceTab id={id} c={c} m={sp.m} />}
    {tab === 'history' && canSens && <HistoryTab id={id} c={c} e={e} />}
  </>
}

async function SalaryTab({ id, c }: { id: string; c: Awaited<ReturnType<typeof getCtx>> }) {
  const [a, wa] = await Promise.all([salaryAccount(c, id), companyWhatsApp(c.company.id)])
  if (!a) return null
  const cloud = wa.live && c.can('records.edit')   // WhatsApp Business (paid API) only when connected
  const month = c.today.slice(0, 7), split = splitOwed(a.obligations, month)
  const cur = a.obligations.find(o => o.kind === 'accrual' && o.period === `${month}-01`)
  const target = { id, name: a.emp.full_name, no: a.emp.employee_no, monthly: a.monthly, outstanding: a.account.outstanding, previous: split.previous, currentDue: split.current, current: cur ? cur.amount : null,
    open: a.obligations.filter(o => o.remaining > 0).map(({ id, kind, period, entry_date, remaining, reason }) => ({ id, kind, period, entry_date, remaining, reason })) }
  const advLeft = sum(a.advances.filter(x => x.kind === 'advance').map(x => x.remaining))
  return <div className="grid gap-5 lg:grid-cols-3">
    <Card data-salary-summary className="lg:col-span-2"><CardHeader title="Salary account" sub="One balance: opening balance and every salary month, less every payment. Payments settle the oldest month first." action={<CardLink href={`/salary/${id}`}>Open salary account</CardLink>} />
      <div className="grid gap-4 px-5 pb-5 sm:grid-cols-3">
        <div><div className="text-[12.5px] text-muted">Still owed</div><div className="text-[26px] font-semibold tracking-[-0.02em]"><Money value={a.account.outstanding} /></div></div>
        <div><div className="text-[12.5px] text-muted">Earlier months</div><div className="text-[17px] font-semibold"><Money value={split.previous} /></div><div className="text-xs text-muted">{cur ? <>This month <Money value={split.current} /> left</> : 'This month not posted'}</div></div>
        <div><div className="text-[12.5px] text-muted">Advances to repay</div><div className="text-[17px] font-semibold"><Money value={advLeft} /></div><div className="text-xs text-muted">Kept apart from salary</div></div>
        <div className="flex flex-wrap gap-2 sm:col-span-3"><QuickPay emp={target} today={c.today} /><LinkButton variant="secondary" href={`/salary/${id}#statement`}><FileText size={15} aria-hidden />Statement</LinkButton><LinkButton variant="ghost" href={`/salary/${id}`}>Advances, adjustments, history</LinkButton></div>
      </div></Card>
    <Card><CardHeader title="Monthly salary" /><div className="px-5 pb-5"><div className="mb-3 text-2xl font-semibold tabular-nums">{a.monthly !== null ? formatAed(a.monthly) : 'Not set'}</div>
      <ActionForm action={setSalary.bind(null, id)} submit="Update" resetOnSuccess={false}><Field label="Monthly salary (AED)"><Input name="monthly_salary" type="number" step="0.01" min="0" defaultValue={a.monthly ?? undefined} required /></Field></ActionForm>
      <p className="mt-3 text-xs text-muted">A new amount applies to months posted from now on. Months already posted keep their amount.</p></div></Card>
    <Card className="lg:col-span-3"><CardHeader title="Recent payments" action={<CardLink href={`/salary/${id}`} />} />
      {!a.payments.length ? <EmptyState compact title="No payments recorded" /> : <TableWrap><thead className="border-b border-border"><tr><Th>Paid on</Th><Th>Amount</Th><Th>Method</Th><Th>Status</Th><Th><span className="sr-only">Receipt</span></Th></tr></thead><tbody className="divide-y divide-border">
        {a.payments.slice(0, 6).map(p => <tr key={p.id}><Td>{showDate(p.paid_on ?? p.period)}</Td><Td className="tabular-nums">{formatAed(p.amount)}</Td><Td className="text-muted">{methodLabel(p.method)}</Td><Td><Badge tone={p.status === 'posted' ? 'green' : 'neutral'}>{p.status === 'posted' ? 'Posted' : 'Reversed'}</Badge></Td>
          <Td className="text-right"><div className="flex justify-end gap-1"><LinkButton href={`/api/payslips/${p.id}`} variant="ghost" size="sm"><Download size={14} aria-hidden />Receipt<span className="sr-only"> {showDate(p.paid_on ?? p.period)}</span></LinkButton>{p.status === 'posted' && <ShareSheet kind="salary_receipt" recordId={p.id} variant="ghost" iconOnly label={`Share the ${showDate(p.paid_on ?? p.period)} salary receipt via WhatsApp`} />}{p.status === 'posted' && cloud && <WhatsAppSend kind="payslip" recordId={p.id} label="Business" ariaLabel={`Send the ${showDate(p.paid_on ?? p.period)} salary receipt with WhatsApp Business`} variant="ghost" />}</div></Td></tr>)}</tbody></TableWrap>}</Card>
  </div>
}

async function LeaveTab({ id, c }: { id: string; c: Awaited<ReturnType<typeof getCtx>> }) {
  const { data: leave } = await c.supabase.from('leave_records').select('*').eq('employee_id', id).order('start_date', { ascending: false })
  return <Card><CardHeader title="Leave records" action={c.can('records.edit') ? <DialogButton size="sm" label="Add leave" icon={<Plus size={14} />} title="Record leave">
    <ActionForm action={addLeave.bind(null, id)}><Field label="Type"><Select name="leave_type"><option value="annual">Annual</option><option value="sick">Sick</option><option value="unpaid">Unpaid</option><option value="emergency">Emergency</option><option value="other">Other</option></Select></Field>
      <div className="grid gap-4 sm:grid-cols-2"><Field label="From *"><Input type="date" name="start_date" required /></Field><Field label="To *"><Input type="date" name="end_date" required /></Field></div><Field label="Notes"><Textarea name="notes" /></Field></ActionForm></DialogButton> : undefined} />
    {!leave?.length ? <EmptyState title="No leave recorded" /> : <TableWrap><thead className="border-b border-border"><tr><Th>Type</Th><Th>From</Th><Th>To</Th><Th>Days</Th><Th>Notes</Th></tr></thead><tbody className="divide-y divide-border">
      {leave.map(l => <tr key={l.id}><Td className="capitalize">{l.leave_type}</Td><Td>{showDate(l.start_date)}</Td><Td>{showDate(l.end_date)}</Td><Td>{daysBetween(l.start_date, l.end_date) + 1}</Td><Td className="text-muted">{l.notes ?? '—'}</Td></tr>)}</tbody></TableWrap>}</Card>
}

async function HistoryTab({ id, c, e }: { id: string; c: Awaited<ReturnType<typeof getCtx>>; e: any }) {
  const { data: logs } = c.can('audit.view') ? await c.supabase.from('audit_logs').select('id,action,table_name,created_at').eq('record_id', id).order('created_at', { ascending: false }).limit(30) : { data: [] as any[] }
  const events = await documentTimeline(c, { type: 'employee', id })
  return <div className="grid gap-5 lg:grid-cols-2"><Card><CardHeader title="Document timeline" sub="Uploads, versions, renewals and reminders. Previous documents stay in history" /><div className="p-4"><Timeline events={events} /></div></Card><Card><CardHeader title="Employment history" />
    <ul className="divide-y divide-border text-sm"><li className="px-4 py-3">Joined <b>{e.joining_date ?? 'unknown date'}</b> · current status <b>{e.status.replace('_', ' ')}</b></li>
      <li className="px-4 py-3 text-muted">Record created {localDate(e.created_at, c.company.timezone)}</li>
      {c.can('audit.view') && (logs ?? []).map((l: any) => <li key={l.id} className="flex justify-between px-4 py-2.5"><span><b className="capitalize">{l.action.toLowerCase()}</b> {l.table_name.replace('_', ' ')}</span><span className="text-xs text-muted">{l.created_at.slice(0, 16).replace('T', ' ')}</span></li>)}</ul></Card></div>
}

/** Employee Portal login: who signs in as this employee (sees only their own records), invite or link one, or remove it. */
async function PortalAccess({ id, c, e }: { id: string; c: Awaited<ReturnType<typeof getCtx>>; e: any }) {
  const [{ data: login }, { data: users }, { data: linked }] = await Promise.all([
    e.user_id ? c.supabase.from('profiles').select('id,full_name,role,is_active').eq('id', e.user_id).maybeSingle() : Promise.resolve({ data: null }),
    e.user_id ? Promise.resolve({ data: [] as any[] }) : c.supabase.from('profiles').select('id,full_name,role').eq('is_active', true).order('full_name'),
    e.user_id ? Promise.resolve({ data: [] as any[] }) : c.supabase.from('employees').select('user_id').not('user_id', 'is', null).is('deleted_at', null),
  ])
  const taken = new Set((linked ?? []).map((r: any) => r.user_id))
  const free = (users ?? []).filter((u: any) => !taken.has(u.id))
  return <Card data-portal-access><CardHeader title="Portal access" sub="Their own login to see their expenses, attendance, salary and payslips, and to send receipts. Nothing else." />
    <div className="space-y-3 p-4 pt-0 text-sm">{login ? <>
      <div className="flex items-center justify-between gap-2"><span className="min-w-0"><span className="block truncate font-medium">{login.full_name}</span><span className="text-xs text-muted">{ROLE_LABELS[login.role as Role] ?? login.role}{login.is_active ? '' : ' · switched off'}</span></span>
        <Badge tone={login.is_active ? 'green' : 'neutral'}>{login.is_active ? 'Active' : 'Off'}</Badge></div>
      {c.can('users.manage') && login.role === 'employee' && login.is_active && login.id !== c.userId && <LoginAsButton id={id} name={e.full_name} variant="secondary" />}
      <ActionButton variant="ghost" action={revokePortalAccess.bind(null, id)} confirm={`Remove ${e.full_name}'s portal access?${login.role === 'employee' ? ' Their employee login is switched off.' : ''} Their records are kept.`}>Remove access</ActionButton></>
      : <DialogButton size="sm" label="Give portal access" title={`Portal access for ${e.full_name}`}>
        <ActionForm action={grantPortalAccess.bind(null, id)} submit="Give access">
          <div className="grid gap-4">
            <Field label="How?"><Select name="mode" defaultValue="invite"><option value="invite">Invite by email (new Employee login)</option>{free.length > 0 && <option value="link">Link an existing user</option>}</Select></Field>
            <Field label="Email" hint="For an invitation: they set their own password from the email"><Input name="email" type="email" autoComplete="off" /></Field>
            {free.length > 0 && <Field label="Existing user" hint="When linking"><Select name="user_id" defaultValue=""><option value="">—</option>{free.map((u: any) => <option key={u.id} value={u.id}>{u.full_name} ({ROLE_LABELS[u.role as Role] ?? u.role})</option>)}</Select></Field>}
            <p className="text-xs text-muted">An Employee login only ever sees this person&apos;s own records. It cannot open company finance, other employees, quotations, invoices, projects or settings.</p>
          </div></ActionForm></DialogButton>}</div></Card>
}

/** Attendance by month for HR: summary, every recorded day (incl. self check-in times), and a form to record or correct a day. */
async function AttendanceTab({ id, c, m }: { id: string; c: Awaited<ReturnType<typeof getCtx>>; m?: string }) {
  const cur = c.today.slice(0, 7), month = m && /^\d{4}-\d{2}$/.test(m) && m <= cur ? m : cur
  const start = `${month}-01`, [y, mo] = month.split('-').map(Number), end = new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10)
  // `again` adds a tie-break order: Next reuses an identical GET from earlier in the same render, which would be the stale rows
  const readMonth = (again = false) => { const q = c.supabase.from('attendance_records').select('id,work_date,status,overtime_hours,notes,check_in_at,check_out_at,overtime_start_at,overtime_end_at,source').eq('employee_id', id).gte('work_date', start).lte('work_date', end).order('work_date', { ascending: false }); return again ? q.order('id') : q }
  const [settings, first] = await Promise.all([portalSettings(c), readMonth()])
  let rows = first.data
  if (leftRunning(rows ?? [], settings, c.company.timezone)) {      // a forgotten check-out / overtime is closed before it is shown
    await c.supabase.rpc('attendance_autoclose', { p_company: null })
    rows = (await readMonth(true)).data
  }
  const sum = attendanceSummary(rows ?? []), tz = c.company.timezone
  const prev = new Date(Date.UTC(y, mo - 2, 1)).toISOString().slice(0, 7), next = month < cur ? new Date(Date.UTC(y, mo, 1)).toISOString().slice(0, 7) : null
  return <Card><CardHeader title={`Attendance · ${monthName(start)}`} sub={`Present ${sum.present} · half days ${sum.half_day} · absent ${sum.absent} · leave ${sum.leave} · holidays ${sum.holiday} · overtime ${sum.overtime} h`}
    action={<div className="flex items-center gap-2"><LinkButton size="sm" variant="ghost" href={`/employees/${id}?tab=attendance&m=${prev}`}>‹ Previous</LinkButton>{next && <LinkButton size="sm" variant="ghost" href={`/employees/${id}?tab=attendance&m=${next}`}>Next ›</LinkButton>}
      <DialogButton size="sm" label="Record a day" icon={<Plus size={14} />} title="Record attendance">
        <ActionForm action={markAttendance.bind(null, id)} submit="Save"><div className="grid gap-4 sm:grid-cols-2">
          <Field label="Day *"><Input type="date" name="work_date" required max={c.today} defaultValue={c.today} /></Field>
          <Field label="Status *"><Select name="status" defaultValue="present">{Object.entries(ATTENDANCE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select></Field>
          <Field label="Overtime (hours)"><Input type="number" name="overtime_hours" min="0" max="24" step="0.5" defaultValue="0" /></Field>
          <Field label="Notes"><Input name="notes" maxLength={500} /></Field></div>
          <p className="mt-3 text-xs text-muted">Saving a day that is already recorded corrects it. The employee sees it in their portal; they cannot change it.</p></ActionForm></DialogButton></div>} />
    {!rows?.length ? <EmptyState title="No attendance recorded this month" /> : <TableWrap><thead className="border-b border-border"><tr><Th>Day</Th><Th>Status</Th><Th>In</Th><Th>Out</Th><Th>Overtime</Th><Th>Notes</Th></tr></thead>
      <tbody className="divide-y divide-border">{rows.map(r => <tr key={r.id}><Td className="tabular-nums">{showDate(r.work_date)}</Td><Td><Badge tone={ATTENDANCE[r.status]?.tone}>{ATTENDANCE[r.status]?.label ?? r.status}</Badge>{r.source === 'self' && <span className="ms-2 text-xs text-muted">self check-in</span>}</Td>
        <Td className="tabular-nums">{clock(r.check_in_at, tz) ?? '—'}</Td><Td className="tabular-nums">{clock(r.check_out_at, tz) ?? '—'}</Td><Td className="tabular-nums">{Number(r.overtime_hours) ? `${Number(r.overtime_hours)} h` : '—'}{r.overtime_start_at && <span className="block text-xs text-muted">{clock(r.overtime_start_at, tz)}–{r.overtime_end_at ? clock(r.overtime_end_at, tz) : 'running'}</span>}</Td><Td className="text-muted">{r.notes ?? ''}</Td></tr>)}</tbody></TableWrap>}
  </Card>
}
