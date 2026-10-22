'use client'
import { useEffect, useState } from 'react'
import { Field, Select } from '@/components/ui/primitives'
import { listBankAccounts, type AccountOpt } from '@/app/actions/banking'

let cache: Promise<AccountOpt[]> | null = null   // one request per page view, shared by every form on it

/**
 * "Deposited to" / "Paid from": the company's own accounts. Picking one posts the amount to that account's ledger.
 * Renders only a hidden field (keeping `value`) while loading or when the company has no accounts yet.
 */
export function AccountSelect({ name, label, value, className }: { name: 'deposit_bank_id' | 'paid_from_bank_id'; label: string; value?: string | null; className?: string }) {
  const [accts, setAccts] = useState<AccountOpt[] | null>(null)
  useEffect(() => { let live = true; (cache ??= listBankAccounts().catch(() => { cache = null; return [] })).then(a => { if (live) setAccts(a) }); return () => { live = false } }, [])
  if (!accts?.length) return <input type="hidden" name={name} value={value ?? ''} />
  const initial = value === undefined ? accts.find(a => a.is_default)?.id ?? '' : value ?? ''
  return <Field label={label} hint="Updates that account's balance" className={className}>
    <Select name={name} defaultValue={initial}><option value="">— Not in an account —</option>{accts.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}</Select></Field>
}
