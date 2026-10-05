import 'server-only'
import { createClient } from '@supabase/supabase-js'
import { supabaseSecretKey, supabaseUrl } from '../env'

/** Secret-key client: bypasses RLS. Only for cron, webhooks, signed URLs, invites – always after an explicit permission check. */
export function createAdminClient() {
  return createClient(supabaseUrl(), supabaseSecretKey(), { auth: { persistSession: false, autoRefreshToken: false } })
}
