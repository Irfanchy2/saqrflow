import 'server-only'
import type { Ctx } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { normName, normRef, type DuplicateHit, type SupplierHit } from './suppliers'

// Supplier memory for employee expense claims. Employees cannot read the company's supplier list (RLS), so a supplier and
// its TRN typed once come back from the employee's own earlier claims; a scanned receipt is also matched against the
// company's saved suppliers on the server (only that one supplier's name and TRN are returned, never the list).

/** The employee's own suppliers (from their claims), each with the latest TRN they entered for it. */
export async function claimSuppliers(c: Ctx, employeeId: string): Promise<{ id: string; name: string; trn: string | null }[]> {
  const { data } = await c.supabase.from('expense_claims').select('supplier_name,supplier_trn,created_at').eq('employee_id', employeeId)
    .not('supplier_name', 'is', null).order('created_at', { ascending: false }).limit(1000)
  const seen = new Map<string, { id: string; name: string; trn: string | null }>()
  for (const r of data ?? []) {
    const k = normName(r.supplier_name!); if (!k) continue
    const cur = seen.get(k)
    if (!cur) seen.set(k, { id: '', name: r.supplier_name!, trn: r.supplier_trn ?? null })
    else if (!cur.trn && r.supplier_trn) cur.trn = r.supplier_trn
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** The supplier on a scanned receipt: the employee's own earlier claims first, then the company's saved suppliers. */
export async function matchClaimSupplier(c: Ctx, employeeId: string, name: string | null, trn: string | null): Promise<SupplierHit | null> {
  const n = name ? normName(name) : '', t = trn && /^\d{15}$/.test(trn) ? trn : null
  if (!t && n.length < 3) return null
  const own = await claimSuppliers(c, employeeId)
  const mine = own.find(s => (t && s.trn === t) || (n.length >= 3 && normName(s.name) === n))
  if (mine && (mine.trn || !t)) return { id: '', name: mine.name, trn: mine.trn ?? t, tally_ledger: null }
  const admin = createAdminClient()
  if (t) {
    const { data } = await admin.from('suppliers').select('name,trn').eq('company_id', c.company.id).eq('trn', t).is('deleted_at', null).limit(1)
    if (data?.[0]) return { id: '', name: data[0].name, trn: data[0].trn, tally_ledger: null }
  }
  if (n.length >= 3) {
    const word = name!.trim().split(/\s+/).find(w => w.replace(/\W/g, '').length >= 3)?.replace(/[%_,]/g, '') ?? name!.slice(0, 20)
    const { data } = await admin.from('suppliers').select('name,trn').eq('company_id', c.company.id).ilike('name', `%${word}%`).is('deleted_at', null).limit(50)
    const hit = (data ?? []).find(s => normName(s.name) === n)
    if (hit) return { id: '', name: hit.name, trn: hit.trn ?? t, tally_ledger: null }
  }
  return mine ? { id: '', name: mine.name, trn: mine.trn ?? t, tally_ledger: null } : null
}

/** The employee already claimed this receipt number (not withdrawn or rejected). */
export async function findClaimDuplicate(c: Ctx, employeeId: string, reference: string | null): Promise<DuplicateHit | null> {
  const ref = reference ? normRef(reference) : ''
  if (!ref) return null
  const { data } = await c.supabase.from('expense_claims').select('id,spent_on,amount,vat_amount,reference,supplier_name').eq('employee_id', employeeId)
    .not('reference', 'is', null).not('status', 'in', '(withdrawn,rejected)').limit(2000)
  const hit = (data ?? []).find(r => normRef(r.reference ?? '') === ref)
  return hit ? { id: hit.id, spent_on: hit.spent_on, amount: Number(hit.amount), vat_amount: Number(hit.vat_amount), reference: hit.reference!, supplier_name: hit.supplier_name } : null
}
