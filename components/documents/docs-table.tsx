import Link from 'next/link'
import { FileText, Paperclip } from 'lucide-react'
import { Card, EmptyState, Pagination, SortTh, Td, Th, TableWrap } from '@/components/ui/primitives'
import { StatusBadge } from './status-badge'
import { PAGE_SIZE, type SP } from '@/lib/queries'

export function DocsTable({ rows, total, page, today, base, sp, showOwner, empty }: {
  rows: any[]; total: number; page: number; today: string; base: string; sp: SP; showOwner?: boolean; empty: React.ReactNode
}) {
  if (!rows.length) return <Card>{empty}</Card>
  const ownerLabel: Record<string, string> = { company: 'Company', employee: 'Employee', vault: 'Vault', project: 'Project', asset: 'Asset', cheque: 'Cheque' }
  return <Card className="overflow-hidden"><TableWrap>
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
      <Td className="text-muted">{r.responsible?.full_name ?? '—'}</Td></tr>)}</tbody></TableWrap>
    <Pagination page={page} pageSize={PAGE_SIZE} total={total} params={sp} base={base} /></Card>
}

export function Filters({ sp, categories, base, extra }: { sp: SP; categories: { id: string; name: string }[]; base: string; extra?: React.ReactNode }) {
  const cls = 'h-9 rounded-md border border-border bg-surface px-3 text-sm'
  return <form action={base} className="mb-4 flex flex-wrap items-center gap-2">
    <input name="q" defaultValue={sp.q} placeholder="Search name, reference, authority…" className={`${cls} min-w-52 flex-1`} />
    <select name="category" defaultValue={sp.category ?? ''} className={cls}><option value="">All categories</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
    <select name="status" defaultValue={sp.status ?? ''} className={cls}><option value="">Any status</option><option value="valid">Valid</option><option value="expiring">Expiring ≤ 60d</option><option value="expired">Expired</option><option value="none">No expiry</option></select>
    {extra}<button className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-fg">Filter</button>
    {(sp.q || sp.category || sp.status || sp.owner) && <Link href={base} className="text-sm text-muted hover:text-fg">Clear</Link>}</form>
}
