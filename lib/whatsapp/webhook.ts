import { hmacSha256Hex, safeEqual } from '../crypto'

export function verifySignature(appSecret: string, rawBody: string, header: string | null): boolean {
  if (!header?.startsWith('sha256=')) return false
  return safeEqual(header.slice(7), hmacSha256Hex(appSecret, rawBody))
}

const RANK: Record<string, number> = { queued: 0, sending: 1, retry: 1, sent: 2, delivered: 3, read: 4 }
/** Delivery receipts can arrive out of order: never downgrade (read → delivered) and never override a terminal failure by a stale "sent". */
export function mergeStatus(current: string, incoming: string): string {
  if (incoming === 'failed') return ['delivered', 'read'].includes(current) ? current : 'failed'
  if (current === 'failed' && incoming !== 'failed') return RANK[incoming] >= 2 ? incoming : current
  return (RANK[incoming] ?? -1) > (RANK[current] ?? -1) ? incoming : current
}

export interface StatusEvent { id: string; status: string; timestamp?: string; error?: string }
export interface InboundMessage { from: string; text: string }
export function parseWebhook(body: any): { statuses: StatusEvent[]; messages: InboundMessage[] } {
  const statuses: StatusEvent[] = [], messages: InboundMessage[] = []
  for (const entry of body?.entry ?? []) for (const ch of entry?.changes ?? []) {
    for (const s of ch?.value?.statuses ?? []) statuses.push({
      id: s.id, status: s.status, timestamp: s.timestamp,
      error: s.errors?.[0] ? `${s.errors[0].title ?? s.errors[0].message ?? 'error'} (code ${s.errors[0].code})` : undefined,
    })
    for (const m of ch?.value?.messages ?? []) if (m?.type === 'text') messages.push({ from: `+${m.from}`, text: String(m.text?.body ?? '') })
  }
  return { statuses, messages }
}
/** STOP/UNSUBSCRIBE → opt out. START/YES → opt in (explicit consent). Anything else: ignore. */
export function optIntent(text: string): 'opt_out' | 'opt_in' | null {
  const t = text.trim().toLowerCase()
  if (['stop', 'unsubscribe', 'cancel', 'opt out', 'optout'].includes(t)) return 'opt_out'
  if (['start', 'yes', 'subscribe', 'opt in', 'optin'].includes(t)) return 'opt_in'
  return null
}
