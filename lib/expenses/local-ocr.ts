import 'server-only'
import path from 'node:path'
import { readReceipt, type ReceiptRead } from './receipt-read'
import { paddleOcr, tinyAvailable, type PaddleModel } from '../ai/ocr/paddle'

// Free, private receipt reading on our own server with PaddleOCR (Tesseract as the fallback). The reading that makes the
// most sense as a receipt wins. Paid services (cloud OCR, Gemini) are only asked when this is not good enough.

const LANG_PATH = path.join(process.cwd(), 'node_modules/@tesseract.js-data/eng/4.0.0_best_int')
const IMAGES = new Set(['image/png', 'image/jpeg', 'image/webp'])

/** How complete and self-consistent a reading is (higher is better). */
export function receiptScore(r: ReceiptRead): number {
  const adds = r.subtotal !== undefined && r.vat !== undefined && r.total !== undefined && Math.abs(r.subtotal + r.vat - r.total) <= 0.05
  let s = 0
  if (r.total !== undefined) s += r.confidence.total === 'high' ? 3 : 2
  if (adds) s += r.confidence.vat === 'low' ? 1.5 : 3
  if (r.supplier) s += r.confidence.supplier === 'high' ? 2 : 1
  if (r.date) s += r.confidence.date === 'high' ? 2 : 1.5
  if (r.invoice_no) s += r.confidence.invoice_no === 'high' ? 1.5 : 1
  if (r.trn?.length === 15) s += 1
  if (r.lines.length) s += r.confidence.lines === 'high' ? 2 : 0.5
  return s - r.warnings.length * 0.75
}

/**
 * Good enough to stop here: a total that adds up (or a plain receipt with no VAT), a date and a supplier, no amount
 * warnings, and — when the text shows a TRN label — a valid 15-digit TRN read.
 */
export function goodEnough(r: ReceiptRead, text?: string): boolean {
  if (r.total === undefined || !r.date || !r.supplier) return false
  if (text && /\bT\.?\s?R\.?\s?N\b|الرقم الضريبي/i.test(text) && !/^\d{15}$/.test(r.trn ?? '')) return false
  if (r.warnings.some(w => /does not equal|not the UAE standard|line items add up/.test(w))) return false
  const adds = r.subtotal !== undefined && r.vat !== undefined && Math.abs(r.subtotal + r.vat - r.total) <= 0.05
  return adds ? r.confidence.vat !== 'low' : r.vat === undefined
}

type Worker = { recognize: (b: Buffer) => Promise<{ data: { text: string; confidence: number } }>; setParameters: (p: Record<string, string>) => Promise<unknown>; terminate: () => Promise<unknown> }

/** The photo prepared for OCR: upright, about 1,800–2,200 px wide, grey, contrast stretched, sharpened; plus a black-and-white copy. */
export async function prepareReceiptImage(bytes: Uint8Array): Promise<{ gray: Buffer; bw: Buffer } | null> {
  try {
    const sharp = (await import('sharp')).default
    const meta = await sharp(bytes, { failOn: 'none' }).metadata()
    const w = (meta.orientation ?? 1) >= 5 ? meta.height ?? 1000 : meta.width ?? 1000
    const width = w < 1400 ? 1800 : w > 2400 ? 2200 : w
    const gray = await sharp(bytes, { failOn: 'none' }).rotate().resize({ width, kernel: 'lanczos3' }).grayscale().normalize().sharpen({ sigma: 1 }).png().toBuffer()
    const bw = await sharp(gray).clahe({ width: 64, height: 64, maxSlope: 3 }).threshold(165).png().toBuffer()
    return { gray, bw }
  } catch (e) { console.warn('[receipt-ocr] image could not be prepared', (e as Error).message); return null }
}

/**
 * Reads a receipt photo on this server. PaddleOCR reads the photo as taken (turbo: a smaller copy with the tiny models, ~1 s,
 * then the small models), then — only if that reading is not good enough — a contrast-evened, detailed copy; Tesseract runs only when PaddleOCR cannot (and tries
 * the photo in three ways). The reading that makes the most sense as a receipt wins; it stops as soon as one is good enough.
 */
export async function localReceiptOcr(bytes: Uint8Array, mime: string, today: string, budgetMs = 40_000, turbo = true): Promise<{ text: string; read: ReceiptRead; passes: number; ms: number; engine: string } | null> {
  if (!IMAGES.has(mime) || process.env.SAQRFLOW_DISABLE_OCR === '1') return null
  const t0 = Date.now()
  let best: { text: string; read: ReceiptRead; score: number; engine: string } | null = null, passes = 0
  const consider = (text: string, engine: string) => {
    const read = readReceipt(text, today), score = receiptScore(read)
    if (!best || score > best.score) best = { text, read, score, engine }
    return goodEnough(read, text)
  }
  const done = () => { const b = best as { text: string; read: ReceiptRead; engine: string } | null; return b && b.text.trim() ? { text: b.text, read: b.read, passes, ms: Date.now() - t0, engine: b.engine } : null }

  // turbo: tiny models on a small copy (~1 s) → small models on the small copy → small models, contrast-evened, full size
  const plan: { model: PaddleModel; enhance: boolean; turbo: boolean }[] = [
    ...(turbo && tinyAvailable() ? [{ model: 'tiny' as const, enhance: false, turbo: true }] : []),
    { model: 'small', enhance: false, turbo }, { model: 'small', enhance: true, turbo: false },
  ]
  let paddleRan = false
  for (const step of plan) {
    const left = budgetMs - (Date.now() - t0); if (left < 4000) break
    const r = await paddleOcr(bytes, mime, { ...step, timeoutMs: left })
    if (!r) { if (step.model === 'tiny') continue; break }       // tiny could not run: the small models still can
    paddleRan = true; passes++
    if (r.text.trim() && consider(r.text, r.engine)) return done()
  }
  if (paddleRan) return done()                     // PaddleOCR ran: Tesseract would not read more than it did
  return (await tesseractPasses(bytes, t0, budgetMs, (t) => { passes++; return consider(t, 'tesseract-5-eng') })) ?? done()
}

async function tesseractPasses(bytes: Uint8Array, t0: number, budgetMs: number, consider: (text: string) => boolean): Promise<null> {
  const img = await prepareReceiptImage(bytes)
  let worker: Worker | null = null
  try {
    const { createWorker } = await import('tesseract.js')
    worker = await createWorker('eng', 1, { langPath: LANG_PATH, gzip: true, cacheMethod: 'none', errorHandler: () => {} }) as unknown as Worker
    await worker.setParameters({ preserve_interword_spaces: '1', user_defined_dpi: '300' })
    const tries: [Buffer, string][] = img ? [[img.gray, '6'], [img.gray, '4'], [img.bw, '6']] : [[Buffer.from(bytes), '6'], [Buffer.from(bytes), '4']]
    for (const [buf, psm] of tries) {
      const left = budgetMs - (Date.now() - t0); if (left < 3000) break
      await worker.setParameters({ tessedit_pageseg_mode: psm })
      const r = await Promise.race([worker.recognize(buf), new Promise<null>(res => setTimeout(() => res(null), left))])
      if (!r) break
      if (consider((r.data.text ?? '').slice(0, 200_000))) break
    }
  } catch (e) {
    console.warn('[receipt-ocr]', (e as Error).message)
  } finally { await worker?.terminate().catch(() => {}) }
  return null
}
