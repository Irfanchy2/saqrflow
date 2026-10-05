import 'server-only'
import path from 'node:path'

const LANG_PATH = path.join(process.cwd(), 'node_modules/@tesseract.js-data/eng/4.0.0_best_int')
const OCR_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp'])
export const OCR_ENGINE = 'tesseract-5-eng'

/** On-server OCR for photos and scans (no data leaves the server). Returns '' when OCR is unavailable or the image can't be read. */
export async function ocrImage(buf: Uint8Array, mime: string, timeoutMs = 25_000): Promise<{ text: string; confidence: number }> {
  if (!OCR_MIMES.has(mime) || process.env.SAQRFLOW_DISABLE_OCR === '1') return { text: '', confidence: 0 }
  let worker: { recognize: (b: Buffer) => Promise<{ data: { text: string; confidence: number } }>; terminate: () => Promise<unknown> } | null = null
  try {
    const { createWorker } = await import('tesseract.js')
    worker = await createWorker('eng', 1, { langPath: LANG_PATH, gzip: true, cacheMethod: 'none', errorHandler: () => {} }) as any   // errors reject recognize(); without a handler tesseract.js also throws globally
    const run = worker!.recognize(Buffer.from(buf))
    const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('OCR timed out')), timeoutMs))
    const { data } = await Promise.race([run, timeout])
    return { text: (data.text ?? '').slice(0, 200_000), confidence: Math.max(0, Math.min(1, (data.confidence ?? 0) / 100)) }
  } catch (e) {
    console.warn('[ocr]', (e as Error).message)
    return { text: '', confidence: 0 }
  } finally { await worker?.terminate().catch(() => {}) }
}
