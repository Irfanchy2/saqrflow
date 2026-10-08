// Google Cloud Vision — DOCUMENT_TEXT_DETECTION for images, files:annotate for PDFs (first 5 pages).
// Auth: service account (JSON from GOOGLE_SERVICE_ACCOUNT_JSON / Settings, or the file at GOOGLE_APPLICATION_CREDENTIALS)
// exchanged for a short-lived OAuth token (signed JWT, no extra SDK), or an API key restricted to the Vision API.
import { createSign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { OcrError, TEST_IMAGE, testPassed, type OCRProvider, type OcrDocument, type OcrFile } from './types'

export interface ServiceAccount { client_email: string; private_key: string; project_id?: string; token_uri?: string }
export interface GoogleVisionOptions {
  serviceAccount?: ServiceAccount | null
  apiKey?: string | null
  projectId?: string | null
  endpoint?: string                       // https://vision.googleapis.com
  tokenEndpoint?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

/** Accepts raw JSON, base64-encoded JSON, or (fallback) the file named by GOOGLE_APPLICATION_CREDENTIALS. */
export function parseServiceAccount(raw?: string | null, credentialsPath?: string | null): ServiceAccount | null {
  const tryJson = (s: string) => { try { const j = JSON.parse(s); return j?.client_email && j?.private_key ? (j as ServiceAccount) : null } catch { return null } }
  if (raw?.trim()) return tryJson(raw.trim()) ?? tryJson(Buffer.from(raw.trim(), 'base64').toString('utf8'))
  if (credentialsPath) { try { return tryJson(readFileSync(credentialsPath, 'utf8')) } catch { return null } }
  return null
}

const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url')
export function signServiceAccountJwt(sa: ServiceAccount, nowSec = Math.floor(Date.now() / 1000), aud = sa.token_uri || 'https://oauth2.googleapis.com/token') {
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claim = b64u(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/cloud-vision', aud, iat: nowSec, exp: nowSec + 3600 }))
  const sig = createSign('RSA-SHA256').update(`${head}.${claim}`).sign(sa.private_key)
  return `${head}.${claim}.${b64u(sig)}`
}

const tokens = new Map<string, { token: string; exp: number }>()

export function googleVisionProvider(o: GoogleVisionOptions): OCRProvider {
  const base = (o.endpoint || 'https://vision.googleapis.com').replace(/\/$/, ''), timeoutMs = o.timeoutMs ?? 60_000
  const doFetch = o.fetchImpl ?? fetch
  const fail = (m: string, code: ConstructorParameters<typeof OcrError>[1]) => new OcrError(m, code, 'google_vision')
  const project = o.projectId || o.serviceAccount?.project_id || null

  async function authHeaders(): Promise<{ headers: Record<string, string>; query: string }> {
    if (o.serviceAccount) {
      const sa = o.serviceAccount, cached = tokens.get(sa.client_email)
      if (cached && cached.exp > Date.now() + 60_000) return { headers: { authorization: `Bearer ${cached.token}`, ...(project ? { 'x-goog-user-project': project } : {}) }, query: '' }
      let jwt: string
      try { jwt = signServiceAccountJwt(sa, undefined, o.tokenEndpoint) } catch { throw fail('The Google service-account private key is invalid', 'auth') }
      const res = await doFetch(o.tokenEndpoint || sa.token_uri || 'https://oauth2.googleapis.com/token', {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }), signal: AbortSignal.timeout(20_000),
      }).catch(e => { throw fail(`Google sign-in failed (${(e as Error).message})`, 'provider') })
      const j = await res.json().catch(() => ({})) as { access_token?: string; expires_in?: number; error_description?: string }
      if (!res.ok || !j.access_token) throw fail(`Google rejected the service account${j.error_description ? `: ${j.error_description}` : ''}`, 'auth')
      tokens.set(sa.client_email, { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 })
      return { headers: { authorization: `Bearer ${j.access_token}`, ...(project ? { 'x-goog-user-project': project } : {}) }, query: '' }
    }
    if (o.apiKey) return { headers: {}, query: `?key=${encodeURIComponent(o.apiKey)}` }
    throw fail('Google Vision credentials are not configured', 'not_configured')
  }

  async function post(path: string, body: unknown) {
    const a = await authHeaders()
    let res: Response
    try {
      res = await doFetch(`${base}${path}${a.query}`, { method: 'POST', headers: { 'content-type': 'application/json', ...a.headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) })
    } catch (e) {
      const n = (e as Error).name
      throw fail(n === 'TimeoutError' || n === 'AbortError' ? 'Google Vision timed out' : `Google Vision could not be reached (${(e as Error).message})`, n === 'TimeoutError' || n === 'AbortError' ? 'timeout' : 'provider')
    }
    const j = await res.json().catch(() => null) as any
    const msg = String(j?.error?.message ?? '').slice(0, 300)
    if (res.status === 429 || j?.error?.status === 'RESOURCE_EXHAUSTED') throw fail('Google Vision quota exceeded', 'rate_limited')
    if (res.status === 401 || res.status === 403) throw fail(`Google Vision refused the request${msg ? `: ${msg}` : ''}`, 'auth')
    if (!res.ok || !j) throw fail(`Google Vision error ${res.status}${msg ? `: ${msg}` : ''}`, res.status === 400 ? 'invalid_document' : 'provider')
    return j
  }

  const lang = (ann: any): string | null => ann?.pages?.[0]?.property?.detectedLanguages?.map((l: any) => l.languageCode).filter(Boolean).slice(0, 2).join(',') || null

  const provider: OCRProvider = {
    id: 'google_vision', label: 'Google Cloud Vision',
    configured: () => !!(o.serviceAccount || o.apiKey),
    supports: mime => ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/tiff'].includes(mime),
    async extractDocument(file: OcrFile): Promise<OcrDocument> {
      if (!provider.configured()) throw fail('Google Vision credentials are not configured', 'not_configured')
      if (file.bytes.byteLength > 20 * 1048576) throw fail('Google Vision accepts files up to 20 MB', 'too_large')
      const t0 = Date.now(), content = Buffer.from(file.bytes).toString('base64')
      const features = [{ type: 'DOCUMENT_TEXT_DETECTION' }], imageContext = { languageHints: ['en', 'ar'] }
      let pageTexts: string[] = [], language: string | null = null
      if (file.mime === 'application/pdf') {
        const j = await post('/v1/files:annotate', { requests: [{ inputConfig: { content, mimeType: 'application/pdf' }, features, imageContext, pages: [1, 2, 3, 4, 5] }] })
        const r = j.responses?.[0]
        if (r?.error?.message) throw fail(`Google Vision: ${r.error.message}`, 'invalid_document')
        pageTexts = (r?.responses ?? []).map((p: any) => (p.fullTextAnnotation?.text ?? '').trim())
        language = lang(r?.responses?.[0]?.fullTextAnnotation)
      } else {
        const j = await post('/v1/images:annotate', { requests: [{ image: { content }, features, imageContext }] })
        const r = j.responses?.[0]
        if (r?.error?.message) throw fail(`Google Vision: ${r.error.message}`, 'invalid_document')
        pageTexts = [(r?.fullTextAnnotation?.text ?? r?.textAnnotations?.[0]?.description ?? '').trim()]
        language = lang(r?.fullTextAnnotation)
      }
      const text = pageTexts.filter(Boolean).join('\n\n').trim()
      if (!text) throw fail('No text was found in the document', 'empty')
      return { provider: 'google_vision', text, pageTexts, pages: pageTexts.length, language, ms: Date.now() - t0 }
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
