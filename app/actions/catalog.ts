'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getCtx, need } from '@/lib/auth'
import { safe, str } from '@/lib/action'
import type { ActionState } from '@/lib/utils'

const itemSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
  description: z.string().max(2000).optional(), unit: z.string().trim().min(1).max(20).default('Nos'),
  rate: z.coerce.number({ message: 'Rate must be a number' }).min(0, 'Rate cannot be negative').max(1e10).transform(n => Math.round(n * 100) / 100),
  vat_category: z.enum(['standard', 'zero', 'exempt', 'out_of_scope']).default('standard'),
  category: z.string().max(80).optional(), notes: z.string().max(1000).optional(),
})
const fieldErrors = (e: z.ZodError) => Object.fromEntries(e.issues.map(i => [i.path.join('.'), i.message]))

export async function saveCatalogItem(id: string | null, _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    const r = itemSchema.safeParse(Object.fromEntries(['name', 'description', 'unit', 'rate', 'vat_category', 'category', 'notes'].map(k => [k, str(fd, k)])))
    if (!r.success) return { error: r.error.issues[0].message, fieldErrors: fieldErrors(r.error) }
    const row = { ...r.data, description: r.data.description ?? null, category: r.data.category ?? null, notes: r.data.notes ?? null, updated_at: new Date().toISOString() }
    const { error } = id ? await c.supabase.from('catalog_items').update(row).eq('id', id) : await c.supabase.from('catalog_items').insert({ ...row, company_id: c.company.id, created_by: c.userId })
    if (error) { if (error.code === '23505') return { error: `“${r.data.name}” is already in the catalog.`, fieldErrors: { name: 'Already exists' } }; throw error }
    revalidatePath('/catalog'); return { ok: true, message: id ? 'Item updated.' : 'Item added.' }
  })
}
export async function setCatalogActive(id: string, active: boolean): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    const { error } = await c.supabase.from('catalog_items').update({ active, updated_at: new Date().toISOString() }).eq('id', id); if (error) throw error
    revalidatePath('/catalog'); return { ok: true, message: active ? 'Item restored.' : 'Item archived. No longer offered in the editor.' }
  })
}
/** Typical steel-fabrication services as a starting list — rate 0 until you set your own prices. */
export async function addStarterItems(): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    const names: [string, string, string][] = [['Steel Fabrication', 'Fabrication', 'Kg'], ['MS Handrail', 'Railings', 'Rmt'], ['Stainless Steel Railing', 'Railings', 'Rmt'], ['Glass Railing', 'Railings', 'Rmt'],
      ['Staircase', 'Structures', 'Nos'], ['Gate', 'Gates & doors', 'Nos'], ['Shed', 'Structures', 'Sq.Mtr'], ['Sandwich Panel', 'Cladding', 'Sq.Mtr'], ['Structural Steel', 'Structures', 'Ton'], ['Maintenance', 'Services', 'Job'], ['Custom Fabrication', 'Fabrication', 'L.S']]
    const { error } = await c.supabase.from('catalog_items').upsert(names.map(([name, category, unit]) => ({ company_id: c.company.id, name, category, unit, rate: 0, created_by: c.userId })), { onConflict: 'company_id,name', ignoreDuplicates: true })
    if (error) throw error
    revalidatePath('/catalog'); return { ok: true, message: 'Starter items added with rate 0. Edit each item to set your price.' }
  })
}

const lines = (s?: string) => (s ?? '').split('\n').map(x => x.trim()).filter(Boolean).slice(0, 60)
export async function saveTemplate(id: string | null, _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'settings.manage')
    const v = z.object({ name: z.string().trim().min(1, 'Name is required').max(120), kind: z.enum(['terms', 'payment']) }).safeParse({ name: str(fd, 'name'), kind: str(fd, 'kind') })
    if (!v.success) return { error: v.error.issues[0].message, fieldErrors: fieldErrors(v.error) }
    const ls = lines(str(fd, 'lines'))
    if (!ls.length) return { error: 'Add at least one clause (one per line).', fieldErrors: { lines: 'Required' } }
    const isDefault = fd.get('is_default') === 'on'
    if (isDefault) await c.supabase.from('terms_templates').update({ is_default: false }).eq('kind', v.data.kind)
    const row = { ...v.data, lines: ls, is_default: isDefault, updated_at: new Date().toISOString() }
    const { error } = id ? await c.supabase.from('terms_templates').update(row).eq('id', id) : await c.supabase.from('terms_templates').insert({ ...row, company_id: c.company.id })
    if (error) { if (error.code === '23505') return { error: 'A template with this name already exists.' }; throw error }
    revalidatePath('/settings'); return { ok: true, message: 'Template saved.' }
  })
}
export async function deleteTemplate(id: string): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'settings.manage')
    const { error } = await c.supabase.from('terms_templates').delete().eq('id', id); if (error) throw error
    revalidatePath('/settings'); return { ok: true, message: 'Template deleted.' }
  })
}
