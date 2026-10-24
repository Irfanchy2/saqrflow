import 'server-only'
import path from 'node:path'
import os from 'node:os'
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
    const [ort0, { PaddleOcrService }, det, rec, dict] = await Promise.all([
      import('onnxruntime-node'), import('paddleocr'),
      readFile(path.join(MODEL_DIR, 'det.onnx')), readFile(path.join(MODEL_DIR, 'rec.onnx')), readFile(path.join(MODEL_DIR, 'dict.txt'), 'utf8'),
    ])
    const ab = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
    // one ONNX thread per CPU this server really has (more threads than CPUs only fight each other)
    const opts = { intraOpNumThreads: Math.max(1, os.availableParallelism?.() ?? os.cpus().length), interOpNumThreads: 1, graphOptimizationLevel: 'all', executionMode: 'sequential' }
    const ort = { ...ort0, InferenceSession: { ...ort0.InferenceSession, create: (b: ArrayBuffer, o?: object) => ort0.InferenceSession.create(b, { ...opts, ...o } as never) } }
    const svc = await PaddleOcrService.createInstance({
      ort: ort as never, modelPreset: 'PP-OCRv6_small',
      detection: { modelBuffer: ab(det) },
      // the model's classes are: CTC blank + the dictionary + a space
      recognition: { modelBuffer: ab(rec), charactersDictionary: dict.replace(/\r/g, '').trimEnd().split('\n').concat(' ') },
    })
    batchRecognition(svc)
    return svc as unknown as Service
  })().catch(e => { service = null; throw e })
  return service
}

type Img = { width: number; height: number; cropRotated(p: unknown): Img; crop(b: unknown): Img; resize(s: { width: number; height: number }): Img; tensor(o: object): Float32Array }
/**
 * Turbo: text lines are recognised in batches (as upstream PaddleOCR does) instead of one by one. Lines are sorted by width
 * and each batch is padded only to its own widest line; the library pads every line to the widest one on the receipt.
 * ~2× faster on a receipt with 80 lines, same text. Uses the internals of paddleocr 1.2.0 (pinned); when they are not
 * there (another version) the library's own one-by-one path stays.
 */
function batchRecognition(svc: unknown, batchSize = 6, minWidth = 160) {
  const rec = (svc as { recognitionService?: Record<string, any> }).recognitionService
  if (!rec || !['padRecognitionTensor', 'ctcLabelDecode', 'sortBoxesByReadingOrder', 'resolveRuntimeOptions', 'resolveOrderingOptions'].every(k => typeof rec[k] === 'function') || !rec.session || !rec.ortModule) return false
  rec.run = async function (this: Record<string, any>, image: Img, detection: Box[], options?: { recognition?: object; ordering?: object }) {
    const o = this.resolveRuntimeOptions(options?.recognition), H: number = o.imageHeight
    const boxes: Box[] = this.sortBoxesByReadingOrder(detection.filter(b => b.width > 0 && b.height > 0), this.resolveOrderingOptions(options?.ordering))
    const items = boxes.map((box, i) => { const crop = box.points ? image.cropRotated(box.points) : image.crop(box); return { i, box, crop, w: Math.max(1, Math.ceil(H * crop.width / crop.height)) } })
    const order = [...items].sort((a, b) => a.w - b.w), out: (Rec | undefined)[] = new Array(items.length)
    for (let s = 0; s < order.length; s += batchSize) {
      const group = order.slice(s, s + batchSize), W = Math.max(minWidth, ...group.map(g => g.w)), size = 3 * H * W
      const data = new Float32Array(group.length * size)
      group.forEach((g, k) => {
        const t = g.crop.resize({ width: g.w, height: H }).tensor({ mean_values: o.mean, norm_values: o.stdDeviation, channel_order: o.channelOrder })
        data.set(this.padRecognitionTensor(t, g.w, H, W), k * size)
      })
      const res = await this.session.run({ [this.session.inputNames?.[0] ?? 'x']: new this.ortModule.Tensor('float32', data, [group.length, 3, H, W]) })
      const logits = (Object.values(res) as { data: unknown; dims: number[] }[]).filter(t => t?.data instanceof Float32Array && t.dims?.length === 3 && t.dims[2] > 1).pop()
      if (!logits) throw new Error('PaddleOCR recognition output not found')
      const [, seq, classes] = logits.dims, all = logits.data as Float32Array
      group.forEach((g, k) => { const r = this.ctcLabelDecode(all.subarray(k * seq * classes, (k + 1) * seq * classes), seq, classes, o); out[g.i] = { text: r.text, confidence: r.confidence, box: g.box } })
    }
    return out.filter(Boolean)
  }
  return true
}

/** Loads the models now (e.g. while the person is still taking the photo), so the scan itself starts at once. */
export async function warmPaddle(): Promise<boolean> {
  if (!paddleEnabled()) return false
  try { await loadService(); return true } catch { return false }
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

/**
 * Turbo reads the photo at 1,280 px on its long side (a phone photo is 4,000: 10× fewer pixels to search for text), more
 * for long thin receipts so their lines stay tall enough. Detailed reading uses up to 2,600 px.
 */
export function readSize(width: number, height: number, turbo: boolean): number {
  if (!turbo) return 2600
  const long = Math.max(width, height), short = Math.max(1, Math.min(width, height))
  return Math.min(2200, Math.max(1280, Math.round(640 * long / short)))
}

/** An image ready for the model: upright (EXIF), no transparency, between ~900 px and `readSize` on its long side. */
async function decode(bytes: Uint8Array, enhance: boolean, turbo: boolean): Promise<{ width: number; height: number; data: Uint8Array }> {
  const sharp = (await import('sharp')).default
  const meta = await sharp(bytes, { failOn: 'none' }).metadata()
  const turned = (meta.orientation ?? 1) >= 5
  const long = Math.max((turned ? meta.height : meta.width) ?? 0, (turned ? meta.width : meta.height) ?? 0)
  let img = sharp(bytes, { failOn: 'none' }).rotate().flatten({ background: '#ffffff' })
  const max = readSize(meta.width ?? 0, meta.height ?? 0, turbo)
  if (long > max) img = img.resize({ width: max, height: max, fit: 'inside' })
  else if (long && long < 900) img = img.resize({ width: Math.round(((turned ? meta.height : meta.width) ?? 900) * 900 / long), kernel: 'lanczos3' })
  if (enhance) img = img.grayscale().normalize().clahe({ width: 48, height: 48, maxSlope: 3 }).sharpen({ sigma: 0.8 })
  const { data, info } = await img.removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true })
  return { width: info.width, height: info.height, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) }
}

export interface PaddleResult { text: string; confidence: number; lines: number; ms: number; engine: string }

/**
 * Reads an image with PaddleOCR. `enhance` evens out the contrast first (for faded or shadowed photos); `turbo` (default)
 * reads a smaller copy of the photo, `turbo: false` the detailed one.
 * Returns null when it cannot run here (disabled, unsupported type, models missing); never throws.
 */
export async function paddleOcr(bytes: Uint8Array, mime: string, opts: { enhance?: boolean; timeoutMs?: number; turbo?: boolean } = {}): Promise<PaddleResult | null> {
  if (!paddleEnabled() || !paddleSupports(mime)) return null
  const t0 = Date.now()
  try {
    const work = serial(async () => {
      const [svc, img] = await Promise.all([loadService(), decode(bytes, !!opts.enhance, opts.turbo !== false)])
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
