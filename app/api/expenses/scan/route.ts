import { NextResponse, type NextRequest } from 'next/server'
import { getCtx } from '@/lib/auth'
import { aiSettings } from '@/lib/inbox/pipeline'
import { extractText } from '@/lib/inbox/text'
import { ocrProviders, providerOrder, runOcr } from '@/lib/ai/ocr'
import { parseReceipt } from '@/lib/expenses/receipt'

export const runtime = 'nodejs'
export const maxDuration = 60
/**
 * Reads a receipt with the company's configured OCR (PDF text layer first) and returns SUGGESTED fields.
 * Nothing is stored here — the user reviews the form and saves the expense (with the file) themselves.
 */
export async function POST(req: NextRequest) {
  const c = await getCtx().catch(() => null)
  if (!c) return NextResponse.json({ error: 'Your session has expired. Sign in again.' }, { status: 401 })
  if (!c.can('records.edit') || !c.can('finance.view')) return NextResponse.json({ error: 'You are not allowed to add expenses.' }, { status: 403 })
  const f = (await req.formData()).get('file')
  if (!(f instanceof File) || !f.size) return NextResponse.json({ error: 'Choose a receipt image or PDF.' }, { status: 400 })
  if (f.size > 10 * 1024 * 1024) return NextResponse.json({ error: 'The file is larger than 10 MB.' }, { status: 400 })
  const mime = f.type || 'application/octet-stream'
  if (!/^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/.test(mime)) return NextResponse.json({ error: 'Only images (JPG, PNG, WEBP, HEIC) or PDF can be read.' }, { status: 400 })
  const buf = new Uint8Array(await f.arrayBuffer())
  let text = '', provider: string | null = null
  if (mime === 'application/pdf') { const layer = await extractText(buf, mime).catch(() => ''); if (layer.replace(/\s/g, '').length >= 30) { text = layer; provider = 'text_layer' } }
  if (!text) {
    const s = await aiSettings(c)
    const providers = providerOrder(s.ocr, await ocrProviders(c.company.id), mime)
    if (!providers.length) return NextResponse.json({ error: 'No OCR service is configured for this file type. Enter the details manually or set up OCR in Settings → AI & OCR.' }, { status: 422 })
    const { result, attempts } = await runOcr({ bytes: buf, mime, name: f.name }, providers)
    if (!result) return NextResponse.json({ error: `The receipt could not be read (${attempts.map(a => a.error).filter(Boolean).join('; ') || 'no text found'}). Enter the details manually.` }, { status: 422 })
    text = result.text; provider = result.provider
  }
  return NextResponse.json({ fields: parseReceipt(text, c.today), provider, chars: text.length })
}
