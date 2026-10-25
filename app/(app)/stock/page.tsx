import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AlertTriangle, Archive, ArchiveRestore, ArrowDownLeft, ArrowUpRight, Boxes, Pencil, Plus, Wallet } from '@/components/icons'
import { getCtx } from '@/lib/auth'
import { PAGE_SIZE, flat, pageOf, sanitizeQ } from '@/lib/queries'
import { Badge, Card, EmptyState, Field, Input, Metrics, PageHeader, Pagination, Select, StatCard, Td, Th, TableWrap, Textarea, type Tone } from '@/components/ui/primitives'
import { DialogButton } from '@/components/ui/dialog'
import { ActionButton, ActionForm } from '@/components/ui/action-form'
import { recordStockMovement, saveStockItem, setStockItemActive } from '@/app/actions/stock'
import { fmtMoney } from '@/lib/sales/money'
import { cn } from '@/lib/utils'

export const metadata = { title: 'Stock' }
const KIND: Record<string, [string, Tone]> = { opening: ['Opening', 'neutral'], receipt: ['Received', 'green'], issue: ['Issued', 'blue'], return: ['Returned', 'amber'], adjustment: ['Adjusted', 'neutral'] }
const UNITS = ['Nos', 'Kg', 'Ton', 'Rmt', 'Mtr', 'Sq.Mtr', 'Sheet', 'Length', 'Box', 'Roll', 'Ltr', 'Set', 'Pcs']
const num = (n: number | string) => Number(n).toLocaleString('en-AE', { maximumFractionDigits: 3 })
type Item = { id: string; name: string; sku: string | null; category: string | null; unit: string; location: string | null; reorder_level: number; reorder_qty: number; on_hand: number; avg_cost: number; supplier_id: string | null; notes: string | null; active: boolean }
const isLow = (i: Item) => Number(i.reorder_level) > 0 && Number(i.on_hand) <= Number(i.reorder_level)

function ItemFields({ i, units, cats, suppliers }: { i?: Item; units: string[]; cats: string[]; suppliers: { id: string; name: string }[] }) {
  const k = i?.id ?? 'new'   // one form per item on the page: the suggestion lists need their own ids
  return <>
    <div className="grid gap-4 sm:grid-cols-3">
      <Field label="Item name *" className="sm:col-span-2"><Input name="name" required maxLength={200} defaultValue={i?.name} placeholder="e.g. MS Plate 6mm 1250×2500" /></Field>
      <Field label="Code / SKU"><Input name="sku" maxLength={40} defaultValue={i?.sku ?? ''} placeholder="e.g. MSP-06" /></Field>
      <Field label="Category"><Input name="category" maxLength={80} list={`stock-cats-${k}`} defaultValue={i?.category ?? ''} placeholder="e.g. Plates" /></Field>
      <Field label="Unit *"><Input name="unit" required maxLength={20} list={`stock-units-${k}`} defaultValue={i?.unit ?? 'Nos'} /></Field>
      <Field label="Location"><Input name="location" maxLength={80} defaultValue={i?.location ?? ''} placeholder="e.g. Yard rack B" /></Field>
      <Field label="Reorder level" hint="“Running low” when on hand falls to this."><Input name="reorder_level" type="number" step="any" min="0" defaultValue={i ? Number(i.reorder_level) : ''} /></Field>
      <Field label="Usual reorder quantity"><Input name="reorder_qty" type="number" step="any" min="0" defaultValue={i ? Number(i.reorder_qty) : ''} /></Field>
      <Field label="Usual supplier"><Select name="supplier_id" defaultValue={i?.supplier_id ?? ''}><option value="">—</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
    </div>
    {!i && <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Opening quantity" hint="What is on the shelf today. Leave empty to start at zero."><Input name="opening_qty" type="number" step="any" min="0" /></Field>
      <Field label="Cost per unit (AED)"><Input name="opening_cost" type="number" step="0.01" min="0" /></Field></div>}
    <Field label="Notes"><Textarea name="notes" rows={2} maxLength={1000} defaultValue={i?.notes ?? ''} /></Field>
    <datalist id={`stock-units-${k}`}>{units.map(u => <option key={u} value={u} />)}</datalist>
    <datalist id={`stock-cats-${k}`}>{cats.map(u => <option key={u} value={u} />)}</datalist>
  </>
}

function MoveFields({ kind, items, today, projects, orders, suppliers, item }: { kind: 'receipt' | 'issue' | 'adjustment'; items: Item[]; today: string; projects: { id: string; name: string }[]; orders: { id: string; number: string | null; title: string }[]; suppliers: { id: string; name: string }[]; item?: string }) {
  return <>
    <input type="hidden" name="kind" value={kind} />
    <div className="grid gap-4 sm:grid-cols-3">
      <Field label="Item *" className="sm:col-span-2"><Select name="item_id" required defaultValue={item ?? ''}><option value="" disabled>Choose an item…</option>
        {items.map(i => <option key={i.id} value={i.id}>{i.name}{i.sku ? ` (${i.sku})` : ''} · {num(i.on_hand)} {i.unit} on hand</option>)}</Select></Field>
      <Field label="Date *"><Input name="moved_on" type="date" required defaultValue={today} max={today} /></Field>
      {kind === 'adjustment' && <Field label="Direction *"><Select name="direction" defaultValue="out"><option value="out">Less than recorded (remove)</option><option value="in">More than recorded (add)</option></Select></Field>}
      <Field label="Quantity *"><Input name="qty" type="number" step="any" min="0" required /></Field>
      {kind === 'receipt' && <Field label="Cost per unit (AED)" hint="Sets the average cost."><Input name="unit_cost" type="number" step="0.01" min="0" /></Field>}
      {kind === 'receipt' && <Field label="Supplier"><Select name="supplier_id" defaultValue=""><option value="">—</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>}
      {kind === 'receipt' && <Field label="Supplier invoice / DN / PO no."><Input name="reference" maxLength={120} /></Field>}
      {kind === 'issue' && <Field label="Project"><Select name="project_id" defaultValue=""><option value="">— (workshop use)</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>}
      {kind === 'issue' && <Field label="Work order"><Select name="work_order_id" defaultValue=""><option value="">—</option>{orders.map(o => <option key={o.id} value={o.id}>{o.number ? `${o.number} · ` : ''}{o.title}</option>)}</Select></Field>}
    </div>
    <Field label={kind === 'adjustment' ? 'Reason *' : 'Notes'}><Textarea name="notes" rows={2} maxLength={1000} required={kind === 'adjustment'} placeholder={kind === 'adjustment' ? 'e.g. Stock take 23 Oct: 2 sheets damaged' : undefined} /></Field>
  </>
}

export default async function StockPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await getCtx(); if (!c.can('documents.view')) redirect('/')
  const sp = await flat(searchParams), page = pageOf(sp.page), term = sanitizeQ(sp.q), edit = c.can('records.edit')
  const tab = sp.tab === 'movements' ? 'movements' : 'items'
  const monthStart = c.today.slice(0, 8) + '01'

  const [{ data: all }, { data: sups }, { data: projs }, { data: wos }, { count: monthMoves }] = await Promise.all([
    c.supabase.from('stock_items').select('id,name,sku,category,unit,location,reorder_level,reorder_qty,on_hand,avg_cost,supplier_id,notes,active').order('name').limit(5000),
    c.supabase.from('suppliers').select('id,name').order('name').limit(1000),
    edit ? c.supabase.from('projects').select('id,name').in('status', ['planning', 'active', 'on_hold']).order('name').limit(500) : Promise.resolve({ data: [] as any[] }),
    edit ? c.supabase.from('work_orders').select('id,number,title').not('status', 'in', '(completed,cancelled)').order('created_at', { ascending: false }).limit(300) : Promise.resolve({ data: [] as any[] }),
    c.supabase.from('stock_movements').select('id', { count: 'exact', head: true }).gte('moved_on', monthStart),
  ])
  const items = (all ?? []) as Item[], active = items.filter(i => i.active)
  const value = active.reduce((s, i) => s + Number(i.on_hand) * Number(i.avg_cost), 0), low = active.filter(isLow)
  const cats = [...new Set(items.map(i => i.category).filter(Boolean) as string[])].sort(), units = [...new Set([...UNITS, ...items.map(i => i.unit)])]
  const suppliers = sups ?? [], projects = projs ?? [], orders = wos ?? []
  const move = { items: active, today: c.today, projects, orders, suppliers }

  let list: Item[] = [], moves: any[] = [], total = 0
  if (tab === 'items') {
    list = items.filter(i => (sp.archived === '1' ? !i.active : i.active) && (!sp.low || isLow(i)) && (!sp.category || i.category === sp.category)
      && (!term || [i.name, i.sku, i.category, i.location].some(x => x?.toLowerCase().includes(term.toLowerCase()))))
    total = list.length; list = list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  } else {
    let q = c.supabase.from('stock_movements').select('id,kind,qty,unit_cost,moved_on,supplier_name,reference,notes,balance_after,item_id,stock_items(name,unit),projects(id,name),work_orders(number,title),profiles:created_by(full_name)', { count: 'exact' })
    if (sp.item && /^[0-9a-f-]{36}$/i.test(sp.item)) q = q.eq('item_id', sp.item)
    if (sp.kind && KIND[sp.kind]) q = q.eq('kind', sp.kind)
    const r = await q.order('moved_on', { ascending: false }).order('created_at', { ascending: false }).range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
    moves = r.data ?? []; total = r.count ?? 0
  }
  const cls = 'h-9 rounded-md border border-border bg-surface px-3 text-sm'
  const filtered = sp.item ? items.find(i => i.id === sp.item) : undefined

  return <>
    <PageHeader title="Stock" sub="Materials on hand: what came in from suppliers, what went out to each job, and what is running low."
      actions={edit && <>
        {active.length > 0 && <DialogButton wide variant="secondary" label="Issue to job" title="Issue stock to a job" icon={<ArrowUpRight size={14} />} openParam="issue"><ActionForm idempotent action={recordStockMovement.bind(null, null)} submit="Issue"><MoveFields kind="issue" {...move} item={filtered?.id} /></ActionForm></DialogButton>}
        {active.length > 0 && <DialogButton wide variant="secondary" label="Receive stock" title="Receive stock from a supplier" icon={<ArrowDownLeft size={14} />} openParam="receive"><ActionForm idempotent action={recordStockMovement.bind(null, null)} submit="Receive"><MoveFields kind="receipt" {...move} item={filtered?.id} /></ActionForm></DialogButton>}
        <DialogButton wide label="Add item" title="Add stock item" icon={<Plus size={15} />} openParam="stock_item"><ActionForm action={saveStockItem.bind(null, null)} submit="Add item"><ItemFields units={units} cats={cats} suppliers={suppliers} /></ActionForm></DialogButton></>} />

    <Metrics cols={4} className="mb-5">
      <StatCard label="Items in stock" value={active.filter(i => Number(i.on_hand) > 0).length} hint={`${active.length} tracked`} icon={Boxes} href="/stock" index={0} />
      <StatCard label="Stock value" value={<>AED {fmtMoney(value)}</>} hint="On hand × average cost" icon={Wallet} index={1} />
      <StatCard label="Running low" value={low.length} tone={low.length ? 'red' : 'neutral'} hint={low.length ? low.slice(0, 2).map(i => i.name).join(', ') + (low.length > 2 ? '…' : '') : 'Nothing below its reorder level'} icon={AlertTriangle} href="/stock?low=1" index={2} />
      <StatCard label="Movements this month" value={monthMoves ?? 0} icon={ArrowDownLeft} href="/stock?tab=movements" index={3} />
    </Metrics>


    {tab === 'items' ? <Card>
      <form className="flex flex-wrap gap-2 border-b border-border p-3">
        <input name="q" type="search" defaultValue={sp.q} aria-label="Search stock" placeholder="Search name, code, category, location…" className={`${cls} min-w-52 flex-1`} />
        <select name="category" defaultValue={sp.category ?? ''} aria-label="Category" className={cls}><option value="">All categories</option>{cats.map(x => <option key={x}>{x}</option>)}</select>
        <select name="low" defaultValue={sp.low ?? ''} aria-label="Level" className={cls}><option value="">Any level</option><option value="1">Running low</option></select>
        <select name="archived" defaultValue={sp.archived ?? ''} aria-label="Show" className={cls}><option value="">Active</option><option value="1">Archived</option></select>
        <button className="h-9 cursor-pointer rounded-md border border-border px-3 text-sm hover:bg-surface-2">Filter</button></form>
      {!list.length ? <EmptyState icon={Boxes} title={term || sp.low || sp.category ? 'Nothing matches' : 'No stock items yet'}
          body={term || sp.low || sp.category ? undefined : 'Add the materials you keep in the yard (plates, pipes, rods, paint) with what is on the shelf today. Receipts and issues keep the count after that.'} />
        : <TableWrap><thead className="bg-surface-2/50"><tr><Th>Item</Th><Th>Category</Th><Th className="text-right">On hand</Th><Th className="text-right">Reorder at</Th><Th className="text-right">Avg cost</Th><Th className="text-right">Value (AED)</Th>{edit && <Th />}</tr></thead>
          <tbody className="divide-y divide-border">{list.map(i => <tr key={i.id} className="hover:bg-surface-2/50">
            <Td><Link href={`/stock?tab=movements&item=${i.id}`} className="font-medium hover:text-primary">{i.name}</Link><div className="text-xs text-muted">{[i.sku, i.location].filter(Boolean).join(' · ') || '—'}</div></Td>
            <Td className="text-muted">{i.category ?? '—'}</Td>
            <Td className="text-right tabular-nums" badge>{isLow(i) ? <Badge tone="red">{num(i.on_hand)} {i.unit} · low</Badge> : <span className="font-medium">{num(i.on_hand)} <span className="text-muted">{i.unit}</span></span>}</Td>
            <Td className="text-right tabular-nums text-muted">{Number(i.reorder_level) ? num(i.reorder_level) : '—'}</Td>
            <Td className="text-right tabular-nums">{Number(i.avg_cost) ? fmtMoney(i.avg_cost) : '—'}</Td>
            <Td className="text-right tabular-nums">{fmtMoney(Number(i.on_hand) * Number(i.avg_cost))}</Td>
            {edit && <Td className="text-right"><div className="flex justify-end gap-1">
              <DialogButton wide size="sm" variant="ghost" label={<><Pencil size={13} /><span className="sr-only">Edit {i.name}</span></>} title={`Edit ${i.name}`}><ActionForm action={saveStockItem.bind(null, i.id)} resetOnSuccess={false}><ItemFields i={i} units={units} cats={cats} suppliers={suppliers} /></ActionForm></DialogButton>
              <DialogButton wide size="sm" variant="ghost" label={<><Plus size={13} /><span className="sr-only">Adjust count of {i.name}</span></>} title={`Adjust the count of ${i.name}`}><ActionForm idempotent action={recordStockMovement.bind(null, null)} submit="Save adjustment"><MoveFields kind="adjustment" {...move} item={i.id} /></ActionForm></DialogButton>
              <ActionButton variant="ghost" action={setStockItemActive.bind(null, i.id, !i.active)}>{i.active ? <><Archive size={13} /><span className="sr-only">Archive {i.name}</span></> : <><ArchiveRestore size={13} />Restore</>}</ActionButton></div></Td>}
          </tr>)}</tbody></TableWrap>}
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} params={sp} base="/stock" />
    </Card> : <Card>
      <form className="flex flex-wrap gap-2 border-b border-border p-3"><input type="hidden" name="tab" value="movements" />
        <select name="item" defaultValue={sp.item ?? ''} aria-label="Item" className={`${cls} min-w-52 flex-1`}><option value="">All items</option>{items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</select>
        <select name="kind" defaultValue={sp.kind ?? ''} aria-label="Type" className={cls}><option value="">All movements</option>{Object.entries(KIND).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select>
        <button className="h-9 cursor-pointer rounded-md border border-border px-3 text-sm hover:bg-surface-2">Filter</button></form>
      {filtered && <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-border px-4 py-3 text-sm"><span className="font-semibold">{filtered.name}</span>
        <span>{num(filtered.on_hand)} {filtered.unit} on hand</span><span className="text-muted">avg cost AED {fmtMoney(filtered.avg_cost)}</span>{isLow(filtered) && <Badge tone="red">Running low</Badge>}</div>}
      {!moves.length ? <EmptyState icon={ArrowDownLeft} title="No movements yet" body="Receipts, issues to jobs and count adjustments appear here, newest first. The history cannot be edited: a mistake is corrected with an adjustment." />
        : <TableWrap><thead className="bg-surface-2/50"><tr><Th>Date</Th><Th>Item</Th><Th>Type</Th><Th className="text-right">Qty</Th><Th className="text-right">Cost / unit</Th><Th>For / from</Th><Th className="text-right">Balance</Th></tr></thead>
          <tbody className="divide-y divide-border">{moves.map(m => { const [l, tone] = KIND[m.kind] ?? [m.kind, 'neutral']; const q = Number(m.qty)
            return <tr key={m.id} className="hover:bg-surface-2/50">
              <Td className="whitespace-nowrap tabular-nums">{m.moved_on}</Td>
              <Td><Link href={`/stock?tab=movements&item=${m.item_id}`} className="font-medium hover:text-primary">{m.stock_items?.name}</Link>{m.notes && <div className="line-clamp-1 max-w-xs text-xs text-muted">{m.notes}</div>}</Td>
              <Td badge><Badge tone={tone}>{l}</Badge></Td>
              <Td className={cn('text-right font-medium tabular-nums', q < 0 ? 'text-fg' : 'text-success')}>{q > 0 ? '+' : '−'}{num(Math.abs(q))} <span className="font-normal text-muted">{m.stock_items?.unit}</span></Td>
              <Td className="text-right tabular-nums text-muted">{m.unit_cost != null ? fmtMoney(m.unit_cost) : '—'}</Td>
              <Td className="text-muted">{m.projects ? <Link href={`/projects/${m.projects.id}`} className="hover:text-primary">{m.projects.name}</Link> : m.work_orders ? `${m.work_orders.number ?? ''} ${m.work_orders.title}` : [m.supplier_name, m.reference].filter(Boolean).join(' · ') || '—'}<div className="text-xs">{m.profiles?.full_name}</div></Td>
              <Td className="text-right tabular-nums">{m.balance_after != null ? num(m.balance_after) : '—'}</Td></tr> })}</tbody></TableWrap>}
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} params={sp} base="/stock" />
    </Card>}
  </>
}
