import { generateKeyPairSync, createVerify } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { ocrSpaceProvider } from '@/lib/ai/ocr/ocrspace'
import { googleVisionProvider, parseServiceAccount, signServiceAccountJwt } from '@/lib/ai/ocr/google-vision'
import { OcrError, TEST_IMAGE } from '@/lib/ai/ocr/types'
import { geminiProvider } from '@/lib/ai/llm/gemini'
import { validateAiOutput } from '@/lib/ai/llm/schema'
import { redactForAi } from '@/lib/ai/redact'
import { parseQuery } from '@/lib/ai/search'

type Call = { url: string; init: RequestInit }
const fake = (responses: (Response | Error)[]) => {
  const calls: Call[] = []
  const f = (async (url: string, init: RequestInit) => { calls.push({ url: String(url), init }); const r = responses.shift()!; if (r instanceof Error) throw r; return r }) as unknown as typeof fetch
  return { f, calls }
}
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
const pdf = { bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 1, 2, 3]), mime: 'application/pdf', name: 'tl.pdf' }
const err = async (p: Promise<unknown>) => { try { await p } catch (e) { return e as OcrError } throw new Error('expected an error') }

describe('OCR.Space provider', () => {
  it('posts the file server-side with the key in a header and returns the text', async () => {
    const { f, calls } = fake([json({ ParsedResults: [{ ParsedText: 'COMMERCIAL LICENSE\r\nLicense No: 1', FileParseExitCode: 1 }], OCRExitCode: 1, IsErroredOnProcessing: false })])
    const r = await ocrSpaceProvider({ apiKey: 'K123', fetchImpl: f }).extractText(pdf)
    expect(r).toMatchObject({ provider: 'ocrspace', text: 'COMMERCIAL LICENSE\nLicense No: 1', pages: 1, language: 'en' })
    expect(calls[0].url).toBe('https://api.ocr.space/parse/image')
    expect((calls[0].init.headers as Record<string, string>).apikey).toBe('K123')
    const fd = calls[0].init.body as FormData
    expect([fd.get('OCREngine'), fd.get('language'), fd.get('filetype')]).toEqual(['2', 'auto', 'PDF'])
    expect(String(calls[0].url)).not.toContain('K123')
  })
  it('re-reads Arabic-only documents with the Arabic model', async () => {
    const { f, calls } = fake([json({ ParsedResults: [{ ParsedText: ' ', FileParseExitCode: 1 }], OCRExitCode: 1 }), json({ ParsedResults: [{ ParsedText: 'رخصة تجارية رقم ١٢٣٤٥ دبي', FileParseExitCode: 1 }], OCRExitCode: 1 })])
    const r = await ocrSpaceProvider({ apiKey: 'K', fetchImpl: f }).extractText(TEST_IMAGE)
    expect(r.language).toBe('ar'); expect((calls[1].init.body as FormData).get('language')).toBe('ara'); expect((calls[1].init.body as FormData).get('OCREngine')).toBe('1')
  })
  it('maps provider errors: processing error, rate limit, bad key, timeout, too large, empty, not configured', async () => {
    const mk = (r: Response | Error) => ocrSpaceProvider({ apiKey: 'K', fetchImpl: fake([r]).f })
    expect((await err(mk(json({ OCRExitCode: 3, IsErroredOnProcessing: true, ErrorMessage: ['Unable to recognize the file type'] })).extractText(pdf))).code).toBe('invalid_document')
    expect((await err(mk(new Response('You may only perform this action upto maximum 180 number of times within 3600 seconds', { status: 403 })).extractText(pdf))).code).toBe('rate_limited')
    expect((await err(mk(new Response('The API key is invalid', { status: 403 })).extractText(pdf))).code).toBe('auth')
    expect((await err(mk(Object.assign(new Error('t'), { name: 'TimeoutError' })).extractText(pdf))).code).toBe('timeout')
    expect((await err(ocrSpaceProvider({ apiKey: 'K', maxBytes: 3 }).extractText(pdf))).code).toBe('too_large')
    expect((await err(mk(json({ ParsedResults: [{ ParsedText: '', FileParseExitCode: 1 }], OCRExitCode: 1 })).extractText(pdf))).code).toBe('empty')
    expect((await err(ocrSpaceProvider({ apiKey: null }).extractText(pdf))).code).toBe('not_configured')
  })
})

describe('Google Cloud Vision provider', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } })
  const sa = { client_email: 'ocr@proj.iam.gserviceaccount.com', private_key: privateKey, project_id: 'proj' }
  it('signs a valid RS256 service-account JWT for the Vision scope', () => {
    const jwt = signServiceAccountJwt(sa, 1_800_000_000)
    const [h, c, s] = jwt.split('.')
    expect(createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(s, 'base64url'))).toBe(true)
    expect(JSON.parse(Buffer.from(c, 'base64url').toString())).toMatchObject({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/cloud-vision', exp: 1_800_003_600 })
    expect(parseServiceAccount(Buffer.from(JSON.stringify(sa)).toString('base64'))?.client_email).toBe(sa.client_email)
    expect(parseServiceAccount('not json')).toBeNull()
  })
  it('exchanges the JWT for a token, then uses DOCUMENT_TEXT_DETECTION (images) and files:annotate (PDF)', async () => {
    const { f, calls } = fake([
      json({ access_token: 'ya29.tok', expires_in: 3600 }),
      json({ responses: [{ fullTextAnnotation: { text: 'EMIRATES ID\nبطاقة الهوية', pages: [{ property: { detectedLanguages: [{ languageCode: 'en' }, { languageCode: 'ar' }] } }] } }] }),
      json({ responses: [{ responses: [{ fullTextAnnotation: { text: 'page one' } }, { fullTextAnnotation: { text: 'page two' } }] }] }),
    ])
    const p = googleVisionProvider({ serviceAccount: { ...sa, client_email: 'other@proj.iam.gserviceaccount.com' }, fetchImpl: f })
    const r = await p.extractText(TEST_IMAGE)
    expect(r).toMatchObject({ provider: 'google_vision', text: 'EMIRATES ID\nبطاقة الهوية', language: 'en,ar' })
    expect(calls[0].url).toBe('https://oauth2.googleapis.com/token')
    expect(calls[1].url).toBe('https://vision.googleapis.com/v1/images:annotate')
    expect((calls[1].init.headers as Record<string, string>).authorization).toBe('Bearer ya29.tok')
    expect(JSON.parse(String(calls[1].init.body)).requests[0].features[0].type).toBe('DOCUMENT_TEXT_DETECTION')
    const d = await p.extractDocument(pdf)
    expect(calls[2].url).toBe('https://vision.googleapis.com/v1/files:annotate')       // token re-used from cache
    expect(d).toMatchObject({ pages: 2, text: 'page one\n\npage two' })
  })
  it('supports an API key and maps quota errors', async () => {
    const { f, calls } = fake([json({ error: { message: 'Quota exceeded', status: 'RESOURCE_EXHAUSTED' } }, 429)])
    const e = await err(googleVisionProvider({ apiKey: 'AIzaKEY', fetchImpl: f }).extractText(TEST_IMAGE))
    expect(e.code).toBe('rate_limited'); expect(calls[0].url).toContain('?key=AIzaKEY')
    expect(googleVisionProvider({}).configured()).toBe(false)
  })
})

const doc = (o: Record<string, unknown>) => ({ document_type: 'trade_license', category: 'company_document', document_owner_type: 'company', company_name: null, employee_name: null, document_number: null, issue_date: null, expiry_date: null, issuing_authority: null, confidence: 0.95, fields: [], requires_manual_review: false, ...o })
const TL = 'COMMERCIAL LICENSE\nLicense No: 7788123\nTrade Name: AL SAQR AL AHMAR WELDING AND BLACKSMITH LLC\nIssue Date: 20/05/2026\nExpiry Date: 19/05/2027'

describe('Gemini structured output', () => {
  it('requests JSON with a schema and keeps the key out of the URL', async () => {
    const { f, calls } = fake([json({ candidates: [{ content: { parts: [{ text: JSON.stringify(doc({ company_name: 'AL SAQR AL AHMAR WELDING AND BLACKSMITH LLC', document_number: '7788123', issue_date: '2026-05-20', expiry_date: '2027-05-19' })) }] }, finishReason: 'STOP' }] })])
    const r = await geminiProvider({ apiKey: 'AIzaX', model: 'gemini-2.5-flash', fetchImpl: f }).classifyDocument({ text: TL })
    expect(r.extraction).toMatchObject({ engine: 'gemini', docType: 'trade_license', fields: { expiry_date: { value: '2027-05-19' }, document_number: { value: '7788123' } } })
    expect(r.requiresReview).toBe(false)
    const body = JSON.parse(String(calls[0].init.body))
    expect(body.generationConfig).toMatchObject({ responseMimeType: 'application/json', temperature: 0 }); expect(body.generationConfig.responseSchema.required).toContain('requires_manual_review')
    expect(calls[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent')
    expect((calls[0].init.headers as Record<string, string>)['x-goog-api-key']).toBe('AIzaX')
  })
  it('never trusts the model: invented values are dropped, missing expiry forces review', () => {
    const v = validateAiOutput(doc({ document_number: '9999999', expiry_date: '2030-01-01', company_name: 'AL SAQR AL AHMAR WELDING AND BLACKSMITH LLC', issue_date: '20-05-2026' }), TL, 'gemini', 'm')
    expect(v.extraction.fields.document_number).toBeUndefined()
    expect(v.extraction.fields.expiry_date).toBeUndefined()
    expect(v.extraction.fields.issue_date).toBeUndefined()
    expect(v.extraction.fields.company_name?.value).toBe('AL SAQR AL AHMAR WELDING AND BLACKSMITH LLC')
    expect(v.requiresReview).toBe(true)
    expect(v.warnings.join(' ')).toMatch(/9999999.*not found/)
    expect(validateAiOutput(doc({ document_type: 'spaceship' }), TL, 'gemini', 'm').extraction.docType).toBe('unknown')
    expect(() => validateAiOutput({ document_type: 'x' }, TL, 'gemini', 'm')).toThrow(/invalid structure/)
  })
  it('maps failures: bad key, rate limit, blocked, invalid JSON, not configured', async () => {
    const g = (r: Response) => geminiProvider({ apiKey: 'k', fetchImpl: fake([r]).f }).classifyDocument({ text: TL })
    await expect(g(json({ error: { message: 'API key not valid. Please pass a valid API key.' } }, 400))).rejects.toMatchObject({ code: 'auth' })
    await expect(g(json({ error: { message: 'Resource has been exhausted' } }, 429))).rejects.toMatchObject({ code: 'rate_limited' })
    await expect(g(json({ promptFeedback: { blockReason: 'SAFETY' } }))).rejects.toMatchObject({ code: 'blocked' })
    await expect(g(json({ candidates: [{ content: { parts: [{ text: 'Sure! Here is the JSON' }] }, finishReason: 'STOP' }] }))).rejects.toMatchObject({ code: 'invalid_output' })
    await expect(geminiProvider({ apiKey: null }).classifyDocument({ text: TL })).rejects.toMatchObject({ code: 'not_configured' })
  })
})

describe('privacy & search', () => {
  it('removes ID numbers before AI, keeps the public TRN', () => {
    const r = redactForAi('ID Number: 784-1990-1234567-6\nPassport No: BX1234567\nP<BGDAYUB<<MOHAMMED<<<<<<\nIBAN AE07 0331 2345 6789 0123 456\nTRN: 100123456700003\nCard 4111 1111 1111 1111')
    expect(r.redacted).toBe(true)
    expect(r.text).not.toMatch(/784-1990|BX1234567|<<<|AE07|4111/)
    expect(r.text).toContain('100123456700003')
  })
  it('understands the spec questions without any AI service', () => {
    const t = '2026-10-05'
    expect(parseQuery('Show our latest Trade License.', t)).toMatchObject({ entity: 'documents', doc_type: 'trade_license', latest: true })
    expect(parseQuery('Which employees have visas expiring next month?', t)).toMatchObject({ doc_type: 'residence_visa', expiring_within_days: 56 })
    expect(parseQuery("Find Mohammed Ayub's Emirates ID.", t)).toMatchObject({ doc_type: 'emirates_id', person: 'Mohammed Ayub' })
    expect(parseQuery('Show tenancy contract.', t)).toMatchObject({ doc_type: 'tenancy_contract' })
    expect(parseQuery('Which documents expire within 60 days?', t)).toMatchObject({ entity: 'documents', expiring_within_days: 60, doc_type: null })
    expect(parseQuery('Show invoices for ABC Contracting.', t)).toMatchObject({ entity: 'invoices', customer: 'ABC Contracting' })
  })
})
