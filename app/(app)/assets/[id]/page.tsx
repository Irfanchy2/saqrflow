import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { Archive, ArchiveRestore, ArrowLeft, BellRing, FileText, MapPin, Pencil, Upload, UserRound } from 'lucide-react'
import { getCtx } from '@/lib/auth'
import { Alert, Badge, Card, CardHeader, EmptyState, Field, Input, Select } from '@/components/ui/primitives'
import { DialogButton } from '@/components/ui/dialog'
import { ActionButton, ActionForm } from '@/components/ui/action-form'
import { AssetFields } from '@/components/assets/asset-fields'
import { setAssetArchived, updateAsset, uploadAssetFiles } from '@/app/actions/assets'
import { ASSET_DOCS, ASSET_STATUS, EQUIPMENT_KINDS, VEHICLE_DOCS, assetDeadlines, deadlineTone } from '@/lib/assets'
import { formatAed, formatLongDate } from '@/lib/time'
import { ACCEPT_ATTR } from '@/lib/files'

export const metadata = { title: 'Vehicle / asset' }

export default async function AssetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const c = await getCtx(); if (!c.can('documents.view')) redirect('/')
  const { data: a } = await c.supabase.from('assets').select('*, employee:employees(id,full_name)').eq('id', id).maybeSingle()
  if (!a) notFound()
  const edit = c.can('records.edit'), isV = a.kind === 'vehicle'
  const [{ data: owned }, { data: rel }, { data: emps }, { data: sups }] = await Promise.all([
    c.supabase.from('documents').select('id,name,expiry_date,reference_no,folder,created_at').eq('owner_type', 'asset').eq('owner_id', id).is('deleted_at', null).order('created_at', { ascending: false }).limit(100),
    c.supabase.from('document_relationships').select('role,document:documents(id,name,expiry_date,folder,created_at,deleted_at)').in('related_type', ['vehicle', 'asset']).eq('related_id', id).limit(100),
    edit ? c.supabase.from('employees').select('id,full_name').neq('status', 'archived').order('full_name').limit(1000) : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
    edit ? c.supabase.from('suppliers').select('name').order('name').limit(500) : Promise.resolve({ data: [] as { name: string }[] }),
  ])
  const docs = new Map<string, any>()
  for (const d of owned ?? []) docs.set(d.id, d)
  for (const r of rel ?? []) { const d: any = r.document; if (d && !d.deleted_at && !docs.has(d.id)) docs.set(d.id, d) }
  const deadlines = assetDeadlines(a, c.today)
  const st = ASSET_STATUS[a.status] ?? { label: a.status, tone: 'neutral' as const }
  const kinds = isV ? VEHICLE_DOCS : ASSET_DOCS
  const facts: [string, React.ReactNode][] = isV
    ? [['Plate', [a.plate_or_serial, a.plate_emirate].filter(Boolean).join(' · ') || '—'], ['Type', a.vehicle_type ?? '—'], ['Make / model', [a.make, a.model].filter(Boolean).join(' ') || '—'], ['Year', a.model_year ?? '—'],
      ['Mulkiya no.', a.mulkiya_no ?? '—'], ['Insurance provider', a.insurance_provider ?? '—']]
    : [['Type', EQUIPMENT_KINDS[a.kind] ?? a.kind], ['Category', a.category ?? '—'], ['Asset ID', a.asset_code ?? '—'], ['Serial number', a.serial_no ?? '—'],
      ['Purchased', a.purchase_date ? formatLongDate(a.purchase_date) : '—'], ['Purchase price', a.purchase_price != null ? formatAed(a.purchase_price) : '—'], ['Supplier', a.supplier_name ?? '—'], ['Location', a.location ?? '—']]

  return <>
    <Link href={`/assets?tab=${a.archived_at ? 'archived' : isV ? 'vehicles' : 'assets'}`} className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg"><ArrowLeft size={14} />Vehicles & Assets</Link>
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold tracking-tight">{a.name}</h1><Badge tone={st.tone}>{st.label}</Badge>{a.archived_at && <Badge>Archived</Badge>}</div>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
          {isV ? <span>{[a.plate_or_serial, a.make, a.model, a.model_year].filter(Boolean).join(' · ')}</span> : <span>{[a.category, a.asset_code].filter(Boolean).join(' · ')}</span>}
          {a.employee && <Link href={`/employees/${a.employee.id}`} className="inline-flex items-center gap-1 hover:text-primary"><UserRound size={13} aria-hidden />{a.employee.full_name}</Link>}
          {a.location && <span className="inline-flex items-center gap-1"><MapPin size={13} aria-hidden />{a.location}</span>}
        </div>
      </div>
      {edit && <div className="flex flex-wrap gap-2">
        <DialogButton wide variant="secondary" label="Edit" title={`Edit ${isV ? 'vehicle' : 'asset'}`} icon={<Pencil size={14} />}><ActionForm action={updateAsset.bind(null, id)} resetOnSuccess={false}><AssetFields kind={isV ? 'vehicle' : 'asset'} a={a} employees={emps ?? []} suppliers={(sups ?? []).map(s => s.name)} /></ActionForm></DialogButton>
        {a.archived_at ? <ActionButton size="md" action={setAssetArchived.bind(null, id, false)}><ArchiveRestore size={14} />Restore</ActionButton>
          : <ActionButton size="md" variant="ghost" action={setAssetArchived.bind(null, id, true)} confirm="Archive this item? Its documents and history are kept; reminders stop."><Archive size={14} />Archive</ActionButton>}
      </div>}
    </div>
    {a.archived_at && <div className="mb-4"><Alert tone="amber">Archived on {formatLongDate(a.archived_at.slice(0, 10))}. No reminders are sent for archived items.</Alert></div>}

    <div className="grid gap-5 xl:grid-cols-3">
      <Card className="xl:col-span-2"><CardHeader title="Details" />
        <dl className="grid gap-x-6 gap-y-3 p-4 text-sm sm:grid-cols-2">{facts.map(([k, v]) => <div key={k}><dt className="text-xs text-muted">{k}</dt><dd className="mt-0.5 break-words font-medium">{v}</dd></div>)}</dl>
        {a.notes && <p className="whitespace-pre-wrap break-words border-t border-border px-4 py-3 text-sm text-muted">{a.notes}</p>}
      </Card>
      <Card><CardHeader title="Expiry & reminders" sub="Reminders are sent automatically (Smart Reminders schedule)" action={<BellRing size={15} className="text-muted" aria-hidden />} />
        {!deadlines.length ? <p className="px-4 py-5 text-sm text-muted">No dates set. {edit && 'Use Edit to add Mulkiya, insurance, warranty or maintenance dates.'}</p>
          : <ul className="divide-y divide-border">{deadlines.map(d => <li key={d.key} className="flex items-center gap-3 px-4 py-2.5 text-sm"><span className="flex-1">{d.label}</span>
            <span className="tabular-nums text-xs text-muted">{formatLongDate(d.date)}</span><Badge tone={deadlineTone(d.days)}>{d.days < 0 ? `${-d.days}d overdue` : d.days === 0 ? 'today' : `${d.days}d`}</Badge></li>)}</ul>}
      </Card>

      <Card className="xl:col-span-3"><CardHeader title="Documents" sub={isV ? 'Mulkiya, insurance, inspection, maintenance — private and versioned' : 'Invoices, warranty, maintenance records — private and versioned'}
        action={c.can('documents.upload') && !a.archived_at ? <DialogButton size="sm" label="Upload" title="Upload documents" icon={<Upload size={14} />}><ActionForm action={uploadAssetFiles.bind(null, id)} submit="Upload">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Document type"><Select name="doc_type" defaultValue={isV ? 'mulkiya' : 'invoice'}>{Object.entries(kinds).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
            <Field label="Expiry date" hint="Optional — creates expiry reminders"><Input name="expiry_date" type="date" /></Field>
            <Field label="Reference / policy no." className="sm:col-span-2"><Input name="reference_no" maxLength={100} /></Field>
            <Field label="Files *" hint="PDF or images, up to 10" className="sm:col-span-2"><input type="file" name="file" multiple required accept={ACCEPT_ATTR} className="text-sm" /></Field>
          </div></ActionForm></DialogButton> : null} />
        {!docs.size ? <EmptyState icon={FileText} title="No documents yet" body={isV ? 'Upload the Mulkiya and insurance here, or drop them into the Smart Inbox — it matches them to this vehicle by plate number.' : 'Upload the purchase invoice, warranty card or service reports.'} />
          : <ul className="grid sm:grid-cols-2 xl:grid-cols-3">{[...docs.values()].map(d => <li key={d.id} className="border-b border-border">
            <Link href={`/documents/${d.id}`} className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-surface-2/60"><FileText size={16} className="shrink-0 text-primary" aria-hidden />
              <span className="min-w-0 flex-1"><span className="block truncate font-medium">{d.name}</span><span className="block truncate text-xs text-muted">{d.expiry_date ? `expires ${formatLongDate(d.expiry_date)}` : d.created_at.slice(0, 10)}</span></span></Link></li>)}</ul>}
      </Card>
    </div>
  </>
}
