import 'server-only'
import { getSecret } from '../secrets'
import { ocrSpaceProvider } from './ocrspace'
import { googleVisionProvider, parseServiceAccount } from './google-vision'
import { tesseractProvider } from './tesseract'
import { OcrError, type OCRProvider, type OcrFile, type OcrMode, type OcrResult } from './types'

export * from './types'
export const OCR_MODES: { id: OcrMode; label: string }[] = [
  { id: 'auto', label: 'Auto (Google Vision → OCR.Space → local)' }, { id: 'google_vision', label: 'Google Cloud Vision' },
  { id: 'ocrspace', label: 'OCR.Space' }, { id: 'tesseract', label: 'Local OCR only (nothing leaves the server)' },
]
export const isOcrMode = (v: unknown): v is OcrMode => OCR_MODES.some(m => m.id === v)

/** All providers with credentials resolved for this company (env first, then encrypted Settings). */
export async function ocrProviders(companyId: string | null): Promise<Record<'google_vision' | 'ocrspace' | 'tesseract', OCRProvider>> {
  const [ocrKey, gKey, gSa] = await Promise.all([getSecret(companyId, 'ocr_space_api_key'), getSecret(companyId, 'google_vision_api_key'), getSecret(companyId, 'google_service_account')])
  const engine = Number(process.env.OCR_SPACE_ENGINE) as 1 | 2 | 3
  return {
    google_vision: googleVisionProvider({
      serviceAccount: parseServiceAccount(gSa, process.env.GOOGLE_APPLICATION_CREDENTIALS), apiKey: gKey,
      projectId: process.env.GOOGLE_CLOUD_PROJECT_ID, endpoint: process.env.GOOGLE_VISION_ENDPOINT, tokenEndpoint: process.env.GOOGLE_TOKEN_ENDPOINT,
    }),
    ocrspace: ocrSpaceProvider({
      apiKey: ocrKey, endpoint: process.env.OCR_SPACE_ENDPOINT, engine: [1, 2, 3].includes(engine) ? engine : 2,
      maxBytes: Number(process.env.OCR_SPACE_MAX_BYTES) || undefined,
    }),
    tesseract: tesseractProvider(),
  }
}

export interface OcrAttempt { provider: OCRProvider['id']; ok: boolean; ms: number; chars: number; language: string | null; pages: number | null; error: string | null; code: string | null }

/** Order in which providers are tried. AUTO prefers Google Vision, then OCR.Space, then the private local reader. */
export function providerOrder(mode: OcrMode, available: Record<string, OCRProvider>, mime: string): OCRProvider[] {
  const chain: OCRProvider[] = mode === 'auto' ? [available.google_vision, available.ocrspace, available.tesseract]
    : mode === 'tesseract' ? [available.tesseract] : [available[mode], available.tesseract]   // explicit choice; local OCR is the private safety net
  return chain.filter(p => p && p.configured() && p.supports(mime))
}

/** Runs providers in order until one returns text. Every attempt is reported (for ocr_logs); errors never throw. */
export async function runOcr(file: OcrFile, providers: OCRProvider[]): Promise<{ result: OcrResult | null; attempts: OcrAttempt[] }> {
  const attempts: OcrAttempt[] = []
  for (const p of providers) {
    const t0 = Date.now()
    try {
      const r = await p.extractText(file)
      attempts.push({ provider: p.id, ok: true, ms: r.ms || Date.now() - t0, chars: r.text.length, language: r.language, pages: r.pages, error: null, code: null })
      return { result: r, attempts }
    } catch (e) {
      const err = e instanceof OcrError ? e : new OcrError((e as Error).message, 'provider', p.id)
      attempts.push({ provider: p.id, ok: false, ms: Date.now() - t0, chars: 0, language: null, pages: null, error: err.message.slice(0, 300), code: err.code })
    }
  }
  return { result: null, attempts }
}
