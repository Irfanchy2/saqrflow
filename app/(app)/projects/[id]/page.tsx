import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft, CalendarCheck, CheckCircle2, Circle, FileText, MapPin, Pencil, Plus, Receipt, Trash2, Upload, Wallet } from 'lucide-react'
import { getCtx } from '@/lib/auth'
import { Badge, Card, CardHeader, EmptyState, Field, Input, Select, StatCard, Td, Th, TableWrap } from '@/components/ui/primitives'
import { DialogButton } from '@/components/ui/dialog'
import { ActionButton, ActionForm } from '@/components/ui/action-form'
import { ProjectFields, Progress } from '@/components/projects/project-fields'
import { NewSalesButtons } from '@/components/sales/new-buttons'
import { addExpense, addMilestone, deleteExpense, deleteMilestone, toggleMilestone, updateProgress, updateProject, uploadProjectFiles } from '@/app/actions/projects'
import { EXPENSE_CATS, PROJECT_STATUS, projectFinancials } from '@/lib/projects'
import { DOC_META, STATUS_LABEL, STATUS_TONE, type SalesType } from '@/lib/sales/docs'
import { fmtMoney } from '@/lib/sales/money'
import { formatAed } from '@/lib/time'
import { ACCEPT_ATTR } from '@/lib/files'
import { cn } from '@/lib/utils'

export const metadata = { title: 'Project' }

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const c = await getCtx(); if (!c.can('documents.view')) redirect('/')
  const { data: p } = await c.supabase.from('projects').select('*, customer:customers(id,name)').eq('id', id).maybeSingle()
  if (!p) notFound()
  const fin = c.can('finance.view'), edit = c.can('records.edit'), del = c.can('records.delete')
  const [{ data: ms }, { data: exps }, { data: sales }, { data: owned }, { data: rel }, { data: customers }] = await Promise.all([
    c.supabase.from('project_milestones').select('*').eq('project_id', id).order('due_date'),
    fin ? c.supabase.from('project_expenses').select('*').eq('project_id', id).order('spent_on', { ascending: false }) : Promise.resolve({ data: [] as any[] }),
    fin ? c.supabase.from('invoices').select('id,doc_type,number,status,total,issue_date').eq('project_id', id).order('issue_date', { ascending: false }) : Promise.resolve({ data: [] as any[] }),
    c.supabase.from('documents').select('id,name,folder,created_at').eq('owner_type', 'project').eq('owner_id', id).is('deleted_at', null).order('created_at', { ascending: false }).limit(100),
    c.supabase.from('document_relationships').select('role,document:documents(id,name,folder,created_at,deleted_at)').eq('related_type', 'project').eq('related_id', id).limit(200),
    edit ? c.supabase.from('customers').select('id,name').order('name').limit(1000) : Promise.resolve({ data: [] as any[] }),
  ])
  const invIds = (sales ?? []).filter((s: any) => s.doc_type === 'invoice').map((s: any) => s.id)
  const { data: bals } = invIds.length ? await c.supabase.from('invoice_balances').select('id,paid').in('id', invIds) : { data: [] as any[] }
  const paid = new Map((bals ?? []).map((b: any) => [b.id, Number(b.paid)]))
  const f = projectFinancials(p.contract_value, (sales ?? []).map((s: any) => ({ ...s, paid: paid.get(s.id) ?? 0 })), exps ?? [])
  const docs = new Map<string, any>()
  for (const d of owned ?? []) docs.set(d.id, d)
  for (const r of rel ?? []) { const d: any = r.document; if (d && !d.deleted_at && !docs.has(d.id)) docs.set(d.id, { ...d, role: r.role }) }
  const st = PROJECT_STATUS[p.status]
  const open = (ms ?? []).filter((m: any) => !m.done)

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
        {edit && <DialogButton wide variant="secondary" label="Edit" title="Edit project" icon={<Pencil size={14} />}><ActionForm action={updateProject.bind(null, id)} resetOnSuccess={false}><ProjectFields customers={customers ?? []} p={p} /></ActionForm></DialogButton>}
        {edit && fin && <NewSalesButtons projectId={id} customerId={p.customer_id ?? undefined} />}
      </div>
    </div>

    {fin && <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
      <StatCard label="Contract value" value={formatAed(f.contract)} />
      <StatCard label="Invoiced" value={formatAed(f.invoiced)} hint={f.billedPct !== null ? `${f.billedPct}% of contract` : undefined} icon={Receipt} tone="blue" />
      <StatCard label="Received" value={formatAed(f.received)} hint={f.collectedPct !== null ? `${f.collectedPct}% collected` : undefined} icon={Wallet} tone="green" />
      <StatCard label="Outstanding" value={formatAed(f.outstanding)} tone={f.outstanding ? 'amber' : 'neutral'} />
      <StatCard label="Costs" value={formatAed(f.expenses)} />
      <StatCard label="Est. profit" value={formatAed(f.profit)} hint={f.margin !== null ? `${f.margin}% margin` : 'Add a contract value'} tone={f.profit < 0 ? 'red' : 'green'} />
    </div>}

    <div className="grid gap-5 xl:grid-cols-3">
      <Card className="xl:col-span-1"><CardHeader title="Progress" />
        <div className="space-y-4 p-4">
          <Progress label="Fabrication (workshop)" value={p.fabrication_progress} />
          <Progress label="Site installation" value={p.site_progress} tone="bg-success" />
          {edit && <ActionForm action={updateProgress.bind(null, id)} resetOnSuccess={false} submit="Update progress" variant="secondary">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Fabrication %"><Input name="fabrication_progress" type="number" min={0} max={100} step={5} defaultValue={p.fabrication_progress} /></Field>
              <Field label="Site %"><Input name="site_progress" type="number" min={0} max={100} step={5} defaultValue={p.site_progress} /></Field>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="complete" />Mark project completed when both reach 100%</label>
          </ActionForm>}
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

      {fin && <Card className="xl:col-span-2"><CardHeader title="Quotations, invoices & delivery notes" />
        {!(sales ?? []).length ? <EmptyState icon={Receipt} title="No sales documents yet" body="Create a quotation for this project — customer and site are filled in for you." />
          : <TableWrap><thead className="bg-surface-2/50"><tr><Th>No.</Th><Th>Type</Th><Th>Date</Th><Th className="text-right">Total</Th><Th className="text-right">Paid</Th><Th>Status</Th></tr></thead>
            <tbody className="divide-y divide-border">{(sales ?? []).map((s: any) => <tr key={s.id} className="hover:bg-surface-2/50">
              <Td><Link href={`/invoices/${s.id}`} className="font-mono text-[13px] text-primary hover:underline">{s.number}</Link></Td><Td>{DOC_META[s.doc_type as SalesType]?.label}</Td><Td className="tabular-nums">{s.issue_date}</Td>
              <Td className="text-right tabular-nums">{DOC_META[s.doc_type as SalesType]?.priced ? fmtMoney(s.total) : '—'}</Td><Td className="text-right tabular-nums">{s.doc_type === 'invoice' ? fmtMoney(paid.get(s.id) ?? 0) : '—'}</Td>
              <Td><Badge tone={STATUS_TONE[s.status]}>{STATUS_LABEL[s.status]}</Badge></Td></tr>)}</tbody></TableWrap>}
      </Card>}

      {fin && <Card><CardHeader title="Costs" sub={Object.entries(f.byCategory).map(([k, v]) => `${EXPENSE_CATS[k]} ${formatAed(v)}`).join(' · ') || 'Materials, labour, transport…'}
        action={edit ? <DialogButton size="sm" label="Add" title="Add project cost" icon={<Plus size={14} />}><ActionForm action={addExpense.bind(null, id)} submit="Add cost">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Date *"><Input name="spent_on" type="date" required defaultValue={c.today} max={c.today} /></Field>
            <Field label="Category *"><Select name="category" defaultValue="material">{Object.entries(EXPENSE_CATS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <Field label="Description *" className="sm:col-span-2"><Input name="description" required maxLength={500} placeholder="e.g. MS hollow section 100×50×3 — 40 pcs" /></Field>
            <Field label="Amount (AED) *"><Input name="amount" type="number" step="0.01" min="0.01" required /></Field>
            <Field label="Reference"><Input name="reference" maxLength={120} placeholder="Supplier invoice no." /></Field>
          </div></ActionForm></DialogButton> : null} />
        {!(exps ?? []).length ? <p className="px-4 py-6 text-sm text-muted">No costs recorded.</p> :
          <ul className="max-h-96 divide-y divide-border overflow-y-auto">{(exps ?? []).map((e: any) => <li key={e.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
            <div className="min-w-0 flex-1"><div className="truncate">{e.description}</div><div className="text-xs text-muted">{e.spent_on} · {EXPENSE_CATS[e.category]}{e.reference ? ` · ${e.reference}` : ''}</div></div>
            <span className="font-medium tabular-nums">{fmtMoney(e.amount)}</span>
            {del && <ActionButton variant="ghost" action={deleteExpense.bind(null, e.id)} confirm="Delete this cost?"><Trash2 size={13} /><span className="sr-only">Delete</span></ActionButton>}</li>)}</ul>}
      </Card>}

      <Card className="xl:col-span-3"><CardHeader title="Project files" sub="Drawings, LPOs, site photos, variation orders — private and versioned"
        action={c.can('documents.upload') ? <DialogButton size="sm" label="Upload" title="Upload project files" icon={<Upload size={14} />}><ActionForm action={uploadProjectFiles.bind(null, id)} submit="Upload">
          <Field label="Type"><Select name="kind" defaultValue="drawing"><option value="drawing">Drawings</option><option value="lpo">LPO / purchase order</option><option value="contract">Contract</option><option value="photo">Site photos</option><option value="variation">Variation order</option><option value="other">Other</option></Select></Field>
          <Field label="Files *" hint="PDF, images or Office files — up to 20 at a time"><input type="file" name="file" multiple required accept={ACCEPT_ATTR} className="text-sm" /></Field></ActionForm></DialogButton> : null} />
        {!docs.size ? <EmptyState icon={FileText} title="No files yet" body="Upload drawings and photos here, or file them from the Smart Inbox and link this project." />
          : <ul className="grid sm:grid-cols-2 xl:grid-cols-3">{[...docs.values()].map(d => <li key={d.id} className="border-b border-border">
            <Link href={`/documents/${d.id}`} className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-surface-2/60"><FileText size={16} className="shrink-0 text-primary" aria-hidden />
              <span className="min-w-0 flex-1"><span className="block truncate font-medium">{d.name}</span><span className="block truncate text-xs text-muted">{d.folder?.split('/').pop() ?? d.role ?? 'File'} · {d.created_at.slice(0, 10)}</span></span></Link></li>)}</ul>}
      </Card>
    </div>
  </>
}
