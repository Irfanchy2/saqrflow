'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { getCtx, need } from '@/lib/auth'
import { safe } from '@/lib/action'
import type { ActionState } from '@/lib/utils'

const entity = z.enum(['customer', 'supplier', 'project', 'invoice', 'employee', 'asset', 'document'])
const LIST: Record<string, string> = { customer: '/parties', supplier: '/parties?tab=suppliers', project: '/projects', invoice: '/invoices', employee: '/employees', asset: '/assets', document: '/documents' }
const friendly = (m: string) =>
  /insufficient privilege/.test(m) ? 'You are not allowed to do that.' : /only draft or cancelled/.test(m) ? 'Only draft or cancelled sales documents can go to the trash.'
  : /has payments/.test(m) ? 'This document has payments and cannot be deleted.' : /not found/.test(m) ? 'Record not found (it may already be restored or deleted).'
  : /foreign key|still referenced|violates/.test(m) ? 'This record is still used by other records (e.g. invoices). Keep it in the trash or restore it.' : null

/** Soft delete: the record disappears from every list but stays restorable from Settings → Trash. */
export async function trashRecord(kind: string, id: string): Promise<ActionState> {
  const r = await safe(async () => {
    const c = await getCtx(); need(c, 'records.delete')
    const e = entity.parse(kind)
    const { error } = e === 'document'
      ? await c.supabase.from('documents').update({ deleted_at: new Date().toISOString() }).eq('id', id)
      : await c.supabase.rpc('soft_delete', { p_entity: e, p_id: id })
    if (error) return { error: friendly(error.message) ?? error.message }
    revalidatePath('/', 'layout')
  })
  if (r?.ok) redirect(LIST[kind] ?? '/')
  return r
}

export async function restoreRecord(kind: string, id: string): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.delete')
    const e = entity.parse(kind)
    const { error } = e === 'document'
      ? await c.supabase.from('documents').update({ deleted_at: null }).eq('id', id)
      : await c.supabase.rpc('restore_deleted', { p_entity: e, p_id: id })
    if (error) return { error: friendly(error.message) ?? error.message }
    revalidatePath('/', 'layout')
    return { ok: true, message: 'Restored.' }
  })
}

/** Permanent delete — owners / super admins only (records.purge), and only from the trash. */
export async function purgeRecord(kind: string, id: string): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.purge')
    const e = entity.exclude(['document']).parse(kind)
    const { error } = await c.supabase.rpc('purge_deleted', { p_entity: e, p_id: id })
    if (error) return { error: friendly(error.message) ?? error.message }
    revalidatePath('/trash')
    return { ok: true, message: 'Permanently deleted.' }
  })
}
