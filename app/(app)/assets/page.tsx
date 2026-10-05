import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AlertTriangle, Archive, CarFront, Plus, Truck, Wrench } from 'lucide-react'
import { getCtx } from '@/lib/auth'
import { PAGE_SIZE, flat, pageOf, sanitizeQ } from '@/lib/queries'
import { Badge, Card, EmptyState, LinkButton, PageHeader, Pagination, StatCard, Td, Th, TableWrap } from '@/components/ui/primitives'
import { DialogButton } from '@/components/ui/dialog'
import { ActionForm } from '@/components/ui/action-form'
import { AssetFields } from '@/components/assets/asset-fields'
import { createAsset } from '@/app/actions/assets'
import { ASSET_STATUS, EQUIPMENT_KINDS, VEHICLE_TYPES, assetDeadlines, deadlineTone } from '@/lib/assets'
import { addDays } from '@/lib/time'
import { cn } from '@/lib/utils'

export const metadata = { title: 'Vehicles & Assets' }
const TABS = [['vehicles', 'Vehicles', CarFront], ['assets', 'Equipment & assets', Wrench], ['archived', 'Archived', Archive]] as const

export default async function AssetsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await getCtx(); if (!c.can('documents.view')) redirect('/')
  const sp = await flat(searchParams)
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : 'vehicles'
  const page = pageOf(sp.page), term = sanitizeQ(sp.q), soon = addDays(c.today, 30)
  const edit = c.can('records.edit')

  // one page of rows from the server (search / filter / sort in SQL), never the whole table
  let q = c.supabase.from('assets').select('id,kind,name,category,asset_code,plate_or_serial,plate_emirate,vehicle_type,make,model,model_year,status,location,registration_expiry,insurance_expiry,warranty_expiry,next_service_date,archived_at,employee:employees(full_name)', { count: 'exact' })
  q = tab === 'archived' ? q.not('archived_at', 'is', null) : q.is('archived_at', null)
  if (tab === 'vehicles') q = q.eq('kind', 'vehicle'); else if (tab === 'assets') q = q.neq('kind', 'vehicle')
  if (term) q = q.or(`name.ilike.%${term}%,plate_or_serial.ilike.%${term}%,asset_code.ilike.%${term}%,serial_no.ilike.%${term}%,make.ilike.%${term}%,model.ilike.%${term}%,category.ilike.%${term}%,location.ilike.%${term}%`)
  if (sp.status && sp.status in ASSET_STATUS) q = q.eq('status', sp.status)
  if (sp.type) q = tab === 'vehicles' ? q.eq('vehicle_type', sp.type) : q.eq('kind', sp.type)
  if (sp.due === '30') q = q.or(`registration_expiry.lte.${soon},insurance_expiry.lte.${soon},warranty_expiry.lte.${soon},next_service_date.lte.${soon}`)
  const sort = sp.sort === 'name' ? 'name' : 'created_at'
  const [{ data: rows, count }, counts, { data: emps }, { data: sups }] = await Promise.all([
    q.order(sort, { ascending: sort === 'name' }).range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1),
    Promise.all([
      c.supabase.from('assets').select('id', { count: 'exact', head: true }).eq('kind', 'vehicle').is('archived_at', null),
      c.supabase.from('assets').select('id', { count: 'exact', head: true }).neq('kind', 'vehicle').is('archived_at', null),
      c.supabase.from('assets').select('id', { count: 'exact', head: true }).is('archived_at', null).or(`registration_expiry.lte.${soon},insurance_expiry.lte.${soon},warranty_expiry.lte.${soon},next_service_date.lte.${soon}`),
      c.supabase.from('assets').select('id', { count: 'exact', head: true }).is('archived_at', null).eq('status', 'in_maintenance'),
    ]),
    edit ? c.supabase.from('employees').select('id,full_name').neq('status', 'archived').order('full_name').limit(1000) : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
    edit ? c.supabase.from('suppliers').select('name').order('name').limit(500) : Promise.resolve({ data: [] as { name: string }[] }),
  ])
  const [nV, nA, nDue, nMaint] = counts.map(r => r.count ?? 0)
  const cls = 'h-9 rounded-md border border-border bg-surface px-3 text-sm'
  const isV = tab === 'vehicles'

  return <>
    <PageHeader title="Vehicles & Assets" sub="Vehicles, Mulkiya & insurance, machinery and equipment — with documents and automatic expiry reminders."
      actions={edit && tab !== 'archived' ? <>
        <DialogButton wide label="Add vehicle" title="Add vehicle" icon={<Plus size={15} />} variant={isV ? 'primary' : 'secondary'}><ActionForm action={createAsset} submit="Save vehicle"><AssetFields kind="vehicle" employees={emps ?? []} suppliers={(sups ?? []).map(s => s.name)} /></ActionForm></DialogButton>
        <DialogButton wide label="Add asset" title="Add equipment / asset" icon={<Plus size={15} />} variant={isV ? 'secondary' : 'primary'}><ActionForm action={createAsset} submit="Save asset"><AssetFields kind="asset" employees={emps ?? []} suppliers={(sups ?? []).map(s => s.name)} /></ActionForm></DialogButton>
      </> : null} />
    <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Vehicles" value={nV} icon={Truck} tone="blue" href="/assets?tab=vehicles" />
      <StatCard label="Equipment & assets" value={nA} icon={Wrench} href="/assets?tab=assets" />
      <StatCard label="Expiring / due in 30 days" value={nDue} icon={AlertTriangle} tone={nDue ? 'amber' : 'neutral'} href={`/assets?tab=${tab === 'archived' ? 'vehicles' : tab}&due=30`} />
      <StatCard label="In maintenance" value={nMaint} icon={Wrench} tone={nMaint ? 'amber' : 'neutral'} href={`/assets?tab=${tab === 'archived' ? 'vehicles' : tab}&status=in_maintenance`} />
    </div>
    <nav aria-label="Asset lists" className="mb-4 flex gap-1 overflow-x-auto border-b border-border">{TABS.map(([k, l, I]) => <Link key={k} href={`/assets?tab=${k}`} aria-current={tab === k ? 'page' : undefined}
      className={cn('-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3.5 py-2 text-sm', tab === k ? 'border-primary font-medium text-primary' : 'border-transparent text-muted hover:text-fg')}><I size={14} aria-hidden />{l}</Link>)}</nav>
    <Card>
      <form className="flex flex-wrap gap-2 border-b border-border p-3"><input type="hidden" name="tab" value={tab} />
        <input name="q" type="search" defaultValue={sp.q} aria-label="Search vehicles and assets" placeholder={isV ? 'Search name, plate, make, model…' : 'Search name, asset ID, serial, category, location…'} className={`${cls} min-w-52 flex-1`} />
        <select name="status" defaultValue={sp.status ?? ''} aria-label="Status" className={cls}><option value="">Any status</option>{Object.entries(ASSET_STATUS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}</select>
        {tab !== 'archived' && <select name="type" defaultValue={sp.type ?? ''} aria-label="Type" className={cls}><option value="">Any type</option>{isV ? VEHICLE_TYPES.map(v => <option key={v}>{v}</option>) : Object.entries(EQUIPMENT_KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>}
        <select name="due" defaultValue={sp.due ?? ''} aria-label="Expiry" className={cls}><option value="">Any expiry</option><option value="30">Expiring / due within 30 days</option></select>
        <button className="h-9 cursor-pointer rounded-md border border-border px-3 text-sm hover:bg-surface-2">Filter</button>
        {(sp.q || sp.status || sp.type || sp.due) && <LinkButton href={`/assets?tab=${tab}`} variant="ghost">Clear</LinkButton>}</form>
      {!rows?.length ? <EmptyState icon={isV ? Truck : Wrench} title={term || sp.status || sp.type || sp.due ? 'Nothing matches' : tab === 'archived' ? 'No archived items' : isV ? 'No vehicles yet' : 'No equipment yet'}
        body={tab === 'archived' ? 'Archived vehicles and assets keep their documents and history.' : isV ? 'Add a vehicle with its Mulkiya and insurance expiry — reminders are created automatically.' : 'Add welding machines, generators, compressors and other equipment with warranty and maintenance dates.'} />
        : <TableWrap><thead className="bg-surface-2/50"><tr><Th>{isV ? 'Vehicle' : 'Asset'}</Th><Th>{isV ? 'Plate' : 'Asset ID / serial'}</Th><Th>{isV ? 'Make / model' : 'Category / location'}</Th><Th>Assigned to</Th><Th>Next deadline</Th><Th>Status</Th></tr></thead>
          <tbody className="divide-y divide-border">{rows.map((a: any) => {
            const next = assetDeadlines(a, c.today)[0]
            return <tr key={a.id} className="hover:bg-surface-2/50">
              <Td><Link href={`/assets/${a.id}`} className="font-medium text-primary hover:underline">{a.name}</Link>{a.kind !== 'vehicle' && <div className="text-xs text-muted">{EQUIPMENT_KINDS[a.kind] ?? a.kind}</div>}</Td>
              <Td className="whitespace-nowrap">{a.kind === 'vehicle' ? <>{a.plate_or_serial ?? '—'}{a.plate_emirate && <span className="ms-1 text-xs text-muted">{a.plate_emirate}</span>}</> : <span className="font-mono text-xs">{a.asset_code ?? a.plate_or_serial ?? '—'}</span>}</Td>
              <Td className="text-muted">{a.kind === 'vehicle' ? [a.make, a.model, a.model_year].filter(Boolean).join(' ') || '—' : [a.category, a.location].filter(Boolean).join(' · ') || '—'}</Td>
              <Td className="text-muted">{a.employee?.full_name ?? '—'}</Td>
              <Td>{next ? <Badge tone={deadlineTone(next.days)}>{next.label}: {next.days < 0 ? `${-next.days}d overdue` : `${next.days}d`}</Badge> : <span className="text-muted">—</span>}</Td>
              <Td><Badge tone={ASSET_STATUS[a.status]?.tone}>{ASSET_STATUS[a.status]?.label ?? a.status}</Badge></Td></tr>
          })}</tbody></TableWrap>}
      <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} params={sp} base="/assets" />
    </Card>
  </>
}
