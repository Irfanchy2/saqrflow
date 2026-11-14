import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PDFDocument } from 'pdf-lib'
import { invoicePaidStamp, paidStampArt, stampDate } from '@/lib/sales/paid-stamp'
import { renderSalesPdf } from '@/lib/sales/pdf'
import { SalesPaper } from '@/components/sales/paper'
import { DEFAULTS } from '@/lib/sales/docs'

/** every point of every outline, as [x, y] (fontkit / our paths only use pair-argument commands) */
const points = (d: string) => { const n = (d.match(/-?\d*\.?\d+(?:e-?\d+)?/gi) ?? []).map(Number), out: [number, number][] = []; for (let i = 0; i + 1 < n.length; i += 2) out.push([n[i], n[i + 1]]); return out }
const radius = ([x, y]: [number, number]) => Math.hypot(x - 100, y - 100)

describe('green PAID stamp artwork', () => {
  it('formats the date as DD-MM-YYYY (no time)', () => {
    expect(stampDate('2026-11-03')).toBe('03-11-2026')
    expect(stampDate('2026-01-15T10:20:00Z')).toBe('15-01-2026')
  })

  it('draws the bilingual stamp in green, inside its ring, the same every time', async () => {
    const o = { nameEn: 'Al Saqr Al Ahmar Steel Fabrication LLC', nameAr: 'الصقر الأحمر لصناعة الحديد ذ.م.م', date: '2026-11-03' }
    const a = await paidStampArt(o), b = await paidStampArt({ ...o })
    expect(a.ink).toBe('#15803D')
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))                     // deterministic, texture included
    expect(a.circles.length).toBeGreaterThanOrEqual(2)                    // double border (+ inner ring)
    expect(a.fills.length).toBeGreaterThan(40)
    for (const d of a.fills) for (const p of points(d)) expect(radius(p)).toBeLessThan(a.circles[0].r)
    const en = await paidStampArt({ nameEn: o.nameEn, nameAr: '', date: o.date })
    expect(en.fills.length).not.toBe(a.fills.length)                      // the Arabic name is really drawn
  })

  it('shrinks a very long company name instead of letting it run into the borders', async () => {
    const a = await paidStampArt({ nameEn: 'A very long company name for metal works and general contracting and trading LLC', nameAr: 'شركة طويلة جدا للأعمال المعدنية والمقاولات العامة والتجارة ذ.م.م', date: '2025-12-31' })
    for (const d of a.fills) for (const p of points(d)) expect(radius(p)).toBeLessThan(a.circles[1].r)
  })

  it('keeps the date line clear of the worn-rubber gaps', async () => {
    const a = await paidStampArt({ nameEn: 'Test Co', date: '2026-02-01' })
    expect(a.specks.length).toBeGreaterThan(50)
    expect(a.specks.filter(s => s.y > 66 && s.y < 92 && Math.abs(s.x - 100) < 52)).toEqual([])
  })
})

describe('which invoices get the stamp', () => {
  const ctx = (nameAr: string | null, error: any = null) => ({ company: { id: 'c1', name: 'Test Co' }, supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: error ? null : { name_ar: nameAr }, error }) }) }) }) } }) as any
  const doc = { doc_type: 'invoice', status: 'sent', total: 1050 }
  const pays = [{ paid_on: '2026-10-01' }, { paid_on: '2026-11-03' }]

  it('fully paid → stamp dated with the payment that completed it', async () => {
    const s = await invoicePaidStamp(ctx('شركة الاختبار'), { doc, paid: 1050, payments: pays })
    expect(s?.date).toBe('2026-11-03'); expect(s?.art?.fills.length).toBeGreaterThan(10)
  })
  it('part paid, unpaid, draft or cancelled → no stamp', async () => {
    expect(await invoicePaidStamp(ctx(null), { doc, paid: 1000, payments: pays })).toBeNull()
    expect(await invoicePaidStamp(ctx(null), { doc, paid: 0, payments: [] })).toBeNull()
    expect(await invoicePaidStamp(ctx(null), { doc: { ...doc, status: 'draft' }, paid: 1050, payments: pays })).toBeNull()
    expect(await invoicePaidStamp(ctx(null), { doc: { ...doc, status: 'cancelled' }, paid: 1050, payments: pays })).toBeNull()
    expect(await invoicePaidStamp(ctx(null), { doc: { ...doc, doc_type: 'quotation' }, paid: 1050, payments: pays })).toBeNull()
  })
  it('removed with the per-invoice switch → no stamp; switched back on → stamp', async () => {
    expect(await invoicePaidStamp(ctx(null), { doc: { ...doc, show_paid_stamp: false }, paid: 1050, payments: pays })).toBeNull()
    expect(await invoicePaidStamp(ctx(null), { doc: { ...doc, show_paid_stamp: true }, paid: 1050, payments: pays })).not.toBeNull()
  })
  it('works before the database update (no Arabic name column yet)', async () => {
    const s = await invoicePaidStamp(ctx(null, { code: '42703', message: 'column companies.name_ar does not exist' }), { doc, paid: 1050, payments: pays })
    expect(s?.art).toBeTruthy()
  })
})

describe('stamp on paper and in the PDF', () => {
  const base = { doc_type: 'invoice', number: 'INV-2026-0042', issue_date: '2026-10-05', customer_name: 'GTSC', vat_rate: 5, terms: DEFAULTS.terms, payment_terms: DEFAULTS.paymentTerms } as any
  const items = [{ description: 'Steel staircase', quantity: 1, unit_price: 1000 }]

  it('the A4 paper shows the stamp only when given one', async () => {
    const art = await paidStampArt({ nameEn: 'Test Co', nameAr: 'شركة الاختبار', date: '2026-11-03' })
    const branding = { companyName: 'Test Co', showHeaderFooter: false, showStamp: false }
    const withStamp = renderToStaticMarkup(createElement(SalesPaper, { doc: base, items, branding, paid: 1050, stamp: { date: '2026-11-03', art } }))
    expect(withStamp).toContain('data-paid-stamp')
    expect(withStamp).toContain('aria-label="Paid on 03-11-2026"')
    expect(withStamp).toContain('#15803D')
    expect(withStamp).not.toMatch(/\d{2}:\d{2}/)   // no time anywhere
    expect(renderToStaticMarkup(createElement(SalesPaper, { doc: base, items, branding, paid: 1050, stamp: null }))).not.toContain('data-paid-stamp')
  })

  it('the PDF draws the stamp as vectors (and still renders without it)', async () => {
    const art = await paidStampArt({ nameEn: 'Test Co', nameAr: 'شركة الاختبار', date: '2026-11-03' })
    const opts = { companyName: 'Test Co', images: {}, showHeaderFooter: false, showStamp: false, paid: 1050 }
    const plain = await renderSalesPdf(base, items, opts), stamped = await renderSalesPdf(base, items, { ...opts, stamp: { date: '2026-11-03', art } })
    const fallback = await renderSalesPdf(base, items, { ...opts, stamp: { date: '2026-11-03', art: null } })
    for (const b of [plain, stamped, fallback]) expect((await PDFDocument.load(b)).getPageCount()).toBe(1)
    expect(stamped.length).toBeGreaterThan(plain.length + 3000)
    expect(fallback.length).toBeGreaterThan(plain.length)
  })
})
