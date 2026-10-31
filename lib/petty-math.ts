// Employee Petty Cash arithmetic shared by the wallet pages, the statement PDF and the CSV export. The database
// (migration 0037) is the source of truth: these helpers only label, sort and add up the ledger rows it returns.
// Petty cash is company money for business expenses. It is not salary and has nothing to do with payroll.
import { cents, fromCents } from './salary-math'

export type PettyKind = 'received' | 'expense_settled' | 'returned' | 'adjustment' | 'reimbursement_payable' | 'reimbursement_paid' | 'reversal'
export type PettyEntry = {
  id: string; book: 'wallet' | 'reimbursement'; kind: PettyKind; reverses_kind: PettyKind | null; amount: number | string
  entry_date: string; created_at: string; description: string; reference: string | null; method?: string | null
  project?: { name: string } | null; claim_id?: string | null; reverses_id?: string | null
}

export const KIND: Record<PettyKind, { label: string; tone: 'green' | 'blue' | 'amber' | 'red' | 'neutral' }> = {
  received: { label: 'Petty cash received', tone: 'green' },
  expense_settled: { label: 'Approved expense settled', tone: 'blue' },
  returned: { label: 'Petty cash returned', tone: 'neutral' },
  adjustment: { label: 'Authorized adjustment', tone: 'amber' },
  reimbursement_payable: { label: 'Reimbursement payable', tone: 'amber' },
  reimbursement_paid: { label: 'Reimbursement paid', tone: 'green' },
  reversal: { label: 'Reversal', tone: 'red' },
}
export const kindLabel = (e: Pick<PettyEntry, 'kind' | 'reverses_kind'>) =>
  e.kind === 'reversal' ? `Reversal of ${KIND[e.reverses_kind ?? 'adjustment'].label.toLowerCase()}` : KIND[e.kind].label

export const METHODS = [['cash', 'Cash'], ['bank_transfer', 'Bank transfer'], ['cheque', 'Cheque'], ['card', 'Card'], ['other', 'Other']] as const
export const methodLabel = (m: string | null | undefined) => METHODS.find(([k]) => k === m)?.[1] ?? '—'

export const FUNDED = [['petty_cash', 'Company petty cash'], ['personal', 'My own money'], ['company', 'Company paid directly']] as const
export const FUNDED_ADMIN: Record<string, string> = { petty_cash: 'Company petty cash', personal: 'Employee\'s own money', company: 'Company direct payment' }

export const REQUEST_STATUS: Record<string, { label: string; tone: 'green' | 'blue' | 'amber' | 'red' | 'neutral' }> = {
  pending: { label: 'Pending admin approval', tone: 'amber' }, approved: { label: 'Confirmed', tone: 'green' },
  rejected: { label: 'Not accepted', tone: 'red' }, correction_requested: { label: 'Correction needed', tone: 'amber' }, withdrawn: { label: 'Withdrawn', tone: 'neutral' },
}

const order = (a: PettyEntry, b: PettyEntry) => a.entry_date.localeCompare(b.entry_date) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)

/** Totals of one employee's ledger (the same sums as the petty_cash_wallets view). */
export function totals(entries: PettyEntry[]) {
  // sums in whole fils; 0 - 0 gives 0, never -0 (which would print as "−0.00")
  const by = (pred: (e: PettyEntry) => boolean, sign = 1) => fromCents(sign * entries.filter(pred).reduce((s, e) => s + cents(e.amount), 0)) || 0
  const k = (e: PettyEntry) => e.reverses_kind ?? e.kind
  return {
    available: by(e => e.book === 'wallet'),
    received: by(e => k(e) === 'received'),
    settled: by(e => k(e) === 'expense_settled', -1),
    returned: by(e => k(e) === 'returned', -1),
    adjusted: by(e => k(e) === 'adjustment'),
    reimbursementDue: by(e => e.book === 'reimbursement'),
    reimbursed: by(e => k(e) === 'reimbursement_paid', -1),
  }
}

export type StatementRow = { id: string; date: string; label: string; detail: string; reference: string | null; in: number; out: number; balance: number }
/**
 * Petty cash statement for [from, to]: the opening balance, each wallet movement with its running balance, the closing
 * balance, and the period's totals per type. Reimbursements (the employee's own money) are listed separately: they never
 * change the petty cash balance.
 */
export function statement(entries: PettyEntry[], from: string, to: string) {
  const wallet = entries.filter(e => e.book === 'wallet').sort(order)
  let bal = 0
  for (const e of wallet) if (e.entry_date < from) bal += cents(e.amount)
  const opening = fromCents(bal)
  const rows: StatementRow[] = []
  const sums = { received: 0, settled: 0, returned: 0, adjustments: 0 }
  for (const e of wallet) {
    if (e.entry_date < from || e.entry_date > to) continue
    const a = cents(e.amount); bal += a
    const k = e.reverses_kind ?? e.kind
    if (k === 'received') sums.received += a; else if (k === 'expense_settled') sums.settled -= a; else if (k === 'returned') sums.returned -= a; else sums.adjustments += a
    rows.push({ id: e.id, date: e.entry_date, label: kindLabel(e), detail: e.description, reference: e.reference, in: a > 0 ? fromCents(a) : 0, out: a < 0 ? fromCents(-a) : 0, balance: fromCents(bal) })
  }
  const reimb = entries.filter(e => e.book === 'reimbursement').sort(order)
  let due = 0
  for (const e of reimb) if (e.entry_date <= to) due += cents(e.amount)
  return {
    opening, closing: fromCents(bal), rows,
    received: fromCents(sums.received) || 0, settled: fromCents(sums.settled) || 0, returned: fromCents(sums.returned) || 0, adjustments: fromCents(sums.adjustments) || 0,
    reimbursements: reimb.filter(e => e.entry_date >= from && e.entry_date <= to).map(e => ({ id: e.id, date: e.entry_date, label: kindLabel(e), detail: e.description, amount: Number(e.amount) })),
    reimbursementDue: fromCents(due),
  }
}

/** Default statement period: from the first ledger entry (or the start of this month) to today. */
export function statementRange(entries: Pick<PettyEntry, 'entry_date'>[], today: string) {
  const first = entries.reduce<string | null>((m, e) => (!m || e.entry_date < m ? e.entry_date : m), null)
  return { from: first && first < today ? first : today.slice(0, 7) + '-01', to: today }
}

/**
 * Hand-overs an employee's "Petty Cash Received" report may be the same money as: the same employee, the same amount, and
 * the same reference or a date within a week, not reversed and not already matched to another report. Only a suggestion:
 * the approver chooses. A genuine second payment of the same amount is never refused.
 */
export function matchHandovers<T extends { id: string; kind: string; amount: number | string; entry_date: string; reference: string | null }>(
  report: { amount: number | string; entry_date: string; reference: string | null }, entries: T[], taken: Set<string>, reversed: Set<string>) {
  const ref = (s: string | null) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
  const days = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000
  return entries
    .filter(e => e.kind === 'received' && !taken.has(e.id) && !reversed.has(e.id) && cents(e.amount) === cents(report.amount))
    .map(e => ({ e, sameRef: !!ref(report.reference) && ref(report.reference) === ref(e.reference), gap: days(e.entry_date, report.entry_date) }))
    .filter(x => x.sameRef || x.gap <= 7)
    .sort((a, b) => Number(b.sameRef) - Number(a.sameRef) || a.gap - b.gap)
    .map(x => ({ ...x.e, sameRef: x.sameRef, gap: x.gap }))
}

/** Default settlement when approving a claim, the same rule as decide_expense_claim(): petty cash first, as much as the
 *  employee holds; the rest waits unless the approver confirms the employee paid it. Own money: all of it is owed back. */
export function defaultSettlement(funded: string | null, total: number, wallet: number) {
  if (funded === 'petty_cash') { const pet = Math.max(0, Math.min(total, wallet)); return { petty: pet, personal: 0, awaiting: fromCents(cents(total) - cents(pet)) } }
  if (funded === 'personal') return { petty: 0, personal: total, awaiting: 0 }
  return { petty: 0, personal: 0, awaiting: 0 }
}
