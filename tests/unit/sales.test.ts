import { describe, it, expect } from 'vitest'
import { amountInWords, computeTotals, lineAmount, lineVat, numberToWords, r2, fmtMoney } from '@/lib/sales/money'
import { CONVERSIONS, DOC_META, manualStatuses } from '@/lib/sales/docs'

describe('sales maths', () => {
  it('line amounts and VAT round per line', () => {
    expect(lineAmount({ quantity: 3, unit_price: 33.335 })).toBe(100.02)   // rate is stored with 2 decimals (33.34), so the editor shows what reloads
    expect(lineVat({ quantity: 1, unit_price: 25000 }, 5)).toBe(1250)
    expect(r2(0.1 + 0.2)).toBe(0.3)
  })
  it('totals with VAT and discount', () => {
    expect(computeTotals([{ quantity: 1, unit_price: 25000 }], 5)).toMatchObject({ subtotal: 25000, discount: 0, taxable: 25000, vat: 1250, total: 26250 })
    expect(computeTotals([{ quantity: 2, unit_price: 1000 }, { quantity: 12.5, unit_price: 80 }], 5, 500)).toMatchObject({ subtotal: 3000, discount: 500, taxable: 2500, vat: 125, total: 2625 })
    expect(computeTotals([{ quantity: 1, unit_price: 100 }], 5, 999).discount).toBe(100)          // discount capped at subtotal
    expect(computeTotals([{ quantity: 1, unit_price: 100 }], 5, 0, false).vat).toBe(0)           // quotation: "VAT will be applied" note only
    expect(computeTotals([], 5).total).toBe(0)
  })
  it('float-safe maths, percent / line discounts, VAT categories', () => {
    // classic float traps: 0.1 × 3, 1.15 × 100, 1249.995 …
    expect(lineAmount({ quantity: 3, unit_price: 0.1 })).toBe(0.3)
    expect(lineAmount({ quantity: 100, unit_price: 1.15 })).toBe(115)
    expect(lineAmount({ quantity: 0.333, unit_price: 3753.75 })).toBe(1250)        // 1249.99875 → 1250.00
    expect(computeTotals(Array.from({ length: 10 }, () => ({ quantity: 1, unit_price: 0.1 })), 5).subtotal).toBe(1)
    expect(computeTotals([{ quantity: 2.5, unit_price: 499.99 }], 5)).toMatchObject({ subtotal: 1249.98, vat: 62.5, total: 1312.48 })
    expect(computeTotals([{ quantity: 1, unit_price: 2000 }], 5, { type: 'percent', value: 10 })).toMatchObject({ discount: 200, taxable: 1800, vat: 90, total: 1890 })
    expect(lineAmount({ quantity: 4, unit_price: 250, discount_pct: 12.5 })).toBe(875)
    // mixed VAT: only standard-rated lines carry VAT; the document discount is shared pro rata
    const t = computeTotals([{ quantity: 1, unit_price: 1000 }, { quantity: 1, unit_price: 1000, vat_category: 'zero' }, { quantity: 1, unit_price: 500, vat_category: 'exempt' }], 5, 250)
    expect(t).toMatchObject({ subtotal: 2500, discount: 250, taxable: 2250, standardBase: 900, zeroBase: 900, exemptBase: 450, vat: 45, total: 2295 })
    expect(lineVat({ quantity: 1, unit_price: 1000, vat_category: 'exempt' }, 5)).toBe(0)
    expect(computeTotals([{ quantity: 1, unit_price: 100 }], 5, { type: 'percent', value: 150 }).total).toBe(0)   // capped
    expect(r2(1.005)).toBe(1.01); expect(r2(-2.675)).toBe(-2.68)
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

import { salesPdfName, safePart } from '@/lib/sales/filename'
describe('PDF file names', () => {
  it('meaningful and filesystem-safe', () => {
    expect(salesPdfName({ doc_type: 'quotation', number: 'AS0025180/2026', customer_name: 'ABC Contracting' })).toBe('AS0025180-2026_ABC-Contracting_Quotation.pdf')
    expect(salesPdfName({ doc_type: 'invoice', number: 'INV-2026-0001', customer_name: 'ABC Contracting L.L.C.' })).toBe('INV-2026-0001_ABC-Contracting-L.L.C.pdf')
    expect(salesPdfName({ doc_type: 'delivery_note', number: 'DN-2026-0007', customer_name: 'ABC', project_name: 'Villa 22, Fujairah' })).toBe('DN-2026-0007_Villa-22-Fujairah.pdf')
    expect(salesPdfName({ doc_type: 'quotation', number: 'AS0025180/2026', customer_name: 'a/b\\c:*?"<>|', revision: 2 })).toBe('AS0025180-2026_Rev2_a-b-c_Quotation.pdf')
    expect(salesPdfName({ doc_type: 'invoice', number: 'INV-1', customer_name: null })).toBe('INV-1.pdf')
    expect(safePart('../../etc/passwd')).toBe('etc-passwd')
  })
})
