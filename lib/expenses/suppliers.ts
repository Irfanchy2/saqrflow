import 'server-only'
import type { Ctx } from '@/lib/auth'

// Linking expenses to suppliers, and the duplicate-bill check. Runs with the signed-in user's session (RLS).

const SUFFIX = /\b(l\.?\s?l\.?\s?c\.?|llc|est(ablishment)?|fz[ce]|fzco|fz-llc|co|company|ltd|limited|trading|tr|general|gen)\b/g
/** "AL FAHIM BUILDING MATERIALS L.L.C" and "Al Fahim Building Materials LLC" are the same supplier. */
export const normName = (s: string) => s.toLowerCase().replace(/[.,&'’]/g, ' ').replace(SUFFIX, ' ').replace(/[^a-z0-9؀-ۿ]+/g, '')
/** "INV-55821", "inv 55821" and "INV55821" are the same bill number. */
export const normRef = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^(invoice|inv|bill|receipt|no)+/, '')

export type SupplierHit = { id: string; name: string; trn: string | null; tally_ledger: string | null }

/** The saved supplier for a name / TRN from a receipt: same TRN first, then the same name ignoring LLC / Est / punctuation. */
export async function matchSupplier(c: Ctx, name: string | null, trn: string | null): Promise<SupplierHit | null> {
  if (trn && /^\d{15}$/.test(trn)) {
    const { data } = await c.supabase.from('suppliers').select('id,name,trn,tally_ledger').eq('trn', trn).is('deleted_at', null).limit(1)
    if (data?.[0]) return data[0]
  }
  const n = name ? normName(name) : ''
  if (n.length < 3) return null
  const word = name!.trim().split(/\s+/).find(w => w.replace(/\W/g, '').length >= 3)?.replace(/[%_,]/g, '') ?? name!.slice(0, 20)
  const { data } = await c.supabase.from('suppliers').select('id,name,trn,tally_ledger').ilike('name', `%${word}%`).is('deleted_at', null).limit(50)
  return (data ?? []).find(s => normName(s.name) === n) ?? null
}

/**
 * The supplier for an expense being saved: the chosen one (if it belongs to this company), else a match by TRN / name,
 * else a new supplier record with the name and TRN typed on the expense. Returns null when there is no supplier.
 */
export async function resolveSupplier(c: Ctx, v: { id?: string | null; name?: string | null; trn?: string | null }): Promise<SupplierHit | null> {
  if (v.id) {
    const { data } = await c.supabase.from('suppliers').select('id,name,trn,tally_ledger').eq('id', v.id).maybeSingle()
    if (data) {
      if (v.trn && !data.trn) await c.supabase.from('suppliers').update({ trn: v.trn }).eq('id', data.id)   // fill a missing TRN, never overwrite one
      return { ...data, trn: data.trn ?? v.trn ?? null }
    }
  }
  const name = v.name?.trim()
  if (!name) return null
  const hit = await matchSupplier(c, name, v.trn ?? null)
  if (hit) { if (v.trn && !hit.trn) await c.supabase.from('suppliers').update({ trn: v.trn }).eq('id', hit.id); return hit }
  const { data, error } = await c.supabase.from('suppliers').insert({ company_id: c.company.id, name: name.slice(0, 200), trn: v.trn ?? null }).select('id,name,trn,tally_ledger').single()
  if (error) {
    if (error.code === '23505') { const { data: d } = await c.supabase.from('suppliers').select('id,name,trn,tally_ledger').eq('name', name.slice(0, 200)).maybeSingle(); if (d) return d }
    throw error
  }
  return data
}

export type DuplicateHit = { id: string; spent_on: string; amount: number; vat_amount: number; reference: string; supplier_name: string | null }
/** An expense already saved with the same supplier and invoice number (ignoring case, spaces and dashes). */
export async function findDuplicate(c: Ctx, v: { supplierId: string | null; supplierName: string | null; reference: string | null; excludeId?: string | null }): Promise<DuplicateHit | null> {
  const ref = v.reference ? normRef(v.reference) : ''
  if (!ref || (!v.supplierId && !v.supplierName)) return null
  let q = c.supabase.from('project_expenses').select('id,spent_on,amount,vat_amount,reference,supplier_name,supplier_id').not('reference', 'is', null)
  q = v.supplierId ? q.or(`supplier_id.eq.${v.supplierId}${v.supplierName ? `,supplier_name.ilike.${v.supplierName.replace(/[%_,()*]/g, ' ').trim()}` : ''}`) : q.ilike('supplier_name', v.supplierName!.replace(/[%_,()*]/g, ' ').trim())
  if (v.excludeId) q = q.neq('id', v.excludeId)
  const { data } = await q.order('spent_on', { ascending: false }).limit(500)
  const hit = (data ?? []).find(r => normRef(r.reference ?? '') === ref)
  return hit ? { id: hit.id, spent_on: hit.spent_on, amount: Number(hit.amount), vat_amount: Number(hit.vat_amount), reference: hit.reference!, supplier_name: hit.supplier_name } : null
}
