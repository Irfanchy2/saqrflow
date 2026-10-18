import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from './supabase/admin'
import { adminConfigured } from './env'
import { DEMO_EMAIL, DEMO_PASSWORD, DemoBlockedError } from './demo-account'
import type { Ctx } from './auth'

export { DEMO_EMAIL, DEMO_PASSWORD, isDemoEmail, DemoBlockedError } from './demo-account'

/** Refuse something the shared demo must not do: send for real, change sign-in or users, publish to the internet. */
export function demoGuard(c: Pick<Ctx, 'company'>, what: string) { if (c.company.is_demo) throw new DemoBlockedError(what) }

const flags = new Map<string, { v: boolean; at: number }>()
/** Is this company the shared demo? Cached for 5 minutes per server instance. Used where there is no signed-in context (senders, secrets). */
export async function isDemoCompany(companyId: string | null | undefined): Promise<boolean> {
  if (!companyId || !adminConfigured()) return false
  const hit = flags.get(companyId)
  if (hit && Date.now() - hit.at < 300_000) return hit.v
  const { data, error } = await createAdminClient().from('companies').select('is_demo').eq('id', companyId).maybeSingle()
  if (error) return false
  const v = !!data?.is_demo
  flags.set(companyId, { v, at: Date.now() })
  return v
}

/** Put the demo sign-in back (password, email, no two-step) in case a visitor changed it. */
export async function repairDemoAuth(admin: SupabaseClient = createAdminClient()) {
  const { error } = await admin.rpc('demo_repair_auth', { p_email: DEMO_EMAIL, p_password: DEMO_PASSWORD })
  if (error) console.warn('[demo] repair', error.message)
}

/** Every file path under a folder of the private bucket (the storage API lists one level at a time). */
async function listAll(admin: SupabaseClient, prefix: string, out: string[] = [], depth = 0): Promise<string[]> {
  if (depth > 6 || out.length > 5000) return out
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await admin.storage.from('vault').list(prefix, { limit: 1000, offset })
    if (error || !data?.length) break
    for (const o of data) { const p = `${prefix}/${o.name}`; if (o.id) out.push(p); else await listAll(admin, p, out, depth + 1) }
    if (data.length < 1000) break
  }
  return out
}

/** Daily: remove visitors' files and changes, restore the sample data and the sign-in. Real companies are never touched. */
export async function resetDemo(admin: SupabaseClient = createAdminClient()) {
  const { data: demos } = await admin.from('companies').select('id').eq('is_demo', true)
  let files = 0
  for (const d of demos ?? []) {
    const paths = await listAll(admin, d.id)
    for (let i = 0; i < paths.length; i += 100) { const { error } = await admin.storage.from('vault').remove(paths.slice(i, i + 100)); if (!error) files += Math.min(100, paths.length - i) }
  }
  const { data: n, error } = await admin.rpc('demo_reset')
  if (error) throw error
  if (n) await repairDemoAuth(admin)
  return { demoCompanies: n ?? 0, demoFiles: files }
}
