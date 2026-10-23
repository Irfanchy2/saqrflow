'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getCtx, need } from '@/lib/auth'
import { safe, str } from '@/lib/action'
import type { ActionState } from '@/lib/utils'

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date')
const uuid = z.string().uuid()
const aed = (msg: string) => z.coerce.number({ message: msg }).max(1e11).min(-1e11).transform(n => Math.round(n * 100) / 100)
const fieldErrors = (e: z.ZodError) => Object.fromEntries(e.issues.map(i => [i.path.join('.'), i.message]))
const done = () => { revalidatePath('/banking'); revalidatePath('/') }

const accountSchema = z.object({
  name: z.string().trim().min(1, 'Enter the bank (or "Petty cash")').max(120),
  account_display_name: z.string().trim().max(120).default(''),
  account_type: z.enum(['current', 'savings', 'cash', 'card', 'other']).default('current'),
  opening_balance: aed('Opening balance must be a number').default(0), opening_date: date.optional(), notes: z.string().max(1000).optional(),
})

/** Adds or edits one of the company's own accounts. A bank name already saved from a cheque becomes the account instead of a duplicate. */
export async function saveBankAccount(id: string | null, _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'finance.view'); need(c, 'cheques.manage')
    const r = accountSchema.safeParse(Object.fromEntries(['name', 'account_display_name', 'account_type', 'opening_balance', 'opening_date', 'notes'].map(k => [k, str(fd, k)])))
    if (!r.success) return { error: r.error.issues[0].message, fieldErrors: fieldErrors(r.error) }
    if (/\d{7,}/.test(r.data.account_display_name)) return { error: 'Use a label like “Current ••4417”. Never store full account numbers.', fieldErrors: { account_display_name: 'No full account numbers' } }
    const isDefault = fd.get('is_default') === 'on'
    const row = { ...r.data, opening_date: r.data.opening_date ?? null, notes: r.data.notes ?? null, is_account: true, active: true }
    if (isDefault) { const { error } = await c.supabase.from('banks').update({ is_default: false }).eq('is_default', true).neq('id', id ?? '00000000-0000-0000-0000-000000000000'); if (error) throw error }
    let targetId = id
    if (!targetId) {
      const { data: same } = await c.supabase.from('banks').select('id,is_account').eq('name', row.name).eq('account_display_name', row.account_display_name).maybeSingle()
      if (same?.is_account) return { error: 'This account already exists.', fieldErrors: { account_display_name: 'Already exists' } }
      targetId = same?.id ?? null
    }
    const { error } = targetId ? await c.supabase.from('banks').update({ ...row, is_default: isDefault }).eq('id', targetId)
      : await c.supabase.from('banks').insert({ ...row, is_default: isDefault, company_id: c.company.id })
    if (error) { if (error.code === '23505') return { error: 'An account with this bank and label already exists.' }; throw error }
    done(); return { ok: true, message: id ? 'Account updated.' : 'Account added.' }
  })
}

export async function setBankAccountActive(id: string, active: boolean): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'finance.view'); need(c, 'cheques.manage')
    const { error } = await c.supabase.from('banks').update(active ? { active } : { active, is_default: false }).eq('id', id).eq('is_account', true); if (error) throw error
    done(); return { ok: true, message: active ? 'Account reopened.' : 'Account closed. Its history and balance are kept.' }
  })
}

const IN = ['deposit', 'interest'], OUT = ['withdrawal', 'fee']
const txnSchema = z.object({
  bank_id: uuid, kind: z.enum(['deposit', 'withdrawal', 'fee', 'interest', 'adjustment']),
  amount: aed('Enter the amount').pipe(z.number().positive('Enter an amount greater than zero')),
  txn_date: date, description: z.string().trim().max(300).optional(), reference: z.string().trim().max(120).optional(), idempotency_key: uuid.optional(),
})

/** A deposit, withdrawal, bank fee, interest or correction entered by hand (money moved by payments, expenses and cheques posts by itself). */
export async function recordBankTxn(_: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'finance.view'); need(c, 'cheques.manage')
    const r = txnSchema.safeParse(Object.fromEntries(['bank_id', 'kind', 'amount', 'txn_date', 'description', 'reference', 'idempotency_key'].map(k => [k, str(fd, k)])))
    if (!r.success) return { error: r.error.issues[0].message, fieldErrors: fieldErrors(r.error) }
    const v = r.data
    if (v.txn_date > c.today) return { error: 'The date cannot be in the future.', fieldErrors: { txn_date: 'In the future' } }
    if (v.kind === 'adjustment' && !v.description) return { error: 'Say what the correction is for.', fieldErrors: { description: 'Required for a correction' } }
    const sign = OUT.includes(v.kind) || (v.kind === 'adjustment' && str(fd, 'direction') === 'out') ? -1 : 1
    const { error } = await c.supabase.from('bank_transactions').insert({ company_id: c.company.id, bank_id: v.bank_id, kind: v.kind, amount: sign * v.amount, txn_date: v.txn_date,
      description: v.description ?? null, reference: v.reference ?? null, idempotency_key: v.idempotency_key ?? null, created_by: c.userId })
    if (error) { if (error.code === '23505') return { ok: true, message: 'Already recorded.' }; throw error }
    done(); return { ok: true, message: `${IN.includes(v.kind) || sign > 0 ? 'Money in' : 'Money out'} recorded.` }
  })
}

/** Moves money between two of the company's accounts: both sides are written in one statement, so neither can exist alone. */
export async function transferBetweenAccounts(_: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'finance.view'); need(c, 'cheques.manage')
    const r = z.object({ from: uuid, to: uuid, amount: aed('Enter the amount').pipe(z.number().positive('Enter an amount greater than zero')), txn_date: date, description: z.string().trim().max(300).optional(), idempotency_key: uuid.optional() })
      .safeParse({ from: str(fd, 'from'), to: str(fd, 'to'), amount: str(fd, 'amount'), txn_date: str(fd, 'txn_date') ?? c.today, description: str(fd, 'description'), idempotency_key: str(fd, 'idempotency_key') })
    if (!r.success) return { error: r.error.issues[0].message, fieldErrors: fieldErrors(r.error) }
    const v = r.data
    if (v.from === v.to) return { error: 'Choose two different accounts.', fieldErrors: { to: 'Same as “from”' } }
    if (v.txn_date > c.today) return { error: 'The date cannot be in the future.', fieldErrors: { txn_date: 'In the future' } }
    const { data: accts } = await c.supabase.from('banks').select('id,name,account_display_name').in('id', [v.from, v.to]).eq('is_account', true)
    if ((accts ?? []).length !== 2) return { error: 'Account not found.' }
    const label = (id: string) => { const a = accts!.find(x => x.id === id)!; return [a.name, a.account_display_name].filter(Boolean).join(' · ') }
    const group = crypto.randomUUID(), base = { company_id: c.company.id, txn_date: v.txn_date, transfer_group: group, created_by: c.userId }
    const { error } = await c.supabase.from('bank_transactions').insert([
      { ...base, bank_id: v.from, kind: 'transfer_out', amount: -v.amount, description: v.description ?? `Transfer to ${label(v.to)}`, idempotency_key: v.idempotency_key ?? null },
      { ...base, bank_id: v.to, kind: 'transfer_in', amount: v.amount, description: v.description ?? `Transfer from ${label(v.from)}` },
    ])
    if (error) { if (error.code === '23505') return { ok: true, message: 'Already recorded.' }; throw error }
    done(); return { ok: true, message: `Moved AED ${v.amount.toFixed(2)} to ${label(v.to)}.` }
  })
}

/** Removes an entry made by hand (both sides of a transfer). Entries that come from payments, expenses or cheques are changed there. */
export async function deleteBankTxn(id: string): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'cheques.manage'); need(c, 'records.delete')
    const { data: t } = await c.supabase.from('bank_transactions').select('id,source_type,transfer_group').eq('id', id).maybeSingle()
    if (!t) return { error: 'Entry not found.' }
    if (t.source_type) return { error: 'This entry comes from a payment, expense or cheque. Change it there.' }
    const q = c.supabase.from('bank_transactions').delete()
    const { error } = t.transfer_group ? await q.eq('transfer_group', t.transfer_group) : await q.eq('id', id)
    if (error) throw error
    done(); return { ok: true, message: t.transfer_group ? 'Transfer removed from both accounts.' : 'Entry removed.' }
  })
}

export type AccountOpt = { id: string; label: string; is_default: boolean; account_type: string }
/** Open accounts for the "Deposited to" / "Paid from" pickers (empty without finance access). */
export async function listBankAccounts(): Promise<AccountOpt[]> {
  const c = await getCtx(); if (!c.can('finance.view')) return []
  const { data } = await c.supabase.from('banks').select('id,name,account_display_name,is_default,account_type').eq('is_account', true).eq('active', true).order('is_default', { ascending: false }).order('name')
  return (data ?? []).map(a => ({ id: a.id, label: [a.name, a.account_display_name].filter(Boolean).join(' · '), is_default: a.is_default, account_type: a.account_type }))
}
