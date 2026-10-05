import 'server-only'
import { createAdminClient } from '../supabase/admin'
import { adminConfigured } from '../env'
import { parseSettings } from './settings'
import { isConfigured } from '../whatsapp/client'
import { loadWhatsAppConfig } from './engine'

export interface WaStatus { mode: 'live' | 'sandbox'; reason: string; hasToken: boolean; phoneNumberId: string | null; emailLive: boolean }
/** Tells the UI honestly whether WhatsApp messages would actually leave the system. Never exposes the token. */
export async function whatsappStatus(companyId: string): Promise<WaStatus> {
  const emailLive = !!process.env.RESEND_API_KEY && !!process.env.EMAIL_FROM
  if (!adminConfigured()) return { mode: 'sandbox', reason: 'SUPABASE_SERVICE_ROLE_KEY is not set on the server.', hasToken: false, phoneNumberId: null, emailLive }
  const admin = createAdminClient()
  const { data } = await admin.from('app_settings').select('key,value').eq('company_id', companyId)
  const s = parseSettings(data ?? [])
  const cfg = await loadWhatsAppConfig(admin, companyId, s)
  const live = isConfigured(cfg)
  return {
    mode: live ? 'live' : 'sandbox', hasToken: !!cfg.accessToken, phoneNumberId: cfg.phoneNumberId ?? null, emailLive,
    reason: live ? 'Credentials found. Messages are sent through the Meta WhatsApp Cloud API.'
      : s.whatsappMode === 'sandbox' ? 'Sandbox mode is switched on in Settings.' : !cfg.accessToken || !cfg.phoneNumberId ? 'WhatsApp credentials are not configured yet.' : 'Sandbox.',
  }
}
