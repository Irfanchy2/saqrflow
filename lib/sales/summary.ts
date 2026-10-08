// Pure receivables / sales maths (unit-tested). Inputs come straight from invoices + invoice_balances.
import { daysBetween } from '../time'

export interface InvRow { id: string; doc_type: string; status: string; number: string; customer_name: string | null; customer_id: string | null; issue_date: string; due_date: string | null; total: number; paid: number }
export const OPEN_INVOICE = ['sent', 'partially_paid', 'overdue']
export const AGE_BUCKETS = ['Current', '1-30', '31-60', '61-90', '90+'] as const

export function ageBucket(due: string | null, today: string): number {
  if (!due) return 0
  const late = daysBetween(due, today)
  return late <= 0 ? 0 : late <= 30 ? 1 : late <= 60 ? 2 : late <= 90 ? 3 : 4
}

/** Outstanding balance per customer split into ageing buckets (by days past due). */
export function receivablesAgeing(rows: InvRow[], today: string) {
  const by = new Map<string, { customer: string; customerId: string | null; buckets: number[]; total: number; count: number }>()
  for (const r of rows) {
    if (r.doc_type !== 'invoice' || !OPEN_INVOICE.includes(r.status)) continue
    const bal = Math.round((Number(r.total) - Number(r.paid)) * 100) / 100
    if (bal <= 0) continue
    const k = r.customer_id ?? `name:${(r.customer_name ?? 'Unassigned').toLowerCase()}`
    const e = by.get(k) ?? { customer: r.customer_name ?? 'Unassigned', customerId: r.customer_id, buckets: [0, 0, 0, 0, 0], total: 0, count: 0 }
    e.buckets[ageBucket(r.due_date, today)] += bal; e.total += bal; e.count++
    by.set(k, e)
  }
  const list = [...by.values()].sort((a, b) => b.total - a.total)
  const totals = list.reduce((t, e) => t.map((v, i) => v + e.buckets[i]), [0, 0, 0, 0, 0])
  return { list, totals, grand: totals.reduce((a, b) => a + b, 0) }
}

export function salesKpis(rows: InvRow[], payments: { amount: number; paid_on: string }[], today: string) {
  const month = today.slice(0, 7)
  const inv = rows.filter(r => r.doc_type === 'invoice')
  const open = inv.filter(r => OPEN_INVOICE.includes(r.status))
  const bal = (r: InvRow) => Math.max(0, Number(r.total) - Number(r.paid))
  const overdue = open.filter(r => r.due_date && r.due_date < today && bal(r) > 0)
  const q = rows.filter(r => r.doc_type === 'quotation')
  const decided = q.filter(r => ['accepted', 'rejected', 'expired'].includes(r.status))
  return {
    outstanding: open.reduce((s, r) => s + bal(r), 0), openCount: open.filter(r => bal(r) > 0).length,
    overdue: overdue.reduce((s, r) => s + bal(r), 0), overdueCount: overdue.length,
    collectedThisMonth: payments.filter(p => p.paid_on.startsWith(month)).reduce((s, p) => s + Number(p.amount), 0),
    invoicedThisMonth: inv.filter(r => r.issue_date.startsWith(month) && !['draft', 'cancelled'].includes(r.status)).reduce((s, r) => s + Number(r.total), 0),
    pipeline: q.filter(r => ['draft', 'sent'].includes(r.status)).reduce((s, r) => s + Number(r.total), 0), pipelineCount: q.filter(r => ['draft', 'sent'].includes(r.status)).length,
    winRate: decided.length ? Math.round((decided.filter(r => r.status === 'accepted').length / decided.length) * 100) : null,
    drafts: rows.filter(r => r.status === 'draft').length,
  }
}
