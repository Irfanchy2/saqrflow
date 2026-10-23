'use server'
import { revalidatePath } from 'next/cache'
import { getCtx } from '@/lib/auth'
import { safe } from '@/lib/action'
import { createAdminClient } from '@/lib/supabase/admin'
import { rateLimit } from '@/lib/security'
import type { ActionState } from '@/lib/utils'

/**
 * "Reset demo data" in the account menu: puts the shared demo company back to its sample data now, instead of waiting
 * for the nightly reset. Only the demo company (is_demo) can do this; the database functions refuse any other company.
 * The visitor stays signed in (profiles are kept). At most 3 resets per 10 minutes, since every visitor shares the demo.
 */
export async function resetDemoData(): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx()
    if (!c.company.is_demo) return { error: 'Only the shared demo can be reset.' }
    if (!(await rateLimit(`demo-reset:${c.company.id}`, 3, 600))) return { error: 'The demo was just reset. Try again in a few minutes.' }
    const admin = createAdminClient()
    const { error: we } = await admin.rpc('demo_wipe', { p_company: c.company.id }); if (we) throw we
    const { error: se } = await admin.rpc('demo_seed', { p_company: c.company.id }); if (se) throw se
    revalidatePath('/', 'layout')
    return { ok: true, message: 'Demo data restored.' }
  })
}
