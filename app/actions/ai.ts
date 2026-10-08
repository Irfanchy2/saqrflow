'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getCtx, need } from '@/lib/auth'
import { safe, str } from '@/lib/action'
import { saveSecret, SECRETS, type SecretName } from '@/lib/ai/secrets'
import { isOcrMode, ocrProviders } from '@/lib/ai/ocr'
import { parseServiceAccount } from '@/lib/ai/ocr/google-vision'
import { aiProviders, isAiMode } from '@/lib/ai/llm'
import { createAdminClient } from '@/lib/supabase/admin'
import { documentParams } from '@/lib/whatsapp/templates'
import { makeSenders, supabaseStore } from '@/lib/reminders/engine'
import { processBatch } from '@/lib/reminders/dispatch'
import { addDays } from '@/lib/time'
import { aiSearch, type SearchAnswer } from '@/lib/ai/search'
import type { ActionState } from '@/lib/utils'

const setting = (companyId: string, key: string, value: unknown) => ({ company_id: companyId, key, value, updated_at: new Date().toISOString() })

/** Settings → AI & Automation. API keys are write-only: encrypted at rest, never shown again (only ••••1234). */
export async function saveAiSettings(_: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'settings.manage')
    const ocr = str(fd, 'ocr_provider'), ai = str(fd, 'ai_provider')
    if (!isOcrMode(ocr) || !isAiMode(ai)) return { error: 'Choose an OCR and an AI provider.' }
    const { error } = await c.supabase.from('app_settings').upsert([
      setting(c.company.id, 'ocr.provider', ocr), setting(c.company.id, 'ai.provider', ai), setting(c.company.id, 'ai.redact_ids', fd.get('redact') === 'on'),
    ])
    if (error) throw error
    const secrets: [SecretName, string | undefined][] = [
      ['ocr_space_api_key', str(fd, 'ocr_space_api_key')], ['gemini_api_key', str(fd, 'gemini_api_key')],
      ['google_vision_api_key', str(fd, 'google_vision_api_key')], ['google_service_account', str(fd, 'google_service_account')],
    ]
    const given = secrets.filter(([, v]) => v)
    if (given.length && !process.env.SETTINGS_ENCRYPTION_KEY) return { error: 'Provider choice saved, but keys cannot be stored: SETTINGS_ENCRYPTION_KEY is not set on the server. Add the keys as environment variables instead (see .env.example).' }
    for (const [name, v] of given) {
      if (name === 'google_service_account' && !parseServiceAccount(v)) return { error: 'The Google service account must be the JSON key file (with client_email and private_key).' }
      if (name !== 'google_service_account' && !/^[\w\-.]{8,200}$/.test(v!)) return { error: `${SECRETS[name].label} does not look like a valid key.` }
      await saveSecret(c.company.id, name, v!.trim())
    }
    revalidatePath('/settings'); revalidatePath('/inbox')
    return { ok: true, message: given.length ? `Saved. ${given.length} key(s) encrypted. They will never be displayed again.` : 'Saved.' }
  })
}

export async function clearAiSecret(name: string): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'settings.manage')
    const n = z.enum(Object.keys(SECRETS) as [SecretName, ...SecretName[]]).parse(name)
    await saveSecret(c.company.id, n, null)
    revalidatePath('/settings'); return { ok: true, message: `${SECRETS[n].label} removed.` }
  })
}

/** Real round-trip to the provider with a built-in test image (no customer data). */
export async function testOcrProvider(provider: string): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'settings.manage')
    const id = z.enum(['google_vision', 'ocrspace', 'tesseract']).parse(provider)
    const p = (await ocrProviders(c.company.id))[id]
    if (!p.configured()) return { error: `${p.label} is not configured.` }
    const r = await p.healthCheck()
    await c.supabase.from('ocr_logs').insert({ company_id: c.company.id, created_by: c.userId, provider: id, ok: r.ok, processing_ms: r.ms, error: r.ok ? null : r.message.slice(0, 300) })
    revalidatePath('/settings')
    return r.ok ? { ok: true, message: `${p.label}: ${r.message} (${(r.ms / 1000).toFixed(1)}s)` } : { error: `${p.label}: ${r.message}` }
  })
}

export async function testAiProvider(provider: string): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'settings.manage')
    const id = z.enum(['gemini', 'claude']).parse(provider)
    const p = (await aiProviders(c.company.id))[id]
    if (!p.configured()) return { error: `${p.label} is not configured.` }
    const r = await p.healthCheck()
    if (id === 'gemini') await c.supabase.from('ai_processing_logs').insert({ company_id: c.company.id, created_by: c.userId, provider: id, model: p.model, purpose: 'test', ok: r.ok, processing_ms: r.ms, error: r.ok ? null : r.message.slice(0, 300) })
    revalidatePath('/settings')
    return r.ok ? { ok: true, message: `${p.label}: ${r.message}` } : { error: `${p.label}: ${r.message}` }
  })
}

/** A realistic (fictional) document reminder through the real notification pipeline — no ID numbers, no files. */
export async function sendTestReminder(_: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'settings.manage')
    const rid = z.string().uuid({ message: 'Choose a recipient' }).parse(str(fd, 'recipient_id'))
    const { data: r } = await c.supabase.from('notification_recipients').select('id,whatsapp_number,whatsapp_opt_in').eq('id', rid).maybeSingle()
    if (!r) return { error: 'Recipient not found.' }
    if (!r.whatsapp_number || r.whatsapp_opt_in !== 'opted_in') return { error: 'This recipient has no WhatsApp number or has not opted in (Reminders → Recipients).' }
    const admin = createAdminClient()
    const params = { ...documentParams({ title: 'Residence Visa (TEST)', subject: 'Sample Employee', expiry: addDays(c.today, 15), daysRemaining: 15 }), _link: '/reminders', _title: 'Averiqo test reminder' }
    const { data: log, error } = await admin.from('notification_logs').insert({ company_id: c.company.id, recipient_id: rid, channel: 'whatsapp', template: 'document_reminder', params, dedupe_key: `test:${crypto.randomUUID()}`, source_type: 'test' }).select('id').single()
    if (error) throw error
    await processBatch(supabaseStore(admin), makeSenders(admin), { tz: c.company.timezone, emailFallback: false })
    const { data: res } = await admin.from('notification_logs').select('status,last_error').eq('id', log.id).single()
    revalidatePath('/reminders')
    if (res?.status === 'sandbox') return { ok: true, message: 'SANDBOX: logged only: WhatsApp credentials are not configured (or sandbox mode is on).' }
    if (res?.status === 'sent') return { ok: true, message: 'Accepted by WhatsApp. Delivery status will appear in the notification log.' }
    if (res?.status === 'queued') return { ok: true, message: 'Held for quiet hours; it will be sent when they end.' }
    return { error: `Not sent (${res?.status}): ${res?.last_error ?? 'unknown reason'}` }
  })
}

export async function runAiSearch(_: unknown, fd: FormData): Promise<SearchAnswer | { error: string }> {
  try {
    const c = await getCtx()
    const q = (str(fd, 'q') ?? '').slice(0, 300)
    if (q.length < 3) return { error: 'Type a question, e.g. “Which documents expire within 60 days?”' }
    return await aiSearch(c, q)
  } catch (e) { return { error: (e as Error).message } }
}
