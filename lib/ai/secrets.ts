import 'server-only'
import { createAdminClient } from '../supabase/admin'
import { adminConfigured } from '../env'
import { decryptSecret, encryptSecret } from '../crypto'

/** Integration credentials. An environment variable wins; otherwise a key saved (AES-GCM encrypted) from Settings is used. */
export const SECRETS = {
  ocr_space_api_key: { env: 'OCR_SPACE_API_KEY', label: 'OCR.Space API key' },
  gemini_api_key: { env: 'GEMINI_API_KEY', label: 'Gemini API key' },
  google_vision_api_key: { env: 'GOOGLE_VISION_API_KEY', label: 'Google Vision API key' },
  google_service_account: { env: 'GOOGLE_SERVICE_ACCOUNT_JSON', label: 'Google service account (JSON)' },
} as const
export type SecretName = keyof typeof SECRETS

const cache = new Map<string, { v: string | null; at: number }>()
export async function getSecret(companyId: string | null, name: SecretName): Promise<string | null> {
  const env = process.env[SECRETS[name].env]
  if (env && env.trim()) return env.trim()
  if (!companyId || !adminConfigured() || !process.env.SETTINGS_ENCRYPTION_KEY) return null
  const k = `${companyId}:${name}`, hit = cache.get(k)
  if (hit && Date.now() - hit.at < 60_000) return hit.v
  const { data } = await createAdminClient().from('integration_secrets').select('ciphertext').eq('company_id', companyId).eq('name', name).maybeSingle()
  let v: string | null = null
  if (data?.ciphertext) { try { v = decryptSecret(data.ciphertext) } catch { v = null } }
  cache.set(k, { v, at: Date.now() })
  return v
}
export async function saveSecret(companyId: string, name: SecretName, value: string | null) {
  const admin = createAdminClient()
  cache.delete(`${companyId}:${name}`)
  if (!value) { await admin.from('integration_secrets').delete().eq('company_id', companyId).eq('name', name); return }
  const { error } = await admin.from('integration_secrets').upsert({ company_id: companyId, name, ciphertext: encryptSecret(value), updated_at: new Date().toISOString() })
  if (error) throw error
}
/** "••••••••xyz7" — never more than the last 4 characters. */
export function mask(v: string | null | undefined): string | null {
  if (!v) return null
  const t = v.trim()
  return t.length <= 8 ? '••••••••' : `••••••••${t.slice(-4)}`
}
export function secretSource(name: SecretName): 'env' | 'settings' {
  return process.env[SECRETS[name].env]?.trim() ? 'env' : 'settings'
}
