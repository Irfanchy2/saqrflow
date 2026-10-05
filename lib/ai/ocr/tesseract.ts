import 'server-only'
import { ocrImage } from '../../inbox/ocr'
import { OcrError, TEST_IMAGE, testPassed, type OCRProvider, type OcrDocument } from './types'

/** On-server Tesseract (English) — no data leaves the server. Images only; used as the private / last-resort reader. */
export function tesseractProvider(): OCRProvider {
  const p: OCRProvider = {
    id: 'tesseract', label: 'Local OCR (on this server)',
    configured: () => process.env.SAQRFLOW_DISABLE_OCR !== '1',
    supports: mime => ['image/png', 'image/jpeg', 'image/webp'].includes(mime),
    async extractDocument(file): Promise<OcrDocument> {
      if (!p.supports(file.mime)) throw new OcrError('Local OCR reads images only (scanned PDFs need OCR.Space or Google Vision)', 'unsupported', 'tesseract')
      const t0 = Date.now()
      const r = await ocrImage(file.bytes, file.mime)
      if (!r.text.trim()) throw new OcrError('No text was found in the image', 'empty', 'tesseract')
      return { provider: 'tesseract', text: r.text.trim(), pageTexts: [r.text.trim()], pages: 1, language: 'en', ms: Date.now() - t0 }
    },
    async extractText(file) { const { pageTexts: _p, ...r } = await p.extractDocument(file); return r },
    async healthCheck() {
      const t0 = Date.now()
      try { const r = await p.extractText(TEST_IMAGE); return { ok: testPassed(r.text), message: testPassed(r.text) ? 'Working' : 'Ran, but misread the test image', ms: Date.now() - t0 } }
      catch (e) { return { ok: false, message: (e as Error).message, ms: Date.now() - t0 } }
    },
  }
  return p
}
