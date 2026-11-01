import 'server-only'
import type { Ctx } from './auth'
import type { PettyEntry } from './petty-math'

// Reads for Employee Petty Cash. Every read goes through the caller's own session: RLS (migration 0037) keeps an employee
// to their own wallet and everyone inside their company. Petty cash never reads or writes salary data.

export const ENTRY_COLS = 'id,book,kind,reverses_kind,amount,entry_date,created_at,description,reference,method,bank_id,project_id,claim_id,request_id,reverses_id,document_id,notes,project:projects(name),bank:banks(name,account_display_name),creator:profiles!petty_cash_entries_created_by_fkey(full_name)'
export const REQUEST_COLS = 'id,employee_id,kind,status,amount,entry_date,method,counterparty,project_id,purpose,reference,notes,document_id,decision_note,decided_at,entry_id,linked,created_at,updated_at,project:projects(name),decider:profiles!petty_cash_requests_decided_by_fkey(full_name)'

export type WalletRow = {
  employee_id: string; available: number; received: number; settled: number; returned: number; adjusted: number; reimbursement_due: number; reimbursed: number
  pending_received: number; pending_returns: number; pending_requests: number; pending_expenses: number; pending_claims: number; awaiting_settlement: number; last_entry: string | null
}
const num = (r: any): WalletRow => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, k === 'employee_id' || k === 'last_entry' ? v : Number(v ?? 0)])) as WalletRow
export const emptyWallet = (employee_id: string): WalletRow => ({ employee_id, available: 0, received: 0, settled: 0, returned: 0, adjusted: 0, reimbursement_due: 0, reimbursed: 0,
  pending_received: 0, pending_returns: 0, pending_requests: 0, pending_expenses: 0, pending_claims: 0, awaiting_settlement: 0, last_entry: null })

export async function wallets(c: Ctx): Promise<WalletRow[]> {
  const { data } = await c.supabase.from('petty_cash_wallets').select('*').limit(5000)
  return (data ?? []).map(num)
}

/** One employee's wallet: totals, every ledger row, their reports, and approved claims still waiting for settlement. */
export async function walletOf(c: Ctx, employeeId: string) {
  const [{ data: emp }, { data: w }, { data: entries }, { data: requests }, { data: awaiting }] = await Promise.all([
    c.supabase.from('employees').select('id,full_name,employee_no,designation,phone,whatsapp,user_id').eq('id', employeeId).maybeSingle(),
    c.supabase.from('petty_cash_wallets').select('*').eq('employee_id', employeeId).maybeSingle(),
    c.supabase.from('petty_cash_entries').select(ENTRY_COLS).eq('employee_id', employeeId).order('entry_date').order('created_at').limit(5000),
    c.supabase.from('petty_cash_requests').select(REQUEST_COLS).eq('employee_id', employeeId).order('created_at', { ascending: false }).limit(500),
    c.supabase.from('expense_claim_settlement').select('claim_id,funded_by,total,from_petty_cash,to_reimburse,unsettled').eq('employee_id', employeeId).eq('status', 'approved').gt('unsettled', 0).limit(500),
  ])
  if (!emp) return null
  const claimIds = (awaiting ?? []).map(a => a.claim_id)
  const { data: claims } = claimIds.length ? await c.supabase.from('expense_claims').select('id,spent_on,description,supplier_name,reference,category,project:projects(name)').in('id', claimIds) : { data: [] as any[] }
  return {
    emp, wallet: w ? num(w) : emptyWallet(employeeId),
    entries: (entries ?? []) as unknown as (PettyEntry & { notes: string | null; bank_id: string | null; request_id: string | null; bank: { name: string; account_display_name: string | null } | null; creator: { full_name: string } | null })[],
    requests: (requests ?? []) as any[],
    awaiting: (awaiting ?? []).map(a => ({ ...a, total: Number(a.total), unsettled: Number(a.unsettled), from_petty_cash: Number(a.from_petty_cash), to_reimburse: Number(a.to_reimburse),
      claim: (claims ?? []).find((x: any) => x.id === a.claim_id) as any })),
  }
}
export type Wallet = NonNullable<Awaited<ReturnType<typeof walletOf>>>

/** Who may manage petty cash: the same rule as petty_can_manage() in the database. */
export const canManagePetty = (c: Ctx) => c.can('expenses.approve') || c.can('approvals.decide')
