import { describe, it, expect } from 'vitest'
import { amountInWords, computeTotals, lineAmount, lineVat, numberToWords, r2, fmtMoney } from '@/lib/sales/money'
import { CONVERSIONS, DOC_META, manualStatuses } from '@/lib/sales/docs'

describe('sales maths', () => {
  it('line amounts and VAT round per line', () => {
    expect(lineAmount({ quantity: 3, unit_price: 33.335 })).toBe(100.01)
    expect(lineVat({ quantity: 1, unit_price: 25000 }, 5)).toBe(1250)
    expect(r2(0.1 + 0.2)).toBe(0.3)
  })
  it('totals with VAT and discount', () => {
    expect(computeTotals([{ quantity: 1, unit_price: 25000 }], 5)).toEqual({ subtotal: 25000, discount: 0, taxable: 25000, vat: 1250, total: 26250 })
    expect(computeTotals([{ quantity: 2, unit_price: 1000 }, { quantity: 12.5, unit_price: 80 }], 5, 500)).toEqual({ subtotal: 3000, discount: 500, taxable: 2500, vat: 125, total: 2625 })
    expect(computeTotals([{ quantity: 1, unit_price: 100 }], 5, 999).discount).toBe(100)          // discount capped at subtotal
    expect(computeTotals([{ quantity: 1, unit_price: 100 }], 5, 0, false).vat).toBe(0)           // quotation: "VAT will be applied" note only
    expect(computeTotals([], 5).total).toBe(0)
  })
  it('amount in words (UAE dirhams / fils)', () => {
    expect(numberToWords(0)).toBe('Zero')
    expect(numberToWords(26250)).toBe('Twenty-Six Thousand Two Hundred Fifty')
    expect(numberToWords(1000001)).toBe('One Million One')
    expect(amountInWords(26250)).toBe('UAE Dirhams Twenty-Six Thousand Two Hundred Fifty Only')
    expect(amountInWords(1250.5)).toBe('UAE Dirhams One Thousand Two Hundred Fifty and Fils Fifty Only')
    expect(amountInWords('0.07')).toBe('UAE Dirhams Zero and Fils Seven Only')
    expect(fmtMoney(26250)).toBe('26,250.00')
  })
  it('document rules', () => {
    expect(DOC_META.delivery_note.priced).toBe(false)
    expect(CONVERSIONS.quotation).toEqual(['invoice', 'delivery_note'])
    expect(manualStatuses('invoice', 'draft')).toEqual(['sent', 'cancelled'])
    expect(manualStatuses('invoice', 'partially_paid')).toEqual(['cancelled'])   // paid/partially paid are automatic
    expect(manualStatuses('quotation', 'sent')).toContain('accepted')
  })
})
