import 'server-only'
import type { Ctx } from './auth'
import { r2 } from './sales/money'

export interface LedgerEntry { date: string; kind: 'opening' | 'invoice' | 'payment' | 'credit_note'; ref: string; description: string; debit: number; credit: number; balance: number; href?: string; projectId?: string | null }
export interface Ledger {
  entries: LedgerEntry[]; opening: number; closing: number; totalDebit: number; totalCredit: number; outstanding: number; overdue: number
  invoices: { id: string; number: string; issue_date: string; due_date: string | null; total: number; balance: number; status: string; daysOverdue: number }[]
}
const METHOD: Record<string, string> = { cash: 'Cash', bank_transfer: 'Bank transfer', cheque: 'Cheque', pdc: 'PDC cheque', card: 'Card', other: 'Payment' }

/**
 * Customer ledger from recorded data only: opening balance + issued invoices (debit) − payments − issued credit notes (credit).
 * `from`/`to` are business dates (Asia/Dubai date-only, compared as strings — never shifted through UTC).
 */
export async function buildLedger(c: Ctx, customerId: string, f: { from?: string; to?: string; project?: string; status?: string } = {}): Promise<Ledger> {
  const [{ data: cu }, { data: docs }, { data: pays }] = await Promise.all([
    c.supabase.from('customers').select('opening_balance,opening_balance_date').eq('id', customerId).maybeSingle(),
    c.supabase.from('invoices').select('id,doc_type,number,status,issue_date,due_date,total,project_id,subject,source_invoice_id').eq('customer_id', customerId)
      .in('doc_type', ['invoice', 'credit_note']).not('status', 'in', '(draft,cancelled)').order('issue_date').limit(5000),
    c.supabase.from('payments').select('id,amount,paid_on,method,reference,invoice_id,cheque:cheques(cheque_no),invoice:invoices(number,project_id)').eq('customer_id', customerId).order('paid_on').limit(5000),
  ])
  const projOk = (p?: string | null) => !f.project || p === f.project
  const raw: Omit<LedgerEntry, 'balance'>[] = []
  for (const d of docs ?? []) {
    if (!projOk(d.project_id)) continue
    if (d.doc_type === 'invoice') raw.push({ date: d.issue_date, kind: 'invoice', ref: d.number, description: `Tax invoice${d.subject ? ': ' + d.subject : ''}`, debit: Number(d.total), credit: 0, href: `/invoices/${d.id}`, projectId: d.project_id })
    else raw.push({ date: d.issue_date, kind: 'credit_note', ref: d.number, description: 'Credit note', debit: 0, credit: Number(d.total), href: `/invoices/${d.id}`, projectId: d.project_id })
  }
  for (const p of pays ?? []) {
    const inv: any = p.invoice, chq: any = p.cheque
    if (!projOk(inv?.project_id)) continue
    raw.push({ date: p.paid_on, kind: 'payment', ref: chq?.cheque_no ? `Chq ${chq.cheque_no}` : p.reference ?? '—', description: `${METHOD[p.method ?? 'other'] ?? 'Payment'} received${inv?.number ? `: ${inv.number}` : '. On account'}`, debit: 0, credit: Number(p.amount), href: p.invoice_id ? `/invoices/${p.invoice_id}` : undefined, projectId: inv?.project_id })
  }
  const order = { opening: 0, invoice: 1, credit_note: 2, payment: 3 }
  raw.sort((a, b) => a.date.localeCompare(b.date) || order[a.kind] - order[b.kind])
  const ob = f.project ? 0 : Number(cu?.opening_balance ?? 0)
  let opening = ob
  const inRange = raw.filter(e => {
    if (f.from && e.date < f.from) { opening += e.debit - e.credit; return false }
    return !f.to || e.date <= f.to
  })
  let bal = r2(opening)
  const entries: LedgerEntry[] = [{ date: f.from ?? cu?.opening_balance_date ?? '', kind: 'opening', ref: '', description: f.from ? 'Balance brought forward' : 'Opening balance', debit: 0, credit: 0, balance: bal }]
  for (const e of inRange) { bal = r2(bal + e.debit - e.credit); entries.push({ ...e, balance: bal }) }

  // open invoices with ageing (balance after payments and credit notes)
  const invIds = (docs ?? []).filter(d => d.doc_type === 'invoice' && projOk(d.project_id)).map(d => d.id)
  const balMap = new Map<string, number>()
  for (let i = 0; i < invIds.length; i += 200) {
    const { data } = await c.supabase.from('invoice_balances').select('id,balance').in('id', invIds.slice(i, i + 200))
    for (const b of data ?? []) balMap.set(b.id, Number(b.balance))
  }
  const day = (s: string) => Date.parse(s + 'T00:00:00Z') / 864e5
  let invoices = (docs ?? []).filter(d => d.doc_type === 'invoice' && projOk(d.project_id)).map(d => {
    const balance = balMap.get(d.id) ?? 0
    return { id: d.id, number: d.number, issue_date: d.issue_date, due_date: d.due_date, total: Number(d.total), balance, status: d.status, daysOverdue: d.due_date && balance > 0 && d.due_date < c.today ? Math.round(day(c.today) - day(d.due_date)) : 0 }
  })
  if (f.status === 'open') invoices = invoices.filter(i => i.balance > 0.004)
  else if (f.status === 'paid') invoices = invoices.filter(i => i.balance <= 0.004)
  else if (f.status === 'overdue') invoices = invoices.filter(i => i.daysOverdue > 0)
  return {
    entries, opening: r2(opening), closing: bal, totalDebit: r2(inRange.reduce((s, e) => s + e.debit, 0)), totalCredit: r2(inRange.reduce((s, e) => s + e.credit, 0)),
    // everything owed today: opening balance + all issued invoices − all payments − all credit notes (independent of the date filter)
    outstanding: r2(ob + raw.reduce((s, e) => s + e.debit - e.credit, 0)), overdue: r2(invoices.reduce((s, i) => s + (i.daysOverdue > 0 ? i.balance : 0), 0)), invoices,
  }
}
