import { describe, expect, it } from 'vitest'
import { ageBucket, receivablesAgeing, salesKpis, type InvRow } from '@/lib/sales/summary'
import { projectFinancials } from '@/lib/projects'

const inv = (o: Partial<InvRow>): InvRow => ({ id: Math.random().toString(36), doc_type: 'invoice', status: 'sent', number: 'INV', customer_name: 'ABC', customer_id: 'c1', issue_date: '2026-09-01', due_date: '2026-10-01', total: 1000, paid: 0, ...o })

describe('receivables', () => {
  it('buckets by days past due', () => {
    expect(ageBucket('2026-10-10', '2026-10-05')).toBe(0)
    expect(ageBucket('2026-10-01', '2026-10-05')).toBe(1)
    expect(ageBucket('2026-08-20', '2026-10-05')).toBe(2)
    expect(ageBucket('2026-06-01', '2026-10-05')).toBe(4)
  })
  it('ages open balances per customer and ignores drafts, paid and quotations', () => {
    const rows = [inv({ total: 1050, paid: 50 }), inv({ due_date: '2026-06-01', total: 500 }), inv({ customer_id: 'c2', customer_name: 'XYZ', status: 'partially_paid', total: 300, paid: 100, due_date: '2026-12-01' }),
      inv({ status: 'draft' }), inv({ status: 'paid', paid: 1000 }), inv({ doc_type: 'quotation', status: 'sent' })]
    const a = receivablesAgeing(rows, '2026-10-05')
    expect(a.list.map(e => [e.customer, e.total])).toEqual([['ABC', 1500], ['XYZ', 200]])
    expect(a.totals).toEqual([200, 1000, 0, 0, 500]); expect(a.grand).toBe(1700)
  })
  it('computes KPIs', () => {
    const rows = [inv({ total: 1000, paid: 400, status: 'partially_paid', due_date: '2026-09-01' }), inv({ doc_type: 'quotation', status: 'sent', total: 5000 }),
      inv({ doc_type: 'quotation', status: 'accepted' }), inv({ doc_type: 'quotation', status: 'rejected' }), inv({ status: 'draft' })]
    const k = salesKpis(rows, [{ amount: 400, paid_on: '2026-10-02' }, { amount: 99, paid_on: '2026-09-02' }], '2026-10-05')
    expect(k).toMatchObject({ outstanding: 600, overdue: 600, overdueCount: 1, collectedThisMonth: 400, pipeline: 5000, winRate: 50, drafts: 1 })
  })
})

describe('project financials', () => {
  it('uses issued invoices, payments and costs', () => {
    const f = projectFinancials(100000, [{ doc_type: 'invoice', status: 'partially_paid', total: 52500, paid: 30000 }, { doc_type: 'invoice', status: 'draft', total: 9999 }, { doc_type: 'quotation', status: 'accepted', total: 105000 }],
      [{ amount: 40000, category: 'material' }, { amount: 15000, category: 'labour' }])
    expect(f).toMatchObject({ invoiced: 52500, received: 30000, outstanding: 22500, expenses: 55000, profit: 45000, margin: 45, billedPct: 53, collectedPct: 57, byCategory: { material: 40000, labour: 15000 } })
  })
  it('falls back to the invoiced amount without a contract value', () => {
    expect(projectFinancials(null, [{ doc_type: 'invoice', status: 'sent', total: 1000 }], [{ amount: 1200 }])).toMatchObject({ profit: -200, margin: -20, billedPct: null })
  })
})

describe('project profitability (recorded data only)', () => {
  it('revenue is ex-VAT, credit notes reduce it, accepted quotation is the fallback value', () => {
    const f = projectFinancials(null, [
      { doc_type: 'quotation', status: 'converted', total: 105000, vat_amount: 5000 },
      { doc_type: 'invoice', status: 'sent', total: 52500, vat_amount: 2500, paid: 10000 },
      { doc_type: 'credit_note', status: 'sent', total: 2100, vat_amount: 100 },
    ], [{ amount: 30000, category: 'material' }, { amount: 5000, category: 'fuel' }])
    expect(f).toMatchObject({ quoted: 100000, value: 100000, invoicedNet: 48000, invoiced: 50400, profit: 65000, margin: 65, actualProfit: 13000, byCategory: { material: 30000, fuel: 5000 } })
  })
})
