import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Archive, CarFront, Download, Plus, Truck, Wrench } from 'lucide-react'
import { getCtx } from '@/lib/auth'
import { PAGE_SIZE, flat, pageOf, sanitizeQ } from '@/lib/queries'
import { Badge, Card, EmptyState, LinkButton, Metrics, PageHeader, Pagination, StatCard, Td, Th, TableWrap } from '@/components/ui/primitives'
import { DialogButton } from '@/components/ui/dialog'
import { ActionForm } from '@/components/ui/action-form'
import { AssetFields } from '@/components/assets/asset-fields'
import { createAsset } from '@/app/actions/assets'
import { ASSET_STATUS, CONDITIONS, EQUIPMENT_KINDS, VEHICLE_TYPES, deadlineTone, kmToService } from '@/lib/assets'
import { addDays, daysBetween, formatShortDate } from '@/lib/time'
import { cn } from '@/lib/utils'
import { SavedViews } from '@/components/saved-views'

export const metadata = { title: 'Vehicles & Assets' }
const TABS = [['vehicles', 'Vehicles', CarFront], ['assets', 'Equipment & assets', Wrench], ['archived', 'Archived', Archive]] as const

/** A date cell that turns amber within 30 days and red once passed. */
function Due({ date, today }: { date?: string | null; today: string }) {
  if (!date) return <span className="text-muted/60">Not set</span>
  const d = daysBetween(today, date), t = deadlineTone(d)
  return <span className={cn('whitespace-nowrap tabular-nums', t === 'red' ? 'font-medium text-danger' : t === 'amber' ? 'font-medium text-warning' : '')} title={d < 0 ? `${-d} days overdue` : `in ${d} days`}>{formatShortDate(date)}</span>
}

export default async function AssetsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await getCtx(); if (!c.can('documents.view')) redirect('/')
  const sp = await flat(searchParams)
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : 'vehicles'
  const page = pageOf(sp.page), term = sanitizeQ(sp.q), soon = addDays(c.today, 30)
  const edit = c.can('records.edit'), isV = tab === 'vehicles'
  const dueOr = `registration_expiry.lte.${soon},insurance_expiry.lte.${soon},inspection_expiry.lte.${soon},warranty_expiry.lte.${soon},next_service_date.lte.${soon}`

  // one page of rows from the server (search / filter / sort in SQL), never the whole table
  let q = c.supabase.from('assets').select('id,kind,name,category,asset_code,plate_or_serial,plate_emirate,vehicle_type,make,model,model_year,status,condition,location,registration_expiry,insurance_expiry,inspection_expiry,warranty_expiry,next_service_date,current_mileage,next_service_km,archived_at,employee:employees(id,full_name)', { count: 'exact' })
  q = tab === 'archived' ? q.not('archived_at', 'is', null) : q.is('archived_at', null)
  if (tab === 'vehicles') q = q.eq('kind', 'vehicle'); else if (tab === 'assets') q = q.neq('kind', 'vehicle')
  if (term) q = q.or(`name.ilike.%${term}%,plate_or_serial.ilike.%${term}%,asset_code.ilike.%${term}%,serial_no.ilike.%${term}%,make.ilike.%${term}%,model.ilike.%${term}%,category.ilike.%${term}%,location.ilike.%${term}%,vin.ilike.%${term}%`)
  if (sp.status && sp.status in ASSET_STATUS) q = q.eq('status', sp.status)
  if (sp.type) q = tab === 'vehicles' ? q.eq('vehicle_type', sp.type) : q.eq('kind', sp.type)
  if (sp.due === '30') q = q.or(dueOr)
  if (sp.unassigned === '1') q = q.is('assigned_to', null)
  const sort = ['name', 'registration_expiry', 'insurance_expiry', 'next_service_date', 'warranty_expiry'].includes(sp.sort ?? '') ? sp.sort! : 'name'
  const head = { count: 'exact' as const, head: true }
  const base = () => c.supabase.from('assets').select('id', head).is('archived_at', null)
  const [{ data: rows, count }, counts, { data: emps }, { data: sups }] = await Promise.all([
    q.order(sort, { ascending: true, nullsFirst: false }).order('name').range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1),
    Promise.all([
      base().eq('kind', 'vehicle'), base().neq('kind', 'vehicle'), base().or(dueOr),
      base().in('status', ['in_maintenance', 'in_repair']), base().neq('kind', 'vehicle').is('assigned_to', null).in('status', ['active', 'available']),
    ]),
    edit ? c.supabase.from('employees').select('id,full_name').neq('status', 'archived').order('full_name').limit(1000) : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
    edit ? c.supabase.from('suppliers').select('name').order('name').limit(500) : Promise.resolve({ data: [] as { name: string }[] }),
  ])
  const [nV, nA, nDue, nMaint, nFree] = counts.map(r => r.count ?? 0)
  const cls = 'h-9 rounded-md border border-border bg-surface px-3 text-sm hover:border-border-strong'
  const filtered = !!(term || sp.status || sp.type || sp.due || sp.unassigned)
  const sortLink = (col: string, label: string) => <Link href={`/assets?${new URLSearchParams({ ...Object.fromEntries(Object.entries(sp).filter(([, v]) => v)) as Record<string, string>, sort: col, page: '1' })}`} className={cn('hover:text-fg', sort === col && 'text-fg')}>{label}{sort === col ? ' ↑' : ''}</Link>
  const addVehicle = <DialogButton wide label="Add vehicle" title="Add vehicle" icon={<Plus size={15} />} variant={isV ? 'primary' : 'secondary'} openParam="vehicle"><ActionForm action={createAsset} submit="Save vehicle" idempotent><AssetFields kind="vehicle" employees={emps ?? []} suppliers={(sups ?? []).map(s => s.name)} /></ActionForm></DialogButton>
  const addAsset = <DialogButton wide label="Add asset" title="Add asset or equipment" icon={<Plus size={15} />} variant={isV ? 'secondary' : 'primary'} openParam="asset"><ActionForm action={createAsset} submit="Save asset" idempotent><AssetFields kind="asset" employees={emps ?? []} suppliers={(sups ?? []).map(s => s.name)} /></ActionForm></DialogButton>

  return <>
    <PageHeader title="Vehicles & Assets" sub="Company vehicles and equipment with registration, insurance, maintenance and assignment history."
      actions={<><SavedViews page="/assets" />{c.can('data.export') && tab !== 'archived' && <><LinkButton variant="ghost" href={`/api/export/${isV ? 'vehicles' : 'assets'}`}><Download size={15} />CSV</LinkButton><LinkButton variant="ghost" href={`/api/export/${isV ? 'vehicles' : 'assets'}?format=xlsx`}><Download size={15} />Excel</LinkButton></>}
        {edit && tab !== 'archived' && <>{addVehicle}{addAsset}</>}</>} />
    <Metrics className="mb-5" cols={5}>
      <StatCard label="Vehicles" value={nV} href="/assets?tab=vehicles" />
      <StatCard label="Equipment & assets" value={nA} href="/assets?tab=assets" />
      <StatCard label="Renewals or service due in 30 days" value={nDue} tone={nDue ? 'red' : 'neutral'} href={`/assets?tab=${isV || tab === 'archived' ? 'vehicles' : 'assets'}&due=30`} />
      <StatCard label="In maintenance or repair" value={nMaint} href={`/assets?tab=${isV || tab === 'archived' ? 'vehicles' : 'assets'}&status=in_maintenance`} />
      <StatCard label="Equipment available" value={nFree} hint="Not assigned to anyone" href="/assets?tab=assets&unassigned=1" />
    </Metrics>
    <nav aria-label="Asset lists" className="mb-4 flex gap-1 overflow-x-auto border-b border-border">{TABS.map(([k, l, I]) => <Link key={k} href={`/assets?tab=${k}`} aria-current={tab === k ? 'page' : undefined}
      className={cn('-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors', tab === k ? 'border-primary font-medium text-fg' : 'border-transparent text-muted hover:text-fg')}><I size={14} aria-hidden />{l}</Link>)}</nav>
    <Card>
      <form className="flex flex-wrap gap-2 border-b border-border p-3"><input type="hidden" name="tab" value={tab} />{sp.sort && <input type="hidden" name="sort" value={sp.sort} />}
        <input name="q" type="search" defaultValue={sp.q} aria-label="Search vehicles and assets" placeholder={isV ? 'Search name, plate, make, VIN…' : 'Search name, code, serial, brand, location…'} className={`${cls} min-w-52 flex-1`} />
        <select name="status" defaultValue={sp.status ?? ''} aria-label="Status" className={cls}><option value="">Any status</option>{Object.entries(ASSET_STATUS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}</select>
        {tab !== 'archived' && <select name="type" defaultValue={sp.type ?? ''} aria-label="Type" className={cls}><option value="">Any type</option>{isV ? VEHICLE_TYPES.map(v => <option key={v}>{v}</option>) : Object.entries(EQUIPMENT_KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>}
        <select name="due" defaultValue={sp.due ?? ''} aria-label="Due dates" className={cls}><option value="">Any dates</option><option value="30">Due within 30 days</option></select>
        <button className={`${cls} cursor-pointer`}>Filter</button>
        {filtered && <LinkButton href={`/assets?tab=${tab}`} variant="ghost">Clear</LinkButton>}</form>
      {!rows?.length ? <EmptyState icon={isV ? Truck : Wrench} title={filtered ? 'Nothing matches these filters' : tab === 'archived' ? 'No archived items' : isV ? 'No vehicles yet' : 'No equipment yet'}
        body={filtered ? 'Try a different search or clear the filters.' : tab === 'archived' ? 'Archived vehicles and assets keep their documents and history.' : isV ? 'Add your first company vehicle to start tracking registration, insurance and maintenance.' : 'Add welding machines, generators, compressors and tools to track assignment, warranty and maintenance.'}
        action={!filtered && edit && tab !== 'archived' ? (isV ? addVehicle : addAsset) : undefined} />
        : isV ? <TableWrap><thead><tr><Th>{sortLink('name', 'Vehicle')}</Th><Th>Plate</Th><Th>Make / model</Th><Th>Driver</Th><Th>{sortLink('registration_expiry', 'Registration')}</Th><Th>{sortLink('insurance_expiry', 'Insurance')}</Th><Th>{sortLink('next_service_date', 'Next service')}</Th><Th>Status</Th><Th className="text-end"><span className="sr-only">Actions</span></Th></tr></thead>
          <tbody className="divide-y divide-border">{rows.map((a: any) => { const km = kmToService(a); return <tr key={a.id} className="hover:bg-surface-2/40">
            <Td className="max-w-[220px]"><Link href={`/assets/${a.id}`} className="block truncate font-medium hover:text-primary" title={a.name}>{a.name}</Link>{a.vehicle_type && <div className="text-xs text-muted">{a.vehicle_type}</div>}</Td>
            <Td className="whitespace-nowrap">{a.plate_or_serial ?? <span className="text-muted/60">Not set</span>}{a.plate_emirate && <div className="text-xs text-muted">{a.plate_emirate}</div>}</Td>
            <Td className="text-muted">{[a.make, a.model, a.model_year].filter(Boolean).join(' ') || '—'}</Td>
            <Td>{a.employee ? <Link href={`/employees/${a.employee.id}`} className="hover:text-primary">{a.employee.full_name}</Link> : <span className="text-muted/60">Unassigned</span>}</Td>
            <Td><Due date={a.registration_expiry} today={c.today} /></Td><Td><Due date={a.insurance_expiry} today={c.today} /></Td>
            <Td><Due date={a.next_service_date} today={c.today} />{km != null && <div className={cn('text-xs tabular-nums', km <= 500 ? 'text-warning' : 'text-muted')}>{km <= 0 ? `${(-km).toLocaleString('en-US')} km over` : `in ${km.toLocaleString('en-US')} km`}</div>}</Td>
            <Td><Badge tone={ASSET_STATUS[a.status]?.tone}>{ASSET_STATUS[a.status]?.label ?? a.status}</Badge></Td>
            <Td className="text-end"><Link href={`/assets/${a.id}`} className="text-sm font-medium text-primary hover:underline">View</Link></Td></tr> })}</tbody></TableWrap>
        : <TableWrap><thead><tr><Th>{sortLink('name', 'Asset')}</Th><Th>Code / serial</Th><Th>Category</Th><Th>Assigned to</Th><Th>Location</Th><Th>{sortLink('warranty_expiry', 'Warranty')}</Th><Th>{sortLink('next_service_date', 'Next maintenance')}</Th><Th>Condition</Th><Th>Status</Th><Th className="text-end"><span className="sr-only">Actions</span></Th></tr></thead>
          <tbody className="divide-y divide-border">{rows.map((a: any) => <tr key={a.id} className="hover:bg-surface-2/40">
            <Td className="max-w-[220px]"><Link href={`/assets/${a.id}`} className="block truncate font-medium hover:text-primary" title={a.name}>{a.name}</Link><div className="truncate text-xs text-muted">{[a.make, a.model].filter(Boolean).join(' ') || (a.kind === 'vehicle' ? 'Vehicle' : EQUIPMENT_KINDS[a.kind] ?? a.kind)}</div></Td>
            <Td className="font-mono text-xs">{a.asset_code ?? a.plate_or_serial ?? '—'}</Td>
            <Td className="text-muted">{a.category ?? '—'}</Td>
            <Td>{a.employee ? <Link href={`/employees/${a.employee.id}`} className="hover:text-primary">{a.employee.full_name}</Link> : <span className="text-muted/60">Available</span>}</Td>
            <Td className="max-w-[180px] truncate text-muted" title={a.location ?? undefined}>{a.location ?? '—'}</Td>
            <Td><Due date={a.warranty_expiry} today={c.today} /></Td><Td><Due date={a.next_service_date} today={c.today} /></Td>
            <Td className="text-muted">{a.condition ? CONDITIONS[a.condition] : '—'}</Td>
            <Td><Badge tone={ASSET_STATUS[a.status]?.tone}>{ASSET_STATUS[a.status]?.label ?? a.status}</Badge></Td>
            <Td className="text-end"><Link href={`/assets/${a.id}`} className="text-sm font-medium text-primary hover:underline">View</Link></Td></tr>)}</tbody></TableWrap>}
      <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} params={sp} base="/assets" />
    </Card>
  </>
}
