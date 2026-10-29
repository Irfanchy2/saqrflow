// Salary account arithmetic shared by the salary pages, receipts and statements. Amounts are summed in whole fils
// (cents) so 0.1 + 0.2 never shows as 0.30000000000000004. The database (migration 0034) is the source of truth:
// these helpers only split and present what it returns.

export const cents = (v: number | string | null | undefined) => Math.round(Number(v ?? 0) * 100)
export const fromCents = (c: number) => c / 100
export const sum = (xs: (number | string | null | undefined)[]) => fromCents(xs.reduce<number>((s, x) => s + cents(x), 0))

export type SalaryStatus = 'paid' | 'partial' | 'unpaid'
export const STATUS: Record<SalaryStatus, { label: string; tone: 'green' | 'amber' | 'red' }> = {
  paid: { label: 'Paid', tone: 'green' }, partial: { label: 'Partially paid', tone: 'amber' }, unpaid: { label: 'Unpaid', tone: 'red' },
}
export const KIND_LABEL: Record<string, string> = {
  opening: 'Opening balance', accrual: 'Salary', adjustment: 'Adjustment', deduction: 'Deduction', advance_offset: 'Advance recovered', payment: 'Payment',
}
export const METHODS = [['cash', 'Cash'], ['bank_transfer', 'Bank transfer'], ['cheque', 'Cheque'], ['wps', 'WPS'], ['other', 'Other']] as const
export const methodLabel = (m: string | null | undefined) => METHODS.find(([k]) => k === m)?.[1] ?? (m ? m : '—')

/** "2026-10" for an obligation: the opening balance sorts before every month. */
export function obligationMonth(o: { kind: string; period: string | null; entry_date: string }): string {
  return o.kind === 'opening' ? '0000-00' : (o.period ?? o.entry_date).slice(0, 7)
}
export function periodLabel(o: { kind: string; period: string | null; entry_date: string; reason?: string | null }): string {
  if (o.kind === 'opening') return 'Opening balance'
  const m = new Date(`${(o.period ?? o.entry_date).slice(0, 7)}-01T00:00:00Z`).toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  return o.kind === 'accrual' ? m : `${o.reason ? o.reason : 'Addition'} (${m})`
}

/** What is still owed from before `month`, and for `month` itself. */
export function splitOwed(obs: { kind: string; period: string | null; entry_date: string; remaining: number | string }[], month: string) {
  let prev = 0, cur = 0
  for (const o of obs) {
    const k = obligationMonth(o)
    if (k < month) prev += cents(o.remaining); else if (k === month) cur += cents(o.remaining)
  }
  return { previous: fromCents(prev), current: fromCents(cur) }
}

/**
 * Paid: nothing owed. Partially paid: still owed, but money went to the account this month or an obligation is part-settled.
 * Unpaid: still owed and nothing has been paid towards what is open.
 */
export function salaryStatus(outstanding: number, paidThisMonth: number, anyPartial: boolean): SalaryStatus {
  if (cents(outstanding) <= 0) return 'paid'
  return cents(paidThisMonth) > 0 || anyPartial ? 'partial' : 'unpaid'
}

/** Suggested amount for Quick Pay: everything owed, or a month's salary when the account is settled or in credit. */
export const suggestedPay = (outstanding: number, monthly: number | null) => (cents(outstanding) > 0 ? outstanding : monthly ?? 0)

export type Movement = { date: string; kind: string; label: string; amount: number; ref?: string | null; id: string; created_at: string }
/**
 * Statement for [from, to]: the balance brought forward, each movement with a running balance, and the closing balance.
 * `amount` is signed: + the company owes more (opening, salary, additions), − it owes less (payments, deductions, recoveries).
 */
export function statement(moves: Movement[], from: string, to: string) {
  const sorted = [...moves].sort((a, b) => a.date.localeCompare(b.date) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
  let bal = 0
  for (const m of sorted) if (m.date < from) bal += cents(m.amount)
  const brought = fromCents(bal)
  let owed = 0, settled = 0
  const rows = sorted.filter(m => m.date >= from && m.date <= to).map(m => {
    bal += cents(m.amount); if (m.amount >= 0) owed += cents(m.amount); else settled -= cents(m.amount)
    return { ...m, balance: fromCents(bal) }
  })
  return { brought, rows, added: fromCents(owed), settled: fromCents(settled), closing: fromCents(bal) }
}
