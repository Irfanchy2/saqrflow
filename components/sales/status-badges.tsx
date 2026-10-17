import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/primitives'
import { STATUS_TONE, statusLabel, type SalesType } from '@/lib/sales/docs'
import { DOC_STATE_LABEL, PAY_STATE_LABEL, type DocState, type PayState } from '@/lib/sales/status'

// One badge look for both facts about an invoice. Colour + text (+ a dot), never colour alone.
const BASE = 'inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-px text-xs font-medium leading-5 ring-1 ring-inset'
const DOC_CLS: Record<DocState, string> = {
  draft: 'bg-surface-2 text-muted ring-border',
  sent: 'bg-primary-soft text-primary ring-primary/15',
  viewed: 'bg-violet-500/[.08] text-violet-700 ring-violet-500/20 dark:text-violet-300',
  cancelled: 'bg-surface-2 text-muted ring-border line-through decoration-muted/60',
}
const PAY_CLS: Record<PayState, string> = {
  unpaid: 'bg-orange-500/[.07] text-orange-700 ring-orange-500/20 dark:text-orange-300',
  partially_paid: 'bg-warning/[.08] text-warning ring-warning/20',
  paid: 'bg-success/[.08] text-success ring-success/20',
  overdue: 'bg-danger/[.07] text-danger ring-danger/25 due-pulse',
  credited: 'bg-surface-2 text-muted ring-border',
}

export function DocStatusBadge({ state, className }: { state: DocState; className?: string }) {
  return <span className={cn(BASE, DOC_CLS[state], className)} data-doc-status={state}>
    {state !== 'draft' && state !== 'cancelled' && <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-80" />}{DOC_STATE_LABEL[state]}</span>
}

export function PayStatusBadge({ state, daysLate, className }: { state: PayState; daysLate?: number; className?: string }) {
  return <span className={cn(BASE, PAY_CLS[state], className)} data-pay-status={state} title={state === 'overdue' && daysLate ? `${daysLate} day${daysLate === 1 ? '' : 's'} past the due date` : undefined}>
    <span aria-hidden className={cn('h-1.5 w-1.5 shrink-0 rounded-full', state === 'paid' ? 'bg-current' : state === 'partially_paid' ? 'bg-[linear-gradient(90deg,currentColor_50%,transparent_50%)] ring-1 ring-current' : 'bg-current opacity-80')} />
    {PAY_STATE_LABEL[state]}{state === 'overdue' && daysLate ? <span className="font-normal opacity-80">· {daysLate}d</span> : null}</span>
}

/** "Sent | Unpaid": the document status and the payment status side by side (payment status only once issued). */
export function InvoiceStatus({ doc, pay, daysLate, className, stack, bare }: { doc: DocState; pay: PayState | null; daysLate?: number; className?: string; stack?: boolean; /** no "|" between the two (cards, where they may wrap) */ bare?: boolean }) {
  return <span className={cn('inline-flex items-center gap-1', stack ? 'flex-col items-end' : 'flex-wrap', className)} aria-label={`${DOC_STATE_LABEL[doc]}${pay ? `, ${PAY_STATE_LABEL[pay]}` : ''}`}>
    <DocStatusBadge state={doc} />
    {pay && <>{!bare && <span aria-hidden className={cn('text-[11px] text-border-strong', stack && 'hidden')}>|</span>}<PayStatusBadge state={pay} daysLate={daysLate} /></>}
  </span>
}

/**
 * Status of any sales document in a list: tax invoices read from `invoice_list` show "Sent | Unpaid";
 * quotations, delivery notes and credit notes keep their own status.
 */
export function SalesDocBadge({ r, className }: { r: { doc_type: string; status: string; doc_status?: string | null; payment_status?: string | null; due_date?: string | null }; className?: string }) {
  if (r.doc_type === 'invoice' && r.doc_status) return <InvoiceStatus doc={r.doc_status as DocState} pay={(r.payment_status ?? null) as PayState | null} className={className} />
  return <Badge tone={STATUS_TONE[r.status] ?? 'neutral'} className={className}>{statusLabel(r.doc_type as SalesType, r.status)}</Badge>
}
