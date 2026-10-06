'use server'
import { revalidatePath } from 'next/cache'
import { getCtx } from '@/lib/auth'
import { safe } from '@/lib/action'
import type { ActionState } from '@/lib/utils'

export async function markAllRead(): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx()
    const { error } = await c.supabase.from('in_app_notifications').update({ read_at: new Date().toISOString() }).eq('user_id', c.userId).is('read_at', null)
    if (error) throw error
    revalidatePath('/', 'layout')
  })
}

export async function markRead(id: string): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx()
    const { error } = await c.supabase.from('in_app_notifications').update({ read_at: new Date().toISOString() }).eq('id', id).eq('user_id', c.userId)
    if (error) throw error
    revalidatePath('/', 'layout')
  })
}
