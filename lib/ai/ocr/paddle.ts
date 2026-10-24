import 'server-only'
import path from 'node:path'
import { readFile } from 'node:fs/promises'

// PaddleOCR (PP-OCRv6 small, from PaddlePaddle — https://github.com/PaddlePaddle/PaddleOCR) running on this server through
// ONNX Runtime. Free and private: no file leaves the server. Much better than Tesseract on phone photos (tilt, blur, low
// contrast, thermal paper). Models live in ocr-models/ppocrv6-small (see the README there for where they come from).

const MODEL_DIR = path.join(process.cwd(), 'ocr-models/ppocrv6-small')
const MIMES = new Set(['image/png', 'image/jpeg', 'image/webp'])
export const PADDLE_ENGINE = 'paddleocr-ppocrv6-small'

type Box = { x: number; y: number; width: number; height: number; points?: { x: number; y: number }[] }
type Rec = { text: string; confidence: number; box: Box }
type Service = { recognize: (img: { width: number; height: number; data: Uint8Array }) => Promise<Rec[]> }

export const paddleEnabled = () => process.env.SAQRFLOW_DISABLE_OCR !== '1' && process.env.SAQRFLOW_DISABLE_PADDLE !== '1'
export const paddleSupports = (mime: string) => MIMES.has(mime)

let service: Promise<Service> | null = null
/** The models are loaded once per server instance (about a quarter of a second) and kept for later requests. */
function loadService(): Promise<Service> {
  service ??= (async () => {
    const [ort, { PaddleOcrService }, det, rec, dict] = await Promise.all([
      import('onnxruntime-node'), import('paddleocr'),
      readFile(path.join(MODEL_DIR, 'det.onnx')), readFile(path.join(MODEL_DIR, 'rec.onnx')), readFile(path.join(MODEL_DIR, 'dict.txt'), 'utf8'),
    ])
    const ab = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
    return await PaddleOcrService.createInstance({
      ort: ort as never, modelPreset: 'PP-OCRv6_small',
      detection: { modelBuffer: ab(det) },
      // the model's classes are: CTC blank + the dictionary + a space
      recognition: { modelBuffer: ab(rec), charactersDictionary: dict.replace(/\r/g, '').trimEnd().split('\n').concat(' ') },
    }) as unknown as Service
  })().catch(e => { service = null; throw e })
  return service
}

// One image at a time per server instance: keeps memory flat when several people scan at once.
let queue: Promise<unknown> = Promise.resolve()
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn)
  queue = run.catch(() => {})
  return run
}

/**
 * Text boxes → lines in reading order. Boxes are grouped by their (de-skewed) vertical position so the label and the amount
 * on a receipt stay on one line ("TOTAL AED   3,360.00"); a wide horizontal gap becomes two spaces.
 */
export function boxesToLines(recs: Rec[], minConfidence = 0.5): { text: string; confidence: number }[] {
  const items = recs.filter(r => r.text.trim() && r.confidence >= minConfidence)
  if (!items.length) return []
  // tilt of the photo: median slope of the top edge of the wider boxes
  const slopes = items.filter(r => r.box.points?.length === 4 && r.box.width > 3 * r.box.height)
    .map(r => { const [a, b] = r.box.points!; return (b.y - a.y) / Math.max(1, b.x - a.x) }).sort((a, b) => a - b)
  const slope = slopes.length ? slopes[Math.floor(slopes.length / 2)] : 0
  const pts = items.map(r => {
    const cx = r.box.x + r.box.width / 2, h = r.box.points?.length === 4 ? Math.max(4, (Math.hypot(r.box.points[3].x - r.box.points[0].x, r.box.points[3].y - r.box.points[0].y))) : r.box.height
    return { r, cy: r.box.y + r.box.height / 2 - cx * slope, h, x: r.box.x }
  }).sort((a, b) => a.cy - b.cy)
  const lines: { cy: number; h: number; items: typeof pts }[] = []
  for (const p of pts) {
    const line = lines.find(l => Math.abs(l.cy - p.cy) <= Math.min(l.h, p.h) * 0.55)
    if (line) { line.items.push(p); line.cy = (line.cy * (line.items.length - 1) + p.cy) / line.items.length; line.h = Math.max(line.h, p.h) }
    else lines.push({ cy: p.cy, h: p.h, items: [p] })
  }
  return lines.sort((a, b) => a.cy - b.cy).map(l => {
    const row = l.items.sort((a, b) => a.x - b.x)
    let text = row[0].r.text.trim()
    for (let i = 1; i < row.length; i++) {
      const prev = row[i - 1].r, cur = row[i].r
      const gap = cur.box.x - (prev.box.x + prev.box.width), charW = prev.box.width / Math.max(1, prev.text.length)
      text += (gap > charW * 2 ? '   ' : ' ') + cur.text.trim()
    }
    return { text, confidence: row.reduce((s, p) => s + p.r.confidence, 0) / row.length }
  })
}

/** An image ready for the model: upright (EXIF), no transparency, between ~900 and 2,600 px on its long side. */
async function decode(bytes: Uint8Array, enhance: boolean): Promise<{ width: number; height: number; data: Uint8Array }> {
  const sharp = (await import('sharp')).default
  const meta = await sharp(bytes, { failOn: 'none' }).metadata()
  const turned = (meta.orientation ?? 1) >= 5
  const long = Math.max((turned ? meta.height : meta.width) ?? 0, (turned ? meta.width : meta.height) ?? 0)
  let img = sharp(bytes, { failOn: 'none' }).rotate().flatten({ background: '#ffffff' })
  if (long > 2600) img = img.resize({ width: 2600, height: 2600, fit: 'inside' })
  else if (long && long < 900) img = img.resize({ width: Math.round(((turned ? meta.height : meta.width) ?? 900) * 900 / long), kernel: 'lanczos3' })
  if (enhance) img = img.grayscale().normalize().clahe({ width: 48, height: 48, maxSlope: 3 }).sharpen({ sigma: 0.8 })
  const { data, info } = await img.removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true })
  return { width: info.width, height: info.height, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) }
}

export interface PaddleResult { text: string; confidence: number; lines: number; ms: number; engine: string }

/**
 * Reads an image with PaddleOCR. `enhance` evens out the contrast first (for faded or shadowed photos).
 * Returns null when it cannot run here (disabled, unsupported type, models missing); never throws.
 */
export async function paddleOcr(bytes: Uint8Array, mime: string, opts: { enhance?: boolean; timeoutMs?: number } = {}): Promise<PaddleResult | null> {
  if (!paddleEnabled() || !paddleSupports(mime)) return null
  const t0 = Date.now()
  try {
    const work = serial(async () => {
      const [svc, img] = await Promise.all([loadService(), decode(bytes, !!opts.enhance)])
      return svc.recognize(img)
    })
    const recs = await Promise.race([work, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('PaddleOCR timed out')), opts.timeoutMs ?? 45_000))])
    const lines = boxesToLines(recs)
    const text = lines.map(l => l.text).join('\n').slice(0, 200_000)
    const confidence = lines.length ? lines.reduce((s, l) => s + l.confidence, 0) / lines.length : 0
    return { text, confidence, lines: lines.length, ms: Date.now() - t0, engine: PADDLE_ENGINE }
  } catch (e) {
    console.warn('[paddleocr]', (e as Error).message)
    return null
  }
}
