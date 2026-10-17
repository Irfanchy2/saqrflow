// Invoice statuses, shown as two separate facts (pure, unit-tested; mirrored by invoice_payment_status() in SQL):
//   document status — where the document is:      Draft · Sent · Viewed · Cancelled
//   payment status  — what has been paid against it: Unpaid · Partially paid · Paid · Overdue
// The stored invoices.status keeps its older combined values (sent / partially_paid / paid / overdue …) so reports,
// reminders and filters that use it keep working; both statuses below are derived from it plus the recorded money.

export type DocState = 'draft' | 'sent' | 'viewed' | 'cancelled'
export type PayState = 'unpaid' | 'partially_paid' | 'paid' | 'overdue' | 'credited'

export const DOC_STATE_LABEL: Record<DocState, string> = { draft: 'Draft', sent: 'Sent', viewed: 'Viewed', cancelled: 'Cancelled' }
export const PAY_STATE_LABEL: Record<PayState, string> = { unpaid: 'Unpaid', partially_paid: 'Partially paid', paid: 'Paid', overdue: 'Overdue', credited: 'Credited' }
export const PAY_STATES: PayState[] = ['unpaid', 'partially_paid', 'overdue', 'paid']

/** Document status of an invoice / credit note. Every issued value (sent, partially paid, paid, overdue) is "Sent", or "Viewed" once the customer opened it. */
export function docState(status: string, viewedAt?: string | null): DocState {
  if (status === 'draft') return 'draft'
  if (status === 'cancelled') return 'cancelled'
  return viewedAt || status === 'viewed' ? 'viewed' : 'sent'
}

const cents = (v: number | string | null | undefined) => Math.round(Number(v ?? 0) * 100)

/**
 * Payment status from recorded payments only (never from a status someone set):
 *   nothing paid, not yet due → Unpaid · some paid → Partially paid · all paid → Paid · past the due date with a balance → Overdue.
 * Credit notes lower the amount due but are not payments: an invoice settled only by credit notes is "Credited", never "Paid".
 * Drafts and cancelled invoices have no payment status (null).
 */
export function payState(x: { status: string; total: number | string; paid?: number | string | null; credited?: number | string | null; due_date?: string | null }, today: string): PayState | null {
  if (x.status === 'draft' || x.status === 'cancelled') return null
  const due = cents(x.total) - cents(x.credited), paid = cents(x.paid)
  if (due <= 0) return paid > 0 ? 'paid' : 'credited'
  if (paid >= due) return 'paid'
  if (x.due_date && x.due_date < today) return 'overdue'
  return paid > 0 ? 'partially_paid' : 'unpaid'
}

/** Balance still owed (never negative), in AED. */
export const balanceOf = (x: { total: number | string; paid?: number | string | null; credited?: number | string | null }) =>
  Math.max(0, cents(x.total) - cents(x.paid) - cents(x.credited)) / 100

/** Whole days past the due date (0 when not overdue). */
export function daysOverdue(due: string | null | undefined, today: string) {
  if (!due || due >= today) return 0
  return Math.round((Date.parse(today + 'T00:00:00Z') - Date.parse(due + 'T00:00:00Z')) / 864e5)
}

/** What a person can do with the money on an invoice right now (the server enforces the same rules). */
export function paymentActions(x: { status: string; total: number | string; paid?: number | string | null; credited?: number | string | null }) {
  const issued = x.status !== 'draft' && x.status !== 'cancelled', bal = balanceOf(x), hasPaid = cents(x.paid) > 0
  return {
    record: issued && bal > 0, markPaid: issued && bal > 0, markPartial: issued && bal > 0.01,
    markUnpaid: issued && hasPaid, cancel: x.status !== 'cancelled' && !hasPaid,
  }
}
