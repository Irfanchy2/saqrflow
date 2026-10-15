import Link from 'next/link'
import { FileText, Paperclip } from '@/components/icons'
import { Card, EmptyState, Pagination, SortTh, Td, Th, TableWrap } from '@/components/ui/primitives'
import { StatusBadge } from './status-badge'
import { PAGE_SIZE, type SP } from '@/lib/queries'
import { FilterBar, FilterTabs, MList, MRow, Tile, TINTS } from '@/components/ui/mobile'
import { formatShortDate } from '@/lib/time'

export function DocsTable({ rows, total, page, today, base, sp, showOwner, empty }: {
  rows: any[]; total: number; page: number; today: string; base: string; sp: SP; showOwner?: boolean; empty: React.ReactNode
}) {
  if (!rows.length) return <Card>{empty}</Card>
  const ownerLabel: Record<string, string> = { company: 'Company', employee: 'Employee', vault: 'Vault', project: 'Project', asset: 'Asset', cheque: 'Cheque' }
  const days = (d: string | null) => d ? Math.round((Date.parse(d) - Date.parse(today)) / 864e5) : null
  return <Card className="overflow-hidden"><MList>{rows.map(r => { const n = days(r.expiry_date)
    return <MRow key={r.id} href={`/documents/${r.id}`} lead={<Tile icon={FileText} tint={TINTS[n === null ? 'slate' : n < 0 ? 'rose' : n <= 30 ? 'amber' : n <= 90 ? 'violet' : 'blue']} />}
      title={r.name} sub={r.expiry_date ? `Expires ${formatShortDate(r.expiry_date)}` : r.category?.name ?? 'No expiry'} right={<StatusBadge doc={r} today={today} />} rightSub={r.category?.name && r.expiry_date ? r.category.name : undefined} /> })}</MList>
    <div className="hidden sm:block"><TableWrap>
    <thead className="border-b border-border bg-surface-2/60"><tr>
      <SortTh label="Document" col="name" params={sp} base={base} /><Th>Category</Th>{showOwner && <Th>Belongs to</Th>}
      <Th>Reference</Th><SortTh label="Expiry" col="expiry_date" params={sp} base={base} /><Th>Status</Th><Th>Responsible</Th></tr></thead>
    <tbody className="divide-y divide-border">{rows.map(r => <tr key={r.id} className="transition-colors hover:bg-surface-2/50">
      <Td><Link href={`/documents/${r.id}`} className="flex items-center gap-2 font-medium hover:text-primary"><FileText size={15} className="shrink-0 text-muted" />{r.name}
        {r.current_version_id && <Paperclip size={12} className="text-muted" aria-label="Has file" />}</Link></Td>
      <Td className="text-muted">{r.category?.name ?? '—'}</Td>
      {showOwner && <Td className="text-muted">{ownerLabel[r.owner_type] ?? r.owner_type}{r.folder ? ` · ${r.folder}` : ''}</Td>}
      <Td className="font-mono text-xs text-muted">{r.reference_no ?? '—'}</Td>
      <Td className="tabular-nums">{r.expiry_date ?? '—'}</Td><Td><StatusBadge doc={r} today={today} /></Td>
      <Td className="text-muted">{r.responsible?.full_name ?? '—'}</Td></tr>)}</tbody></TableWrap></div>
    <Pagination page={page} pageSize={PAGE_SIZE} total={total} params={sp} base={base} /></Card>
}

export function Filters({ sp, categories, base, extra }: { sp: SP; categories: { id: string; name: string }[]; base: string; extra?: React.ReactNode }) {
  const cls = 'h-10 rounded-lg border border-border bg-surface px-3 text-sm'
  const keep = (o: Record<string, string>) => `${base}?${new URLSearchParams(Object.entries({ q: sp.q, category: sp.category, owner: sp.owner, ...o }).filter(([, v]) => v) as [string, string][])}`
  return <><FilterTabs label="Expiry" className="mb-3" tabs={[['', 'All'], ['expiring30', 'Expiring in 30 days'], ['expiring90', 'Next 90 days'], ['expired', 'Expired'], ['valid', 'Valid']].map(([k, l]) => ({ href: keep({ status: k }), label: l, active: (sp.status ?? '') === k }))} />
  <form action={base} className="mb-4"><FilterBar active={!!(sp.category || sp.status)} search={<input name="q" type="search" defaultValue={sp.q} aria-label="Search documents" placeholder="Search name, reference, authority…" className={`${cls} h-11 min-w-0 flex-1 sm:h-10`} />}>
    <select name="category" defaultValue={sp.category ?? ''} aria-label="Category" className={cls}><option value="">All categories</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
    <select name="status" defaultValue={sp.status ?? ''} aria-label="Status" className={cls}><option value="">Any status</option><option value="valid">Valid</option><option value="expiring7">Expiring in 7 days</option><option value="expiring30">Expiring in 30 days</option><option value="expiring">Expiring in 60 days</option><option value="expiring90">Expiring in 90 days</option><option value="expired">Expired</option><option value="renewal">Renewal in progress</option><option value="none">No expiry</option></select>
    {extra}<button className="h-10 rounded-lg bg-ink px-4 text-sm font-medium text-ink-fg">Filter</button>
    {(sp.q || sp.category || sp.status || sp.owner) && <Link href={base} className="self-center text-sm text-muted hover:text-fg">Clear</Link>}</FilterBar></form></>
}
