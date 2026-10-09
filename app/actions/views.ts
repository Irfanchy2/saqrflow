'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getCtx } from '@/lib/auth'
import { safe, str } from '@/lib/action'
import type { ActionState } from '@/lib/utils'

const PAGE = /^\/[a-z0-9/-]{0,60}$/
/** keep only plain filter parameters; never paging or "open this record" state */
const cleanQuery = (q: string) => {
  const p = new URLSearchParams(q.replace(/^\?/, ''))
  for (const k of ['page', 'open', 'new']) p.delete(k)
  return p.toString().slice(0, 1000)
}

export async function saveView(page: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx()
    if (!PAGE.test(page)) return { error: 'Unknown page.' }
    const name = z.string().trim().min(1, 'Give the view a name').max(60).parse(str(fd, 'name') ?? '')
    const shared = fd.get('shared') === 'on'
    if (shared && !c.can('records.edit')) return { error: 'Only editors can share views with the team.' }
    const { error } = await c.supabase.from('saved_views').insert({ company_id: c.company.id, user_id: c.userId, page, name, query: cleanQuery(String(fd.get('query') ?? '')), shared })
    if (error) throw error
    revalidatePath(page); return { ok: true, message: `Saved “${name}”.` }
  })
}

export async function deleteView(id: string, page: string): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx()
    const { data, error } = await c.supabase.from('saved_views').delete().eq('id', id).select('id')
    if (error) throw error
    if (!data?.length) return { error: 'You can only remove your own views.' }
    if (PAGE.test(page)) revalidatePath(page)
    return { ok: true, message: 'View removed.' }
  })
}
