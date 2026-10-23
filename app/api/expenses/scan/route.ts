import { NextResponse, type NextRequest } from 'next/server'
import { getCtx } from '@/lib/auth'
import { aiSettings } from '@/lib/inbox/pipeline'
import { extractText } from '@/lib/inbox/text'
import { ocrProviders, providerOrder, runOcr } from '@/lib/ai/ocr'
import { aiProviders } from '@/lib/ai/llm'
import { redactForAi } from '@/lib/ai/redact'
import { rateLimit } from '@/lib/security'
import { mergeAi, readReceipt, RECEIPT_PROMPT, RECEIPT_SCHEMA, type ReceiptRead } from '@/lib/expenses/receipt-read'
import { findDuplicate, matchSupplier } from '@/lib/expenses/suppliers'

export const runtime = 'nodejs'
export const maxDuration = 60
/**
 * Reads a receipt / supplier invoice (PDF text layer first, else the company's OCR; then Gemini if it is set up) and
 * returns SUGGESTED fields with how sure each one is, warnings when the numbers do not add up, the supplier it matches
 * and any expense already saved with the same supplier and invoice number. Nothing is stored here: the person reviews
 * every field in the form and saves (with the receipt attached) themselves.
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
  let text = '', provider: string | null = null
  if (mime === 'application/pdf') { const layer = await extractText(buf, mime).catch(() => ''); if (layer.replace(/\s/g, '').length >= 30) { text = layer; provider = 'text_layer' } }
  const s = await aiSettings(c)
  if (!text) {
    const providers = providerOrder(s.ocr, await ocrProviders(c.company.id), mime)
    if (!providers.length) return NextResponse.json({ error: 'No OCR service is set up for this file type. Enter the details by hand, or set up OCR in Settings → AI & OCR.' }, { status: 422 })
    const { result, attempts } = await runOcr({ bytes: buf, mime, name: f.name }, providers)
    if (!result || !result.text.trim()) return NextResponse.json({ error: `The receipt could not be read (${attempts.map(a => a.error).filter(Boolean).join('; ') || 'no text found'}). Retake the photo in good light, flat and in focus, or enter the details by hand.` }, { status: 422 })
    text = result.text; provider = result.provider
  }
  let read: ReceiptRead = readReceipt(text, c.today), engine: 'rules' | 'rules+gemini' = 'rules', aiNote: string | null = null
  if (s.ai === 'auto' || s.ai === 'gemini') {
    const { gemini } = await aiProviders(c.company.id)
    if (gemini.configured()) {
      try {
        const sent = s.redact ? redactForAi(text).text : text
        const ai = await gemini.generateStructuredOutput<Partial<ReceiptRead>>(RECEIPT_PROMPT, `Receipt OCR text:\n"""\n${sent.slice(0, 20_000)}\n"""\nReturn the JSON.`, RECEIPT_SCHEMA, raw => (raw && typeof raw === 'object' ? raw as Partial<ReceiptRead> : {}))
        read = mergeAi(read, ai, text); engine = 'rules+gemini'
      } catch (e) { aiNote = `AI reading was skipped (${(e as Error).message}). The fields come from the text rules only.` }
    }
  }
  const supplier = await matchSupplier(c, read.supplier ?? null, read.trn ?? null)
  const duplicate = read.invoice_no ? await findDuplicate(c, { supplierId: supplier?.id ?? null, supplierName: supplier?.name ?? read.supplier ?? null, reference: read.invoice_no }) : null
  return NextResponse.json({ read, provider, engine, aiNote, chars: text.length, supplier, duplicate })
}
