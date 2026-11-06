'use server'
import { randomBytes } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { getCtx, need } from '@/lib/auth'
import { demoGuard } from '@/lib/demo'
import { safe, str } from '@/lib/action'
import { createAdminClient } from '@/lib/supabase/admin'
import { auditAction } from '@/lib/security'
import { decryptSecret, encryptSecret } from '@/lib/crypto'
import { allowPrivate } from '@/lib/net-guard'
import { companyWhatsApp } from '@/lib/whatsapp/outbox'
import { INSTANCE_RE, normaliseUrl, serverUrlProblem } from '@/lib/whatsapp/evolution-core'
import { evoConnect, evoLogout, evoState } from '@/lib/whatsapp/evolution'
import type { ActionState } from '@/lib/utils'

// Settings → WhatsApp → Evolution API: server URL, instance, API key (encrypted), link the number by QR code.
type C = Awaited<ReturnType<typeof getCtx>>
const admin = () => createAdminClient()
async function setting(c: C, key: string, value: unknown) {
  const { error } = await c.supabase.from('app_settings').upsert({ company_id: c.company.id, key, value: value ?? false, updated_at: new Date().toISOString() }); if (error) throw error
}
async function guard() { const c = await getCtx(); demoGuard(c, 'the WhatsApp connection'); need(c, 'settings.manage'); return c }
const noKey = () => !process.env.SETTINGS_ENCRYPTION_KEY

/** The per-company secret Evolution sends back in a header on every webhook call (created once, encrypted at rest). */
async function webhookSecret(companyId: string): Promise<string> {
  const { data } = await admin().from('integration_secrets').select('ciphertext').eq('company_id', companyId).eq('name', 'evolution_webhook_secret').maybeSingle()
  if (data?.ciphertext) { try { return decryptSecret(data.ciphertext) } catch { /* key rotated → issue a new one */ } }
  const s = randomBytes(32).toString('hex')
  const { error } = await admin().from('integration_secrets').upsert({ company_id: companyId, name: 'evolution_webhook_secret', ciphertext: encryptSecret(s), updated_at: new Date().toISOString() }); if (error) throw error
  return s
}
const webhookUrl = (companyId: string) => {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/+$/, '')
  return base ? `${base}/api/webhooks/evolution/${companyId}` : null
}

export async function saveEvolution(_: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await guard()
    const use = fd.get('use_evolution') === 'on'
    const rawUrl = str(fd, 'evolution_url'), instance = str(fd, 'evolution_instance'), key = str(fd, 'evolution_key')
    const url = rawUrl ? normaliseUrl(rawUrl) : null
    if (url) { const bad = serverUrlProblem(url, allowPrivate()); if (bad) return { error: bad } }
    if (instance && !INSTANCE_RE.test(instance)) return { error: 'Instance name: 2–64 letters, digits, - or _ (e.g. alsaqr-main).' }
    if (key && (key.length < 8 || key.length > 200 || /\s/.test(key))) return { error: 'That does not look like an API key (8–200 characters, no spaces).' }
    if (use && (!url || !instance)) return { error: 'Enter the server URL and an instance name to use Evolution API.' }
    if (key && noKey()) return { error: 'Cannot store the API key: SETTINGS_ENCRYPTION_KEY is not set on the server.' }
    const { count } = await admin().from('integration_secrets').select('name', { count: 'exact', head: true }).eq('company_id', c.company.id).eq('name', 'evolution_api_key')
    if (use && !key && !count) return { error: 'Enter the API key (AUTHENTICATION_API_KEY of your Evolution API server).' }
    await Promise.all([setting(c, 'whatsapp.provider', use ? 'evolution' : 'meta'), setting(c, 'whatsapp.evolution_url', url), setting(c, 'whatsapp.evolution_instance', instance)])
    if (key) {
      const { error } = await admin().from('integration_secrets').upsert({ company_id: c.company.id, name: 'evolution_api_key', ciphertext: encryptSecret(key), updated_at: new Date().toISOString() }); if (error) throw error
      await auditAction(c.company.id, c.userId, 'SECRET_SET', 'integration_secrets', { name: 'evolution_api_key', hint: `…${key.slice(-4)}` })
    }
    await auditAction(c.company.id, c.userId, 'SETTINGS_CHANGED', 'app_settings', { whatsapp_provider: use ? 'evolution' : 'meta', evolution_url: url, evolution_instance: instance })
    revalidatePath('/settings'); revalidatePath('/reminders')
    return { ok: true, message: use ? 'Saved. WhatsApp messages now go through your Evolution API server. Link the number with “Link WhatsApp” if you have not yet.' : 'Saved. Evolution API is switched off; the Meta Cloud API settings below apply.' }
  })
}

/** Creates the instance if needed, points its webhook at Averiqo and returns a QR code (or "open" when already linked). */
export async function linkEvolution(): Promise<ActionState> {
  return safe(async () => {
    const c = await guard()
    const { cfg } = await companyWhatsApp(c.company.id)
    if (!cfg.evolution) return { error: 'Save the server URL, instance name and API key first.' }
    const hook = webhookUrl(c.company.id); if (!hook) return { error: 'NEXT_PUBLIC_APP_URL is not set on the server, so Evolution would not know where to send delivery receipts.' }
    const r = await evoConnect(cfg.evolution, hook, await webhookSecret(c.company.id))
    if ('error' in r) return { error: r.error }
    if (r.created) await auditAction(c.company.id, c.userId, 'SETTINGS_CHANGED', 'app_settings', { evolution_instance_created: cfg.evolution.instance })
    return { ok: true, data: { state: r.state, qr: r.qr ?? null, pairingCode: r.pairingCode ?? null }, message: r.state === 'open' ? 'WhatsApp is linked.' : 'Scan the QR code with WhatsApp on the phone.' }
  })
}

/** Polled while the QR code is on screen. */
export async function evolutionLinkState(): Promise<ActionState> {
  return safe(async () => {
    const c = await guard()
    const { cfg } = await companyWhatsApp(c.company.id)
    if (!cfg.evolution) return { error: 'Not configured.' }
    const r = await evoState(cfg.evolution)
    return 'error' in r ? { error: r.error } : { ok: true, data: { state: r.state } }
  })
}

export async function unlinkEvolution(): Promise<ActionState> {
  return safe(async () => {
    const c = await guard()
    const { cfg } = await companyWhatsApp(c.company.id)
    if (!cfg.evolution) return { error: 'Not configured.' }
    const r = await evoLogout(cfg.evolution); if ('error' in r) return { error: r.error }
    await auditAction(c.company.id, c.userId, 'SETTINGS_CHANGED', 'app_settings', { evolution_unlinked: cfg.evolution.instance })
    revalidatePath('/settings'); return { ok: true, message: 'The WhatsApp number was unlinked. Messages are not sent until you link a number again.' }
  })
}

export async function clearEvolutionKey(): Promise<ActionState> {
  return safe(async () => {
    const c = await guard()
    await admin().from('integration_secrets').delete().eq('company_id', c.company.id).in('name', ['evolution_api_key', 'evolution_webhook_secret'])
    await setting(c, 'whatsapp.provider', 'meta')
    await auditAction(c.company.id, c.userId, 'SECRET_REMOVED', 'integration_secrets', { name: 'evolution_api_key' })
    revalidatePath('/settings'); return { ok: true, message: 'API key removed and Evolution API switched off.' }
  })
}
