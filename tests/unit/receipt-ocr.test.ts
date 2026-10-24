import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { cleanOcrText, mergeAi, readReceipt } from '@/lib/expenses/receipt-read'
import { goodEnough, localReceiptOcr } from '@/lib/expenses/local-ocr'
import { boxesToLines, paddleOcr } from '@/lib/ai/ocr/paddle'
import { ocrImage } from '@/lib/inbox/ocr'

const TODAY = '2026-10-20'
const RECEIPT = [
  'AL FAHIM BUILDING MATERIALS LLC', 'Musaffah M-14, Abu Dhabi', 'TRN: 100234567800003', 'TAX INVOICE',
  'Invoice No: INV-55821', 'Date: 14/10/2026',
  'Steel angle 50x50      2 x 800.00   1,600.00', 'Welding rods E6013    4 x 400.00   1,600.00',
  'Subtotal                           3,200.00', 'VAT 5%                               160.00', 'TOTAL AED                          3,360.00',
  'Paid by card. Thank you',
]

/** A receipt drawn as an image (monospace, like a till printer), optionally made to look like a poor phone photo. */
async function receiptImage(lines: string[], o: { tilt?: number; blur?: number; contrast?: number; width?: number; jpeg?: number; ink?: string } = {}) {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="${70 + lines.length * 32}"><rect width="100%" height="100%" fill="#f6f3ea"/>${lines.map((l, i) => `<text x="26" y="${48 + i * 32}" font-family="DejaVu Sans Mono, monospace" font-size="19" fill="${o.ink ?? '#2b2b2b'}" xml:space="preserve">${esc(l)}</text>`).join('')}</svg>`
  let img = sharp(Buffer.from(svg))
  if (o.tilt) img = sharp(await img.png().toBuffer()).rotate(o.tilt, { background: '#d9d4c7' })
  if (o.blur) img = img.blur(o.blur)
  if (o.contrast) img = img.linear(o.contrast, 255 * (1 - o.contrast) * 0.85)
  if (o.width) img = img.resize({ width: o.width })
  return new Uint8Array(o.jpeg ? await img.jpeg({ quality: o.jpeg }).toBuffer() : await img.png().toBuffer())
}
const expectFields = (r: ReturnType<typeof readReceipt>) => {
  expect(r.supplier).toMatch(/AL FAHIM BUILDING MATERIALS/)
  expect(r.trn).toBe('100234567800003')
  expect(r.invoice_no).toBe('INV-55821')
  expect(r.date).toBe('2026-10-14')
  expect([r.subtotal, r.vat, r.total]).toEqual([3200, 160, 3360])
}

describe('OCR text clean-up', () => {
  it('fixes letters read inside numbers and odd number formats', () => {
    const t = cleanOcrText('T0TAL AED 3.36O,00\nSub-Tota1 3.200,00\nV.A.T (5%) 160 .00\nInv# 55821')
    expect(t).toMatch(/TOTAL AED 3,360\.00/); expect(t).toMatch(/SUBTOTAL 3,200\.00/i); expect(t).toMatch(/VAT 5% 160\.00/); expect(t).toMatch(/Invoice No: ?55821/i)
  })
  it('reads Arabic-Indic digits and Arabic labels', () => {
    const r = readReceipt('مؤسسة النور للتجارة\nالمجموع الفرعي ١٠٠٫٠٠\nضريبة القيمة المضافة ٥٫٠٠\nالإجمالي ١٠٥٫٠٠', TODAY)
    expect([r.subtotal, r.vat, r.total]).toEqual([100, 5, 105])
  })
})

describe('PaddleOCR text lines', () => {
  it('keeps a label and its amount on one line even when the photo is tilted', () => {
    const box = (x: number, y: number, w: number, slope: number) => ({ x, y, width: w, height: 22, points: [{ x, y }, { x: x + w, y: y + w * slope }, { x: x + w, y: y + w * slope + 22 }, { x, y: y + 22 }] })
    const s = 0.04   // ~2.3° tilt: the amount sits 16 px lower than its label
    const lines = boxesToLines([
      { text: 'Subtotal', confidence: 0.99, box: box(20, 100, 110, s) }, { text: '3,200.00', confidence: 0.98, box: box(420, 100 + 400 * s, 100, s) },
      { text: 'VAT 5%', confidence: 0.99, box: box(20, 130, 80, s) }, { text: '160.00', confidence: 0.97, box: box(440, 130 + 420 * s, 80, s) },
      { text: 'noise', confidence: 0.2, box: box(300, 300, 50, s) },
    ])
    expect(lines.map(l => l.text)).toEqual(['Subtotal   3,200.00', 'VAT 5%   160.00'])
  })
})

describe('receipt reading on this server (PaddleOCR)', () => {
  const cases: [string, NonNullable<Parameters<typeof receiptImage>[1]>][] = [
    ['clean scan', {}],
    ['tilted, blurred phone photo saved as a small JPEG', { tilt: 2.5, blur: 1.1, jpeg: 55, width: 520 }],
    ['faded thermal paper, low contrast', { ink: '#8d8a84', contrast: 0.55, blur: 0.6, jpeg: 70 }],
  ]
  for (const [name, o] of cases) {
    it(`reads every field: ${name}`, async () => {
      const r = await localReceiptOcr(await receiptImage(RECEIPT, o), o.jpeg ? 'image/jpeg' : 'image/png', TODAY)
      expect(r?.engine).toMatch(/paddle/)
      expectFields(r!.read)
      expect(goodEnough(r!.read)).toBe(true)          // so no paid OCR or AI is needed
    }, 60_000)
  }
  it('reads more than Tesseract on a poor photo', async () => {
    const img = await receiptImage(RECEIPT, { tilt: 2.5, blur: 1.4, jpeg: 45, width: 480, contrast: 0.7 })
    const paddle = await paddleOcr(img, 'image/jpeg')
    process.env.SAQRFLOW_DISABLE_PADDLE = '1'
    const tess = await ocrImage(img, 'image/jpeg', 60_000).finally(() => { delete process.env.SAQRFLOW_DISABLE_PADDLE })
    const found = (t: string) => { const r = readReceipt(t, TODAY); return [r.supplier && /FAHIM/.test(r.supplier), r.trn === '100234567800003', r.invoice_no === 'INV-55821', r.date === '2026-10-14', r.subtotal === 3200, r.vat === 160, r.total === 3360].filter(Boolean).length }
    console.log(`fields read on a poor photo: PaddleOCR ${found(paddle!.text)}/7, Tesseract ${found(tess.text)}/7`)
    expect(tess.engine).toBe('tesseract-5-eng')
    expect(found(paddle!.text)).toBeGreaterThanOrEqual(found(tess.text))
    expect(found(paddle!.text)).toBe(7)
  }, 90_000)
  it('returns nothing for an image without text (so the cloud reader can try)', async () => {
    const blank = new Uint8Array(await sharp({ create: { width: 400, height: 300, channels: 3, background: '#ffffff' } }).png().toBuffer())
    expect(await localReceiptOcr(blank, 'image/png', TODAY)).toBeNull()
  }, 30_000)
})

describe('AI reading merged with the OCR reading', () => {
  const ocr = 'AL FAHIM BUILDING MATERIALS LLC\nTRN 1002345678OO003\nInvoice No: INV-55821\nSubtotal 3,200.00\nVAT 5% 160.00\nTOTAL 3,860.00'
  const ai = { supplier: 'Al Fahim Building Materials LLC', trn: '100234567800003', invoice_no: 'INV-55821', date: '2026-10-14', subtotal: 3200, vat: 160, total: 3360, lines: [{ description: 'Steel angle', quantity: 2, unit_price: 800, amount: 1600 }, { description: 'Welding rods', quantity: 4, unit_price: 400, amount: 1600 }] }
  it('with the photo: takes amounts that add up and a valid TRN even when the OCR text misread them, marked for review', () => {
    const rules = readReceipt(ocr, TODAY)
    expect(goodEnough(rules)).toBe(false)              // 3,200 + 160 ≠ 3,860 → AI is asked
    const m = mergeAi(rules, ai, ocr, { image: true, today: TODAY })
    expect([m.subtotal, m.vat, m.total]).toEqual([3200, 160, 3360])
    expect(m.confidence.total).toBe('medium'); expect(m.trn).toBe('100234567800003'); expect(m.date).toBe('2026-10-14')
    expect(m.lines).toHaveLength(2); expect(m.confidence.lines).toBe('high')
    expect(m.warnings.some(w => /does not equal/.test(w))).toBe(false)
  })
  it('text only: never takes a value that is not in the OCR text', () => {
    const m = mergeAi(readReceipt(ocr, TODAY), ai, ocr, { today: TODAY })
    expect(m.total).not.toBe(3360)
  })
  it('refuses an invalid TRN, a future date and amounts that do not add up', () => {
    const m = mergeAi(readReceipt('SHOP\nTOTAL 50.00', TODAY), { trn: '12345', date: '2027-01-01', subtotal: 40, vat: 2, total: 50 }, '', { image: true, today: TODAY })
    expect(m.trn).toBeUndefined(); expect(m.date).toBeUndefined(); expect(m.subtotal).toBeUndefined(); expect(m.total).toBe(50)
  })
})
