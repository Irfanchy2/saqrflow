// Statement of unpaid invoices: only the invoices a customer still owes, with what was paid, the balance, days overdue
// and an ageing summary. Pure (no database): built from the ledger, so it always matches the full statement.
import { AGE_BUCKETS, ageBucket } from './summary'
import type { Ledger } from '../ledger'

const r2 = (n: number) => Math.round(n * 100) / 100
export interface UnpaidStatement {
  rows: (Ledger['invoices'][number] & { paid: number })[]
  /** amount, paid / credited and balance of the listed invoices */
  totals: { amount: number; paid: number; balance: number }
  ageing: { label: string; amount: number }[]
  /** opening balance and payments or credit not tied to an invoice (only when the statement covers everything) */
  unapplied: number | null
  /** what the customer owes in total (only when the statement covers everything) */
  netDue: number | null
}

/** Invoices with a balance, issued within the period (if one is given), oldest first. */
export function unpaidStatement(l: Ledger, f: { from?: string; to?: string; project?: string }, today: string): UnpaidStatement {
  const rows = l.invoices
    .filter(i => i.balance > 0.004 && (!f.from || i.issue_date >= f.from) && (!f.to || i.issue_date <= f.to))
    .sort((a, b) => a.issue_date.localeCompare(b.issue_date) || a.number.localeCompare(b.number))
    .map(i => ({ ...i, paid: r2(i.total - i.balance) }))
  const totals = { amount: r2(rows.reduce((s, i) => s + i.total, 0)), paid: r2(rows.reduce((s, i) => s + i.paid, 0)), balance: r2(rows.reduce((s, i) => s + i.balance, 0)) }
  const buckets = [0, 0, 0, 0, 0]
  for (const i of rows) buckets[ageBucket(i.due_date, today)] += i.balance
  const ageing = AGE_BUCKETS.map((b, k) => ({ label: k === 0 ? 'Not yet due' : `${b} days`, amount: r2(buckets[k]) }))
  // the whole account (no period or project): show anything owed or paid that is not on an invoice, so the total is true
  const whole = !f.from && !f.to && !f.project
  const unapplied = whole ? r2(l.outstanding - totals.balance) : null
  return { rows, totals, ageing, unapplied: unapplied !== null && Math.abs(unapplied) > 0.004 ? unapplied : null, netDue: whole ? r2(l.outstanding) : null }
}
