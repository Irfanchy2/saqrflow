import 'server-only'
import type { Ctx } from './auth'
import { addDays } from './time'
import { PAGE_SIZE, pageOf, sanitizeQ, type SP } from './queries'

export const DOC_SORTS = ['name', 'expiry_date', 'created_at', 'issue_date'] as const
export const DOC_COLS = 'id,name,reference_no,issuing_authority,issue_date,expiry_date,status,owner_type,owner_id,folder,deleted_at,created_at,current_version_id,category:document_categories(id,name),responsible:profiles!documents_responsible_user_id_fkey(full_name)'

export async function listDocs(c: Ctx, sp: SP, opts: { ownerTypes?: string[]; deleted?: boolean } = {}) {
  let q = c.supabase.from('documents').select(DOC_COLS, { count: 'exact' })
  q = opts.deleted ? q.not('deleted_at', 'is', null) : q.is('deleted_at', null)
  if (opts.ownerTypes) q = q.in('owner_type', opts.ownerTypes)
  const term = sanitizeQ(sp.q); if (term) q = q.or(`name.ilike.%${term}%,reference_no.ilike.%${term}%,issuing_authority.ilike.%${term}%`)
  if (sp.category) q = q.eq('category_id', sp.category)
  // owner=vehicle / owner=resource narrow asset documents by the asset's kind (reports split vehicles from equipment)
  if (sp.owner === 'vehicle' || sp.owner === 'resource') {
    const { data: ids } = await c.supabase.from('assets').select('id').eq('kind', 'vehicle').limit(5000)
    q = q.eq('owner_type', 'asset'); const list = (ids ?? []).map(r => r.id)
    q = sp.owner === 'vehicle' ? q.in('owner_id', list.length ? list : ['00000000-0000-0000-0000-000000000000']) : list.length ? q.not('owner_id', 'in', `(${list.join(',')})`) : q
  } else if (sp.owner) q = q.eq('owner_type', sp.owner)
  if (sp.employee) q = q.eq('owner_type', 'employee').eq('owner_id', sp.employee)
  if (sp.folder) q = q.eq('folder', sp.folder)
  // the same definitions as the dashboard counts and report_summary(): cancelled / archived papers never count as expiring
  const live = () => q.not('status', 'in', '(cancelled,archived)')
  const win = /^expiring(7|30|60|90)$/.exec(sp.status ?? '')
  if (win) q = live().gte('expiry_date', c.today).lte('expiry_date', addDays(c.today, Number(win[1])))
  switch (sp.status) {
    case 'expired': q = q.lt('expiry_date', c.today).not('status', 'in', '(cancelled,archived,renewal_in_progress)'); break
    case 'renewal': q = q.eq('status', 'renewal_in_progress'); break
    case 'expiring': q = live().gte('expiry_date', c.today).lte('expiry_date', addDays(c.today, 60)); break
    case 'valid': q = q.gt('expiry_date', addDays(c.today, 60)); break
    case 'none': q = q.is('expiry_date', null); break
  }
  const sort = (DOC_SORTS as readonly string[]).includes(sp.sort ?? '') ? sp.sort! : 'expiry_date'
  const page = pageOf(sp.page)
  const { data, count, error } = await q.order(sort, { ascending: sp.dir !== 'desc', nullsFirst: false }).range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
  if (error) throw error
  return { rows: (data ?? []) as any[], total: count ?? 0, page }
}
