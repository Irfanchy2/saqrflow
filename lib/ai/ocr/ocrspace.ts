// OCR.Space (https://ocr.space/OCRAPI) — free tier for development, PRO endpoints supported via OCR_SPACE_ENDPOINT.
import { OcrError, TEST_IMAGE, testPassed, type OCRProvider, type OcrDocument, type OcrFile } from './types'

export const OCR_SPACE_DEFAULT_ENDPOINT = 'https://api.ocr.space/parse/image'
const FILETYPE: Record<string, string> = { 'application/pdf': 'PDF', 'image/jpeg': 'JPG', 'image/png': 'PNG' }

export interface OcrSpaceOptions {
  apiKey: string | null
  endpoint?: string
  /** 1 = Arabic via language "ara"; 2 = fast, Latin, auto language; 3 = multilingual incl. Arabic (if enabled for the key) */
  engine?: 1 | 2 | 3
  maxBytes?: number                       // free tier: 1 MB
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

interface OcrSpaceResponse {
  ParsedResults?: { ParsedText?: string; FileParseExitCode?: number | string; ErrorMessage?: string; ErrorDetails?: string }[]
  OCRExitCode?: number | string; IsErroredOnProcessing?: boolean; ErrorMessage?: string | string[]; ErrorDetails?: string
}

const hasArabic = (s: string) => /[؀-ۿ]/.test(s)

export function ocrSpaceProvider(o: OcrSpaceOptions): OCRProvider {
  const endpoint = o.endpoint || OCR_SPACE_DEFAULT_ENDPOINT, maxBytes = o.maxBytes ?? 1_048_576, timeoutMs = o.timeoutMs ?? 60_000
  const doFetch = o.fetchImpl ?? fetch
  const fail = (m: string, code: ConstructorParameters<typeof OcrError>[1]) => new OcrError(m, code, 'ocrspace')

  async function call(file: OcrFile, engine: 1 | 2 | 3, language: string): Promise<{ texts: string[]; ms: number }> {
    const t0 = Date.now()
    const fd = new FormData()
    fd.append('file', new Blob([file.bytes as BlobPart], { type: file.mime }), file.name || 'document')
    fd.append('filetype', FILETYPE[file.mime] ?? 'PNG')
    fd.append('language', language)
    fd.append('OCREngine', String(engine))
    fd.append('isOverlayRequired', 'false'); fd.append('detectOrientation', 'true'); fd.append('scale', 'true'); fd.append('isTable', 'false')
    let res: Response
    try {
      res = await doFetch(endpoint, { method: 'POST', headers: { apikey: o.apiKey! }, body: fd, signal: AbortSignal.timeout(timeoutMs) })
    } catch (e) {
      const n = (e as Error).name
      throw fail(n === 'TimeoutError' || n === 'AbortError' ? `OCR.Space did not answer within ${Math.round(timeoutMs / 1000)}s` : `OCR.Space could not be reached (${(e as Error).message})`, n === 'TimeoutError' || n === 'AbortError' ? 'timeout' : 'provider')
    }
    const raw = await res.text()
    let body: OcrSpaceResponse | null = null
    try { body = JSON.parse(raw) } catch { /* OCR.Space sometimes answers errors as plain text */ }
    const msg = (body ? [body.ErrorMessage].flat().filter(Boolean).join(' ') || body.ErrorDetails || '' : raw).toString().slice(0, 300)
    if (res.status === 429 || /maximum \d+ number of times|rate limit|too many requests/i.test(msg)) throw fail('OCR.Space rate limit reached. Try again later or switch provider', 'rate_limited')
    if (res.status === 401 || res.status === 403 || /api ?key|unauthori[sz]ed|invalid key/i.test(msg)) throw fail('OCR.Space rejected the API key', 'auth')
    if (!res.ok) throw fail(`OCR.Space error ${res.status}${msg ? `: ${msg}` : ''}`, res.status === 413 ? 'too_large' : 'provider')
    if (!body) throw fail('OCR.Space returned an unreadable response', 'provider')
    if (body.IsErroredOnProcessing || ![1, 2, '1', '2'].includes(body.OCRExitCode as any)) {
      const code = /size|limit.*(kb|mb)|too large/i.test(msg) ? 'too_large' : /page|corrupt|invalid|unable to (render|recogni[sz]e)|not supported/i.test(msg) ? 'invalid_document' : /timed? ?out/i.test(msg) ? 'timeout' : 'provider'
      throw fail(`OCR.Space: ${msg || 'processing failed'}`, code)
    }
    return { texts: (body.ParsedResults ?? []).filter(p => [1, '1'].includes(p.FileParseExitCode as any)).map(p => (p.ParsedText ?? '').replace(/\r\n/g, '\n').trim()), ms: Date.now() - t0 }
  }

  const provider: OCRProvider = {
    id: 'ocrspace', label: 'OCR.Space',
    configured: () => !!o.apiKey,
    supports: mime => mime in FILETYPE,
    async extractDocument(file: OcrFile): Promise<OcrDocument> {
      if (!o.apiKey) throw fail('OCR_SPACE_API_KEY is not configured', 'not_configured')
      if (!provider.supports(file.mime)) throw fail(`OCR.Space does not read ${file.mime}`, 'unsupported')
      if (file.bytes.byteLength > maxBytes) throw fail(`File is ${(file.bytes.byteLength / 1048576).toFixed(1)} MB: OCR.Space accepts up to ${(maxBytes / 1048576).toFixed(1)} MB on this plan`, 'too_large')
      const engine = o.engine ?? 2
      let r = await call(file, engine, engine === 1 ? 'eng' : 'auto')
      let text = r.texts.join('\n\n').trim(), ms = r.ms
      // Arabic-only documents come back (nearly) empty from the Latin engine: re-read with the Arabic model
      if (text.replace(/\s/g, '').length < 8 && engine !== 1) {
        const ar = await call(file, 1, 'ara').catch(() => null)
        if (ar && ar.texts.join('').trim().length > text.length) { r = ar; text = ar.texts.join('\n\n').trim() }
        ms += ar?.ms ?? 0
      }
      if (!text) throw fail('No text was found in the document', 'empty')
      return { provider: 'ocrspace', text, pageTexts: r.texts, pages: r.texts.length || null, language: hasArabic(text) ? (/[a-z]{3}/i.test(text) ? 'ar,en' : 'ar') : 'en', ms }
    },
    async extractText(file) { const { pageTexts: _p, ...r } = await provider.extractDocument(file); return r },
    async healthCheck() {
      const t0 = Date.now()
      try {
        const r = await provider.extractText(TEST_IMAGE)
        return { ok: testPassed(r.text), message: testPassed(r.text) ? 'Connected. Test image read correctly' : `Connected, but the test image read as “${r.text.slice(0, 60)}”`, ms: Date.now() - t0 }
      } catch (e) { return { ok: false, message: (e as Error).message, ms: Date.now() - t0 } }
    },
  }
  return provider
}
