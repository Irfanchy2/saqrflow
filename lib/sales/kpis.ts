import 'server-only'
import type { Ctx } from '../auth'
import { OPEN_INVOICE, type InvRow } from './summary'

/**
 * Sales KPIs with small, targeted queries (open invoices, this month, open quotations, counts) instead of loading every
 * invoice + balance. Returns the open invoices too (with paid amounts) for the receivables ageing table.
 */
export async function loadSalesKpis(c: Ctx) {
  const month = c.today.slice(0, 7) + '-01', head = { count: 'exact' as const, head: true }
  const inv = () => c.supabase.from('invoices')
  const [open, monthInv, pipeline, accepted, decided, drafts, pays] = await Promise.all([
    inv().select('id,doc_type,status,number,customer_name,customer_id,issue_date,due_date,total').eq('doc_type', 'invoice').in('status', OPEN_INVOICE).limit(2000),
    inv().select('total').eq('doc_type', 'invoice').gte('issue_date', month).not('status', 'in', '(draft,cancelled)').limit(2000),
    inv().select('total').eq('doc_type', 'quotation').in('status', ['draft', 'sent', 'viewed', 'follow_up']).limit(2000),
    inv().select('id', head).eq('doc_type', 'quotation').in('status', ['accepted', 'converted']),
    inv().select('id', head).eq('doc_type', 'quotation').in('status', ['accepted', 'converted', 'rejected', 'expired']),
    inv().select('id', head).in('doc_type', ['quotation', 'invoice']).eq('status', 'draft'),
    c.supabase.from('payments').select('amount').gte('paid_on', month).limit(5000),
  ])
  const ids = (open.data ?? []).map(r => r.id)
  const paid = new Map<string, number>()
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await c.supabase.from('invoice_balances').select('id,paid,credited').in('id', ids.slice(i, i + 200))
    for (const b of data ?? []) paid.set(b.id, Number(b.paid) + Number(b.credited ?? 0))   // credit notes settle like payments
  }
  const openRows: InvRow[] = (open.data ?? []).map(r => ({ ...r, total: Number(r.total), paid: paid.get(r.id) ?? 0 }))
  const bal = (r: InvRow) => Math.max(0, r.total - r.paid)
  const overdue = openRows.filter(r => r.due_date && r.due_date < c.today && bal(r) > 0)
  const sum = (rows: { total: number | string }[] | null) => (rows ?? []).reduce((s, r) => s + Number(r.total), 0)
  return {
    openRows,
    kpis: {
      outstanding: openRows.reduce((s, r) => s + bal(r), 0), openCount: openRows.filter(r => bal(r) > 0).length,
      overdue: overdue.reduce((s, r) => s + bal(r), 0), overdueCount: overdue.length,
      collectedThisMonth: (pays.data ?? []).reduce((s, p) => s + Number(p.amount), 0), invoicedThisMonth: sum(monthInv.data),
      pipeline: sum(pipeline.data), pipelineCount: pipeline.data?.length ?? 0,
      winRate: decided.count ? Math.round(((accepted.count ?? 0) / decided.count) * 100) : null, drafts: drafts.count ?? 0,
    },
  }
}
