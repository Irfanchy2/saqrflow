'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getCtx, need } from '@/lib/auth'
import { safe, str } from '@/lib/action'
import type { ActionState } from '@/lib/utils'

export async function savePublicForm(_: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'settings.manage')
    const v = z.object({
      slug: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{2,39}$/, 'Web address: 3–40 letters, digits or “-”'),
      title: z.string().trim().min(1, 'Title is required').max(120), intro: z.string().trim().max(1000).optional(),
      kind: z.enum(['enquiry', 'service_request']),
    }).parse({ slug: str(fd, 'slug') ?? '', title: str(fd, 'title') ?? '', intro: str(fd, 'intro'), kind: str(fd, 'kind') ?? 'enquiry' })
    const { count } = await c.supabase.from('public_forms').select('id', { count: 'exact', head: true })
    if ((count ?? 0) >= 10) return { error: 'Up to 10 public forms per company.' }
    const { error } = await c.supabase.from('public_forms').insert({ company_id: c.company.id, ...v, intro: v.intro ?? null, created_by: c.userId })
    if (error) { if (error.code === '23505') return { error: 'That web address is taken. Try another, e.g. your company name.' }; throw error }
    revalidatePath('/settings'); return { ok: true, message: `Form published at /f/${v.slug}.` }
  })
}

export async function setPublicFormEnabled(id: string, enabled: boolean): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'settings.manage')
    if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: 'Unknown form.' }
    const { error } = await c.supabase.from('public_forms').update({ enabled }).eq('id', id)
    if (error) throw error
    revalidatePath('/settings'); return { ok: true, message: enabled ? 'Form is live again.' : 'Form switched off. Its link shows “not available”.' }
  })
}
