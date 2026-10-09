'use server'
import { revalidatePath } from 'next/cache'
import { getCtx } from '@/lib/auth'
import { safe } from '@/lib/action'
import { normalizeLayout } from '@/lib/dashboard-widgets'
import type { ActionState } from '@/lib/utils'

/** Saves this user's dashboard layout (only their own row: RLS user_id = auth.uid()). `null` resets to the default. */
export async function saveDashboardLayout(layout: unknown): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx()
    if (layout === null) {
      const { error } = await c.supabase.from('user_preferences').delete().eq('user_id', c.userId).eq('key', 'dashboard.layout')
      if (error) throw error
    } else {
      const { error } = await c.supabase.from('user_preferences').upsert({ user_id: c.userId, key: 'dashboard.layout', value: normalizeLayout(layout), updated_at: new Date().toISOString() })
      if (error) throw error
    }
    revalidatePath('/'); return { ok: true, message: layout === null ? 'Dashboard reset.' : 'Dashboard saved.' }
  })
}
