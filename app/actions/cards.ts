'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getCtx, need } from '@/lib/auth'
import { safe, str } from '@/lib/action'
import type { ActionState } from '@/lib/utils'

// Settings → Company cards. Only a name and the last four digits are kept: never a full card number.
const done = () => { revalidatePath('/settings'); revalidatePath('/me', 'layout') }

export async function addCompanyCard(_: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'settings.manage')
    const digits = (str(fd, 'last4') ?? '').replace(/\D/g, '')
    // someone typed more of the number: only the last four are kept, the rest is never stored
    const v = z.object({
      label: z.string().trim().min(1, 'Name the card (e.g. Company credit card)').max(60),
      last4: z.string().regex(/^\d{4}$/, 'Enter the last 4 digits of the card'),
      kind: z.enum(['credit', 'debit', 'prepaid']).default('credit'),
    }).safeParse({ label: str(fd, 'label'), last4: digits.slice(-4), kind: str(fd, 'kind') })
    if (!v.success) return { error: v.error.issues[0].message, fieldErrors: Object.fromEntries(v.error.issues.map(i => [i.path.join('.'), i.message])) }
    const { data: dup } = await c.supabase.from('company_cards').select('id').eq('last4', v.data.last4).eq('active', true).limit(1)
    if (dup?.length) return { error: `A card ending ${v.data.last4} is already listed.`, fieldErrors: { last4: 'Already listed' } }
    const { error } = await c.supabase.from('company_cards').insert({ ...v.data, company_id: c.company.id })
    if (error) throw error
    done(); return { ok: true, message: `Card ••${v.data.last4} added. Employees who pay by card now choose it.` }
  })
}

export async function setCompanyCardActive(id: string, active: boolean): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'settings.manage')
    z.string().uuid().parse(id)
    const { data, error } = await c.supabase.from('company_cards').update({ active }).eq('id', id).select('id')
    if (error) throw error
    if (!data?.length) return { error: 'Card not found.' }
    done(); return { ok: true, message: active ? 'Card switched back on.' : 'Card switched off. Past expenses keep it.' }
  })
}
