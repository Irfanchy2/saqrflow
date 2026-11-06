// Evolution API (self-hosted WhatsApp Web gateway, github.com/EvolutionAPI/evolution-api, v2): pure helpers shared by the
// server client, the webhook route and the unit tests. Nothing here performs I/O.
import { isIP } from 'node:net'

export interface EvolutionConfig { url: string; apiKey: string; instance: string }

/** Evolution's message status (Baileys ack) → Averiqo delivery status. */
const STATUS: Record<string, string> = { ERROR: 'failed', PENDING: 'sent', SERVER_ACK: 'sent', DELIVERY_ACK: 'delivered', READ: 'read', PLAYED: 'read' }
export const mapStatus = (s: unknown): string | null => (typeof s === 'string' ? STATUS[s.toUpperCase()] ?? null : null)

export const INSTANCE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/
export const WEBHOOK_EVENTS = ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE']
export const SECRET_HEADER = 'x-averiqo-token'

/** Server URL as saved: https only (http only in local tests), no credentials, no path tricks, a public host. */
export function serverUrlProblem(raw: string, allowPrivate = false): string | null {
  let u: URL
  try { u = new URL(raw) } catch { return 'Enter the full server URL, e.g. https://wa.yourcompany.com' }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && allowPrivate)) return 'The Evolution API server URL must start with https:// (the API key is sent with every request).'
  if (u.username || u.password) return 'Do not put a username or password in the URL.'
  if (u.search || u.hash) return 'Enter the server URL only, without ?query or #fragment.'
  if (raw.length > 300) return 'The URL is too long.'
  const host = u.hostname.replace(/^\[|\]$/g, '')
  if (!allowPrivate && (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || (isIP(host) && isPrivateIp(host)))) return 'The server must be reachable on the public internet (Averiqo runs in the cloud).'
  return null
}
/** Trailing slashes off, so paths join cleanly. */
export const normaliseUrl = (raw: string) => raw.trim().replace(/\/+$/, '')

export function isPrivateIp(ip: string): boolean {
  const v = isIP(ip)
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number)
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224
  }
  if (v === 6) {
    const s = ip.toLowerCase()
    if (s === '::' || s === '::1') return true
    const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); if (mapped) return isPrivateIp(mapped[1])
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(s) || s.startsWith('64:ff9b:') || s.startsWith('2001:db8')
  }
  return true
}

/** E.164 (+971501234567) → the digits Evolution expects (971501234567). */
export const toNumber = (e164: string) => e164.replace(/\D/g, '')

export function textPayload(to: string, text: string) { return { number: toNumber(to), text, linkPreview: false } }
export function documentPayload(to: string, pdfBase64: string, fileName: string, caption?: string) {
  return { number: toNumber(to), mediatype: 'document', mimetype: 'application/pdf', fileName, media: pdfBase64, ...(caption ? { caption } : {}) }
}
export function webhookPayload(url: string, secret: string) {
  return { webhook: { enabled: true, url, headers: { [SECRET_HEADER]: secret }, byEvents: false, base64: false, events: WEBHOOK_EVENTS } }
}
export function createPayload(instance: string, webhookUrl: string, secret: string) {
  return { instanceName: instance, integration: 'WHATSAPP-BAILEYS', qrcode: true, ...webhookPayload(webhookUrl, secret) }
}

/** Evolution error bodies come in a few shapes ({ response: { message } }, { message }, { error }); flatten to one line. */
export function errorText(body: any): string {
  const m = body?.response?.message ?? body?.message ?? body?.error
  const flat = (x: any): string => Array.isArray(x) ? x.map(flat).filter(Boolean).join('; ')
    : x && typeof x === 'object' ? (x.exists === false ? `${x.number ?? 'This number'} is not on WhatsApp` : JSON.stringify(x)) : String(x ?? '')
  return flat(m).slice(0, 300) || 'Evolution API error'
}
/** Retry only what can get better on its own: server errors, rate limits, the phone being briefly offline. */
export function classify(status: number, body: any): { retryable: boolean; error: string } {
  const text = errorText(body)
  const notOnWa = /not on WhatsApp|exists"?:\s*false/i.test(text)
  const retryable = !notOnWa && (status >= 500 || status === 429 || status === 408 || /connection closed|not connected|timed? ?out/i.test(text))
  const hint = status === 401 || status === 403 ? ' Check the API key in Settings → WhatsApp.' : status === 404 ? ' Check the server URL and instance name.' : ''
  return { retryable, error: `${text}${hint} [HTTP ${status}]` }
}

/** QR / pairing answer of GET /instance/connect/{instance}, or the state when the number is already linked. */
export function parseConnect(body: any): { state: string; qr?: string; pairingCode?: string } {
  const state = body?.instance?.state ?? body?.instance?.status
  if (state === 'open') return { state: 'open' }
  const q = body?.qrcode ?? body
  const qr = typeof q?.base64 === 'string' && q.base64.startsWith('data:image/') ? q.base64 : undefined
  return { state: qr ? 'connecting' : (state ?? 'close'), qr, pairingCode: typeof q?.pairingCode === 'string' ? q.pairingCode : undefined }
}

/** A WhatsApp JID for a person (not a group / broadcast / LID) → +E.164. */
export function jidToE164(...jids: unknown[]): string | null {
  for (const j of jids) {
    const m = typeof j === 'string' ? j.match(/^(\d{8,15})(?::\d+)?@s\.whatsapp\.net$/) : null
    if (m) return `+${m[1]}`
  }
  return null
}
const textOf = (msg: any): string => String(msg?.conversation ?? msg?.extendedTextMessage?.text ?? msg?.buttonsResponseMessage?.selectedDisplayText ?? '')

export interface EvoStatus { id: string; status: string; error?: string }
export interface EvoInbound { from: string; text: string; at: string }
/** Webhook body (one event per POST, or an array when Evolution batches) → delivery receipts, inbound messages, link state. */
export function parseEvolutionWebhook(body: any): { instance: string | null; statuses: EvoStatus[]; inbound: EvoInbound[]; connection?: string } {
  const statuses: EvoStatus[] = [], inbound: EvoInbound[] = []
  const event = String(body?.event ?? '').toLowerCase().replace(/_/g, '.')
  const items = Array.isArray(body?.data) ? body.data : body?.data ? [body.data] : []
  let connection: string | undefined
  for (const d of items) {
    if (event === 'messages.update') {
      const id = d?.keyId ?? d?.key?.id, st = mapStatus(d?.status ?? d?.update?.status)
      if (typeof id === 'string' && st && (d?.fromMe ?? d?.key?.fromMe ?? true)) statuses.push({ id, status: st, ...(st === 'failed' ? { error: 'Delivery failed (reported by WhatsApp)' } : {}) })
    } else if (event === 'messages.upsert') {
      const k = d?.key ?? {}
      if (k.fromMe) continue
      const from = jidToE164(k.remoteJid, k.remoteJidAlt, k.senderPn, d?.senderPn); if (!from) continue
      const ts = Number(d?.messageTimestamp ?? 0)
      inbound.push({ from, text: textOf(d?.message), at: new Date(ts > 0 ? ts * 1000 : Date.now()).toISOString() })
    } else if (event === 'connection.update') {
      if (typeof d?.state === 'string') connection = d.state
    }
  }
  return { instance: typeof body?.instance === 'string' ? body.instance : null, statuses, inbound, connection }
}
