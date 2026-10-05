import 'server-only'
import { createClient } from '@supabase/supabase-js'

/** Service-role client: bypasses RLS. Only for cron, webhooks, signed URLs, invites – always after an explicit permission check. */
export function createAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } })
}
