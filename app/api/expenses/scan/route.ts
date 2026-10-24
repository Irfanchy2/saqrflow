import { NextResponse, type NextRequest } from 'next/server'
import { getCtx } from '@/lib/auth'
import { aiSettings } from '@/lib/inbox/pipeline'
import { extractText } from '@/lib/inbox/text'
import { ocrProviders, providerOrder, runOcr } from '@/lib/ai/ocr'
import { aiProviders } from '@/lib/ai/llm'
import { redactForAi } from '@/lib/ai/redact'
import { rateLimit } from '@/lib/security'
import { mergeAi, readReceipt, RECEIPT_PROMPT, RECEIPT_SCHEMA, type ReceiptRead } from '@/lib/expenses/receipt-read'
import { goodEnough, localReceiptOcr, receiptScore } from '@/lib/expenses/local-ocr'
import { warmPaddle } from '@/lib/ai/ocr/paddle'
import { findDuplicate, matchSupplier } from '@/lib/expenses/suppliers'

export const runtime = 'nodejs'

/** Warm-up: called when the person taps Scan receipt, so the OCR models are loaded while they take the photo. */
export async function GET() {
  const c = await getCtx().catch(() => null)
  if (!c) return new NextResponse(null, { status: 401 })
  return NextResponse.json({ ready: await warmPaddle() }, { headers: { 'cache-control': 'no-store' } })
}
export const maxDuration = 60
/**
 * Reads a receipt / supplier invoice and returns SUGGESTED fields with how sure each one is, warnings when the numbers do not
 * add up, the supplier it matches and any expense already saved with the same supplier and invoice number.
 *
 * Cheapest first: a PDF's own text layer, else PaddleOCR on this server (free). Paid services are used only when that reading
 * is not good enough: the company's cloud OCR next, then Gemini (with the photo, so it can read what OCR missed).
 * Nothing is stored here: the person reviews every field in the form and saves (with the receipt attached) themselves.
 */
export async function POST(req: NextRequest) {
  const c = await getCtx().catch(() => null)
  if (!c) return NextResponse.json({ error: 'Your session has expired. Sign in again.' }, { status: 401 })
  if (!c.can('records.edit') || !c.can('finance.view')) return NextResponse.json({ error: 'You are not allowed to add expenses.' }, { status: 403 })
  if (!(await rateLimit(`receipt-scan:${c.userId}`, 40, 600))) return NextResponse.json({ error: 'Too many receipts read in the last few minutes. Wait a little, or enter the details by hand.' }, { status: 429 })
  const f = (await req.formData().catch(() => null))?.get('file')
  if (!(f instanceof File) || !f.size) return NextResponse.json({ error: 'Choose a receipt photo or PDF.' }, { status: 400 })
  if (f.size > 10 * 1024 * 1024) return NextResponse.json({ error: 'The file is larger than 10 MB. Take the photo again at a lower resolution, or upload a PDF.' }, { status: 400 })
  const mime = f.type || 'application/octet-stream'
  if (!/^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/.test(mime)) return NextResponse.json({ error: 'Only photos (JPG, PNG, WEBP, HEIC) or PDF can be read.' }, { status: 400 })
  const buf = new Uint8Array(await f.arrayBuffer())
  const s = await aiSettings(c)
  type Reading = { text: string; read: ReceiptRead; provider: string }
  let best = null as Reading | null
  const errors: string[] = []
  const take = (text: string, provider: string, read = readReceipt(text, c.today)) => { if (!best || receiptScore(read) > receiptScore(best.read)) best = { text, read, provider } }

  // 1. free: the PDF's text layer, or PaddleOCR on this server
  if (mime === 'application/pdf') { const layer = await extractText(buf, mime).catch(() => ''); if (layer.replace(/\s/g, '').length >= 30) take(layer, 'text_layer') }
  else {
    const local = await localReceiptOcr(buf, mime, c.today, 30_000, s.turbo)
    if (local) take(local.text, local.engine.startsWith('paddle') ? 'paddleocr' : 'tesseract', local.read)
  }
  // 2. paid OCR, only when the free reading is missing or not good enough (and the company has not chosen local only)
  if ((!best || !goodEnough(best.read)) && s.ocr !== 'tesseract' && (mime === 'application/pdf' ? !best : true)) {
    const providers = providerOrder(s.ocr, await ocrProviders(c.company.id), mime).filter(p => p.id !== 'tesseract')
    if (providers.length) {
      const { result, attempts } = await runOcr({ bytes: buf, mime, name: f.name }, providers)
      if (result?.text.trim()) take(result.text, result.provider)
      else errors.push(...attempts.map(a => a.error ?? '').filter(Boolean))
    }
  }
  // 3. Gemini, only when the reading still is not good enough. It sees the photo unless ID / card / bank numbers must stay
  //    private (Settings → remove ID numbers) and the text shows some; then it gets the text with those numbers removed.
  let engine: 'rules' | 'rules+gemini' = 'rules', aiNote: string | null = null, aiSaw: 'photo' | 'text' | null = null
  const cur = best
  if ((!cur || !goodEnough(cur.read)) && (s.ai === 'auto' || s.ai === 'gemini')) {
    const { gemini } = await aiProviders(c.company.id)
    const canSee = /^image\/(jpeg|png|webp|heic|heif)$/.test(mime) || mime === 'application/pdf'
    const red = redactForAi(cur?.text ?? '')
    const withImage = canSee && (!s.redact || !red.redacted)
    if (gemini.configured() && (cur || withImage)) {
      try {
        const sent = s.redact ? red.text : cur?.text ?? ''
        const ai = await gemini.generateStructuredOutput<Partial<ReceiptRead>>(RECEIPT_PROMPT,
          `Receipt OCR text:\n"""\n${sent.slice(0, 20_000) || '(no text could be read; use the photo)'}\n"""\n${withImage ? 'The photo of the receipt is attached. ' : ''}Return the JSON.`,
          RECEIPT_SCHEMA, raw => (raw && typeof raw === 'object' ? raw as Partial<ReceiptRead> : {}), withImage ? { image: { bytes: buf, mime } } : undefined)
        const base = cur?.read ?? readReceipt('', c.today)
        best = { text: cur?.text ?? '', read: mergeAi(base, ai, cur?.text ?? '', { image: withImage, today: c.today }), provider: cur?.provider ?? 'gemini' }
        engine = 'rules+gemini'; aiSaw = withImage ? 'photo' : 'text'
      } catch (e) { aiNote = `AI reading was skipped (${(e as Error).message}). The fields come from the OCR reading only.` }
    }
  }
  const done = best
  if (!done || (!done.text.trim() && engine === 'rules')) {
    return NextResponse.json({ error: `The receipt could not be read (${errors.join('; ') || 'no text found'}). Retake the photo in good light, flat and in focus, or enter the details by hand.` }, { status: 422 })
  }
  const read = done.read
  const supplier = await matchSupplier(c, read.supplier ?? null, read.trn ?? null)
  const duplicate = read.invoice_no ? await findDuplicate(c, { supplierId: supplier?.id ?? null, supplierName: supplier?.name ?? read.supplier ?? null, reference: read.invoice_no }) : null
  return NextResponse.json({ read, provider: done.provider, engine, aiSaw, aiNote, chars: done.text.length, bytes: buf.length, supplier, duplicate })
}
