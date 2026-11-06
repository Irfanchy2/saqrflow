import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { decryptSecret, safeEqual } from '@/lib/crypto'
import { securityEvent } from '@/lib/security'
import { mergeStatus, optIntent } from '@/lib/whatsapp/webhook'
import { SECRET_HEADER, parseEvolutionWebhook } from '@/lib/whatsapp/evolution-core'

export const dynamic = 'force-dynamic'

/**
 * Evolution API webhook for one company: delivery receipts (messages.update), inbound messages for STOP / START
 * (messages.upsert). Evolution sends the per-company secret Averiqo configured in the x-averiqo-token header; anything
 * without it is rejected. Updates are always scoped to this company.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ company: string }> }) {
  const { company } = await params
  if (!/^[0-9a-f-]{36}$/i.test(company)) return new NextResponse('Not found', { status: 404 })
  const admin = createAdminClient()
  const [{ data: sec }, { data: st }] = await Promise.all([
    admin.from('integration_secrets').select('ciphertext').eq('company_id', company).eq('name', 'evolution_webhook_secret').maybeSingle(),
    admin.from('app_settings').select('key,value').eq('company_id', company).in('key', ['whatsapp.provider', 'whatsapp.evolution_instance']),
  ])
  let secret: string | null = null
  try { secret = sec?.ciphertext ? decryptSecret(sec.ciphertext) : null } catch { secret = null }
  const given = req.headers.get(SECRET_HEADER) ?? ''
  if (!secret || !given || !safeEqual(given, secret)) {
    await securityEvent('webhook_signature_rejected', { companyId: secret ? company : null, detail: `Evolution webhook with ${given ? 'a wrong' : 'no'} token` })
    return new NextResponse('Unauthorized', { status: 401 })
  }
  const raw = await req.text(); if (raw.length > 2_000_000) return new NextResponse('Too large', { status: 413 })
  let body: unknown; try { body = JSON.parse(raw) } catch { return new NextResponse('Bad request', { status: 400 }) }
  const set = Object.fromEntries((st ?? []).map(r => [r.key, r.value]))
  const ev = parseEvolutionWebhook(body)
  if (set['whatsapp.provider'] !== 'evolution' || (ev.instance && ev.instance !== set['whatsapp.evolution_instance'])) return NextResponse.json({ ok: true, ignored: true })

  for (const s of ev.statuses) {
    const { data: log } = await admin.from('notification_logs').select('id,status,last_error,record_type,record_id').eq('company_id', company).eq('provider_message_id', s.id).maybeSingle()
    if (!log) continue
    const next = mergeStatus(log.status, s.status)
    if (next === log.status) continue
    const patch: Record<string, unknown> = { status: next }
    if (s.status === 'delivered' || s.status === 'read') patch.delivered_at = new Date().toISOString()
    if (next === 'failed') patch.last_error = s.error ?? 'Delivery failed (reported by WhatsApp)'
    await admin.from('notification_logs').update(patch).eq('id', log.id).eq('company_id', company)
    if (s.status === 'read' && log.record_type === 'invoice' && log.record_id)   // a tax invoice read on WhatsApp counts as viewed
      await admin.from('invoices').update({ viewed_at: patch.delivered_at as string }).eq('id', log.record_id).eq('company_id', company).eq('doc_type', 'invoice').is('viewed_at', null)
  }
  for (const m of ev.inbound) {
    const intent = optIntent(m.text)
    await admin.from('whatsapp_contacts').upsert({ company_id: company, phone: m.from, last_inbound_at: m.at,
      ...(intent === 'opt_out' ? { opted_out_at: new Date().toISOString() } : intent === 'opt_in' ? { opted_out_at: null, opted_in_at: new Date().toISOString() } : {}) }, { onConflict: 'company_id,phone' })
    if (intent) await admin.from('notification_recipients').update(intent === 'opt_out' ? { whatsapp_opt_in: 'opted_out', opted_in_at: null } : { whatsapp_opt_in: 'opted_in', opted_in_at: new Date().toISOString() }).eq('company_id', company).eq('whatsapp_number', m.from)
  }
  return NextResponse.json({ ok: true })
}
