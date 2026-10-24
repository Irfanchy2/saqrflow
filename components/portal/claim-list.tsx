import Link from 'next/link'
import { Badge, Money } from '@/components/ui/primitives'
import { ChevronRight, Receipt } from '@/components/icons'
import { CLAIM_STATUS } from '@/lib/me'
import { EXPENSE_CATS } from '@/lib/projects'
import { formatShortDate } from '@/lib/time'

export interface ClaimRow { id: string; spent_on: string; description: string; supplier_name: string | null; amount: number | string; vat_amount: number | string; status: string; category: string; receipt_document_id: string | null }
export const CLAIM_COLS = 'id,spent_on,description,supplier_name,amount,vat_amount,status,category,receipt_document_id'

/** The employee's own expense claims: one tappable row each (whole row opens it), status and total on the right. */
export function ClaimList({ rows }: { rows: ClaimRow[] }) {
  return <ul className="divide-y divide-border/80" data-claim-list>
    {rows.map(r => { const s = CLAIM_STATUS[r.status] ?? CLAIM_STATUS.pending
      return <li key={r.id} className="relative">
        <Link href={`/me/expenses/${r.id}`} className="flex items-center gap-3 px-4 py-3.5 transition-colors active:bg-fg/[.045] hover:bg-surface-2/50 sm:px-5">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-surface-2 text-muted" aria-hidden><Receipt size={19} /></span>
          <span className="min-w-0 flex-1">
            <span className="line-clamp-1 text-[15px] font-semibold tracking-[-0.01em] [overflow-wrap:anywhere]">{r.supplier_name || r.description}</span>
            <span className="mt-0.5 block truncate text-[13px] text-muted">{formatShortDate(r.spent_on)} · {EXPENSE_CATS[r.category] ?? r.category}{r.supplier_name ? ` · ${r.description}` : ''}</span>
          </span>
          <span className="flex shrink-0 flex-col items-end gap-1">
            <Money value={Number(r.amount) + Number(r.vat_amount)} className="text-[15px] font-semibold" />
            <Badge tone={s.tone}>{s.label}</Badge>
          </span>
          <ChevronRight size={16} className="shrink-0 text-muted/60 rtl:rotate-180" aria-hidden />
        </Link></li> })}
  </ul>
}
