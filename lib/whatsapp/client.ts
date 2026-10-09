import { cloudApiPayload, renderText, type Params, type TemplateName } from './templates'

export interface WhatsAppConfig { phoneNumberId?: string; accessToken?: string; apiVersion: string; forceSandbox?: boolean }
export type SendResult = { ok: true; sandbox: boolean; messageId?: string } | { ok: false; retryable: boolean; error: string }

/** Graph API base (WHATSAPP_GRAPH_URL only for a local test stand-in). */
export const graphBase = () => (process.env.WHATSAPP_GRAPH_URL || 'https://graph.facebook.com').replace(/\/$/, '')
export const isConfigured = (c: WhatsAppConfig) => !!c.phoneNumberId && !!c.accessToken && !c.forceSandbox

/** Meta error codes that are worth retrying (throttling / transient). Everything else is permanent. */
const RETRYABLE_CODES = new Set([1, 2, 4, 17, 32, 613, 80007, 130429, 131016, 131048, 131056])
export function classifyMetaError(status: number, body: any): { retryable: boolean; error: string } {
  const e = body?.error ?? {}
  const code = Number(e.code)
  const msg = `${e.message ?? 'WhatsApp API error'}${e.code ? ` (code ${e.code}${e.error_subcode ? '/' + e.error_subcode : ''})` : ''} [HTTP ${status}]`
  return { retryable: status >= 500 || status === 429 || RETRYABLE_CODES.has(code), error: msg }
}

export async function sendWhatsApp(cfg: WhatsAppConfig, to: string, template: TemplateName, params: Params, fetchImpl: typeof fetch = fetch): Promise<SendResult> {
  if (!isConfigured(cfg)) {
    // SANDBOX: nothing leaves the system. Callers record this as "sandbox", never "sent/delivered".
    console.info(`[whatsapp:sandbox] to=${to.slice(0, 6)}… ${renderText(template, params).split('\n')[0]}`)
    return { ok: true, sandbox: true }
  }
  try {
    const res = await fetchImpl(`${graphBase()}/${cfg.apiVersion}/${cfg.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cloudApiPayload(template, params, to)),
      signal: AbortSignal.timeout(15_000),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, ...classifyMetaError(res.status, body) }
    return { ok: true, sandbox: false, messageId: body?.messages?.[0]?.id }
  } catch (e) {
    return { ok: false, retryable: true, error: `Network error: ${(e as Error).message}` }
  }
}

// ── Email (Resend). Sandbox when RESEND_API_KEY is absent. ──
export interface EmailConfig { apiKey?: string; from?: string }
export async function sendEmail(cfg: EmailConfig, to: string, subject: string, text: string, fetchImpl: typeof fetch = fetch): Promise<SendResult> {
  if (!cfg.apiKey || !cfg.from) { console.info(`[email:sandbox] to=${to} subject=${subject}`); return { ok: true, sandbox: true } }
  try {
    const res = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: cfg.from, to, subject, text }), signal: AbortSignal.timeout(15_000),
    })
    const body: any = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, retryable: res.status >= 500 || res.status === 429, error: `${body?.message ?? 'Email error'} [HTTP ${res.status}]` }
    return { ok: true, sandbox: false, messageId: body?.id }
  } catch (e) { return { ok: false, retryable: true, error: `Network error: ${(e as Error).message}` } }
}
