import { redirect } from 'next/navigation'
import { Archive, ArchiveRestore, Download, Package, Pencil, Plus, Sparkles, Upload } from 'lucide-react'
import { getCtx } from '@/lib/auth'
import { PAGE_SIZE, flat, pageOf, sanitizeQ } from '@/lib/queries'
import { Badge, Card, EmptyState, LinkButton, PageHeader, Pagination, Td, Th, TableWrap } from '@/components/ui/primitives'
import { DialogButton } from '@/components/ui/dialog'
import { ActionButton, ActionForm } from '@/components/ui/action-form'
import { CatalogFields } from '@/components/catalog/item-fields'
import { ImportForm } from '@/components/import-form'
import { addStarterItems, saveCatalogItem, setCatalogActive } from '@/app/actions/catalog'
import { importCatalog } from '@/app/actions/imports'
import { VAT_CATEGORIES, fmtMoney, type VatCategory } from '@/lib/sales/money'

export const metadata = { title: 'Products & Services' }
export default async function CatalogPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await getCtx(); if (!c.can('finance.view')) redirect('/')
  const sp = await flat(searchParams), page = pageOf(sp.page), term = sanitizeQ(sp.q), edit = c.can('records.edit')
  let q = c.supabase.from('catalog_items').select('*', { count: 'exact' }).eq('active', sp.archived !== '1')
  if (term) q = q.or(`name.ilike.%${term}%,description.ilike.%${term}%,category.ilike.%${term}%`)
  if (sp.category) q = q.eq('category', sp.category.slice(0, 80))
  const [{ data, count }, { data: cats }] = await Promise.all([q.order('name').range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1), c.supabase.from('catalog_items').select('category').not('category', 'is', null).limit(2000)])
  const categories = [...new Set((cats ?? []).map(x => x.category as string))].sort()
  const cls = 'h-9 rounded-md border border-border bg-surface px-3 text-sm'
  return <>
    <PageHeader title="Products & Services" sub="Reusable items for quotations and invoices. In the editor use “Add from catalog”. The rate and text stay editable per document."
      actions={<>
        {c.can('data.export') && <LinkButton href="/api/export/catalog?format=xlsx" variant="secondary"><Download size={14} />Excel</LinkButton>}
        {edit && <DialogButton wide variant="secondary" label="Import" title="Import products & services" icon={<Upload size={14} />}><ImportForm action={importCatalog} columns="name, description, unit, rate, vat_category, category, notes" /></DialogButton>}
        {edit && <DialogButton wide label="Add item" title="Add product / service" icon={<Plus size={15} />}><ActionForm action={saveCatalogItem.bind(null, null)} submit="Add item"><CatalogFields /></ActionForm></DialogButton>}</>} />
    <datalist id="catalog-cats">{categories.map(x => <option key={x} value={x} />)}</datalist>
    <Card>
      <form className="flex flex-wrap gap-2 border-b border-border p-3">
        <input name="q" type="search" defaultValue={sp.q} aria-label="Search catalog" placeholder="Search name, description, category…" className={`${cls} min-w-52 flex-1`} />
        <select name="category" defaultValue={sp.category ?? ''} aria-label="Category" className={cls}><option value="">All categories</option>{categories.map(x => <option key={x}>{x}</option>)}</select>
        <select name="archived" defaultValue={sp.archived ?? ''} aria-label="Show" className={cls}><option value="">Active</option><option value="1">Archived</option></select>
        <button className="h-9 cursor-pointer rounded-md border border-border px-3 text-sm hover:bg-surface-2">Filter</button></form>
      {!data?.length ? <EmptyState icon={Package} title={term || sp.category ? 'Nothing matches' : 'No products or services yet'} body="Add your standard items once (e.g. MS Handrail per Rmt) and insert them into quotations in one click."
          action={edit && !term && !sp.category ? <ActionButton size="md" action={addStarterItems}><Sparkles size={14} />Add steel-fabrication starter list</ActionButton> : undefined} />
        : <TableWrap><thead className="bg-surface-2/50"><tr><Th>Item</Th><Th>Category</Th><Th>Unit</Th><Th className="text-right">Rate (AED)</Th><Th>VAT</Th>{edit && <Th />}</tr></thead>
          <tbody className="divide-y divide-border">{data.map((i: any) => <tr key={i.id} className="hover:bg-surface-2/50">
            <Td><div className="font-medium">{i.name}</div>{i.description && <div className="line-clamp-1 max-w-md text-xs text-muted">{i.description}</div>}</Td>
            <Td className="text-muted">{i.category ?? '—'}</Td><Td>{i.unit}</Td><Td className="text-right tabular-nums">{Number(i.rate) ? fmtMoney(i.rate) : <span className="text-warning">set price</span>}</Td>
            <Td>{i.vat_category === 'standard' ? <span className="text-muted">Standard</span> : <Badge tone="amber">{VAT_CATEGORIES[i.vat_category as VatCategory]}</Badge>}</Td>
            {edit && <Td className="text-right"><div className="flex justify-end gap-1">
              <DialogButton wide size="sm" variant="ghost" label={<><Pencil size={13} /><span className="sr-only">Edit {i.name}</span></>} title={`Edit ${i.name}`}><ActionForm action={saveCatalogItem.bind(null, i.id)} resetOnSuccess={false}><CatalogFields i={i} /></ActionForm></DialogButton>
              <ActionButton variant="ghost" action={setCatalogActive.bind(null, i.id, !i.active)}>{i.active ? <><Archive size={13} /><span className="sr-only">Archive</span></> : <><ArchiveRestore size={13} />Restore</>}</ActionButton></div></Td>}</tr>)}</tbody></TableWrap>}
      <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} params={sp} base="/catalog" />
    </Card>
  </>
}
