// Google Gemini (Generative Language API) with JSON-schema constrained output.
import { matchByName } from '../../inbox/match'
import { RESPONSE_SCHEMA, SYSTEM_PROMPT, validateAiOutput } from './schema'
import { AiError, type AIProvider, type ClassifyInput, type ClassifyOutput } from './types'

export const GEMINI_DEFAULT_MODEL = 'gemini-2.5-flash'
export interface GeminiOptions { apiKey: string | null; model?: string; endpoint?: string; timeoutMs?: number; fetchImpl?: typeof fetch; maxRetryWaitMs?: number }

export function geminiProvider(o: GeminiOptions): AIProvider {
  const model = o.model || GEMINI_DEFAULT_MODEL, base = (o.endpoint || 'https://generativelanguage.googleapis.com').replace(/\/$/, '')
  const doFetch = o.fetchImpl ?? fetch, timeoutMs = o.timeoutMs ?? 60_000
  const fail = (m: string, code: AiError['code']) => new AiError(m, code, 'gemini')

  /** Free-tier keys allow ~10 requests/minute: on 429 wait for Google's suggested retryDelay (≤ 25 s) and try again, twice at most. */
  async function generate(system: string, user: string, schema: object): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      try { return await generateOnce(system, user, schema) }
      catch (e) {
        const wait = e instanceof AiError && e.code === 'rate_limited' ? (e as AiError & { retryMs?: number }).retryMs ?? 0 : 0
        if (!wait || attempt >= 2 || wait > (o.maxRetryWaitMs ?? 25_000)) throw e
        await new Promise(r => setTimeout(r, wait))
      }
    }
  }

  async function generateOnce(system: string, user: string, schema: object): Promise<unknown> {
    if (!o.apiKey) throw fail('GEMINI_API_KEY is not configured', 'not_configured')
    let res: Response
    try {
      res = await doFetch(`${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': o.apiKey }, signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature: 0 },
        }),
      })
    } catch (e) {
      const n = (e as Error).name
      throw fail(n === 'TimeoutError' || n === 'AbortError' ? 'Gemini did not answer in time' : `Gemini could not be reached (${(e as Error).message})`, n === 'TimeoutError' || n === 'AbortError' ? 'timeout' : 'provider')
    }
    const j = await res.json().catch(() => null) as any
    const msg = String(j?.error?.message ?? '').slice(0, 300)
    if (res.status === 429) {
      const delay = (j?.error?.details ?? []).find((d: any) => String(d?.['@type'] ?? '').endsWith('RetryInfo'))?.retryDelay as string | undefined
      const err = fail('Gemini rate limit / quota reached — try again later', 'rate_limited') as AiError & { retryMs?: number }
      err.retryMs = delay && /^\d+(\.\d+)?s$/.test(delay) ? Math.ceil(parseFloat(delay) * 1000) + 250 : 5_000
      if (/per\s*day|PerDay/i.test(JSON.stringify(j?.error ?? ''))) err.retryMs = undefined                      // daily quota: waiting won't help
      throw err
    }
    if (res.status === 401 || res.status === 403 || /API key not valid|API_KEY_INVALID|permission/i.test(msg)) throw fail('Gemini rejected the API key', 'auth')
    if (!res.ok || !j) throw fail(`Gemini error ${res.status}${msg ? `: ${msg}` : ''}`, 'provider')
    if (j.promptFeedback?.blockReason) throw fail(`Gemini blocked the request (${j.promptFeedback.blockReason})`, 'blocked')
    const cand = j.candidates?.[0]
    if (!cand || ['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT'].includes(cand.finishReason)) throw fail(`Gemini returned no answer (${cand?.finishReason ?? 'empty'})`, 'blocked')
    const text = (cand.content?.parts ?? []).map((p: any) => p.text ?? '').join('')
    try { return JSON.parse(text) } catch { throw fail('Gemini returned text that is not valid JSON', 'invalid_output') }
  }

  const p: AIProvider = {
    id: 'gemini', label: 'Google Gemini', model,
    configured: () => !!o.apiKey,
    async classifyDocument(input: ClassifyInput): Promise<ClassifyOutput> {
      const t0 = Date.now()
      if (!input.text.trim()) throw fail('No document text to classify (OCR found nothing)', 'invalid_output')
      const raw = await generate(SYSTEM_PROMPT, `OCR text of the document:\n"""\n${input.text.slice(0, 30_000)}\n"""\nReturn the JSON.`, RESPONSE_SCHEMA)
      try {
        const v = validateAiOutput(raw, input.text, 'gemini', model)
        return { ...v, ms: Date.now() - t0, model }
      } catch (e) { throw fail((e as Error).message, 'invalid_output') }
    },
    extractMetadata: input => p.classifyDocument(input),
    matchEntity: (name, candidates) => matchByName(name, candidates),
    async generateStructuredOutput(system, user, schema, validate) { return validate(await generate(system, user, schema)) },
    async healthCheck() {
      const t0 = Date.now()
      try {
        const r = await p.classifyDocument({ text: 'COMMERCIAL LICENSE\nLicense No: 123456\nTrade Name: SAMPLE TRADING LLC\nIssue Date: 13/05/2026\nExpiry Date: 12/05/2027' })
        const ok = r.extraction.docType === 'trade_license' && r.extraction.fields.expiry_date?.value === '2027-05-12'
        return { ok, message: ok ? `Connected (${model}) — sample trade licence classified correctly` : `Connected (${model}), but the sample was read as ${r.extraction.docType}`, ms: Date.now() - t0 }
      } catch (e) { return { ok: false, message: (e as Error).message, ms: Date.now() - t0 } }
    },
  }
  return p
}
