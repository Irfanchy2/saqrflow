import { WhatsAppSend } from '@/components/whatsapp/send'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { AlertTriangle, ArrowLeft, CalendarCheck, ClipboardCheck, ClipboardList, ListTodo, Camera, CheckCircle2, Circle, Clock, FileText, MapPin, Paperclip, Pencil, Plus, Receipt, Trash2, Upload, UserPlus, Users, Wallet } from 'lucide-react'
import { getCtx } from '@/lib/auth'
import { Badge, Card, CardHeader, EmptyState, Field, Input, Select, Metrics, StatCard, Td, Th, TableWrap } from '@/components/ui/primitives'
import { DialogButton } from '@/components/ui/dialog'
import { ActionButton, ActionForm } from '@/components/ui/action-form'
import { ProjectFields, Progress } from '@/components/projects/project-fields'
import { SiteReportFields, TaskFields, WorkOrderFields } from '@/components/crm/fields'
import { createSiteReport, createTask, createWorkOrder, saveProjectBudget, setTaskStatus, updateProjectProgress } from '@/app/actions/operations'
import { TASK_STATUS, WO_STATUS, costControl, isOverdue, projectProgress, tasksCompletion } from '@/lib/crm'
import { ExpenseFields } from '@/components/expenses/expense-fields'
import { NewSalesButtons } from '@/components/sales/new-buttons'
import { addMilestone, deleteExpense, deleteMilestone, removeProjectMember, saveExpense, setProjectMember, toggleMilestone, updateProject, uploadProjectFiles, uploadProjectPhotos } from '@/app/actions/projects'
import { trashRecord } from '@/app/actions/trash'
import { EXPENSE_CATS, PHOTO_CATS, PROJECT_STATUS, projectFinancials } from '@/lib/projects'
import { DOC_META, STATUS_TONE, statusLabel, type SalesType } from '@/lib/sales/docs'
import { fmtMoney } from '@/lib/sales/money'
import { formatAed, formatShortDate, localDate } from '@/lib/time'
import { ACCEPT_ATTR } from '@/lib/files'
import { cn } from '@/lib/utils'
import { flat } from '@/lib/queries'
import { RecordActivity } from '@/components/record-activity'
import { CustomFieldsCard } from '@/components/custom-fields-card'
import { QrCode } from 'lucide-react'

export const metadata = { title: 'Project' }

export default async function ProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const c = await getCtx(); if (!c.can('documents.view')) redirect('/')
  const sp = await flat(searchParams)
  const { data: p } = await c.supabase.from('projects').select('*, customer:customers(id,name)').eq('id', id).maybeSingle()
  if (!p) notFound()
  const fin = c.can('finance.view'), edit = c.can('records.edit'), del = c.can('records.delete')
  const [{ data: ms }, { data: exps }, { data: sales }, { data: owned }, { data: rel }, { data: customers }, { data: team }, { data: employees }] = await Promise.all([
    c.supabase.from('project_milestones').select('*').eq('project_id', id).order('due_date'),
    fin ? c.supabase.from('project_expenses').select('*, employee:employees(full_name)').eq('project_id', id).order('spent_on', { ascending: false }).limit(500) : Promise.resolve({ data: [] as any[] }),
    fin ? c.supabase.from('invoices').select('id,doc_type,number,status,total,vat_amount,issue_date,created_at').eq('project_id', id).order('issue_date', { ascending: false }) : Promise.resolve({ data: [] as any[] }),
    c.supabase.from('documents').select('id,name,folder,notes,issue_date,created_at,version:document_versions!documents_current_version_fk(mime_type)').eq('owner_type', 'project').eq('owner_id', id).is('deleted_at', null).order('created_at', { ascending: false }).limit(300),
    c.supabase.from('document_relationships').select('role,document:documents(id,name,folder,created_at,deleted_at)').eq('related_type', 'project').eq('related_id', id).limit(200),
    edit ? c.supabase.from('customers').select('id,name').order('name').limit(2000) : Promise.resolve({ data: [] as any[] }),
    c.supabase.from('project_members').select('employee_id,role,assigned_on,employee:employees(id,full_name,designation)').eq('project_id', id),
    edit ? c.supabase.from('employees').select('id,full_name').neq('status', 'archived').order('full_name').limit(1000) : Promise.resolve({ data: [] as any[] }),
  ])
  const [{ data: wos }, { data: ptasks }, { data: dsrs }, { data: budgets }, { data: users }, { data: woCrew }] = await Promise.all([
    c.supabase.from('work_orders').select('id,number,title,status,target_date,tasks(status,completion)').eq('project_id', id).order('created_at', { ascending: false }).limit(100),
    c.supabase.from('tasks').select('id,title,status,due_date,owner_id,work_order_id').eq('project_id', id).in('status', ['todo', 'in_progress', 'waiting']).order('due_date', { nullsFirst: false }).limit(100),
    c.supabase.from('daily_site_reports').select('id,number,report_date,progress,work_done,issues,delays').eq('project_id', id).order('report_date', { ascending: false }).limit(10),
    fin ? c.supabase.from('project_budgets').select('category,amount').eq('project_id', id) : Promise.resolve({ data: [] as any[] }),
    edit ? c.supabase.from('profiles').select('id,full_name').eq('is_active', true).order('full_name') : Promise.resolve({ data: [] as any[] }),
    c.supabase.from('work_order_members').select('employee_id,employee:employees(full_name),work_order:work_orders!inner(project_id,status)').eq('work_order.project_id', id).not('work_order.status', 'in', '(completed,cancelled)'),
  ])
  const invIds = (sales ?? []).filter((s: any) => s.doc_type === 'invoice').map((s: any) => s.id)
  const [{ data: bals }, { data: pays }] = invIds.length ? await Promise.all([
    c.supabase.from('invoice_balances').select('id,paid').in('id', invIds),
    c.supabase.from('payments').select('id,amount,paid_on,method,reference,created_at,invoice:invoices(id,number)').in('invoice_id', invIds).order('paid_on', { ascending: false }).limit(100),
  ]) : [{ data: [] as any[] }, { data: [] as any[] }]
  const paid = new Map((bals ?? []).map((b: any) => [b.id, Number(b.paid)]))
  const f = projectFinancials(p.contract_value, (sales ?? []).map((s: any) => ({ ...s, paid: paid.get(s.id) ?? 0 })), exps ?? [])
  const photos = (owned ?? []).filter((d: any) => String(d.version?.mime_type ?? '').startsWith('image/') && /\/Photos\//.test(d.folder ?? ''))
  const photoCat = (d: any) => (Object.entries(PHOTO_CATS).find(([, l]) => (d.folder ?? '').endsWith(`/Photos/${l}`))?.[0] ?? 'progress')
  const shownPhotos = sp.photos && sp.photos in PHOTO_CATS ? photos.filter(d => photoCat(d) === sp.photos) : photos
  const files = new Map<string, any>()
  for (const d of owned ?? []) if (!photos.includes(d)) files.set(d.id, d)
  for (const r of rel ?? []) { const d: any = r.document; if (d && !d.deleted_at && !files.has(d.id) && !photos.some(x => x.id === d.id) && !String(r.role).startsWith('photo')) files.set(d.id, { ...d, role: r.role }) }
  const prog = projectProgress(p, f.billedPct)
  const cc = costControl({ contract: f.value, budgets: budgets ?? [], byCategory: f.byCategory, started: p.status !== 'planning' })
  const userOpts = (users ?? []).map((u: any) => ({ id: u.id, name: u.full_name }))
  // the project team plus the crews of its open work orders are pre-ticked on a new daily report
  const onSite = [...new Map([...(team ?? []), ...(woCrew ?? [])].map((m: any) => [m.employee_id, { id: m.employee_id as string, name: (m.employee?.full_name ?? '') as string }])).values()]
  const st = PROJECT_STATUS[p.status]
  const open = (ms ?? []).filter((m: any) => !m.done)
  const emps = (employees ?? []).map((e: any) => ({ id: e.id, name: e.full_name }))
  const materials = (exps ?? []).filter((e: any) => e.category === 'material')
  // timeline: quotation → PO → delivery → invoice → payment, plus photos and expenses
  const when = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { timeZone: c.company.timezone, day: '2-digit', month: 'short', year: 'numeric' })
  const ev = [
    { at: p.created_at, text: 'Project created', icon: Clock },
    ...(sales ?? []).map((s: any) => ({ at: s.created_at, text: `${DOC_META[s.doc_type as SalesType]?.label ?? s.doc_type} ${s.number} (${statusLabel(s.doc_type, s.status).toLowerCase()})`, icon: Receipt, href: `/invoices/${s.id}` })),
    ...(pays ?? []).map((x: any) => ({ at: x.created_at, text: `Payment AED ${fmtMoney(x.amount)}: ${x.invoice?.number ?? ''}`, icon: Wallet, href: x.invoice ? `/invoices/${x.invoice.id}` : undefined })),
    ...[...files.values()].map((d: any) => ({ at: d.created_at, text: `${d.role === 'lpo' || /LPO/.test(d.folder ?? '') ? 'PO / LPO' : 'File'}: ${d.name}`, icon: Paperclip, href: `/documents/${d.id}` })),
    ...(photos.length ? [{ at: photos[0].created_at, text: `${photos.length} photo${photos.length === 1 ? '' : 's'} (latest: ${PHOTO_CATS[photoCat(photos[0]) as keyof typeof PHOTO_CATS]})`, icon: Camera }] : []),
    ...(exps ?? []).slice(0, 20).map((e: any) => ({ at: e.created_at, text: `Expense ${EXPENSE_CATS[e.category] ?? e.category}: AED ${fmtMoney(e.amount)}: ${e.description}`, icon: Wallet })),
  ].sort((a: any, b: any) => b.at.localeCompare(a.at)).slice(0, 30) as { at: string; text: string; icon: typeof Clock; href?: string }[]

  return <>
    <Link href="/projects" className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg"><ArrowLeft size={14} />Projects</Link>
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold tracking-tight">{p.name}</h1><Badge tone={st.tone}>{st.label}</Badge></div>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
          {p.code && <span className="font-mono">{p.code}</span>}
          {p.customer && <Link href={`/parties/${p.customer.id}`} className="hover:text-primary hover:underline">{p.customer.name}</Link>}
          {p.location && <span className="inline-flex items-center gap-1"><MapPin size={13} aria-hidden />{p.location}</span>}
          {(p.start_date || p.expected_completion) && <span className="inline-flex items-center gap-1"><CalendarCheck size={13} aria-hidden />{p.start_date ?? '—'} → {p.expected_completion ?? '—'}</span>}
        </div>
        {p.description && <p className="mt-2 max-w-3xl whitespace-pre-line text-sm">{p.description}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        <a href={`/print/qr?type=project&ids=${p.id}`} target="_blank" rel="noopener" className="inline-flex h-11 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-sm hover:bg-surface-2 sm:h-9"><QrCode size={14} aria-hidden />QR label</a>
        {edit && p.customer_id && <WhatsAppSend kind="project_update" recordId={p.id} label="Send update" size="md" />}
        {edit && <DialogButton wide variant="secondary" label="Edit" title="Edit project" icon={<Pencil size={14} />}><ActionForm action={updateProject.bind(null, id)} resetOnSuccess={false}><ProjectFields customers={customers ?? []} p={p} /></ActionForm></DialogButton>}
        {edit && fin && <NewSalesButtons projectId={id} customerId={p.customer_id ?? undefined} />}
        {del && <ActionButton variant="ghost" size="md" action={trashRecord.bind(null, 'project', id)} confirm={`Move project “${p.name}” to the trash? Its documents, invoices and costs are kept and it can be restored.`}><Trash2 size={14} />Delete</ActionButton>}
      </div>
    </div>

    {fin && <>
      <Metrics className="mb-3" cols={4}>
        <StatCard label={f.contract ? 'Contract value' : f.quoted ? 'Accepted quotation (ex VAT)' : 'Contract value'} value={formatAed(f.value)} hint={!f.contract && !f.quoted ? 'Add a contract value' : undefined} />
        <StatCard label="Invoiced (ex VAT)" value={formatAed(f.invoicedNet)} hint={f.billedPct !== null ? `${f.billedPct}% of contract` : undefined} icon={Receipt} tone="blue" />
        <StatCard label="Payments received" value={formatAed(f.received)} hint={f.collectedPct !== null ? `${f.collectedPct}% collected` : undefined} icon={Wallet} tone="green" />
        <StatCard label="Outstanding" value={formatAed(f.outstanding)} tone={f.outstanding ? 'amber' : 'neutral'} />
        <StatCard label="Recorded costs" value={formatAed(f.expenses)} hint="excl. VAT" />
        <StatCard label="Estimated profit" value={formatAed(f.profit)} hint={f.margin !== null ? `${f.margin}% margin on contract` : undefined} tone={f.profit < 0 ? 'red' : 'green'} />
        <StatCard label="Actual profit" value={formatAed(f.actualProfit)} hint={f.actualMargin !== null ? `${f.actualMargin}% of invoiced` : 'Nothing invoiced yet'} tone={f.actualProfit < 0 ? 'red' : 'neutral'} />
        <StatCard label="Labour cost" value={formatAed(f.byCategory.labour ?? 0)} hint="from recorded labour expenses" />
      </Metrics>
      <p className="mb-5 text-xs text-muted">Profit uses only recorded figures: revenue excludes VAT; costs are the expenses entered for this project ({Object.entries(f.byCategory).map(([k, v]) => `${EXPENSE_CATS[k] ?? k} ${formatAed(v)}`).join(' · ') || 'none yet'}).</p>
    </>}

    <div className="grid gap-5 xl:grid-cols-3 [&>*]:min-w-0">
      <Card className="xl:col-span-1"><CardHeader title="Progress" sub={prog.derived ? 'Overall = 45% fabrication + 45% installation + 10% inspection' : 'Overall set by the project manager'} />
        <div className="space-y-4 p-4">
          <Progress label="Overall" value={prog.overall} />
          <Progress label="Fabrication (workshop)" value={prog.fabrication} />
          <Progress label="Site installation" value={prog.installation} tone="bg-success" />
          <Progress label="Inspection & handover" value={prog.inspection} tone="bg-success" />
          {fin && (prog.commercial == null ? <p className="text-xs text-muted">Commercial progress: add a contract value to measure invoicing against it.</p> : <Progress label="Commercial (invoiced of contract)" value={prog.commercial} tone="bg-warning" />)}
          {edit && <DialogButton size="sm" variant="secondary" label="Update progress" title="Update progress"><ActionForm action={updateProjectProgress.bind(null, id)} resetOnSuccess={false} submit="Save progress">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Fabrication %"><Input name="fabrication_progress" type="number" min={0} max={100} step={5} defaultValue={p.fabrication_progress} /></Field>
              <Field label="Installation %"><Input name="site_progress" type="number" min={0} max={100} step={5} defaultValue={p.site_progress} /></Field>
              <Field label="Inspection %"><Input name="inspection_progress" type="number" min={0} max={100} step={5} defaultValue={p.inspection_progress ?? 0} /></Field>
              <Field label="Overall %" hint="Blank = calculated"><Input name="overall_progress" type="number" min={0} max={100} step={5} defaultValue={p.overall_progress ?? ''} /></Field>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="complete" />Mark project completed when fabrication and installation reach 100%</label>
          </ActionForm></DialogButton>}
        </div></Card>

      <Card className="xl:col-span-2"><CardHeader title="Milestones" sub={open.length ? `${open.length} open · reminders are sent automatically` : 'Key dates for this job'}
        action={edit ? <DialogButton size="sm" label="Add" title="Add milestone" icon={<Plus size={14} />}><ActionForm action={addMilestone.bind(null, id)} submit="Add milestone">
          <Field label="Milestone *"><Input name="title" required maxLength={200} placeholder="e.g. Shop drawings approval, Delivery to site, Handover" /></Field>
          <Field label="Due date *"><Input name="due_date" type="date" required defaultValue={c.today} /></Field></ActionForm></DialogButton> : null} />
        {!(ms ?? []).length ? <p className="px-4 py-6 text-sm text-muted">No milestones yet.</p> :
          <ul className="divide-y divide-border">{(ms ?? []).map((m: any) => { const late = !m.done && m.due_date < c.today
            return <li key={m.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              {edit ? <ActionButton variant="ghost" action={toggleMilestone.bind(null, m.id, !m.done)}>{m.done ? <CheckCircle2 size={17} className="text-success" /> : <Circle size={17} />}<span className="sr-only">{m.done ? 'Mark not done' : 'Mark done'}</span></ActionButton>
                : m.done ? <CheckCircle2 size={17} className="text-success" /> : <Circle size={17} className="text-muted" />}
              <span className={cn('flex-1', m.done && 'text-muted line-through')}>{m.title}</span>
              <span className={cn('tabular-nums text-xs', late ? 'font-medium text-danger' : 'text-muted')}>{m.due_date}{late ? ' · overdue' : ''}</span>
              {del && <ActionButton variant="ghost" action={deleteMilestone.bind(null, m.id)} confirm="Delete this milestone?"><Trash2 size={13} /><span className="sr-only">Delete</span></ActionButton>}
            </li> })}</ul>}
      </Card>

      {fin && <Card className="xl:col-span-2"><CardHeader title="Quotations, invoices, delivery notes & credit notes" />
        {!(sales ?? []).length ? <EmptyState icon={Receipt} title="No sales documents yet" body="Create a quotation for this project. Customer and site are filled in for you." action={edit ? <NewSalesButtons projectId={id} customerId={p.customer_id ?? undefined} only={['quotation']} /> : undefined} />
          : <TableWrap><thead className="bg-surface-2/50"><tr><Th>No.</Th><Th>Type</Th><Th>Date</Th><Th className="text-right">Total</Th><Th className="text-right">Paid</Th><Th>Status</Th></tr></thead>
            <tbody className="divide-y divide-border">{(sales ?? []).map((s: any) => <tr key={s.id} className="hover:bg-surface-2/50">
              <Td><Link href={`/invoices/${s.id}`} className="font-mono text-[13px] text-primary hover:underline">{s.number}</Link></Td><Td>{DOC_META[s.doc_type as SalesType]?.label}</Td><Td className="tabular-nums">{s.issue_date}</Td>
              <Td className="text-right tabular-nums">{DOC_META[s.doc_type as SalesType]?.priced ? fmtMoney(s.total) : '—'}</Td><Td className="text-right tabular-nums">{s.doc_type === 'invoice' ? fmtMoney(paid.get(s.id) ?? 0) : '—'}</Td>
              <Td><Badge tone={STATUS_TONE[s.status]}>{statusLabel(s.doc_type, s.status)}</Badge></Td></tr>)}</tbody></TableWrap>}
      </Card>}

      {fin && <Card><CardHeader title="Payments" />
        {!(pays ?? []).length ? <p className="px-4 py-5 text-sm text-muted">No payments against this project’s invoices yet.</p>
          : <ul className="max-h-80 divide-y divide-border overflow-y-auto text-sm">{(pays ?? []).map((x: any) => <li key={x.id} className="flex items-center gap-3 px-4 py-2.5"><span className="tabular-nums text-xs text-muted">{x.paid_on}</span><span className="min-w-0 flex-1 truncate">{x.invoice?.number}{x.reference ? ` · ${x.reference}` : ''}</span><span className="font-medium tabular-nums text-success">{fmtMoney(x.amount)}</span></li>)}</ul>}</Card>}

      {fin && <Card className="xl:col-span-3"><CardHeader title="Cost control" sub="Estimated cost per category vs costs recorded on this project. Nothing is estimated for you"
        action={edit ? <DialogButton wide size="sm" variant="secondary" label="Set estimate" title="Estimated cost (budget)"><ActionForm action={saveProjectBudget.bind(null, id)} resetOnSuccess={false} submit="Save estimate">
          <p className="text-sm text-muted">Enter the costing you priced the job with. Leave a category blank if it does not apply.</p>
          <div className="grid gap-3 sm:grid-cols-2">{Object.entries(EXPENSE_CATS).map(([k, l]) => <Field key={k} label={`${l} (AED)`}><Input name={`budget_${k}`} type="number" min={0} step="0.01" inputMode="decimal" defaultValue={(budgets ?? []).find((b: any) => b.category === k)?.amount ?? ''} /></Field>)}</div>
        </ActionForm></DialogButton> : null} />
        {!cc.complete && <div className="flex gap-2 border-b border-border bg-warning/5 px-4 py-2.5 text-sm"><AlertTriangle size={15} className="mt-0.5 shrink-0 text-warning" aria-hidden /><div><span className="font-medium">Cost data incomplete.</span> <span className="text-muted">Missing: {cc.missing.join(', ')}. Profit figures below use only what is recorded.</span></div></div>}
        <Metrics className="m-4" cols={5}>
          <StatCard label="Estimated cost" value={cc.estimated ? formatAed(cc.estimated) : 'Not set'} />
          <StatCard label="Actual cost to date" value={formatAed(cc.actual)} hint={cc.usedPct != null ? `${cc.usedPct}% of estimate` : undefined} tone={cc.usedPct != null && cc.usedPct > 100 ? 'red' : 'neutral'} />
          <StatCard label="Remaining budget" value={cc.remaining == null ? 'No estimate' : formatAed(cc.remaining)} tone={cc.remaining != null && cc.remaining < 0 ? 'red' : 'neutral'} />
          <StatCard label="Estimated profit" value={cc.estimatedProfit == null ? 'Needs contract and estimate' : formatAed(cc.estimatedProfit)} hint="Contract − estimated cost" />
          <StatCard label="Forecast profit" value={cc.forecastProfit == null ? 'Needs contract value' : formatAed(cc.forecastProfit)} hint="Contract − higher of estimate or actual" tone={cc.forecastProfit != null && cc.forecastProfit < 0 ? 'red' : 'neutral'} />
        </Metrics>
        {cc.lines.length > 0 && <TableWrap><thead><tr><Th>Category</Th><Th className="text-right">Estimated</Th><Th className="text-right">Actual</Th><Th className="text-right">Variance</Th><Th>Used</Th></tr></thead>
          <tbody className="divide-y divide-border">{cc.lines.map(l => <tr key={l.category}>
            <Td>{EXPENSE_CATS[l.category] ?? l.category}</Td><Td className="text-right tabular-nums">{l.budget == null ? <span className="text-muted/60">Not set</span> : fmtMoney(l.budget)}</Td>
            <Td className="text-right tabular-nums">{fmtMoney(l.actual)}</Td>
            <Td className={cn('text-right tabular-nums', l.variance != null && l.variance < 0 && 'font-medium text-danger')}>{l.variance == null ? '—' : fmtMoney(l.variance)}</Td>
            <Td>{l.usedPct == null ? <span className="text-xs text-muted/60">—</span> : <div className="flex items-center gap-2"><div className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-2" aria-hidden><div className={cn('h-full', l.usedPct > 100 ? 'bg-danger' : 'bg-primary')} style={{ width: `${Math.min(100, l.usedPct)}%` }} /></div><span className="text-xs tabular-nums">{l.usedPct}%</span></div>}</Td></tr>)}</tbody></TableWrap>}
      </Card>}

      <Card className="xl:col-span-2"><CardHeader title="Work orders" sub="Job cards for workshop and site"
        action={edit ? <DialogButton wide size="sm" label="New" title="New work order" icon={<Plus size={14} />}><ActionForm action={createWorkOrder} submit="Create work order" idempotent>
          <WorkOrderFields customers={(customers ?? []).map((x: any) => ({ id: x.id, name: x.name }))} projects={[]} users={userOpts} fixedProject={id} w={{ start_date: c.today, customer_id: p.customer_id, site_location: p.location }} /></ActionForm></DialogButton> : null} />
        {!(wos ?? []).length ? <p className="px-4 py-5 text-sm text-muted">No work orders. Create one here or from the accepted quotation.</p>
          : <ul className="divide-y divide-border text-sm">{(wos ?? []).map((w: any) => { const pc = tasksCompletion(w.tasks ?? []); return <li key={w.id}><Link href={`/work-orders/${w.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2/60"><ClipboardList size={14} className="shrink-0 text-muted" aria-hidden />
            <span className="min-w-0 flex-1"><span className="block truncate">{w.title}</span><span className="block font-mono text-xs text-muted">{w.number}{w.target_date ? ` · target ${formatShortDate(w.target_date)}` : ''}</span></span>
            {pc != null && <span className="text-xs tabular-nums text-muted">{pc}%</span>}<Badge tone={WO_STATUS[w.status]?.tone}>{WO_STATUS[w.status]?.label}</Badge></Link></li> })}</ul>}
      </Card>

      <Card><CardHeader title="Open tasks" action={edit ? <DialogButton wide size="sm" variant="secondary" label="Add" title="Add project task" icon={<ListTodo size={14} />}><ActionForm action={createTask} submit="Add task" idempotent>
        <TaskFields users={userOpts} employees={emps} projects={[]} fixed={{ project_id: id }} t={{ due_date: c.today }} /></ActionForm></DialogButton> : null} />
        {!(ptasks ?? []).length ? <p className="px-4 py-5 text-sm text-muted">No open tasks.</p>
          : <ul className="max-h-80 divide-y divide-border overflow-y-auto text-sm">{(ptasks ?? []).map((t: any) => { const od = isOverdue(t, c.today); return <li key={t.id} className="flex items-center gap-2 px-3 py-1.5">
            <ActionButton variant="ghost" action={setTaskStatus.bind(null, t.id, 'completed')} className="h-9 w-9 px-0"><Circle size={17} /><span className="sr-only">Mark done: {t.title}</span></ActionButton>
            <Link href={`/tasks?open=${t.id}`} className="min-w-0 flex-1 truncate hover:text-primary">{t.title}</Link>
            {t.due_date && <span className={cn('text-xs tabular-nums', od ? 'font-medium text-danger' : 'text-muted')}>{formatShortDate(t.due_date)}</span>}
            <Badge tone={od ? 'red' : TASK_STATUS[t.status]?.tone}>{od ? 'Overdue' : TASK_STATUS[t.status]?.label}</Badge></li> })}</ul>}
        {(ptasks ?? []).length > 0 && <p className="border-t border-border px-4 py-2 text-xs"><Link href={`/tasks?view=open&project=${id}`} className="text-primary hover:underline">All tasks for this project →</Link></p>}
      </Card>

      <Card className="xl:col-span-3"><CardHeader title="Daily site reports" sub="Latest 10"
        action={<div className="flex gap-2">{edit && <DialogButton wide size="sm" label="New report" title="Daily site report" icon={<ClipboardCheck size={14} />}><ActionForm action={createSiteReport} submit="Save report" idempotent>
          <SiteReportFields projects={[]} fixedProject={id} workOrders={(wos ?? []).filter((w: any) => !['completed', 'cancelled'].includes(w.status)).map((w: any) => ({ id: w.id, name: `${w.number}: ${w.title}` }))}
            employees={[...onSite, ...emps.filter(e => !onSite.some(m => m.id === e.id))]} attendance={onSite.map(m => m.id)} today={c.today} r={{ site: p.location }} /></ActionForm></DialogButton>}
          {(dsrs ?? []).length > 0 && <Link href={`/site-reports?project=${id}`} className="inline-flex h-8 items-center px-2 text-sm text-primary hover:underline">All</Link>}</div>} />
        {!(dsrs ?? []).length ? <p className="px-4 py-5 text-sm text-muted">No daily reports yet.</p>
          : <ul className="divide-y divide-border text-sm">{(dsrs ?? []).map((r: any) => <li key={r.id}><Link href={`/site-reports/${r.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2/60">
            <span className="w-24 shrink-0 tabular-nums">{formatShortDate(r.report_date)}</span><span className="min-w-0 flex-1 truncate text-muted">{r.work_done}</span>
            {(r.issues || r.delays) && <Badge tone="red">{r.issues ? 'Issue' : 'Delay'}</Badge>}{r.progress != null && <span className="text-xs tabular-nums text-muted">{r.progress}%</span>}</Link></li>)}</ul>}
      </Card>

      {fin && <Card className="xl:col-span-2"><CardHeader title="Expenses" sub="Materials, labour, subcontract, transport, fuel … with receipts"
        action={edit ? <DialogButton wide size="sm" label="Add" title="Add project expense" icon={<Plus size={14} />}><ActionForm action={saveExpense.bind(null, null, id)} submit="Save expense" idempotent><ExpenseFields today={c.today} employees={emps} suppliers={[]} fixedProject /></ActionForm></DialogButton> : null} />
        {!(exps ?? []).length ? <p className="px-4 py-6 text-sm text-muted">No costs recorded.</p> :
          <TableWrap><thead className="bg-surface-2/50"><tr><Th>Date</Th><Th>Description</Th><Th>Category</Th><Th className="text-right">Amount</Th><Th /></tr></thead>
            <tbody className="divide-y divide-border">{(exps ?? []).slice(0, 50).map((e: any) => <tr key={e.id}>
              <Td className="whitespace-nowrap tabular-nums text-xs">{e.spent_on}</Td>
              <Td><div className="max-w-[300px] truncate">{e.description}</div><div className="text-xs text-muted">{[e.supplier_name, e.reference, e.employee?.full_name].filter(Boolean).join(' · ')}{e.receipt_document_id && <Link href={`/documents/${e.receipt_document_id}`} className="ms-1 text-primary hover:underline">receipt</Link>}</div></Td>
              <Td className="text-muted">{EXPENSE_CATS[e.category] ?? e.category}</Td><Td className="text-right font-medium tabular-nums">{fmtMoney(e.amount)}</Td>
              <Td className="text-right">{del && <ActionButton variant="ghost" action={deleteExpense.bind(null, e.id)} confirm="Delete this cost?"><Trash2 size={13} /><span className="sr-only">Delete</span></ActionButton>}</Td></tr>)}</tbody></TableWrap>}
        {(exps ?? []).length > 50 && <p className="border-t border-border px-4 py-2 text-xs"><Link href={`/expenses?project=${id}`} className="text-primary hover:underline">All {(exps ?? []).length} expenses →</Link></p>}
      </Card>}

      <Card><CardHeader title="Team" sub="Employees assigned to this project" action={edit ? <DialogButton size="sm" variant="secondary" label="Assign" title="Assign employee" icon={<UserPlus size={14} />}><ActionForm action={setProjectMember.bind(null, id)} submit="Assign">
        <Field label="Employee *"><Select name="employee_id" required defaultValue="">{[<option key="" value="">Choose…</option>, ...emps.map(e => <option key={e.id} value={e.id}>{e.name}</option>)]}</Select></Field>
        <Field label="Role on site"><Input name="role" maxLength={80} placeholder="e.g. Foreman, Welder, Fitter" /></Field></ActionForm></DialogButton> : null} />
        {!(team ?? []).length ? <p className="px-4 py-5 text-sm text-muted">No one assigned yet.</p> :
          <ul className="divide-y divide-border text-sm">{(team ?? []).map((m: any) => <li key={m.employee_id} className="flex items-center gap-3 px-4 py-2.5"><Users size={14} className="text-muted" aria-hidden />
            <Link href={`/employees/${m.employee_id}`} className="min-w-0 flex-1 truncate hover:text-primary">{m.employee?.full_name}<span className="ms-2 text-xs text-muted">{m.role ?? m.employee?.designation ?? ''}</span></Link>
            {edit && <ActionButton variant="ghost" action={removeProjectMember.bind(null, id, m.employee_id)}><Trash2 size={13} /><span className="sr-only">Remove</span></ActionButton>}</li>)}</ul>}
        {materials.length > 0 && <div className="border-t border-border px-4 py-3"><div className="mb-1 text-xs font-medium text-muted">Materials bought ({formatAed(materials.reduce((s: number, e: any) => s + Number(e.amount), 0))})</div>
          <ul className="space-y-0.5 text-xs">{materials.slice(0, 6).map((e: any) => <li key={e.id} className="truncate">{e.description}</li>)}</ul></div>}
      </Card>

      <Card className="xl:col-span-3"><CardHeader title="Photos" sub="Before, fabrication, installation and completed. Shown as small previews"
        action={c.can('documents.upload') ? <DialogButton size="sm" label="Add photos" title="Add project photos" icon={<Camera size={14} />}><ActionForm action={uploadProjectPhotos.bind(null, id)} submit="Upload photos">
          <div className="grid gap-4 sm:grid-cols-2"><Field label="Category"><Select name="category" defaultValue="progress">{Object.entries(PHOTO_CATS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
            <Field label="Date taken"><Input name="taken_on" type="date" defaultValue={c.today} max={c.today} /></Field></div>
          <Field label="Caption"><Input name="caption" maxLength={500} placeholder="e.g. Staircase stringers welded" /></Field>
          <Field label="Photos *" hint="JPG, PNG, WEBP or HEIC. Up to 30"><input type="file" name="file" multiple required accept="image/*" capture="environment" className="text-sm" /></Field></ActionForm></DialogButton> : null} />
        {photos.length > 0 && <nav aria-label="Photo categories" className="flex flex-wrap gap-1.5 border-b border-border px-4 py-2 text-xs">
          <Link href={`/projects/${id}`} className={cn('rounded-md border px-2.5 py-0.5', !sp.photos ? 'border-primary text-primary' : 'border-border')}>All ({photos.length})</Link>
          {Object.entries(PHOTO_CATS).map(([k, l]) => { const n = photos.filter(d => photoCat(d) === k).length; return n ? <Link key={k} href={`/projects/${id}?photos=${k}`} className={cn('rounded-md border px-2.5 py-0.5', sp.photos === k ? 'border-primary text-primary' : 'border-border')}>{l} ({n})</Link> : null })}</nav>}
        {!shownPhotos.length ? <EmptyState icon={Camera} title="No photos yet" body="Add before / progress / completed photos. They open full size from the Document Vault." />
          : <ul className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-5 2xl:grid-cols-6">{shownPhotos.slice(0, 60).map((d: any) => <li key={d.id}>
            <Link href={`/documents/${d.id}`} className="group block overflow-hidden rounded-lg border border-border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/documents/${d.id}/thumb?w=320`} alt={d.notes ?? d.name} loading="lazy" decoding="async" width={320} height={240} className="aspect-[4/3] w-full bg-surface-2 object-cover transition-opacity group-hover:opacity-90" />
              <div className="px-2 py-1.5 text-xs"><div className="truncate font-medium">{d.notes ?? d.name}</div><div className="text-muted">{PHOTO_CATS[photoCat(d) as keyof typeof PHOTO_CATS]} · {d.issue_date ?? localDate(d.created_at, c.company.timezone)}</div></div></Link></li>)}</ul>}
      </Card>

      <Card className="xl:col-span-2"><CardHeader title="Project files" sub="Drawings, LPO / purchase orders, contracts, variation orders. Private and versioned"
        action={c.can('documents.upload') ? <DialogButton size="sm" label="Upload" title="Upload project files" icon={<Upload size={14} />}><ActionForm action={uploadProjectFiles.bind(null, id)} submit="Upload">
          <Field label="Type"><Select name="kind" defaultValue="drawing"><option value="drawing">Drawings</option><option value="lpo">LPO / purchase order</option><option value="contract">Contract</option><option value="variation">Variation order</option><option value="other">Other</option></Select></Field>
          <Field label="Files *" hint="PDF, images or Office files. Up to 20 at a time"><input type="file" name="file" multiple required accept={ACCEPT_ATTR} className="text-sm" /></Field></ActionForm></DialogButton> : null} />
        {!files.size ? <EmptyState icon={FileText} title="No files yet" body="Upload drawings and the customer’s LPO here, or file them from the Smart Inbox and link this project." />
          : <ul className="grid sm:grid-cols-2">{[...files.values()].map(d => <li key={d.id} className="border-b border-border">
            <Link href={`/documents/${d.id}`} className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-surface-2/60"><FileText size={16} className="shrink-0 text-primary" aria-hidden />
              <span className="min-w-0 flex-1"><span className="block truncate font-medium">{d.name}</span><span className="block truncate text-xs text-muted">{d.folder?.split('/').pop() ?? d.role ?? 'File'} · {localDate(d.created_at, c.company.timezone)}</span></span></Link></li>)}</ul>}
      </Card>

      <Card><CardHeader title="Timeline" action={<Clock size={15} className="text-muted" aria-hidden />} />
        <ol className="max-h-[480px] divide-y divide-border overflow-y-auto text-sm">{ev.map((e, i) => <li key={i}>
          {e.href ? <Link href={e.href} className="flex gap-3 px-4 py-2.5 hover:bg-surface-2/60"><e.icon size={14} className="mt-0.5 shrink-0 text-muted" aria-hidden /><span className="min-w-0 flex-1">{e.text}<span className="block text-xs text-muted">{when(e.at)}</span></span></Link>
            : <div className="flex gap-3 px-4 py-2.5"><e.icon size={14} className="mt-0.5 shrink-0 text-muted" aria-hidden /><span className="min-w-0 flex-1">{e.text}<span className="block text-xs text-muted">{when(e.at)}</span></span></div>}</li>)}</ol></Card>
    </div>
    <div className="mt-5 grid gap-5 xl:grid-cols-2 [&>*]:min-w-0"><CustomFieldsCard c={c} entity="project" recordId={id} customStatusId={p.custom_status_id} /><RecordActivity c={c} table="projects" id={id} /></div>
  </>
}
