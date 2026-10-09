import 'server-only'
import { classifyMetaError, graphBase, isConfigured, type SendResult, type WhatsAppConfig } from './client'
import { KINDS, metaName, toMetaBody } from './messages'

// WhatsApp Business Cloud API (Graph API): media upload, template and in-window messages, phone number info and template
// management. The access token never leaves the server; WHATSAPP_GRAPH_URL only exists so tests can use a local stand-in.
const url = (cfg: WhatsAppConfig, path: string) => `${graphBase()}/${cfg.apiVersion}/${path}`
const auth = (cfg: WhatsAppConfig) => ({ Authorization: `Bearer ${cfg.accessToken}` })

async function call(cfg: WhatsAppConfig, path: string, init: RequestInit = {}) {
  const res = await fetch(url(cfg, path), { ...init, headers: { ...auth(cfg), ...(init.headers ?? {}) }, signal: AbortSignal.timeout(20_000) })
  const body: any = await res.json().catch(() => ({}))
  return { res, body }
}

/** Uploads a PDF to WhatsApp (media id is valid for 30 days) and returns its id. */
export async function uploadMedia(cfg: WhatsAppConfig, bytes: Uint8Array, filename: string): Promise<{ id: string } | { error: string; retryable: boolean }> {
  const form = new FormData()
  form.set('messaging_product', 'whatsapp'); form.set('type', 'application/pdf')
  form.set('file', new Blob([bytes as BlobPart], { type: 'application/pdf' }), filename)
  try {
    const { res, body } = await call(cfg, `${cfg.phoneNumberId}/media`, { method: 'POST', body: form })
    if (!res.ok || !body?.id) return classifyMetaError(res.status, body)
    return { id: body.id }
  } catch (e) { return { error: `Network error: ${(e as Error).message}`, retryable: true } }
}

export interface OutMessage { to: string; kind: string; language: string; order: string[]; values: Record<string, string>; doc?: { id: string; filename: string }; freeText?: string }

/** Template message (works any time) or, inside the 24-hour window, a free-form document / text message. */
export function messagePayload(m: OutMessage) {
  const to = m.to.replace(/^\+/, '')
  if (m.freeText !== undefined) {
    return m.doc ? { messaging_product: 'whatsapp', to, type: 'document', document: { id: m.doc.id, filename: m.doc.filename, caption: m.freeText } }
      : { messaging_product: 'whatsapp', to, type: 'text', text: { body: m.freeText, preview_url: false } }
  }
  const components: any[] = []
  if (m.doc) components.push({ type: 'header', parameters: [{ type: 'document', document: { id: m.doc.id, filename: m.doc.filename } }] })
  if (m.order.length) components.push({ type: 'body', parameters: m.order.map(v => ({ type: 'text', text: m.values[v] ?? '-' })) })
  return { messaging_product: 'whatsapp', to, type: 'template', template: { name: metaName(m.kind), language: { code: m.language }, components } }
}

export async function sendMessage(cfg: WhatsAppConfig, m: OutMessage): Promise<SendResult> {
  if (!isConfigured(cfg)) return { ok: true, sandbox: true }
  try {
    const { res, body } = await call(cfg, `${cfg.phoneNumberId}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(messagePayload(m)) })
    if (!res.ok) return { ok: false, ...classifyMetaError(res.status, body) }
    return { ok: true, sandbox: false, messageId: body?.messages?.[0]?.id }
  } catch (e) { return { ok: false, retryable: true, error: `Network error: ${(e as Error).message}` } }
}

/** "Test connection": the business number and display name Meta has for this phone number id. */
export async function phoneInfo(cfg: WhatsAppConfig): Promise<{ number: string; name: string; quality?: string } | { error: string }> {
  if (!isConfigured(cfg)) return { error: 'Add the phone number id and access token first (or switch off sandbox mode).' }
  try {
    const { res, body } = await call(cfg, `${cfg.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`)
    if (!res.ok) return { error: classifyMetaError(res.status, body).error }
    return { number: body.display_phone_number, name: body.verified_name, quality: body.quality_rating }
  } catch (e) { return { error: `Network error: ${(e as Error).message}` } }
}

export type MetaTemplate = { id: string; name: string; status: string; language: string; body?: string; rejected_reason?: string }
export async function listTemplates(cfg: WhatsAppConfig, wabaId: string): Promise<MetaTemplate[] | { error: string }> {
  try {
    const { res, body } = await call(cfg, `${wabaId}/message_templates?fields=id,name,status,language,components,rejected_reason&limit=200`)
    if (!res.ok) return { error: classifyMetaError(res.status, body).error }
    return (body?.data ?? []).filter((t: any) => String(t.name).startsWith('averiqo_')).map((t: any) => ({
      id: t.id, name: t.name, status: t.status, language: t.language, rejected_reason: t.rejected_reason && t.rejected_reason !== 'NONE' ? t.rejected_reason : undefined,
      body: (t.components ?? []).find((c: any) => c.type === 'BODY')?.text,
    }))
  } catch (e) { return { error: `Network error: ${(e as Error).message}` } }
}

/** A document header needs an example file: Meta's resumable upload (app id + the same token) returns its handle. */
async function exampleHandle(cfg: WhatsAppConfig, appId: string, bytes: Uint8Array): Promise<string | { error: string }> {
  const start = await call(cfg, `${appId}/uploads?file_length=${bytes.length}&file_type=application/pdf&file_name=example.pdf`, { method: 'POST' })
  if (!start.res.ok || !start.body?.id) return { error: classifyMetaError(start.res.status, start.body).error }
  const up = await fetch(url(cfg, start.body.id), { method: 'POST', headers: { Authorization: `OAuth ${cfg.accessToken}`, file_offset: '0' }, body: bytes as BodyInit, signal: AbortSignal.timeout(30_000) })
  const ub: any = await up.json().catch(() => ({}))
  if (!up.ok || !ub?.h) return { error: classifyMetaError(up.status, ub).error }
  return ub.h
}

/** Creates averiqo_<kind> (or edits it when it already exists). Meta reviews it; status comes back as PENDING. */
export async function submitTemplate(cfg: WhatsAppConfig, o: { wabaId: string; appId?: string; kind: string; body: string; language: string; existingId?: string; examplePdf?: Uint8Array }): Promise<{ id: string; status: string } | { error: string }> {
  const def = KINDS[o.kind]; if (!def) return { error: 'Unknown message type.' }
  const { text, order } = toMetaBody(o.kind, o.body)
  const components: any[] = []
  if (def.pdf) {
    if (!o.appId || !o.examplePdf) return { error: 'Templates with a PDF need your Meta App ID (Settings → WhatsApp) for the example document.' }
    const h = await exampleHandle(cfg, o.appId, o.examplePdf); if (typeof h !== 'string') return h
    components.push({ type: 'HEADER', format: 'DOCUMENT', example: { header_handle: [h] } })
  }
  components.push({ type: 'BODY', text, ...(order.length ? { example: { body_text: [order.map(v => def.sample[v] ?? 'example')] } } : {}) })
  try {
    const { res, body } = o.existingId
      ? await call(cfg, o.existingId, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ components }) })
      : await call(cfg, `${o.wabaId}/message_templates`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: metaName(o.kind), language: o.language, category: 'UTILITY', components }) })
    if (!res.ok) return { error: classifyMetaError(res.status, body).error }
    return { id: body.id ?? o.existingId, status: body.status ?? 'PENDING' }
  } catch (e) { return { error: `Network error: ${(e as Error).message}` } }
}
