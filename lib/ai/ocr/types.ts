// OCR provider contract. Providers run on the server only; API keys never reach the browser.
export type OcrProviderId = 'text_layer' | 'ocrspace' | 'google_vision' | 'tesseract'
export type OcrMode = 'auto' | 'google_vision' | 'ocrspace' | 'tesseract'
export interface OcrFile { bytes: Uint8Array; mime: string; name: string }
export interface OcrResult { provider: OcrProviderId; text: string; language: string | null; pages: number | null; ms: number }
export interface OcrDocument extends OcrResult { pageTexts: string[] }
export type OcrErrorCode = 'not_configured' | 'unsupported' | 'too_large' | 'rate_limited' | 'timeout' | 'auth' | 'invalid_document' | 'empty' | 'provider'
export class OcrError extends Error {
  constructor(message: string, public code: OcrErrorCode, public provider: OcrProviderId) { super(message); this.name = 'OcrError' }
}
export interface HealthResult { ok: boolean; message: string; ms: number }

export interface OCRProvider {
  id: OcrProviderId
  label: string
  /** true when credentials are present (does not call the API) */
  configured(): boolean
  supports(mime: string): boolean
  extractText(file: OcrFile): Promise<OcrResult>
  extractDocument(file: OcrFile): Promise<OcrDocument>
  /** real round-trip with a tiny built-in test image */
  healthCheck(): Promise<HealthResult>
}

/** 420×70 PNG reading "SAQRFLOW OCR TEST" — used by Test connection (contains no customer data). */
export const TEST_IMAGE: OcrFile = { bytes: Uint8Array.from(Buffer.from('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', 'base64')), mime: 'image/png', name: 'saqrflow-ocr-test.png' }
export const testPassed = (text: string) => /SAQR\s*FLOW/i.test(text) && /TEST/i.test(text)
