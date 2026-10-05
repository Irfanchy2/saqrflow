import { it, expect } from 'vitest'
import fs from 'node:fs'
import { renderSalesPdf } from '@/lib/sales/pdf'
import { DEFAULTS } from '@/lib/sales/docs'

// Renders the three document types. Uses the real branding images only when present locally (never committed).
const dir = '/tmp/claude-0/ref', out = process.env.PDF_OUT
const load = (f: string, png: boolean) => (fs.existsSync(`${dir}/${f}`) ? { bytes: new Uint8Array(fs.readFileSync(`${dir}/${f}`)), png } : undefined)
const images: any = { header: load('img1.png', true), header_invoice: load('img2.jpg', false), footer: load('img3.jpg', false), stamp: load('img4.png', true), signature: load('img5.png', true) }
for (const k of Object.keys(images)) if (!images[k]) delete images[k]
const items = [
  { description: 'Supply and installation of steel staircase with handrail, primer + 2 coats paint', materials: 'MS hollow section 100x50x3mm, chequered plate 6mm', quantity: 1, unit: 'Set', unit_price: 25000 },
  { description: 'Fabrication of steel canopy frame', quantity: 42.5, unit: 'Sq.Mtr', unit_price: 180 },
  { description: 'Arabic customer name test: شركة', quantity: 2, unit: 'Nos', unit_price: 350.5 },
]
const base = { number: 'QTN-2026-0007', issue_date: '2026-10-05', attention: 'Mr. Ahmed', customer_name: 'ABC Contracting LLC', customer_address: 'Musaffah M-44, Abu Dhabi', customer_trn: '100123456700003', site: 'Villa 22, Fujairah', vat_rate: 5, terms: DEFAULTS.terms, payment_terms: DEFAULTS.paymentTerms, intro: DEFAULTS.intro, closing: DEFAULTS.closing }
for (const t of ['quotation', 'invoice', 'delivery_note'] as const) it(`renders a valid ${t} PDF`, async () => {
  const bytes = await renderSalesPdf({ ...base, doc_type: t, number: t === 'invoice' ? 'INV-2026-0003' : t === 'delivery_note' ? 'DN-2026-0002' : base.number, lpo_ref: 'LPO-889', del_no: 'DN-2026-0002', due_date: '2026-11-04' } as any, items,
    { companyName: 'Al Saqr Al Ahmar Welding & Blacksmith LLC', images, showHeaderFooter: true, showStamp: true, bankDetails: 'Bank Name: Abu Dhabi Commercial Bank PJSC\nAccount Title: Al Saqr Al Ahmar Wld & Blacksmith LLC\nCurrency: AED', paid: 10000 })
  expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe('%PDF-')
  expect(bytes.length).toBeGreaterThan(1500)
  if (out) fs.writeFileSync(`${out}/${t}.pdf`, bytes)
})
it('long item lists flow onto extra pages', async () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ description: `Line ${i + 1} – structural steel work with a fairly long description that wraps onto two lines in the table`, quantity: 1, unit_price: 100 }))
  const bytes = await renderSalesPdf({ ...base, doc_type: 'invoice' } as any, many, { companyName: 'X', images: {}, showHeaderFooter: true, showStamp: false })
  const { PDFDocument } = await import('pdf-lib'); expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(1)
})
