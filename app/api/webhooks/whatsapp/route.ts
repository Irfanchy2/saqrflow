import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { mergeStatus, optIntent, parseWebhook, verifySignature } from '@/lib/whatsapp/webhook'
import { safeEqual } from '@/lib/crypto'
import { supabaseStore } from '@/lib/reminders/engine'
import type { LogRow, RecipientInfo } from '@/lib/reminders/dispatch'

export const dynamic = 'force-dynamic'

/** Meta webhook verification handshake. */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams, token = process.env.WHATSAPP_VERIFY_TOKEN
  if (token && q.get('hub.mode') === 'subscribe' && safeEqual(q.get('hub.verify_token') ?? '', token)) return new NextResponse(q.get('hub.challenge') ?? '', { status: 200 })
  return new NextResponse('Forbidden', { status: 403 })
}

/** Delivery receipts + inbound STOP/START. Unsigned or mis-signed requests are rejected. */
export async function POST(req: NextRequest) {
  const secret = process.env.META_APP_SECRET || process.env.WHATSAPP_APP_SECRET
  if (!secret) return new NextResponse('Webhook not configured', { status: 503 })
  const raw = await req.text()
  if (!verifySignature(secret, raw, req.headers.get('x-hub-signature-256'))) return new NextResponse('Invalid signature', { status: 401 })
  let body: unknown; try { body = JSON.parse(raw) } catch { return new NextResponse('Bad request', { status: 400 }) }
  const { statuses, messages, inbound } = parseWebhook(body)
  const admin = createAdminClient(), store = supabaseStore(admin)

  for (const s of statuses) {
    const { data: log } = await admin.from('notification_logs').select('*').eq('provider_message_id', s.id).maybeSingle()
    if (!log) continue                                                   // not ours / already purged
    const next = mergeStatus(log.status, s.status)
    if (next === log.status && !(s.status === 'failed' && !log.last_error)) continue
    const patch: Record<string, unknown> = { status: next }
    if (s.status === 'delivered' || s.status === 'read') patch.delivered_at = new Date(Number(s.timestamp ?? Date.now() / 1000) * 1000).toISOString()
    if (next === 'failed') patch.last_error = s.error ?? 'Delivery failed (reported by WhatsApp)'
    await admin.from('notification_logs').update(patch).eq('id', log.id)
    if (next === 'failed' && !log.fallback_of && log.recipient_id) {      // accepted by Meta but not deliverable → email fallback
      const { data: st } = await admin.from('app_settings').select('value').eq('company_id', log.company_id).eq('key', 'reminders.email_fallback').maybeSingle()
      const r = await store.recipient(log.recipient_id)
      if (st?.value !== false && r?.email) await store.enqueueEmailFallback(log as LogRow, r as RecipientInfo)
    }
  }
  for (const m of messages) {
    const intent = optIntent(m.text); if (!intent) continue
    await admin.from('notification_recipients').update(intent === 'opt_out' ? { whatsapp_opt_in: 'opted_out', opted_in_at: null } : { whatsapp_opt_in: 'opted_in', opted_in_at: new Date().toISOString() }).eq('whatsapp_number', m.from)
  }
  // customers / employees: remember the last inbound message per company number (24-hour window) and STOP / START consent
  const companyFor = new Map<string, string[]>()
  const companiesOf = async (pid: string | null) => {
    if (!pid) return []
    if (!companyFor.has(pid)) { const { data } = await admin.from('app_settings').select('company_id').eq('key', 'whatsapp.phone_number_id').eq('value', JSON.stringify(pid)); companyFor.set(pid, (data ?? []).map(r => r.company_id)) }
    return companyFor.get(pid)!
  }
  for (const m of inbound) {
    const intent = optIntent(messages.find(x => x.from === m.from)?.text ?? '')
    for (const cid of await companiesOf(m.phoneNumberId)) {
      await admin.from('whatsapp_contacts').upsert({ company_id: cid, phone: m.from, last_inbound_at: m.at,
        ...(intent === 'opt_out' ? { opted_out_at: new Date().toISOString() } : intent === 'opt_in' ? { opted_out_at: null, opted_in_at: new Date().toISOString() } : {}) }, { onConflict: 'company_id,phone' })
    }
  }
  return NextResponse.json({ ok: true })
}
