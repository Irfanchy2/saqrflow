import 'server-only'
import type { Ctx } from '@/lib/auth'
import { DEFAULT_TALLY, TALLY_VERSIONS, type ExportExpense, type TallySettings } from './tally'

export interface ExportFilters { from?: string; to?: string; supplier?: string; category?: string; status?: 'ready' | 'exported' | 'all' }
const ISO = /^\d{4}-\d{2}-\d{2}$/, UUID = /^[0-9a-f-]{36}$/
const CATS = ['material', 'labour', 'transport', 'fuel', 'equipment', 'subcontract', 'accommodation', 'food', 'maintenance', 'other']

/** Filters from a query string / form, keeping only well-formed values. */
export function readFilters(sp: Record<string, string | undefined>): ExportFilters {
  return {
    from: sp.from && ISO.test(sp.from) ? sp.from : undefined, to: sp.to && ISO.test(sp.to) ? sp.to : undefined,
    supplier: sp.supplier && UUID.test(sp.supplier) ? sp.supplier : undefined, category: sp.category && CATS.includes(sp.category) ? sp.category : undefined,
    status: sp.status === 'exported' || sp.status === 'all' ? sp.status : 'ready',
  }
}

export async function loadTallySettings(c: Ctx): Promise<TallySettings> {
  const { data } = await c.supabase.from('expense_tally_settings').select('*').maybeSingle()
  if (!data) return DEFAULT_TALLY
  const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, string> : {})
  return {
    tally_company: data.tally_company, tally_version: (TALLY_VERSIONS as readonly string[]).includes(data.tally_version) ? data.tally_version : 'TallyPrime',
    paid_mode: data.paid_mode === 'purchase_and_payment' ? 'purchase_and_payment' : 'payment',
    category_ledgers: obj(data.category_ledgers), vat_ledger: data.vat_ledger, payment_ledgers: obj(data.payment_ledgers), bank_ledgers: obj(data.bank_ledgers),
    validated_version: data.validated_version, validated_at: data.validated_at,
  }
}

/** Expenses for the export screen / file, newest last (Tally imports in date order). At most 5,000 per file. */
export async function loadExportRows(c: Ctx, f: ExportFilters, limit = 5000): Promise<ExportExpense[]> {
  let q = c.supabase.from('project_expenses').select('id,spent_on,category,description,amount,vat_amount,reference,supplier_name,supplier_trn,payment_method,payment_status,paid_from_bank_id,payment_ref,verified_at,approval_status,export_batch_id,supplier:suppliers(tally_ledger,trn),project:projects(name),bank:banks!project_expenses_paid_from_bank_id_fkey(name,account_display_name)')
  if (f.from) q = q.gte('spent_on', f.from)
  if (f.to) q = q.lte('spent_on', f.to)
  if (f.supplier) q = q.eq('supplier_id', f.supplier)
  if (f.category) q = q.eq('category', f.category)
  if (f.status === 'ready') q = q.is('export_batch_id', null)
  else if (f.status === 'exported') q = q.not('export_batch_id', 'is', null)
  const { data, error } = await q.order('spent_on').order('created_at').limit(limit)
  if (error) throw error
  return (data ?? []).map((e: any) => ({
    id: e.id, spent_on: e.spent_on, category: e.category, description: e.description, amount: Number(e.amount), vat_amount: Number(e.vat_amount),
    reference: e.reference, supplier_name: e.supplier_name, supplier_ledger: e.supplier?.tally_ledger ?? null, supplier_trn: e.supplier_trn ?? e.supplier?.trn ?? null,
    payment_method: e.payment_method, payment_status: e.payment_status === 'unpaid' ? 'unpaid' : 'paid', paid_from_bank_id: e.paid_from_bank_id,
    bank_label: e.bank ? [e.bank.name, e.bank.account_display_name].filter(Boolean).join(' ') : null, payment_ref: e.payment_ref, project_name: e.project?.name ?? null,
    verified_at: e.verified_at, approval_status: e.approval_status, export_batch_id: e.export_batch_id,
  }))
}
