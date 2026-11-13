import { describe, it, expect } from 'vitest'
import { balanceOf, daysOverdue, docState, paidStamp, payState, paymentActions } from '@/lib/sales/status'
import { fmtQty, unitChoices, UNITS } from '@/lib/sales/docs'

const T = '2026-10-16'
describe('document status (separate from payment)', () => {
  it('maps every issued value to Sent, or Viewed once opened', () => {
    expect(docState('draft')).toBe('draft')
    expect(docState('cancelled')).toBe('cancelled')
    for (const s of ['sent', 'partially_paid', 'paid', 'overdue']) expect(docState(s)).toBe('sent')
    expect(docState('paid', '2026-10-01T10:00:00Z')).toBe('viewed')
    expect(docState('viewed')).toBe('viewed')
  })
})

describe('payment status from recorded payments', () => {
  const inv = (o: Partial<{ status: string; total: number; paid: number; credited: number; due_date: string | null }>) => ({ status: 'sent', total: 1000, paid: 0, credited: 0, due_date: '2026-11-01', ...o })
  it('no payment, not yet due → Unpaid', () => expect(payState(inv({}), T)).toBe('unpaid'))
  it('no due date → Unpaid (never Overdue)', () => expect(payState(inv({ due_date: null }), T)).toBe('unpaid'))
  it('due today is not overdue yet', () => expect(payState(inv({ due_date: T }), T)).toBe('unpaid'))
  it('partial payment → Partially paid', () => expect(payState(inv({ paid: 400 }), T)).toBe('partially_paid'))
  it('fully paid → Paid (even after the due date)', () => { expect(payState(inv({ paid: 1000 }), T)).toBe('paid'); expect(payState(inv({ paid: 1000, due_date: '2026-01-01' }), T)).toBe('paid') })
  it('due date passed with a balance → Overdue (also when partly paid)', () => { expect(payState(inv({ due_date: '2026-10-15' }), T)).toBe('overdue'); expect(payState(inv({ paid: 999.99, due_date: '2026-10-15' }), T)).toBe('overdue') })
  it('never Paid without a recorded payment, whatever the stored status says', () => {
    expect(payState(inv({ status: 'paid', paid: 0 }), T)).toBe('unpaid')
    expect(payState(inv({ status: 'paid', paid: 0, credited: 1000 }), T)).toBe('credited')
  })
  it('credit notes lower the amount due', () => { expect(payState(inv({ credited: 300, paid: 700 }), T)).toBe('paid'); expect(payState(inv({ credited: 300, paid: 100 }), T)).toBe('partially_paid') })
  it('cents are compared exactly (no float drift)', () => expect(payState(inv({ total: 0.3, paid: 0.1 + 0.2 }), T)).toBe('paid'))
  it('drafts and cancelled invoices have no payment status', () => { expect(payState(inv({ status: 'draft' }), T)).toBeNull(); expect(payState(inv({ status: 'cancelled', paid: 0 }), T)).toBeNull() })
  it('balance and days overdue', () => {
    expect(balanceOf({ total: 1000, paid: 250.5, credited: 100 })).toBe(649.5)
    expect(balanceOf({ total: 100, paid: 120 })).toBe(0)
    expect(daysOverdue('2026-10-06', T)).toBe(10); expect(daysOverdue(T, T)).toBe(0); expect(daysOverdue(null, T)).toBe(0)
  })
})

describe('payment actions offered', () => {
  it('draft: nothing to pay yet; can cancel', () => expect(paymentActions({ status: 'draft', total: 100, paid: 0 })).toEqual({ record: false, markPaid: false, markPartial: false, markUnpaid: false, cancel: true }))
  it('issued, unpaid', () => expect(paymentActions({ status: 'sent', total: 100, paid: 0 })).toEqual({ record: true, markPaid: true, markPartial: true, markUnpaid: false, cancel: true }))
  it('partly paid: can record more, mark unpaid, not cancel', () => expect(paymentActions({ status: 'partially_paid', total: 100, paid: 40 })).toEqual({ record: true, markPaid: true, markPartial: true, markUnpaid: true, cancel: false }))
  it('paid: only mark unpaid', () => expect(paymentActions({ status: 'paid', total: 100, paid: 100 })).toEqual({ record: false, markPaid: false, markPartial: false, markUnpaid: true, cancel: false }))
})

describe('units', () => {
  it('offers the trade units by their printed code', () => { for (const u of ['L.S', 'LM', 'SQM', 'PCS', 'KG', 'TON', 'SET', 'LOT', 'Nos']) expect(UNITS).toContain(u) })
  it('keeps a line’s own older unit in its picker', () => { expect(unitChoices('Sq.Mtr')[0]).toBe('Sq.Mtr'); expect(unitChoices('L.S')).toEqual(UNITS) })
  it('formats quantities for print', () => { expect(fmtQty(1250)).toBe('1,250'); expect(fmtQty('42.5')).toBe('42.5'); expect(fmtQty(0.125)).toBe('0.125'); expect(fmtQty(null)).toBe('0') })
})

describe('PAID stamp', () => {
  const inv = { doc_type: 'invoice', status: 'paid', total: 10500 }
  it('shows on a fully paid tax invoice, with the last payment date', () => {
    expect(paidStamp({ ...inv, paid: 10500 }, [{ paid_on: '2026-10-02' }, { paid_on: '2026-11-12' }, { paid_on: '2026-10-20' }])).toEqual({ date: '2026-11-12' })
    expect(paidStamp({ ...inv, paid: 10500 })).toEqual({ date: null })
  })
  it('counts a credit note towards the amount due, but needs a real payment', () => {
    expect(paidStamp({ ...inv, paid: 8000, credited: 2500 }, [{ paid_on: '2026-11-01' }])).toEqual({ date: '2026-11-01' })
    expect(paidStamp({ ...inv, paid: 0, credited: 10500 })).toBeNull()                 // fully credited: nothing was paid
  })
  it('never on partly paid, draft, cancelled, zero-value or non-invoice documents', () => {
    expect(paidStamp({ ...inv, status: 'partially_paid', paid: 10499.99 })).toBeNull()
    expect(paidStamp({ ...inv, status: 'draft', paid: 10500 })).toBeNull()
    expect(paidStamp({ ...inv, status: 'cancelled', paid: 10500 })).toBeNull()
    expect(paidStamp({ ...inv, total: 0, paid: 0 })).toBeNull()
    expect(paidStamp({ ...inv, doc_type: 'quotation', paid: 10500 })).toBeNull()
    expect(paidStamp({ ...inv, doc_type: 'credit_note', paid: 10500 })).toBeNull()
  })
})
