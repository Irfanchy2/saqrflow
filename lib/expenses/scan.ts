import 'server-only'
import crypto from 'node:crypto'
import type { Ctx } from '@/lib/auth'
import { aiSettings } from '@/lib/inbox/pipeline'
import { extractText } from '@/lib/inbox/text'
import { ocrProviders, providerOrder, runOcr } from '@/lib/ai/ocr'
import { aiProviders } from '@/lib/ai/llm'
import { redactForAi } from '@/lib/ai/redact'
import { mergeAi, readReceipt, RECEIPT_PROMPT, RECEIPT_SCHEMA, type ReceiptRead } from './receipt-read'
import { goodEnough, localReceiptOcr, receiptScore } from './local-ocr'
import { findDuplicate, matchSupplier, type DuplicateHit, type SupplierHit } from './suppliers'

export type ScanStage = 'local' | 'cloud' | 'ai'
export interface ScanBody {
  read: ReceiptRead; provider: string; engine: 'rules' | 'rules+gemini'; aiSaw: 'photo' | 'text' | null; aiNote: string | null
  chars: number; bytes: number; localEngine: string | null; cached: boolean; supplier: SupplierHit | null; duplicate: DuplicateHit | null
}
export interface ScanEvents {
  /** the next reader that starts (the screen says "Double-checking with Google AI…") */
  stage?(s: ScanStage): void
  /** the free reading, sent at once when a paid reader is still going to check it, so the form fills without waiting */
  partial?(b: ScanBody): void
}

// The same photo scanned again (a retry, the form reopened) comes back at once. Kept in this server's memory for 30
// minutes, per company, keyed by the file's SHA-256 and the reading settings. The supplier match and the duplicate-bill
// check are always done again, so a bill saved meanwhile is still caught.
type Cached = Omit<ScanBody, 'supplier' | 'duplicate' | 'cached' | 'bytes'>
const cache = new Map<string, { at: number; v: Cached }>()
const TTL = 30 * 60_000, MAX = 300
function remember(k: string, v: Cached) {
  cache.delete(k); cache.set(k, { at: Date.now(), v })
  while (cache.size > MAX) cache.delete(cache.keys().next().value!)
}

async function finish(c: Ctx, v: Cached, bytes: number, cached: boolean): Promise<ScanBody> {
  const supplier = await matchSupplier(c, v.read.supplier ?? null, v.read.trn ?? null)
  const duplicate = v.read.invoice_no ? await findDuplicate(c, { supplierId: supplier?.id ?? null, supplierName: supplier?.name ?? v.read.supplier ?? null, reference: v.read.invoice_no }) : null
  return { ...v, bytes, cached, supplier, duplicate }
}

/**
 * Reads a receipt / supplier invoice and returns SUGGESTED fields with how sure each one is, warnings when the numbers do
 * not add up, the supplier it matches and any expense already saved with the same supplier and invoice number.
 *
 * Cheapest first: a PDF's own text layer, else PaddleOCR on this server (free). Paid services are used only when that
 * reading is not good enough: the company's cloud OCR next, then Gemini (with the photo, so it can read what OCR missed).
 * Nothing is stored: the person reviews every field in the form and saves (with the receipt attached) themselves.
 */
export async function scanReceipt(c: Ctx, file: { bytes: Uint8Array; mime: string; name: string }, on: ScanEvents = {}): Promise<{ ok: true; body: ScanBody } | { ok: false; error: string }> {
  const { bytes: buf, mime } = file
  const s = await aiSettings(c)
  const key = `${c.company.id}:${crypto.createHash('sha256').update(buf).digest('hex')}:${s.ocr}:${s.ai}:${s.redact}:${s.turbo}`
  const hit = cache.get(key), t0 = Date.now()
  if (hit && Date.now() - hit.at < TTL) { console.info(`[receipt-scan] cached ${hit.v.provider} ${Date.now() - t0}ms`); return { ok: true, body: await finish(c, hit.v, buf.length, true) } }

  type Reading = { text: string; read: ReceiptRead; provider: string }
  let best = null as Reading | null, localEngine: string | null = null
  const errors: string[] = []
  const take = (text: string, provider: string, read = readReceipt(text, c.today)) => { if (!best || receiptScore(read) > receiptScore(best.read)) best = { text, read, provider } }
  const settled = () => !!best && goodEnough(best.read, best.text)
  let sentPartial = false
  const partial = async () => {        // the free reading goes to the screen now; a paid reader then checks it
    if (sentPartial || !best || !on.partial) return
    sentPartial = true
    on.partial(await finish(c, { read: best.read, provider: best.provider, engine: 'rules', aiSaw: null, aiNote: null, chars: best.text.length, localEngine }, buf.length, false))
  }

  // 1. free: the PDF's text layer, or PaddleOCR on this server
  on.stage?.('local')
  if (mime === 'application/pdf') { const layer = await extractText(buf, mime).catch(() => ''); if (layer.replace(/\s/g, '').length >= 30) take(layer, 'text_layer') }
  else {
    const local = await localReceiptOcr(buf, mime, c.today, 30_000, s.turbo)
    if (local) { localEngine = local.engine; take(local.text, local.engine.startsWith('paddle') ? 'paddleocr' : 'tesseract', local.read) }
  }
  // 2. paid OCR, only when the free reading is missing or not good enough (and the company has not chosen local only)
  if (!settled() && s.ocr !== 'tesseract' && (mime === 'application/pdf' ? !best : true)) {
    const providers = providerOrder(s.ocr, await ocrProviders(c.company.id), mime).filter(p => p.id !== 'tesseract')
    if (providers.length) {
      await partial(); on.stage?.('cloud')
      const { result, attempts } = await runOcr({ bytes: buf, mime, name: file.name }, providers)
      if (result?.text.trim()) take(result.text, result.provider)
      else errors.push(...attempts.map(a => a.error ?? '').filter(Boolean))
    }
  }
  // 3. Gemini, only when the reading still is not good enough. It sees the photo unless ID / card / bank numbers must stay
  //    private (Settings → remove ID numbers) and the text shows some; then it gets the text with those numbers removed.
  let engine: 'rules' | 'rules+gemini' = 'rules', aiNote: string | null = null, aiSaw: 'photo' | 'text' | null = null
  const cur = best
  if (!settled() && (s.ai === 'auto' || s.ai === 'gemini')) {
    const { gemini } = await aiProviders(c.company.id)
    const canSee = /^image\/(jpeg|png|webp|heic|heif)$/.test(mime) || mime === 'application/pdf'
    const red = redactForAi(cur?.text ?? '')
    const withImage = canSee && (!s.redact || !red.redacted)
    if (gemini.configured() && (cur || withImage)) {
      await partial(); on.stage?.('ai')
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
  // one line per scan in the server log: which reader ran and how long it took (no receipt content)
  console.info(`[receipt-scan] ${done?.provider ?? 'none'} local=${localEngine ?? '-'} ai=${engine === 'rules+gemini' ? aiSaw : 'no'} ${Date.now() - t0}ms${errors.length ? ` errors=${errors.length}` : ''}`)
  if (!done || (!done.text.trim() && engine === 'rules')) {
    return { ok: false, error: `The receipt could not be read (${errors.join('; ') || 'no text found'}). Retake the photo in good light, flat and in focus, or enter the details by hand.` }
  }
  const v: Cached = { read: done.read, provider: done.provider, engine, aiSaw, aiNote, chars: done.text.length, localEngine }
  if (!aiNote) remember(key, v)                           // a reading where a service failed is not kept: the next try may do better
  return { ok: true, body: await finish(c, v, buf.length, false) }
}
