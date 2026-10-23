import { describe, it, expect } from 'vitest'
import { readReceipt, mergeAi, seenInText } from '@/lib/expenses/receipt-read'
import { buildTallyXml, checkExport, checkTallyXml, reviewSheets, vouchersFor, xmlEscape, DEFAULT_TALLY, type ExportExpense, type TallySettings } from '@/lib/expenses/tally'

const TODAY = '2026-10-23'
const TAX_INVOICE = `AL FAHIM BUILDING MATERIALS L.L.C
P.O. Box 1234, Musaffah, Abu Dhabi
Tel: 02 555 1234
TRN: 100234567800003
TAX INVOICE
Invoice No: INV-55821
Invoice Date: 03/10/2026
Bill To: Demo Steel Works LLC
1. MS Hollow Section 100x50x3 40 pcs 80.00 3,200.00
2. Welding rods E6013 2.5mm 5 box 64.00 320.00
Subtotal 3,520.00
VAT 5% 176.00
Grand Total AED 3,696.00`

describe('receipt reading (OCR text → suggested fields)', () => {
  it('reads a UAE supplier tax invoice: supplier, TRN, number, date, lines and the three amounts', () => {
    const r = readReceipt(TAX_INVOICE, TODAY)
    expect(r).toMatchObject({ supplier: 'AL FAHIM BUILDING MATERIALS L.L.C', trn: '100234567800003', invoice_no: 'INV-55821', date: '2026-10-03', subtotal: 3520, vat: 176, total: 3696, vat_rate: 5 })
    expect(r.lines).toEqual([
      { description: 'MS Hollow Section 100x50x3', quantity: 40, unit_price: 80, amount: 3200 },
      { description: 'Welding rods E6013 2.5mm', quantity: 5, unit_price: 64, amount: 320 },
    ])
    expect(r.confidence).toMatchObject({ supplier: 'high', trn: 'high', invoice_no: 'high', total: 'high', lines: 'high' })
    expect(r.warnings).toEqual([])
  })
  it('works out the missing amount from the other two, and flags totals that do not add up', () => {
    const a = readReceipt('ACME TRADING LLC\nInvoice No: A-9\nDate: 01/10/2026\nVAT 5% 50.00\nTotal 1,050.00', TODAY)
    expect(a).toMatchObject({ subtotal: 1000, vat: 50, total: 1050 }); expect(a.confidence.subtotal).toBe('medium')
    const b = readReceipt('ACME TRADING LLC\nSubtotal 1,000.00\nVAT 5% 50.00\nTotal 1,500.00', TODAY)
    expect(b.warnings.join(' ')).toMatch(/does not equal the total 1500\.00/)
  })
  it('VAT-inclusive receipt with no VAT line: 5% backed out, marked low and explained', () => {
    const r = readReceipt('ADNOC SERVICE STATION\nTax Invoice\nReceipt No. 99812\n04-10-2026\nTotal AED 105.00', TODAY)
    expect(r).toMatchObject({ total: 105, vat: 5, subtotal: 100 })
    expect(r.confidence.vat).toBe('low'); expect(r.warnings.join(' ')).toMatch(/5% included/)
  })
  it('flags non-standard VAT, a short TRN, a future date ignored, and a very old date', () => {
    const r = readReceipt('X GENERAL TRADING LLC\nTRN 100 2345 6780\nDate: 01/01/2030\nSubtotal 100.00\nVAT 10.00\nTotal 110.00', TODAY)
    expect(r.date).toBeUndefined()                                    // a date in the future is never suggested
    expect(r.warnings.join(' ')).toMatch(/not the UAE standard 5%/)
    const old = readReceipt('X GENERAL TRADING LLC\nDate: 05/01/2022\nTotal 10.00', TODAY); expect(old.warnings.join(' ')).toMatch(/more than two years/)
  })
  it('never invents values from text that is not a receipt', () => {
    const r = readReceipt('hello world', TODAY)
    expect(r).toMatchObject({ lines: [], warnings: [] }); expect(r.total).toBeUndefined(); expect(r.vat).toBeUndefined(); expect(r.invoice_no).toBeUndefined()
  })
  it('AI suggestions are used only where they appear on the receipt and the amounts add up', () => {
    const text = 'SHARP TOOLS EST\nBill 7781\nGrinder disc 115mm 20 x 4.50 = 90.00\nnet 90.00 vat 4.50 total 94.50'
    const rules = readReceipt(text, TODAY)
    const merged = mergeAi(rules, { supplier: 'Sharp Tools Est', invoice_no: '7781', subtotal: 90, vat: 4.5, total: 94.5, lines: [{ description: 'Grinder disc 115mm', quantity: 20, unit_price: 4.5, amount: 90 }, { description: 'Invented line', quantity: 1, unit_price: 999, amount: 999 }] }, text)
    expect(merged).toMatchObject({ subtotal: 90, vat: 4.5, total: 94.5 })
    expect(merged.lines).toEqual([{ description: 'Grinder disc 115mm', quantity: 20, unit_price: 4.5, amount: 90 }])   // 999 is not on the receipt
    const lied = mergeAi(readReceipt(TAX_INVOICE, TODAY), { total: 9999, vat: 476, subtotal: 9523, supplier: 'Someone Else LLC' }, TAX_INVOICE)
    expect(lied).toMatchObject({ total: 3696, supplier: 'AL FAHIM BUILDING MATERIALS L.L.C' })
    expect(seenInText('Total 3,696.00', 3696)).toBe(true); expect(seenInText('Total 13,696.00', 3696)).toBe(false)
  })
})

const S: TallySettings = { ...DEFAULT_TALLY, tally_company: 'Demo Steel Works LLC', vat_ledger: 'Input VAT 5%', category_ledgers: { material: 'Purchase - Materials', fuel: 'Fuel Expenses' }, payment_ledgers: { cash: 'Cash', card: 'Emirates NBD Card' }, bank_ledgers: { 'bank-1': 'Emirates NBD Current A/c' } }
const row = (o: Partial<ExportExpense>): ExportExpense => ({ id: 'e1', spent_on: '2026-10-03', category: 'material', description: 'MS angle & plate <50x50>', amount: 3520, vat_amount: 176, reference: 'INV-55821', supplier_name: 'Al Fahim Building Materials LLC', supplier_ledger: null, supplier_trn: '100234567800003', payment_method: 'cash', payment_status: 'paid', paid_from_bank_id: null, verified_at: '2026-10-03T10:00:00Z', approval_status: null, export_batch_id: null, ...o })

describe('Tally export: validation report', () => {
  it('lists every missing ledger mapping before any file is produced', () => {
    const rep = checkExport([row({}), row({ id: 'e2', category: 'labour' }), row({ id: 'e3', payment_method: 'bank_transfer' }), row({ id: 'e4', paid_from_bank_id: 'bank-9', bank_label: 'ADCB ••77' })], { ...S, vat_ledger: null })
    expect(rep.errors.map(e => e.message)).toEqual(expect.arrayContaining(['No input VAT ledger', 'No Tally ledger for the "Labour" category', 'No Tally ledger for payments by bank transfer', 'No Tally ledger for the account "ADCB ••77"']))
    expect(rep.errors.find(e => e.key === 'vat')!.count).toBe(4)
  })
  it('leaves out unverified, unapproved and already exported expenses, with the reason', () => {
    const rep = checkExport([row({ verified_at: null }), row({ id: 'b', approval_status: 'pending' }), row({ id: 'c', export_batch_id: 'x' }), row({ id: 'd' })], S)
    expect(rep.excluded.map(x => x.reason)).toEqual(['Not verified yet', 'Waiting for approval', 'Already exported'])
    expect(rep.ready.map(r => r.id)).toEqual(['d']); expect(rep.totals).toEqual({ count: 1, amount: 3520, vat: 176, total: 3696 })
  })
  it('an unpaid expense needs a supplier; duplicate supplier invoices are flagged', () => {
    const rep = checkExport([row({ payment_status: 'unpaid', supplier_name: null }), row({ id: 'x2' }), row({ id: 'x3' })], S)
    expect(rep.errors.map(e => e.key)).toContain('nosupplier')
    expect(rep.warnings.find(w => w.key.startsWith('dup:'))!.ids).toEqual(['x3'])
  })
})

describe('Tally export: vouchers and XML', () => {
  it('paid expense → Payment voucher: Dr expense + Dr VAT, Cr cash; sums to zero', () => {
    const [v] = vouchersFor(row({}), S)
    expect(v).toMatchObject({ type: 'Payment', party: 'Cash', remote: 'averiqo-exp-e1' })
    expect(v.lines).toEqual([{ ledger: 'Purchase - Materials', dr: 3520 }, { ledger: 'Input VAT 5%', dr: 176 }, { ledger: 'Cash', dr: -3696 }])
  })
  it('unpaid → Purchase voucher crediting the supplier ledger (its Tally name when set)', () => {
    const [v] = vouchersFor(row({ payment_status: 'unpaid', supplier_ledger: 'Al Fahim (Sundry Creditor)' }), S)
    expect(v).toMatchObject({ type: 'Purchase', party: 'Al Fahim (Sundry Creditor)' })
    expect(v.lines.at(-1)).toEqual({ ledger: 'Al Fahim (Sundry Creditor)', dr: -3696 })
  })
  it('purchase-and-payment mode books the bill and the payment from the bank ledger', () => {
    const vs = vouchersFor(row({ paid_from_bank_id: 'bank-1' }), { ...S, paid_mode: 'purchase_and_payment' })
    expect(vs.map(v => v.type)).toEqual(['Purchase', 'Payment'])
    expect(vs[1].lines).toEqual([{ ledger: 'Al Fahim Building Materials LLC', dr: 3696 }, { ledger: 'Emirates NBD Current A/c', dr: -3696 }])
  })
  it('zero VAT: no VAT line', () => {
    const [v] = vouchersFor(row({ vat_amount: 0, amount: 200, category: 'fuel', payment_method: 'card' }), S)
    expect(v.lines).toEqual([{ ledger: 'Fuel Expenses', dr: 200 }, { ledger: 'Emirates NBD Card', dr: -200 }])
  })
  it('the generated XML is well-formed, escaped, balanced, and passes the structural check', () => {
    const rows = [row({}), row({ id: 'e2', payment_status: 'unpaid', reference: 'A&B/7' }), row({ id: 'e3', vat_amount: 0.01, amount: 0.2 })]
    const xml = buildTallyXml(rows, { ...S, tally_company: 'Demo & Sons "Steel"' })
    const chk = checkTallyXml(xml)
    expect(chk).toMatchObject({ ok: true, errors: [], vouchers: 3 })
    expect(chk.debit).toBe(3696 * 2 + 0.21)
    expect(xml).toContain('<SVCURRENTCOMPANY>Demo &amp; Sons &quot;Steel&quot;</SVCURRENTCOMPANY>')
    expect(xml).toContain('MS angle &amp; plate &lt;50x50&gt;'); expect(xml).toContain('<REFERENCE>A&amp;B/7</REFERENCE>')
    expect(xml).toContain('<DATE>20261003</DATE>'); expect(xml).toContain('<ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>\n       <AMOUNT>-3520.00</AMOUNT>')
    expect(xml).toMatch(/<VOUCHER REMOTEID="averiqo-exp-e2" VCHTYPE="Purchase"/)
  })
  it('the structural check catches broken files', () => {
    const good = buildTallyXml([row({})], S)
    expect(checkTallyXml(good.replace('<AMOUNT>3696.00</AMOUNT>', '<AMOUNT>3695.00</AMOUNT>')).errors.join()).toMatch(/differ by -1\.00/)
    expect(checkTallyXml(good.replace('</NARRATION>', '')).ok).toBe(false)
    expect(checkTallyXml(good.replace('<DATE>20261003</DATE>', '<DATE>03-10-2026</DATE>')).errors.join()).toMatch(/YYYYMMDD/)
    expect(checkTallyXml(good.replace('Purchase - Materials', 'A & B')).errors.join()).toMatch(/stray "&"/)
    expect(checkTallyXml(good.replace('<ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>', '<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>')).errors.join()).toMatch(/flag does not match/)
    expect(checkTallyXml('<ENVELOPE></ENVELOPE>').errors).toContain('No vouchers in the file')
  })
  it('xmlEscape strips control characters that Tally rejects', () => { expect(xmlEscape('a\u0001b\u000bc & d')).toBe('abc &amp; d') })
  it('review sheets: expenses with status, ledger lines with debits and credits, validation', () => {
    const rep = checkExport([row({}), row({ id: 'n', verified_at: null })], S)
    const sh = reviewSheets(rep, S)
    expect(sh.expenses.rows.map(r => r.at(-1))).toEqual(['Ready', 'Not exported: Not verified yet'])
    expect(sh.ledger.rows).toEqual([
      ['2026-10-03', 'Payment', 'averiqo-exp-e1', 'INV-55821', 'Purchase - Materials', 3520, null, 'MS angle & plate <50x50>'],
      ['2026-10-03', 'Payment', 'averiqo-exp-e1', 'INV-55821', 'Input VAT 5%', 176, null, 'MS angle & plate <50x50>'],
      ['2026-10-03', 'Payment', 'averiqo-exp-e1', 'INV-55821', 'Cash', null, 3696, 'MS angle & plate <50x50>'],
    ])
    expect(sh.validation.rows).toEqual([['OK', 'Every expense has its ledgers mapped', '', 1]])
    expect(reviewSheets(checkExport([row({ payment_status: 'unpaid' })], S), S).validation.rows[0][0]).toBe('Note')   // supplier name used as its ledger
  })
})
