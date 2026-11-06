import 'server-only'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { allowPrivate } from '../net-guard'
import type { SendResult } from './client'
import { classify, createPayload, documentPayload, errorText, isPrivateIp, parseConnect, serverUrlProblem, textPayload, webhookPayload, type EvolutionConfig } from './evolution-core'

// Evolution API v2 client. The API key goes in the `apikey` header and never leaves the server; the server URL is checked
// (https, public address) before every call so a stored URL can't be turned against internal services.
async function call(cfg: EvolutionConfig, method: string, path: string, body?: unknown, timeoutMs = 25_000): Promise<{ status: number; body: any }> {
  const bad = serverUrlProblem(cfg.url, allowPrivate()); if (bad) throw new Error(bad)
  const host = new URL(cfg.url).hostname.replace(/^\[|\]$/g, '')
  if (!allowPrivate()) {
    const address = isIP(host) ? host : (await lookup(host).catch(() => { throw new Error(`Could not resolve ${host}`) })).address
    if (isPrivateIp(address)) throw new Error('The Evolution API server resolves to a private network address.')
  }
  const res = await fetch(`${cfg.url}${path}`, {
    method, redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
    headers: { apikey: cfg.apiKey, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  return { status: res.status, body: await res.json().catch(() => ({})) }
}
const inst = (cfg: EvolutionConfig) => encodeURIComponent(cfg.instance)
const netErr = (e: unknown) => `Could not reach the Evolution API server: ${(e as Error).message}`

/** Plain text message; WhatsApp Web has no templates or 24-hour window, so any text can go at any time. */
export async function evoSendText(cfg: EvolutionConfig, to: string, text: string): Promise<SendResult> {
  try {
    const r = await call(cfg, 'POST', `/message/sendText/${inst(cfg)}`, textPayload(to, text))
    if (r.status >= 300) return { ok: false, ...classify(r.status, r.body) }
    return { ok: true, sandbox: false, messageId: r.body?.key?.id }
  } catch (e) { return { ok: false, retryable: true, error: netErr(e) } }
}

/** The PDF itself as a WhatsApp document, with the message as its caption. */
export async function evoSendDocument(cfg: EvolutionConfig, to: string, pdf: Uint8Array, fileName: string, caption?: string): Promise<SendResult> {
  try {
    const r = await call(cfg, 'POST', `/message/sendMedia/${inst(cfg)}`, documentPayload(to, Buffer.from(pdf).toString('base64'), fileName, caption), 60_000)
    if (r.status >= 300) return { ok: false, ...classify(r.status, r.body) }
    return { ok: true, sandbox: false, messageId: r.body?.key?.id }
  } catch (e) { return { ok: false, retryable: true, error: netErr(e) } }
}

export async function evoState(cfg: EvolutionConfig, timeoutMs = 15_000): Promise<{ state: string } | { error: string; missing?: boolean }> {
  try {
    const r = await call(cfg, 'GET', `/instance/connectionState/${inst(cfg)}`, undefined, timeoutMs)
    if (r.status === 404) return { error: `Instance “${cfg.instance}” does not exist on the server yet.`, missing: true }
    if (r.status >= 300) return { error: classify(r.status, r.body).error }
    return { state: String(r.body?.instance?.state ?? 'close') }
  } catch (e) { return { error: netErr(e) } }
}

/** Creates the instance when it does not exist yet (needs the server's global API key), then asks for a QR code. */
export async function evoConnect(cfg: EvolutionConfig, webhookUrl: string, secret: string): Promise<{ state: string; qr?: string; pairingCode?: string; created?: boolean } | { error: string }> {
  try {
    let created = false
    const st = await evoState(cfg)
    if ('error' in st && !st.missing) return st
    if ('error' in st) {
      const c = await call(cfg, 'POST', '/instance/create', createPayload(cfg.instance, webhookUrl, secret))
      if (c.status >= 300) return { error: `Could not create the instance: ${classify(c.status, c.body).error}` }
      created = true
      const q = parseConnect(c.body); if (q.qr || q.state === 'open') return { ...q, created }
    } else {
      const w = await call(cfg, 'POST', `/webhook/set/${inst(cfg)}`, webhookPayload(webhookUrl, secret))   // keep delivery receipts pointed at Averiqo
      if (w.status >= 300) return { error: `Could not set the webhook: ${errorText(w.body)} [HTTP ${w.status}]` }
      if (st.state === 'open') return { state: 'open' }
    }
    const r = await call(cfg, 'GET', `/instance/connect/${inst(cfg)}`)
    if (r.status >= 300) return { error: classify(r.status, r.body).error }
    return { ...parseConnect(r.body), created }
  } catch (e) { return { error: netErr(e) } }
}

/** Unlinks the WhatsApp number from the instance (the instance itself stays on the server). */
export async function evoLogout(cfg: EvolutionConfig): Promise<{ ok: true } | { error: string }> {
  try {
    const r = await call(cfg, 'DELETE', `/instance/logout/${inst(cfg)}`)
    if (r.status >= 300 && r.status !== 400) return { error: classify(r.status, r.body).error }   // 400: already logged out
    return { ok: true }
  } catch (e) { return { error: netErr(e) } }
}
