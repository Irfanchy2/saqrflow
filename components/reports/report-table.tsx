import Link from 'next/link'
import { Card, CardHeader, EmptyState, Td, Th, TableWrap } from '@/components/ui/primitives'
import type { Table } from '@/lib/reports/sections'
import { fmtCell } from '@/lib/reports/format'
import { cn } from '@/lib/utils'

/** A report table: first column links to the record it summarises, figures right-aligned, totals in a footer row. */
export function ReportTable({ t }: { t: Table }) {
  const hasMoney = t.columns.some(c => c.money)
  return <Card className="break-inside-avoid"><CardHeader title={t.title} sub={hasMoney ? 'Amounts in AED' : undefined} />
    {!t.rows.length ? <EmptyState title="Nothing in this period" body="Choose a wider period above." /> : <TableWrap>
      <thead><tr>{t.columns.map((c, i) => <Th key={i} className={cn((c.money || c.num || c.pct) && 'text-end')}>{c.label}</Th>)}</tr></thead>
      <tbody className="divide-y divide-border">{t.rows.map((r, i) => <tr key={i} className="hover:bg-surface-2/40">{r.map((v, j) => {
        const col = t.columns[j], text = fmtCell(v, col), href = j === 0 ? t.links?.[i] : null
        return <Td key={j} className={cn(col.money || col.num || col.pct ? 'whitespace-nowrap text-end tabular-nums' : 'max-w-[320px] [overflow-wrap:anywhere]', j === 0 && 'font-medium', text === 'Incomplete cost data' && 'text-warning')}>
          {href ? <Link href={href} className="hover:text-primary">{text}</Link> : text}</Td>
      })}</tr>)}</tbody>
      {t.totals && <tfoot><tr className="border-t border-border-strong bg-surface-2/50 font-semibold">{t.totals.map((v, j) => <Td key={j} className={cn((t.columns[j].money || t.columns[j].num || t.columns[j].pct) && 'whitespace-nowrap text-end tabular-nums')}>{fmtCell(v, t.columns[j])}</Td>)}</tr></tfoot>}
    </TableWrap>}
    {t.note && <p className="border-t border-border px-4 py-2 text-xs text-muted">{t.note}</p>}
  </Card>
}
