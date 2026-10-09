import { describe, expect, it } from 'vitest'
import { inflateSync } from 'node:zlib'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { defaultTemplate, isDefault, resolveTemplate, sanitizeTemplate } from '@/lib/sales/template'
import { SalesPaper, type Branding } from '@/components/sales/paper'
import { renderSalesPdf } from '@/lib/sales/pdf'

const doc = { doc_type: 'quotation', number: 'AS-002600/2026', issue_date: '2026-10-05', valid_until: '2026-11-04', attention: 'Mr. Ahmed', customer_name: 'ABC LLC', customer_address: 'Dubai', customer_trn: '100123456700003',
  vat_rate: 5, terms: ['Valid 30 days'], payment_terms: ['50% advance'], reference: 'WA-1' } as any
const items = [{ description: 'Steel staircase', quantity: 1, unit_price: 1000 }]
const branding: Branding = { companyName: 'Al Saqr', showHeaderFooter: false, showStamp: true, bankDetails: 'ADCB 123', signatoryName: 'Manager' }
const html = (b: Branding, d = doc) => renderToStaticMarkup(createElement(SalesPaper, { doc: d, items, branding: b }))
/** text drawn in a pdf-lib PDF: inflate every content stream and decode the hex strings of Tj operators */
const pdfText = (bytes: Uint8Array) => {
  const s = Buffer.from(bytes).toString('latin1'), out: string[] = []
  for (const m of s.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) { let t: string; try { t = inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1') } catch { t = m[1] } for (const h of t.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) out.push(Buffer.from(h[1], 'hex').toString('latin1')) }
  return out.join('\n')
}
const pdf = (tpl?: any, d = doc) => renderSalesPdf(d, items, { companyName: 'Al Saqr', images: {}, showHeaderFooter: false, showStamp: true, bankDetails: 'ADCB 123', signatoryName: 'Manager', templates: tpl })

describe('template builder', () => {
  it('defaults reproduce the standard layout per type', () => {
    expect(defaultTemplate('quotation')).toMatchObject({ scopeHeading: 'The scope of works:-', showSignature: true, showBank: false, fields: { attention: true, customer_trn: false, lpo: false, valid_until: true } })
    expect(defaultTemplate('invoice')).toMatchObject({ scopeHeading: '', showSignature: false, showBank: true, showWords: true, fields: { customer_trn: true, lpo: true, del_no: true, due_date: true } })
    expect(defaultTemplate('credit_note').fields.del_no).toBe(false)
    expect(isDefault('invoice', sanitizeTemplate('invoice', {}))).toBe(true)
  })
  it('sanitises stored values and ignores fields that do not belong to the type', () => {
    const t = resolveTemplate('quotation', { title: '  PROPOSAL\n', fields: { attention: false, del_no: true }, labels: { rate: '' }, footerNote: 'x'.repeat(500), showWords: true, showSignature: 'yes' })
    expect(t.title).toBe('PROPOSAL'); expect(t.fields.attention).toBe(false); expect(t.fields.del_no).toBe(false)
    expect(t.labels.rate).toBe('Unit price (dhs)'); expect(t.footerNote.length).toBe(300); expect(t.showWords).toBe(false); expect(t.showSignature).toBe(true)
    expect(resolveTemplate('credit_note', { title: 'NOPE' }).title).toBe('')   // an invoice template never retitles a credit note
  })
  it('paper and PDF render the standard layout identically to before, and both follow a saved template', async () => {
    const std = html(branding)
    expect(std).toContain('QUOTATION'); expect(std).toContain('Attention:'); expect(std).toContain('The scope of works:-'); expect(std).not.toContain('Bank Details')
    const tpl = { quotation: { title: 'PROPOSAL', scopeHeading: 'Scope:', fields: { attention: false }, labels: { description: 'ITEM', rate: 'Rate (AED)' }, showBank: true, showSignature: false, footerNote: 'Thank you for your business' } }
    const out = html({ ...branding, templates: tpl })
    for (const s of ['PROPOSAL', 'Scope:', 'ITEM', 'Bank Details', 'ADCB 123', 'Thank you for your business']) expect(out).toContain(s)
    expect(out).not.toContain('Attention:'); expect(out).not.toContain('Manager'); expect(out).not.toContain('The scope of works')
    const p0 = pdfText(await pdf()), p1 = pdfText(await pdf(tpl))
    expect(p0).toContain('QUOTATION'); expect(p0).toContain('Attention:'); expect(p0).not.toContain('Bank Details')
    for (const s of ['PROPOSAL', 'Scope:', 'ITEM', 'Bank Details: -', 'ADCB 123', 'Thank you for your business']) expect(p1).toContain(s)
    expect(p1).not.toContain('Attention:'); expect(p1).not.toContain('QUOTATION')
  })
  it('tax invoice essentials stay even when blocks are switched off', async () => {
    const inv = { ...doc, doc_type: 'invoice', number: 'INV-610' }
    const tpl = { invoice: { showWords: false, showComputerLine: false, showBank: false } }
    const out = html({ ...branding, companyTrn: '100999888700003', templates: tpl }, inv)
    expect(out).toContain('VAT 5%'); expect(out).toContain('Amount With Vat'); expect(out).toContain('TRN: 100999888700003')
    expect(out).not.toContain('Amount in Words'); expect(out).not.toContain('computer-generated'); expect(out).not.toContain('Bank Details')
    const p = pdfText(await renderSalesPdf(inv, items, { companyName: 'X', images: {}, showHeaderFooter: false, showStamp: false, bankDetails: 'ADCB', companyTrn: '100999888700003', templates: tpl }))
    expect(p).toContain('Amount With Vat'); expect(p).toContain('TRN: 100999888700003'); expect(p).not.toContain('Amount in Words'); expect(p).not.toContain('computer-generated')
  })
})
