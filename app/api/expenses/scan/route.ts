import { NextResponse, type NextRequest } from 'next/server'
import { getCtx } from '@/lib/auth'
import { rateLimit } from '@/lib/security'
import { tinyAvailable, warmPaddle } from '@/lib/ai/ocr/paddle'
import { scanReceipt } from '@/lib/expenses/scan'
import { getMe } from '@/lib/me'

export const runtime = 'nodejs'

/**
 * Warm-up: called when the person taps Scan receipt, so the OCR models are loaded while they take the photo. Opened in the
 * browser it is also a quick self-check: {"ready":true,"tiny":true,"ms":…} means PaddleOCR (with the fast models) runs here.
 */
export async function GET() {
  const c = await getCtx().catch(() => null)
  if (!c) return new NextResponse(null, { status: 401 })
  const t0 = Date.now(), ready = await warmPaddle()
  return NextResponse.json({ ready, engine: 'PaddleOCR PP-OCRv6', tiny: tinyAvailable(), ms: Date.now() - t0 }, { headers: { 'cache-control': 'no-store' } })
}
export const maxDuration = 60
/**
 * Reads a receipt (see lib/expenses/scan.ts). With `Accept: application/x-ndjson` the answer is streamed, one JSON object
 * per line, so the form fills the moment the free on-server reading is done:
 *   {"type":"stage","stage":"local"|"cloud"|"ai"}   the reader that starts now
 *   {"type":"partial", …reading}                    the free reading, while a paid reader still checks it
 *   {"type":"final", …reading} | {"type":"error","error":…}
 * Without it, one JSON answer (the final reading) as before.
 */
export async function POST(req: NextRequest) {
  const c = await getCtx().catch(() => null)
  if (!c) return NextResponse.json({ error: 'Your session has expired. Sign in again.' }, { status: 401 })
  // staff who add expenses, or an employee (Employee Portal) reading the receipt for their own expense claim
  const staff = c.can('records.edit') && c.can('finance.view'), claimant = staff ? undefined : (await getMe()).emp?.id
  if (!staff && !claimant) return NextResponse.json({ error: 'You are not allowed to add expenses.' }, { status: 403 })
  if (!(await rateLimit(`receipt-scan:${c.userId}`, 40, 600))) return NextResponse.json({ error: 'Too many receipts read in the last few minutes. Wait a little, or enter the details by hand.' }, { status: 429 })
  const f = (await req.formData().catch(() => null))?.get('file')
  if (!(f instanceof File) || !f.size) return NextResponse.json({ error: 'Choose a receipt photo or PDF.' }, { status: 400 })
  if (f.size > 10 * 1024 * 1024) return NextResponse.json({ error: 'The file is larger than 10 MB. Take the photo again at a lower resolution, or upload a PDF.' }, { status: 400 })
  const mime = f.type || 'application/octet-stream'
  if (!/^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/.test(mime)) return NextResponse.json({ error: 'Only photos (JPG, PNG, WEBP, HEIC) or PDF can be read.' }, { status: 400 })
  const file = { bytes: new Uint8Array(await f.arrayBuffer()), mime, name: f.name }

  if (!(req.headers.get('accept') ?? '').includes('application/x-ndjson')) {
    const r = await scanReceipt(c, file, {}, claimant)
    return r.ok ? NextResponse.json(r.body) : NextResponse.json({ error: r.error }, { status: 422 })
  }
  const enc = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      const send = (o: object) => ctrl.enqueue(enc.encode(JSON.stringify(o) + '\n'))
      try {
        const r = await scanReceipt(c, file, { stage: stage => send({ type: 'stage', stage }), partial: b => send({ type: 'partial', ...b }) }, claimant)
        send(r.ok ? { type: 'final', ...r.body } : { type: 'error', error: r.error })
      } catch (e) {
        console.error('[receipt-scan]', e)
        send({ type: 'error', error: 'The receipt could not be read. Try again, or enter the details by hand.' })
      } finally { ctrl.close() }
    },
  })
  return new Response(stream, { headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store, no-transform', 'x-accel-buffering': 'no' } })
}
