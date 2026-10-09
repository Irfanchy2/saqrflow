import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { Archive, ArchiveRestore, ArrowLeft, BellRing, FileText, History, MapPin, Pencil, Plus, Trash2, Undo2, Upload, UserRound, Wrench } from 'lucide-react'
import { getCtx } from '@/lib/auth'
import { Alert, Badge, Card, CardHeader, EmptyState, Field, Input, Metrics, Select, StatCard, Td, Th, TableWrap, Textarea } from '@/components/ui/primitives'
import { DialogButton } from '@/components/ui/dialog'
import { ActionButton, ActionForm } from '@/components/ui/action-form'
import { AssetFields } from '@/components/assets/asset-fields'
import { ExpenseFields } from '@/components/expenses/expense-fields'
import { addMaintenance, assignAsset, returnAsset, setAssetArchived, updateAsset, uploadAssetFiles } from '@/app/actions/assets'
import { saveExpense } from '@/app/actions/projects'
import { trashRecord } from '@/app/actions/trash'
import { ASSET_DOCS, ASSET_STATUS, CONDITIONS, EQUIPMENT_KINDS, MAINT_KINDS, VEHICLE_DOCS, assetDeadlines, deadlineTone, kmToService } from '@/lib/assets'
import { EXPENSE_CATS } from '@/lib/projects'
import { ACTION_LABEL, changeSummary } from '@/lib/audit'
import { formatAed, formatLongDate, formatShortDate, localDate } from '@/lib/time'
import { ACCEPT_ATTR } from '@/lib/files'
import { cn } from '@/lib/utils'
import { RecordActivity } from '@/components/record-activity'
import { RecordTasks } from '@/components/record-tasks'
import { CustomFieldsCard } from '@/components/custom-fields-card'
import { QrCode } from 'lucide-react'

export const metadata = { title: 'Vehicle / asset' }
const TABS = [['overview', 'Overview'], ['documents', 'Documents'], ['maintenance', 'Maintenance'], ['expenses', 'Expenses'], ['assignments', 'Assignments'], ['reminders', 'Reminders'], ['timeline', 'Timeline']] as const
type Tab = typeof TABS[number][0]

export default async function AssetPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const sp = await searchParams
  const c = await getCtx(); if (!c.can('documents.view')) redirect('/')
  const { data: a } = await c.supabase.from('assets').select('*, employee:employees(id,full_name)').eq('id', id).maybeSingle()
  if (!a) notFound()
  const tab: Tab = (TABS.some(([k]) => k === sp.tab) ? sp.tab : 'overview') as Tab
  const edit = c.can('records.edit') && !a.archived_at, isV = a.kind === 'vehicle', fin = c.can('finance.view')
  const [{ data: owned }, { data: rel }, { data: emps }, { data: sups }, { data: maint }, { data: assigns }, { data: exps }, { data: projects }] = await Promise.all([
    c.supabase.from('documents').select('id,name,expiry_date,reference_no,folder,created_at,status').eq('owner_type', 'asset').eq('owner_id', id).is('deleted_at', null).order('created_at', { ascending: false }).limit(200),
    c.supabase.from('document_relationships').select('role,document:documents(id,name,expiry_date,folder,created_at,deleted_at,status)').in('related_type', ['vehicle', 'asset']).eq('related_id', id).limit(200),
    c.can('records.edit') ? c.supabase.from('employees').select('id,full_name').neq('status', 'archived').order('full_name').limit(1000) : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
    c.can('records.edit') ? c.supabase.from('suppliers').select('name').order('name').limit(500) : Promise.resolve({ data: [] as { name: string }[] }),
    c.supabase.from('asset_maintenance').select('*, employee:employees(full_name)').eq('asset_id', id).order('performed_on', { ascending: false }).limit(300),
    c.supabase.from('asset_assignments').select('*, employee:employees(id,full_name), project:projects(id,name)').eq('asset_id', id).order('assigned_on', { ascending: false }).limit(300),
    fin ? c.supabase.from('project_expenses').select('id,spent_on,category,description,amount,vat_amount,supplier_name,receipt_document_id').eq('asset_id', id).order('spent_on', { ascending: false }).limit(300) : Promise.resolve({ data: [] as any[] }),
    c.can('records.edit') ? c.supabase.from('projects').select('id,name').in('status', ['planning', 'active', 'on_hold']).order('name').limit(500) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ])
  const docs = new Map<string, any>()
  for (const d of owned ?? []) docs.set(d.id, d)
  for (const r of rel ?? []) { const d: any = r.document; if (d && !d.deleted_at && !docs.has(d.id)) docs.set(d.id, d) }
  const deadlines = assetDeadlines(a, c.today)
  const st = ASSET_STATUS[a.status] ?? { label: a.status, tone: 'neutral' as const }
  const kinds = isV ? VEHICLE_DOCS : ASSET_DOCS
  const year0 = c.today.slice(0, 4) + '-01-01'
  const maintCost = (maint ?? []).reduce((s: number, m: any) => s + Number(m.cost), 0)
  const maintYear = (maint ?? []).filter((m: any) => m.performed_on >= year0).reduce((s: number, m: any) => s + Number(m.cost), 0)
  const expTotal = (exps ?? []).reduce((s: number, e: any) => s + Number(e.amount), 0)
  const km = kmToService(a)
  const current = (assigns ?? []).find((x: any) => !x.returned_on)
  const empOpts = (emps ?? []).map(e => ({ id: e.id, name: e.full_name }))

  const facts: [string, React.ReactNode][] = isV
    ? [['Plate', [a.plate_or_serial, a.plate_emirate].filter(Boolean).join(', ') || '—'], ['Type', a.vehicle_type ?? '—'], ['Make / model', [a.make, a.model].filter(Boolean).join(' ') || '—'], ['Year', a.model_year ?? '—'],
      ['VIN / chassis', a.vin ? <span className="font-mono text-[13px]">{a.vin}</span> : '—'], ['Registration no.', a.mulkiya_no ?? '—'], ['Insurance company', a.insurance_provider ?? '—'],
      ['Current mileage', a.current_mileage != null ? `${Number(a.current_mileage).toLocaleString('en-US')} km${a.mileage_updated_on ? ` (${formatShortDate(a.mileage_updated_on)})` : ''}` : '—'],
      ['Service interval', a.service_interval_km ? `Every ${Number(a.service_interval_km).toLocaleString('en-US')} km` : '—']]
    : [['Category', a.category ?? '—'], ['Type', EQUIPMENT_KINDS[a.kind] ?? a.kind], ['Asset code', a.asset_code ? <span className="font-mono text-[13px]">{a.asset_code}</span> : '—'], ['Serial number', a.serial_no ? <span className="font-mono text-[13px]">{a.serial_no}</span> : '—'],
      ['Brand / model', [a.make, a.model].filter(Boolean).join(' ') || '—'], ['Condition', a.condition ? CONDITIONS[a.condition] : '—'],
      ['Purchased', a.purchase_date ? formatLongDate(a.purchase_date) : '—'], ['Purchase price', a.purchase_price != null ? formatAed(a.purchase_price) : '—'], ['Supplier', a.supplier_name ?? '—'], ['Location', a.location ?? '—']]

  const assignForm = <ActionForm action={assignAsset.bind(null, id)} submit="Save assignment">
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label={isV ? 'Driver' : 'Employee'}><Select name="employee_id" defaultValue=""><option value="">No employee</option>{(emps ?? []).map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}</Select></Field>
      <Field label="Project"><Select name="project_id" defaultValue=""><option value="">No project</option>{(projects ?? []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
      <Field label="Location"><Input name="location" maxLength={200} defaultValue={a.location ?? ''} /></Field>
      <Field label="From *"><Input name="assigned_on" type="date" required max={c.today} defaultValue={c.today} /></Field>
      <Field label="Note" className="sm:col-span-2"><Textarea name="note" rows={2} maxLength={500} /></Field>
    </div></ActionForm>

  return <>
    <Link href={`/assets?tab=${a.archived_at ? 'archived' : isV ? 'vehicles' : 'assets'}`} className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg"><ArrowLeft size={14} className="rtl:rotate-180" />Vehicles & Assets</Link>
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2"><h1 className="text-lg font-semibold tracking-[-0.015em]">{a.name}</h1><Badge tone={st.tone}>{st.label}</Badge>{a.archived_at && <Badge>Archived</Badge>}</div>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
          <span>{isV ? [a.plate_or_serial, [a.make, a.model, a.model_year].filter(Boolean).join(' ')].filter(Boolean).join(' · ') : [a.category, a.asset_code].filter(Boolean).join(' · ')}</span>
          {a.employee && <Link href={`/employees/${a.employee.id}`} className="inline-flex items-center gap-1 hover:text-primary"><UserRound size={13} aria-hidden />{a.employee.full_name}</Link>}
          {a.location && <span className="inline-flex items-center gap-1"><MapPin size={13} aria-hidden />{a.location}</span>}
        </div>
      </div>
      <div className="flex flex-wrap gap-2"><a href={`/print/qr?type=asset&ids=${a.id}`} target="_blank" rel="noopener" className="inline-flex h-11 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-sm hover:bg-surface-2 sm:h-9"><QrCode size={14} aria-hidden />QR label</a>
      {c.can('records.edit') && <div className="flex flex-wrap gap-2">
        {edit && <DialogButton wide variant="secondary" label={a.assigned_to ? 'Reassign' : 'Assign'} title={`Assign ${isV ? 'vehicle' : 'asset'}`} icon={<UserRound size={14} />}>{assignForm}</DialogButton>}
        {edit && a.assigned_to && <ActionButton size="md" action={returnAsset.bind(null, id)} confirm={`Return ${a.name}? The current assignment is closed today.`}><Undo2 size={14} />Return</ActionButton>}
        {edit && <DialogButton wide variant="secondary" label="Edit" title={`Edit ${isV ? 'vehicle' : 'asset'}`} icon={<Pencil size={14} />}><ActionForm action={updateAsset.bind(null, id)} resetOnSuccess={false}><AssetFields kind={isV ? 'vehicle' : 'asset'} a={a} employees={emps ?? []} suppliers={(sups ?? []).map(s => s.name)} /></ActionForm></DialogButton>}
        {a.archived_at ? <ActionButton size="md" action={setAssetArchived.bind(null, id, false)}><ArchiveRestore size={14} />Restore</ActionButton>
          : <ActionButton size="md" variant="ghost" action={setAssetArchived.bind(null, id, true)} confirm="Archive this item? Its documents and history are kept; reminders stop."><Archive size={14} />Archive</ActionButton>}
        {c.can('records.delete') && <ActionButton size="md" variant="ghost" action={trashRecord.bind(null, 'asset', id)} confirm="Move this item to the trash? It can be restored from Trash."><Trash2 size={14} />Delete</ActionButton>}
      </div>}</div>
    </div>
    {a.archived_at && <div className="mb-4"><Alert tone="amber">Archived on {formatLongDate(localDate(a.archived_at, c.company.timezone))}. No reminders are sent for archived items.</Alert></div>}

    <nav aria-label={`${isV ? 'Vehicle' : 'Asset'} sections`} className="mb-5 flex gap-1 overflow-x-auto border-b border-border">{TABS.filter(([k]) => k !== 'expenses' || fin).map(([k, l]) => {
      const n = k === 'documents' ? docs.size : k === 'maintenance' ? (maint ?? []).length : k === 'expenses' ? (exps ?? []).length : k === 'assignments' ? (assigns ?? []).length : null
      return <Link key={k} href={k === 'overview' ? `/assets/${id}` : `/assets/${id}?tab=${k}`} aria-current={tab === k ? 'page' : undefined} scroll={false}
        className={cn('-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors', tab === k ? 'border-primary font-medium text-fg' : 'border-transparent text-muted hover:text-fg')}>{l}{n ? <span className="rounded-sm bg-surface-2 px-1 text-2xs tabular-nums text-muted">{n}</span> : null}</Link>
    })}</nav>

    {tab === 'overview' && <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] [&>*]:min-w-0">
      <div className="space-y-5">
        <Metrics cols={4}>
          <StatCard label={isV ? 'Next deadline' : 'Next date'} value={deadlines[0] ? (deadlines[0].days < 0 ? `${-deadlines[0].days}d overdue` : `${deadlines[0].days} days`) : 'None'} hint={deadlines[0]?.label} tone={deadlines[0] && deadlines[0].days < 0 ? 'red' : 'neutral'} href={`/assets/${id}?tab=reminders`} />
          <StatCard label={isV ? 'Service by mileage' : 'Last maintenance'} value={isV ? (km == null ? 'Not set' : km <= 0 ? `${(-km).toLocaleString('en-US')} km over` : `${km.toLocaleString('en-US')} km`) : (a.last_service_date ? formatShortDate(a.last_service_date) : 'None')} tone={isV && km != null && km <= 0 ? 'red' : 'neutral'} href={`/assets/${id}?tab=maintenance`} />
          <StatCard label="Maintenance cost this year" value={formatAed(maintYear)} hint={`All time ${formatAed(maintCost)}`} href={`/assets/${id}?tab=maintenance`} />
          <StatCard label={fin ? 'Recorded expenses' : 'Documents'} value={fin ? formatAed(expTotal) : docs.size} hint={fin ? `${(exps ?? []).length} entries` : undefined} href={`/assets/${id}?tab=${fin ? 'expenses' : 'documents'}`} />
        </Metrics>
        <Card><CardHeader title="Details" />
          <dl className="grid gap-x-6 gap-y-3 p-4 text-sm sm:grid-cols-2">{facts.map(([k, v]) => <div key={k} className="min-w-0"><dt className="text-xs text-muted">{k}</dt><dd className="mt-0.5 break-words font-medium">{v}</dd></div>)}</dl>
          {a.notes && <p className="whitespace-pre-wrap break-words border-t border-border px-4 py-3 text-sm text-muted [overflow-wrap:anywhere]" dir="auto">{a.notes}</p>}
        </Card>
      </div>
      <div className="space-y-5">
        <Card><CardHeader title="Renewals & service" action={<Link href={`/assets/${id}?tab=reminders`} className="text-xs font-medium text-primary hover:underline">Reminders</Link>} />
          {!deadlines.length ? <p className="px-4 py-5 text-sm text-muted">No dates set. {edit && 'Use Edit to add registration, insurance, warranty or service dates.'}</p>
            : <ul className="divide-y divide-border">{deadlines.map(d => <li key={d.key} className="flex items-center gap-3 px-4 py-2.5 text-sm"><span className="flex-1">{d.label}</span>
              <span className="text-xs tabular-nums text-muted">{formatShortDate(d.date)}</span><Badge tone={deadlineTone(d.days)}>{d.days < 0 ? `${-d.days}d overdue` : d.days === 0 ? 'Today' : `${d.days}d`}</Badge></li>)}</ul>}</Card>
        <Card><CardHeader title="Current assignment" action={<Link href={`/assets/${id}?tab=assignments`} className="text-xs font-medium text-primary hover:underline">History</Link>} />
          {current ? <dl className="space-y-2 p-4 text-sm">
            {current.employee && <div><dt className="text-xs text-muted">{isV ? 'Driver' : 'Employee'}</dt><dd className="font-medium"><Link href={`/employees/${current.employee.id}`} className="hover:text-primary">{current.employee.full_name}</Link></dd></div>}
            {current.project && <div><dt className="text-xs text-muted">Project</dt><dd className="font-medium"><Link href={`/projects/${current.project.id}`} className="hover:text-primary">{current.project.name}</Link></dd></div>}
            {current.location && <div><dt className="text-xs text-muted">Location</dt><dd>{current.location}</dd></div>}
            <div><dt className="text-xs text-muted">Since</dt><dd className="tabular-nums">{formatLongDate(current.assigned_on)}</dd></div></dl>
            : <p className="px-4 py-5 text-sm text-muted">{a.archived_at ? 'Archived.' : 'Not assigned. Use Assign to hand it to an employee or a project.'}</p>}</Card>
      </div>
    </div>}

    {tab === 'documents' && <Card><CardHeader title="Documents" sub={isV ? 'Mulkiya, insurance, inspection, repairs and service records. Private, versioned and with expiry reminders.' : 'Purchase invoice, warranty, certifications and service records. Private and versioned.'}
      action={c.can('documents.upload') && !a.archived_at ? <DialogButton size="sm" label="Upload" title="Upload documents" icon={<Upload size={14} />}><ActionForm action={uploadAssetFiles.bind(null, id)} submit="Upload">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Document type"><Select name="doc_type" defaultValue={isV ? 'mulkiya' : 'invoice'}>{Object.entries(kinds).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
          <Field label="Expiry date" hint="Optional. Creates expiry reminders"><Input name="expiry_date" type="date" /></Field>
          <Field label="Reference / policy no." className="sm:col-span-2"><Input name="reference_no" maxLength={100} /></Field>
          <Field label="Files *" hint="PDF or images, up to 10" className="sm:col-span-2"><input type="file" name="file" multiple required accept={ACCEPT_ATTR} className="text-sm" /></Field>
        </div></ActionForm></DialogButton> : null} />
      {!docs.size ? <EmptyState icon={FileText} title="No documents yet" body={isV ? 'Upload the Mulkiya and insurance here, or drop them into the Smart Inbox; it matches them to this vehicle by plate number.' : 'Upload the purchase invoice, warranty card or service reports.'} />
        : <TableWrap><thead><tr><Th>Document</Th><Th>Reference</Th><Th>Expiry</Th><Th>Added</Th><Th className="text-end"><span className="sr-only">Open</span></Th></tr></thead>
          <tbody className="divide-y divide-border">{[...docs.values()].map(d => <tr key={d.id} className="hover:bg-surface-2/40">
            <Td className="max-w-[340px]"><Link href={`/documents/${d.id}`} className="flex items-center gap-2 font-medium hover:text-primary"><FileText size={15} className="shrink-0 text-muted" aria-hidden /><span className="truncate">{d.name}</span></Link></Td>
            <Td className="text-muted">{d.reference_no ?? '—'}</Td>
            <Td>{d.expiry_date ? <Badge tone={deadlineTone(Math.round((Date.parse(d.expiry_date) - Date.parse(c.today)) / 864e5))}>{formatShortDate(d.expiry_date)}</Badge> : <span className="text-muted/60">No expiry</span>}</Td>
            <Td className="tabular-nums text-muted">{formatShortDate(localDate(d.created_at, c.company.timezone))}</Td>
            <Td className="text-end"><Link href={`/documents/${d.id}`} className="text-sm font-medium text-primary hover:underline">Open</Link></Td></tr>)}</tbody></TableWrap>}
      <p className="border-t border-border px-4 py-2 text-xs text-muted">Open a document to preview, download, upload a new version or see earlier versions.</p>
    </Card>}

    {tab === 'maintenance' && <Card><CardHeader title="Maintenance history" sub={`Last ${isV ? 'service' : 'maintenance'}: ${a.last_service_date ? formatLongDate(a.last_service_date) : 'none'} · Next: ${a.next_service_date ? formatLongDate(a.next_service_date) : 'not set'} · This year ${formatAed(maintYear)} · All time ${formatAed(maintCost)}`}
      action={edit ? <DialogButton wide size="sm" label="Add record" title="Record maintenance or repair" icon={<Plus size={14} />}><ActionForm action={addMaintenance.bind(null, id)} submit="Save record">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date *"><Input name="performed_on" type="date" required max={c.today} defaultValue={c.today} /></Field>
          <Field label="Type"><Select name="kind" defaultValue="service">{Object.entries(MAINT_KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
          <Field label="Work done *" className="sm:col-span-2"><Input name="description" required maxLength={1000} placeholder={isV ? 'e.g. Oil and filter change, brake pads' : 'e.g. Replaced torch cable, calibrated'} /></Field>
          <Field label="Cost (AED)"><Input name="cost" type="number" min={0} step="0.01" defaultValue={0} inputMode="decimal" /></Field>
          <Field label="Workshop / vendor"><Input name="vendor" maxLength={200} /></Field>
          {isV && <Field label="Odometer (km)" hint="Updates the current mileage"><Input name="odometer" type="number" min={0} inputMode="numeric" /></Field>}
          <Field label="Handled by"><Select name="employee_id" defaultValue=""><option value="">Not recorded</option>{(emps ?? []).map((e: any) => <option key={e.id} value={e.id}>{e.full_name}</option>)}</Select></Field>
          <Field label="Next due" hint="Updates the next service or inspection date and its reminders"><Input name="next_due" type="date" min={c.today} /></Field>
          {c.can('documents.upload') && <Field label="Invoice or report (optional)" className="sm:col-span-2"><input type="file" name="file" accept={ACCEPT_ATTR} className="text-sm" /></Field>}
        </div></ActionForm></DialogButton> : null} />
      {!(maint ?? []).length ? <EmptyState icon={Wrench} title="No maintenance recorded" body={isV ? 'Record services, repairs and RTA inspections. The next due date becomes a reminder.' : 'Record servicing, repairs and calibration with cost and next due date.'} />
        : <TableWrap><thead><tr><Th>Date</Th><Th>Type</Th><Th>Work done</Th><Th>Vendor</Th>{isV && <Th className="text-end">Odometer</Th>}<Th>By</Th><Th>Next due</Th><Th className="text-end">Cost (AED)</Th></tr></thead>
          <tbody className="divide-y divide-border">{(maint ?? []).map((m: any) => <tr key={m.id} className="hover:bg-surface-2/40">
            <Td className="whitespace-nowrap">{formatShortDate(m.performed_on)}</Td><Td>{MAINT_KINDS[m.kind] ?? m.kind}</Td>
            <Td className="max-w-[340px] [overflow-wrap:anywhere]">{m.description}{m.document_id && <Link href={`/documents/${m.document_id}`} className="ms-1.5 text-xs font-medium text-primary hover:underline">File</Link>}</Td>
            <Td className="text-muted">{m.vendor ?? '—'}</Td>{isV && <Td className="text-end">{m.odometer != null ? Number(m.odometer).toLocaleString('en-US') : '—'}</Td>}<Td className="text-muted">{m.employee?.full_name ?? '—'}</Td>
            <Td className="whitespace-nowrap">{m.next_due ? formatShortDate(m.next_due) : '—'}</Td><Td className="text-end font-medium">{formatAed(m.cost).replace('AED ', '')}</Td></tr>)}</tbody>
          <tfoot><tr className="border-t border-border bg-surface-2/40"><Td colSpan={isV ? 7 : 6} className="text-end text-xs font-medium text-muted">Total</Td><Td className="text-end font-semibold">{formatAed(maintCost).replace('AED ', '')}</Td></tr></tfoot></TableWrap>}
    </Card>}

    {tab === 'expenses' && fin && <Card><CardHeader title="Expenses" sub={`Fuel, Salik, parts, repairs and other costs for this ${isV ? 'vehicle' : 'asset'}. Total ${formatAed(expTotal)} excl. VAT.`}
      action={edit ? <DialogButton wide size="sm" label="Add expense" title={`Add expense for ${a.name}`} icon={<Plus size={14} />}><ActionForm action={saveExpense.bind(null, null, null)} submit="Save expense" idempotent>
        <input type="hidden" name="asset_id" value={id} /><ExpenseFields today={c.today} projects={(projects ?? []).map(p => ({ id: p.id, name: p.name }))} employees={empOpts} suppliers={[]} /></ActionForm></DialogButton> : null} />
      {!(exps ?? []).length ? <EmptyState title="No expenses recorded" body={`Add fuel, Salik, parts or repair bills here to see the true running cost of this ${isV ? 'vehicle' : 'asset'}.`} />
        : <TableWrap><thead><tr><Th>Date</Th><Th>Category</Th><Th>Description</Th><Th>Supplier</Th><Th className="text-end">VAT</Th><Th className="text-end">Amount (AED)</Th></tr></thead>
          <tbody className="divide-y divide-border">{(exps ?? []).map((e: any) => <tr key={e.id} className="hover:bg-surface-2/40">
            <Td className="whitespace-nowrap">{formatShortDate(e.spent_on)}</Td><Td>{EXPENSE_CATS[e.category as keyof typeof EXPENSE_CATS] ?? e.category}</Td>
            <Td className="max-w-[320px] [overflow-wrap:anywhere]">{e.description}{e.receipt_document_id && <Link href={`/documents/${e.receipt_document_id}`} className="ms-1.5 text-xs font-medium text-primary hover:underline">Receipt</Link>}</Td>
            <Td className="text-muted">{e.supplier_name ?? '—'}</Td><Td className="text-end text-muted">{formatAed(e.vat_amount).replace('AED ', '')}</Td><Td className="text-end font-medium">{formatAed(e.amount).replace('AED ', '')}</Td></tr>)}</tbody>
          <tfoot><tr className="border-t border-border bg-surface-2/40"><Td colSpan={5} className="text-end text-xs font-medium text-muted">Total excl. VAT</Td><Td className="text-end font-semibold">{formatAed(expTotal).replace('AED ', '')}</Td></tr></tfoot></TableWrap>}
    </Card>}

    {tab === 'assignments' && <Card><CardHeader title="Assignment history" sub="Every change of driver, holder, project or location, with dates"
      action={edit ? <DialogButton wide size="sm" label={a.assigned_to ? 'Reassign' : 'Assign'} title={`Assign ${isV ? 'vehicle' : 'asset'}`} icon={<UserRound size={14} />}>{assignForm}</DialogButton> : null} />
      {!(assigns ?? []).length ? <EmptyState icon={UserRound} title="Never assigned" body="Assignments appear here with who had it, for which project, and for how long." />
        : <TableWrap><thead><tr><Th>{isV ? 'Driver' : 'Employee'}</Th><Th>Project</Th><Th>Location</Th><Th>From</Th><Th>To</Th><Th>Days</Th><Th>Note</Th></tr></thead>
          <tbody className="divide-y divide-border">{(assigns ?? []).map((x: any) => <tr key={x.id} className="hover:bg-surface-2/40">
            <Td>{x.employee ? <Link href={`/employees/${x.employee.id}`} className="font-medium hover:text-primary">{x.employee.full_name}</Link> : '—'}</Td>
            <Td>{x.project ? <Link href={`/projects/${x.project.id}`} className="hover:text-primary">{x.project.name}</Link> : '—'}</Td>
            <Td className="text-muted">{x.location ?? '—'}</Td><Td className="whitespace-nowrap">{formatShortDate(x.assigned_on)}</Td>
            <Td className="whitespace-nowrap">{x.returned_on ? formatShortDate(x.returned_on) : <Badge tone="blue">Current</Badge>}</Td>
            <Td className="text-muted">{Math.max(0, Math.round((Date.parse(x.returned_on ?? c.today) - Date.parse(x.assigned_on)) / 864e5))}</Td>
            <Td className="max-w-[260px] text-muted [overflow-wrap:anywhere]">{x.note ?? ''}</Td></tr>)}</tbody></TableWrap>}
    </Card>}

    {tab === 'reminders' && <ReminderTab c={c} a={a} id={id} deadlines={deadlines} km={km} isV={isV} />}
    {tab === 'timeline' && <TimelineTab c={c} a={a} id={id} maint={maint ?? []} assigns={assigns ?? []} exps={exps ?? []} docs={[...docs.values()]} />}
    {tab === 'overview' && <div className="mt-5 grid gap-5 xl:grid-cols-2 [&>*]:min-w-0"><CustomFieldsCard c={c} entity="asset" recordId={id} /><RecordTasks c={c} type={isV ? 'vehicle' : 'asset'} id={id} /><RecordActivity c={c} table="assets" id={id} className="xl:col-span-2" /></div>}
  </>
}

/** Reminders: the dates feeding the shared reminder engine, the schedule used, and what has already been sent. */
async function ReminderTab({ c, a, id, deadlines, km, isV }: { c: Awaited<ReturnType<typeof getCtx>>; a: any; id: string; deadlines: ReturnType<typeof assetDeadlines>; km: number | null; isV: boolean }) {
  const [{ data: src }, { data: sent }] = await Promise.all([
    c.supabase.from('reminder_sources').select('source_type,due_date,offsets').eq('source_id', id),
    c.can('reminders.create') ? c.supabase.from('notification_logs').select('id,channel,status,created_at,template').eq('source_id', id).order('created_at', { ascending: false }).limit(50) : Promise.resolve({ data: [] as any[] }),
  ])
  return <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2 [&>*]:min-w-0">
    <Card><CardHeader title="Dates that send reminders" sub={a.reminder_days?.length ? `Reminders ${a.reminder_days.join(', ')} days before each date` : 'Uses the company reminder schedule (Settings → Notifications)'} action={<BellRing size={15} className="text-muted" aria-hidden />} />
      {!deadlines.length ? <EmptyState icon={BellRing} title="No reminder dates" body="Add registration, insurance, inspection, warranty or service dates and reminders start automatically." />
        : <ul className="divide-y divide-border">{deadlines.map(d => <li key={d.key} className="flex items-center gap-3 px-4 py-2.5 text-sm"><span className="flex-1">{d.label}</span>
          <span className="tabular-nums text-muted">{formatLongDate(d.date)}</span><Badge tone={deadlineTone(d.days)}>{d.days < 0 ? `${-d.days}d overdue` : d.days === 0 ? 'Today' : `in ${d.days}d`}</Badge></li>)}</ul>}
      {isV && km != null && <p className="border-t border-border px-4 py-2.5 text-sm">Mileage service: <span className={cn('font-medium tabular-nums', km <= 0 && 'text-danger')}>{km <= 0 ? `${(-km).toLocaleString('en-US')} km overdue` : `${km.toLocaleString('en-US')} km to go`}</span>
        <span className="block text-xs text-muted">Mileage is updated from maintenance records and the vehicle form. It is shown here and in Reports; date reminders cover the service date.</span></p>}
      <p className="border-t border-border px-4 py-2 text-xs text-muted">{(src ?? []).length} active reminder source{(src ?? []).length === 1 ? '' : 's'} for this item. {a.archived_at ? 'Archived items do not send reminders.' : ''}</p></Card>
    <Card><CardHeader title="Sent reminders" />
      {!(sent ?? []).length ? <EmptyState icon={History} title="Nothing sent yet" body={c.can('reminders.create') ? 'Reminders appear here once a date enters its reminder window.' : 'Ask an administrator to see the reminder log.'} />
        : <ul className="divide-y divide-border">{(sent ?? []).map((l: any) => <li key={l.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
          <span className="capitalize">{l.channel.replace('_', '-')}</span><span className="text-xs tabular-nums text-muted">{new Date(l.created_at).toLocaleString('en-GB', { timeZone: c.company.timezone, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span><Badge tone={l.status === 'failed' ? 'red' : l.status === 'sandbox' ? 'amber' : 'green'}>{l.status}</Badge></li>)}</ul>}</Card>
  </div>
}

/** One chronological history: created, edits, assignments, maintenance, documents, expenses. */
async function TimelineTab({ c, a, id, maint, assigns, exps, docs }: { c: Awaited<ReturnType<typeof getCtx>>; a: any; id: string; maint: any[]; assigns: any[]; exps: any[]; docs: any[] }) {
  const [{ data: logs }, { data: people }] = await Promise.all([
    c.can('audit.view') ? c.supabase.from('audit_logs').select('id,action,created_at,user_id,changes').eq('table_name', 'assets').eq('record_id', id).order('created_at', { ascending: false }).limit(100) : Promise.resolve({ data: [] as any[] }),
    c.can('audit.view') ? c.supabase.from('profiles').select('id,full_name') : Promise.resolve({ data: [] as any[] }),
  ])
  const who = new Map((people ?? []).map((p: any) => [p.id, p.full_name]))
  // `at` = local calendar date (Asia/Dubai) for display; `ord` orders events inside one day (timestamps before date-only rows)
  type Ev = { at: string; ord: string; title: string; detail?: string; href?: string }
  const tz = c.company.timezone, L = (ts: string) => localDate(ts, tz)
  const ev: Ev[] = [{ at: L(a.created_at), ord: a.created_at, title: `${a.kind === 'vehicle' ? 'Vehicle' : 'Asset'} added` }]
  for (const l of logs ?? []) {
    if (l.action === 'INSERT') continue
    const what = changeSummary('assets', l.action, l.changes).filter(x => !/^(updated at|client token|mileage updated on|last service date|next service km)\b/.test(x))
    if (l.action === 'UPDATE' && !what.length) continue   // only system-maintained fields changed (shown as their own events)
    ev.push({ at: L(l.created_at), ord: l.created_at, title: `${ACTION_LABEL[l.action] ?? l.action} by ${l.user_id ? who.get(l.user_id) ?? 'a former user' : 'the system'}`, detail: what.slice(0, 4).join('; ') || undefined })
  }
  for (const x of assigns) {
    ev.push({ at: x.assigned_on, ord: x.created_at ?? x.assigned_on, title: `Assigned${x.employee ? ` to ${x.employee.full_name}` : ''}${x.project ? ` for ${x.project.name}` : ''}`, detail: x.location ?? undefined })
    if (x.returned_on) ev.push({ at: x.returned_on, ord: x.returned_on + 'T23:59', title: `Returned${x.employee ? ` by ${x.employee.full_name}` : ''}` })
  }
  for (const m of maint) ev.push({ at: m.performed_on, ord: m.created_at ?? m.performed_on, title: `${MAINT_KINDS[m.kind] ?? m.kind}: ${m.description}`, detail: Number(m.cost) ? formatAed(m.cost) : undefined })
  for (const d of docs) ev.push({ at: L(d.created_at), ord: d.created_at, title: `Document uploaded: ${d.name}`, href: `/documents/${d.id}` })
  for (const e of exps) ev.push({ at: e.spent_on, ord: e.spent_on, title: `Expense: ${e.description}`, detail: formatAed(e.amount) })
  ev.sort((x, y) => y.at.localeCompare(x.at) || y.ord.localeCompare(x.ord))
  return <Card><CardHeader title="Timeline" sub={c.can('audit.view') ? undefined : 'Edits by users are visible to owners in the audit log'} />
    <ol className="relative ms-6 border-s border-border py-2">{ev.slice(0, 200).map((e, i) => <li key={i} className="relative py-2.5 pe-4 ps-5">
      <span aria-hidden className="absolute -start-[4.5px] top-[18px] h-2 w-2 rounded-full border border-border-strong bg-surface" />
      <div className="text-sm">{e.href ? <Link href={e.href} className="font-medium hover:text-primary">{e.title}</Link> : <span className="font-medium">{e.title}</span>}</div>
      <div className="text-xs text-muted"><time className="tabular-nums">{formatShortDate(e.at)}</time>{e.detail && <> · {e.detail}</>}</div></li>)}</ol></Card>
}
