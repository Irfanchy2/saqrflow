import { describe, it, expect } from 'vitest'
import { parseReceipt } from '@/lib/expenses/receipt'

describe('receipt reader', () => {
  it('reads a typical UAE tax invoice / receipt', () => {
    const g = parseReceipt(`AL FAHIM BUILDING MATERIALS LLC\nP.O. Box 1234, Musaffah, Abu Dhabi\nTRN: 100234567800003\nTAX INVOICE\nInvoice No: INV-55821\nDate: 03/10/2026\nMS Hollow Section 100x50x3   40 pcs   3,200.00\nSubtotal 3,200.00\nVAT 5% 160.00\nGrand Total AED 3,360.00`, '2026-10-05')
    expect(g).toMatchObject({ supplier: 'AL FAHIM BUILDING MATERIALS LLC', date: '2026-10-03', amount: 3360, vat: 160, reference: 'INV-55821', trn: '100234567800003' })
  })
  it('VAT-inclusive fuel receipt without a VAT line', () => {
    const g = parseReceipt('ADNOC\nTax Invoice\nReceipt No. 99812\n04-10-2026\nTotal AED 105.00', '2026-10-05')
    expect(g.amount).toBe(105); expect(g.vat).toBe(5); expect(g.date).toBe('2026-10-04')
  })
  it('never invents values', () => { expect(parseReceipt('hello world', '2026-10-05')).toEqual({ supplier: 'hello world' }) })
})
