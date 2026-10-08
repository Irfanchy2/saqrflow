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

import { matchesFormat } from '@/lib/numbering'
describe('document number formats', () => {
  const as = { prefix: 'AS', fixed_digits: '00', seq_pad: 5, year_separator: '/', include_year: true }
  it('recognises the configured AS format', () => {
    expect(matchesFormat('AS0025180/2026', as)).toBe(true)
    expect(matchesFormat('AS00251801/2027', as)).toBe(true)
  })
  it('flags legacy numbers that need renumbering', () => {
    expect(matchesFormat('QTN-2026-0004', as)).toBe(false)
    expect(matchesFormat('QTN/2026/004', as)).toBe(false)
    expect(matchesFormat('AS0025180-2026', as)).toBe(false)
  })
  it('handles formats without a year', () => {
    expect(matchesFormat('PRJ00042', { prefix: 'PRJ', fixed_digits: '', seq_pad: 5, year_separator: '/', include_year: false })).toBe(true)
  })
})

import { resolvePeriod } from '@/lib/reports/period'
describe('report periods (company-local dates, no UTC shift)', () => {
  it('defaults to this calendar month', () => { expect(resolvePeriod({}, '2026-10-08')).toMatchObject({ key: 'month', from: '2026-10-01', to: '2026-10-31' }) })
  it('weeks start on Monday', () => { expect(resolvePeriod({ period: 'week' }, '2026-10-08')).toMatchObject({ from: '2026-10-05', to: '2026-10-11' }); expect(resolvePeriod({ period: 'week' }, '2026-10-11')).toMatchObject({ from: '2026-10-05' }) })
  it('quarters and years', () => {
    expect(resolvePeriod({ period: 'quarter' }, '2026-11-30')).toMatchObject({ from: '2026-10-01', to: '2026-12-31' })
    expect(resolvePeriod({ period: 'quarter' }, '2026-02-28')).toMatchObject({ from: '2026-01-01', to: '2026-03-31' })
    expect(resolvePeriod({ period: 'year' }, '2026-06-01')).toMatchObject({ from: '2026-01-01', to: '2026-12-31' })
  })
  it('custom ranges are validated and ordered', () => {
    expect(resolvePeriod({ from: '2026-09-30', to: '2026-09-01' }, '2026-10-08')).toMatchObject({ key: 'custom', from: '2026-09-01', to: '2026-09-30' })
    expect(resolvePeriod({ period: 'custom', from: 'nonsense', to: '2026-13-45' }, '2026-10-08')).toMatchObject({ from: '2026-10-01', to: '2026-10-08' })
  })
})
