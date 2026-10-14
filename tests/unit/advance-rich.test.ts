import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { hasMarkup, parseInline, parseRich, richToPlain } from '@/lib/sales/rich'
import { projectPaymentSummary } from '@/lib/projects'
import { renderSalesPdf } from '@/lib/sales/pdf'
import { DEFAULTS } from '@/lib/sales/docs'

describe('materials rich text', () => {
  it('plain text from before stays one paragraph per line', () => {
    expect(parseRich('MS hollow section 100x50x3mm, chequered plate 6mm')).toEqual([{ kind: 'p', runs: [{ text: 'MS hollow section 100x50x3mm, chequered plate 6mm' }] }])
    expect(parseRich('Line one\nLine two').map(b => b.kind)).toEqual(['p', 'p'])
  })
  it('bold, italic, underline and nesting', () => {
    expect(parseInline('Use **MS plate** and *primer* with __2 coats__')).toEqual([
      { text: 'Use ' }, { text: 'MS plate', b: true }, { text: ' and ' }, { text: 'primer', i: true }, { text: ' with ' }, { text: '2 coats', u: true }])
    expect(parseInline('**bold __and under__**')).toEqual([{ text: 'bold ', b: true }, { text: 'and under', b: true, u: true }])
    expect(parseInline('*primer*__two coats__')).toEqual([{ text: 'primer', i: true }, { text: 'two coats', u: true }])
  })
  it('does not treat maths, sizes or snake_case as formatting', () => {
    expect(parseInline('2*3*4 m and size_a__b and 5 * 6')).toEqual([{ text: '2*3*4 m and size_a__b and 5 * 6' }])
    expect(hasMarkup('MS pipe 50x50')).toBe(false)
  })
  it('bullets and numbers become vertical lists, one item per line', () => {
    const b = parseRich('Materials:\n- MS pipe\n- GI sheet 1.2mm\n• Bolts\n1. Primer\n2. Paint')
    expect(b.map(x => x.kind)).toEqual(['p', 'ul', 'ol'])
    expect((b[1] as any).items.map((it: any) => it[0].text)).toEqual(['MS pipe', 'GI sheet 1.2mm', 'Bolts'])
    expect((b[2] as any).start).toBe(1)
    expect(richToPlain('- **A**\n- B')).toBe('• A\n• B')
  })
})

describe('project payments summary', () => {
  it('received = invoice payments + unapplied advances; remaining against the contract value', () => {
    expect(projectPaymentSummary(100000, 0, 30000)).toEqual({ received: 30000, unapplied: 30000, remaining: 70000 })
    expect(projectPaymentSummary(100000, 52500, 0)).toEqual({ received: 52500, unapplied: 0, remaining: 47500 })
    expect(projectPaymentSummary(0, 1000, 500).remaining).toBeNull()
    expect(projectPaymentSummary(1000, 1200, 0).remaining).toBe(0)
  })
})

const pdfText = (bytes: Uint8Array) => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-')), 'x.pdf'); fs.writeFileSync(f, bytes)
  return execFileSync('pdftotext', ['-layout', f, '-']).toString()
}
const hasPdftotext = (() => { try { execFileSync('pdftotext', ['-v'], { stdio: 'ignore' }); return true } catch { return false } })()
const base = { number: 'QTN-1', issue_date: '2026-10-05', customer_name: 'ABC Contracting LLC', customer_address: 'Musaffah', vat_rate: 5, terms: DEFAULTS.terms, payment_terms: DEFAULTS.paymentTerms }
const opts = { companyName: 'Al Saqr', images: {}, showHeaderFooter: true, showStamp: false }

describe.runIf(hasPdftotext)('PDF: rich materials and advances', () => {
  it('lists render one item per line with bullets / numbers, formatting markers never printed', async () => {
    const txt = pdfText(await renderSalesPdf({ ...base, doc_type: 'quotation' } as any, [{ description: 'Steel staircase', materials: 'Supply of:\n- **MS hollow** section 100x50\n- GI sheet *1.2mm*\n1. Primer\n2. __Two__ coats paint', quantity: 1, unit_price: 25000 }], opts))
    expect(txt).toMatch(/Materials to be used: Supply of:/)
    expect(txt).toMatch(/•\s+MS hollow section 100x50\n[\s\S]*?•\s+GI sheet 1\.2mm/)
    expect(txt).toMatch(/1\.\s+Primer\n[\s\S]*?2\.\s+Two coats paint/)
    expect(txt).not.toMatch(/\*\*|__/)
  })
  it('a very long materials list continues on the next page instead of running off it', async () => {
    const long = Array.from({ length: 140 }, (_, i) => `- Item ${i + 1}: steel section with a long specification that wraps`).join('\n')
    const bytes = await renderSalesPdf({ ...base, doc_type: 'quotation' } as any, [{ description: 'Long spec', materials: long, quantity: 1, unit_price: 10 }], opts)
    const { PDFDocument } = await import('pdf-lib'); expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(2)
    const txt = pdfText(bytes); expect(txt).toContain('Item 1:'); expect(txt).toContain('Item 140:')
  })
  it('quotation shows Less: Advance received and the balance; VAT is unchanged', async () => {
    const txt = pdfText(await renderSalesPdf({ ...base, doc_type: 'quotation', apply_vat: true, advance_applied: 10000, advance_pending: true } as any, [{ description: 'Gate', quantity: 1, unit_price: 20000 }], opts))
    expect(txt).toMatch(/VAT 5%\s+1,000\.00/); expect(txt).toMatch(/21,000\.00/)
    expect(txt).toMatch(/Less: Advance\s+[\s\S]*?- 10,000\.00/); expect(txt).toMatch(/Balance\s+11,000\.00/)
  })
  it('draft invoice counts the advance as paid; VAT still on the full amount', async () => {
    const txt = pdfText(await renderSalesPdf({ ...base, doc_type: 'invoice', number: 'INV-1', advance_applied: 5000, advance_pending: true } as any, [{ description: 'Gate', quantity: 1, unit_price: 20000 }], { ...opts, paid: 0 }))
    expect(txt).toMatch(/1,000\.00\s+21,000\.00/)
    expect(txt).toMatch(/Paid Amount\s+5,000\.00/); expect(txt).toMatch(/incl\. advance 5,000\.00/); expect(txt).toMatch(/Total Balance\s+16,000\.00/)
  })
  it('delivery note mentions the advance received', async () => {
    const txt = pdfText(await renderSalesPdf({ ...base, doc_type: 'delivery_note', number: 'DN-1', advance_applied: 2500, advance_pending: true } as any, [{ description: 'Gate', quantity: 1, unit_price: 0 }], opts))
    expect(txt).toMatch(/Advance received for this project:\s+AED 2,500\.00/)
  })
})
