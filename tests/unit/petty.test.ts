import { describe, it, expect } from 'vitest'
import { employeeMayUse } from '@/lib/portal-paths'
import { defaultSettlement, kindLabel, matchHandovers, statement, statementRange, totals, type PettyEntry } from '@/lib/petty-math'

let n = 0
const e = (kind: PettyEntry['kind'], amount: number, entry_date: string, extra: Partial<PettyEntry> = {}): PettyEntry => ({
  id: `e${++n}`, book: kind === 'reimbursement_payable' || kind === 'reimbursement_paid' || (kind === 'reversal' && (extra.reverses_kind === 'reimbursement_payable' || extra.reverses_kind === 'reimbursement_paid')) ? 'reimbursement' : 'wallet',
  kind, reverses_kind: null, amount, entry_date, created_at: `${entry_date}T08:00:00Z`, description: kind, reference: null, ...extra,
})

describe('petty cash wallet arithmetic', () => {
  // the brief's example: AED 1,000 given; materials 350, transport 100, tools 200 → 350 left
  const ledger = [e('received', 1000, '2026-10-01'), e('expense_settled', -350, '2026-10-03'), e('expense_settled', -100, '2026-10-03'), e('expense_settled', -200, '2026-10-05')]
  it('available = received + adjustments − settled − returned', () => {
    expect(totals(ledger)).toMatchObject({ available: 350, received: 1000, settled: 650, returned: 0, reimbursementDue: 0 })
  })
  it('return of the rest leaves 0; reimbursements never change the petty cash balance', () => {
    const t = totals([...ledger, e('returned', -350, '2026-10-06'), e('reimbursement_payable', 150, '2026-10-06'), e('reimbursement_paid', -100, '2026-10-07')])
    expect(t).toMatchObject({ available: 0, returned: 350, reimbursementDue: 50, reimbursed: 100 })
  })
  it('a reversal cancels the original in its own column; fils add up exactly', () => {
    const r = e('received', 0.1, '2026-10-01'), r2 = e('received', 0.2, '2026-10-01')
    const t = totals([r, r2, e('reversal', -0.1, '2026-10-02', { reverses_kind: 'received', reverses_id: r.id })])
    expect(t.available).toBe(0.2); expect(t.received).toBe(0.2)
    expect(totals([r, r2]).available).toBe(0.3)
  })
  it('labels', () => {
    expect(kindLabel({ kind: 'received', reverses_kind: null })).toBe('Petty cash received')
    expect(kindLabel({ kind: 'reversal', reverses_kind: 'expense_settled' })).toBe('Reversal of approved expense settled')
  })
})

describe('statement', () => {
  const ledger = [e('received', 500, '2026-09-20'), e('expense_settled', -120, '2026-09-25'), e('received', 1000, '2026-10-01'),
    e('expense_settled', -300, '2026-10-02'), e('adjustment', -5, '2026-10-03'), e('returned', -200, '2026-10-04'), e('reimbursement_payable', 150, '2026-10-04'), e('received', 50, '2026-11-02')]
  it('opening, running balance, closing and totals for the period; later entries left out', () => {
    const st = statement(ledger, '2026-10-01', '2026-10-31')
    expect(st.opening).toBe(380)
    expect(st.rows.map(r => r.balance)).toEqual([1380, 1080, 1075, 875])
    expect(st.closing).toBe(875)
    expect(st).toMatchObject({ received: 1000, settled: 300, returned: 200, adjustments: -5 })
    expect(st.rows[1]).toMatchObject({ in: 0, out: 300 })
    expect(st.reimbursements).toHaveLength(1); expect(st.reimbursementDue).toBe(150)
  })
  it('default range starts at the first entry', () => {
    expect(statementRange(ledger, '2026-11-05')).toEqual({ from: '2026-09-20', to: '2026-11-05' })
    expect(statementRange([], '2026-11-05')).toEqual({ from: '2026-11-01', to: '2026-11-05' })
  })
})

describe('matching an employee report to a recorded hand-over', () => {
  const recs = [
    { id: 'a', kind: 'received', amount: 500, entry_date: '2026-10-01', reference: 'PC-77' },
    { id: 'b', kind: 'received', amount: 500, entry_date: '2026-10-20', reference: null },
    { id: 'c', kind: 'received', amount: 400, entry_date: '2026-10-02', reference: null },
    { id: 'd', kind: 'received', amount: 500, entry_date: '2026-10-03', reference: null },
  ]
  it('same amount, same reference first, then the nearest date within a week', () => {
    expect(matchHandovers({ amount: 500, entry_date: '2026-10-02', reference: 'pc 77' }, recs, new Set(), new Set()).map(m => m.id)).toEqual(['a', 'd'])
  })
  it('hand-overs already matched or reversed are not offered; nothing nearby means new money', () => {
    expect(matchHandovers({ amount: 500, entry_date: '2026-10-02', reference: null }, recs, new Set(['a']), new Set(['d'])).map(m => m.id)).toEqual([])
    expect(matchHandovers({ amount: 750, entry_date: '2026-10-02', reference: null }, recs, new Set(), new Set())).toEqual([])
  })
})

describe('default settlement when approving', () => {
  it('petty cash: as much as held; the rest waits (the employee is not assumed to have paid)', () => {
    expect(defaultSettlement('petty_cash', 350, 200)).toEqual({ petty: 200, personal: 0, awaiting: 150 })
    expect(defaultSettlement('petty_cash', 250, 1000)).toEqual({ petty: 250, personal: 0, awaiting: 0 })
    expect(defaultSettlement('petty_cash', 80, -5)).toEqual({ petty: 0, personal: 0, awaiting: 80 })
  })
  it('own money: all owed back; company / earlier claims: nothing to settle', () => {
    expect(defaultSettlement('personal', 250, 900)).toEqual({ petty: 0, personal: 250, awaiting: 0 })
    expect(defaultSettlement('company', 250, 900)).toEqual({ petty: 0, personal: 0, awaiting: 0 })
    expect(defaultSettlement(null, 250, 900)).toEqual({ petty: 0, personal: 0, awaiting: 0 })
  })
})

describe('employee portal access', () => {
  it('an employee may open their petty cash page and statement, never the company list or export', () => {
    expect(employeeMayUse('/me/expenses/petty-cash')).toBe(true)
    expect(employeeMayUse('/api/petty-cash/4dbc708c-4fa0-4443-a514-c6b8392afdd2/statement')).toBe(true)
    expect(employeeMayUse('/api/petty-cash/export')).toBe(false)
    expect(employeeMayUse('/expenses/petty-cash/4dbc708c-4fa0-4443-a514-c6b8392afdd2')).toBe(false)
  })
})
