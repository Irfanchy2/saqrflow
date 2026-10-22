import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowRightLeft, Archive, ArchiveRestore, Cardholder, Pencil, Plus, Trash2, Wallet } from '@/components/icons'
import { getCtx } from '@/lib/auth'
import { PAGE_SIZE, flat, pageOf } from '@/lib/queries'
import { Badge, Card, EmptyState, Field, Input, PageHeader, Pagination, Select, Td, Th, TableWrap, Textarea, type Tone } from '@/components/ui/primitives'
import { DialogButton } from '@/components/ui/dialog'
import { ActionButton, ActionForm } from '@/components/ui/action-form'
import { deleteBankTxn, recordBankTxn, saveBankAccount, setBankAccountActive, transferBetweenAccounts } from '@/app/actions/banking'
import { fmtMoney } from '@/lib/sales/money'
import { cn } from '@/lib/utils'

export const metadata = { title: 'Bank Accounts' }
const TYPES: Record<string, string> = { current: 'Current account', savings: 'Savings', cash: 'Cash', card: 'Card', other: 'Other' }
const KIND: Record<string, [string, Tone]> = {
  payment_in: ['Payment received', 'green'], expense_out: ['Expense', 'neutral'], cheque_out: ['Cheque cleared', 'neutral'], deposit: ['Deposit', 'green'], withdrawal: ['Withdrawal', 'neutral'],
  transfer_in: ['Transfer in', 'blue'], transfer_out: ['Transfer out', 'blue'], fee: ['Bank fee', 'amber'], interest: ['Interest', 'green'], adjustment: ['Correction', 'amber'],
}
const SOURCE: Record<string, string> = { payment: '/invoices?tab=payments', expense: '/expenses', cheque: '/cheques' }
type Acct = { id: string; name: string; account_display_name: string | null; account_type: string; is_default: boolean; active: boolean; opening_balance: number; opening_date: string | null; balance: number; txn_count: number; last_txn: string | null; notes?: string | null }
const label = (a: Pick<Acct, 'name' | 'account_display_name'>) => [a.name, a.account_display_name].filter(Boolean).join(' · ')

function AccountFields({ a, banks }: { a?: Acct; banks: string[] }) {
  return <>
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Bank *" hint="For cash in the office, enter “Petty cash” and choose Cash."><Input name="name" required maxLength={120} list="bank-names" defaultValue={a?.name} placeholder="e.g. Emirates NBD" /></Field>
      <Field label="Label" hint="e.g. “Current ••4417”. Never the full account number."><Input name="account_display_name" maxLength={120} defaultValue={a?.account_display_name ?? ''} /></Field>
      <Field label="Type *"><Select name="account_type" defaultValue={a?.account_type ?? 'current'}>{Object.entries(TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
      <Field label="Opening balance (AED)" hint="The balance on the opening date. Everything after it is added from payments, expenses and entries."><Input name="opening_balance" type="number" step="0.01" defaultValue={a ? Number(a.opening_balance) : ''} /></Field>
      <Field label="Opening date"><Input name="opening_date" type="date" defaultValue={a?.opening_date ?? ''} /></Field>
      <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" name="is_default" defaultChecked={a?.is_default} className="h-4 w-4" />Default account for new payments</label>
    </div>
    <Field label="Notes"><Textarea name="notes" rows={2} maxLength={1000} defaultValue={a?.notes ?? ''} /></Field>
    <datalist id="bank-names">{banks.map(b => <option key={b} value={b} />)}</datalist>
  </>
}

export default async function Banking({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await getCtx(); if (!c.can('finance.view')) redirect('/')
  const sp = await flat(searchParams), page = pageOf(sp.page), manage = c.can('cheques.manage'), canDelete = manage && c.can('records.delete')
  const [{ data: accts }, { data: names }] = await Promise.all([
    c.supabase.from('bank_balances').select('*').order('is_default', { ascending: false }).order('name'),
    c.supabase.from('banks').select('name').eq('is_account', false).order('name').limit(500),
  ])
  const all = (accts ?? []) as Acct[], open = all.filter(a => a.active), shown = sp.closed === '1' ? all : open
  const total = open.reduce((s, a) => s + Number(a.balance), 0), cash = open.filter(a => a.account_type === 'cash').reduce((s, a) => s + Number(a.balance), 0)
  const acct = sp.acct && all.some(a => a.id === sp.acct) ? sp.acct : undefined
  let q = c.supabase.from('bank_transactions').select('id,bank_id,kind,amount,txn_date,description,reference,source_type,transfer_group,profiles:created_by(full_name)', { count: 'exact' })
  if (acct) q = q.eq('bank_id', acct)
  if (sp.from) q = q.gte('txn_date', sp.from); if (sp.to) q = q.lte('txn_date', sp.to)
  const { data: rows, count } = await q.order('txn_date', { ascending: false }).order('created_at', { ascending: false }).range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
  const byId = new Map(all.map(a => [a.id, a]))
  const opts = open.map(a => <option key={a.id} value={a.id}>{label(a)}</option>)
  const banks = [...new Set((names ?? []).map(n => n.name))]
  const cls = 'h-9 rounded-md border border-border bg-surface px-3 text-sm'

  return <>
    <PageHeader title="Bank Accounts" sub="Balances of your bank accounts and cash. Payments, expenses and cleared cheques post here when you choose the account."
      actions={manage && <>
        {open.length > 1 && <DialogButton wide variant="secondary" label="Transfer" title="Move money between accounts" icon={<ArrowRightLeft size={14} />}><ActionForm idempotent action={transferBetweenAccounts} submit="Transfer">
          <div className="grid gap-4 sm:grid-cols-2"><Field label="From *"><Select name="from" required defaultValue="">{[<option key="" value="" disabled>Choose…</option>, ...opts]}</Select></Field>
            <Field label="To *"><Select name="to" required defaultValue="">{[<option key="" value="" disabled>Choose…</option>, ...opts]}</Select></Field>
            <Field label="Amount (AED) *"><Input name="amount" type="number" step="0.01" min="0.01" required /></Field><Field label="Date *"><Input name="txn_date" type="date" required defaultValue={c.today} max={c.today} /></Field></div>
          <Field label="Description"><Input name="description" maxLength={300} placeholder="e.g. Cash deposited at branch" /></Field></ActionForm></DialogButton>}
        {open.length > 0 && <DialogButton wide variant="secondary" label="Record entry" title="Deposit, withdrawal, fee or correction" icon={<Plus size={14} />}><ActionForm idempotent action={recordBankTxn} submit="Save entry">
          <div className="grid gap-4 sm:grid-cols-2"><Field label="Account *"><Select name="bank_id" required defaultValue={acct ?? open.find(a => a.is_default)?.id ?? ''}>{opts}</Select></Field>
            <Field label="Type *"><Select name="kind" defaultValue="deposit"><option value="deposit">Deposit (money in)</option><option value="withdrawal">Withdrawal (money out)</option><option value="fee">Bank fee / charge (out)</option><option value="interest">Interest / profit (in)</option><option value="adjustment">Correction</option></Select></Field>
            <Field label="Correction direction" hint="Only for a correction."><Select name="direction" defaultValue="in"><option value="in">Add to the balance</option><option value="out">Take from the balance</option></Select></Field>
            <Field label="Amount (AED) *"><Input name="amount" type="number" step="0.01" min="0.01" required /></Field>
            <Field label="Date *"><Input name="txn_date" type="date" required defaultValue={c.today} max={c.today} /></Field>
            <Field label="Reference"><Input name="reference" maxLength={120} /></Field></div>
          <Field label="Description"><Input name="description" maxLength={300} placeholder="e.g. Owner capital injection" /></Field></ActionForm></DialogButton>}
        <DialogButton wide label="Add account" title="Add a bank account or cash" icon={<Plus size={15} />} openParam="bank_account"><ActionForm action={saveBankAccount.bind(null, null)} submit="Add account"><AccountFields banks={banks} /></ActionForm></DialogButton></>} />

    {!all.length ? <Card><EmptyState icon={Cardholder} title="No accounts yet" body="Add each bank account (and petty cash) with its balance on a date. From then on, payments you deposit, expenses you pay and cheques that clear update the balance by themselves. Nothing that is already recorded is changed." /></Card> : <>
      <section aria-label="Accounts" className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="relative overflow-hidden rounded-2xl bg-ink p-5 text-ink-fg shadow-card">
          <div className="text-[13px] text-ink-fg/70">Cash on hand</div>
          <div className="mt-2 text-[30px] font-semibold leading-none tracking-[-0.03em] tabular-nums"><span className="me-1 text-[15px] font-medium text-ink-fg/60">AED</span>{fmtMoney(total)}</div>
          <div className="mt-3 text-[12.5px] text-ink-fg/70">{open.length} account{open.length === 1 ? '' : 's'}{cash ? ` · AED ${fmtMoney(cash)} in cash` : ''}</div>
          <Wallet size={84} aria-hidden className="pointer-events-none absolute -bottom-4 -end-3 text-ink-fg/[.07]" />
        </div>
        {shown.map(a => { const b = Number(a.balance)
          return <Card key={a.id} className={cn('relative p-5 transition-shadow hover:shadow-pop', acct === a.id && 'ring-2 ring-primary/50', !a.active && 'opacity-60')}>
            <Link href={acct === a.id ? '/banking' : `/banking?acct=${a.id}`} className="absolute inset-0 rounded-xl" aria-label={`Show entries of ${label(a)}`} />
            <div className="flex items-start justify-between gap-2"><div className="min-w-0"><div className="truncate font-medium">{a.name}</div><div className="truncate text-xs text-muted">{a.account_display_name || TYPES[a.account_type]}</div></div>
              <div className="flex shrink-0 gap-1">{a.is_default && <Badge tone="blue">Default</Badge>}{!a.active && <Badge>Closed</Badge>}{a.account_type === 'cash' && <Badge tone="green">Cash</Badge>}</div></div>
            <div className={cn('mt-4 text-[22px] font-semibold tabular-nums tracking-[-0.02em]', b < 0 && 'text-danger')}><span className="me-1 text-[13px] font-medium text-muted">AED</span>{fmtMoney(b)}</div>
            <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted"><span>{a.txn_count ? `${a.txn_count} entr${a.txn_count === 1 ? 'y' : 'ies'} · last ${a.last_txn}` : `Opening balance${a.opening_date ? ` on ${a.opening_date}` : ''}`}</span>
              {manage && <span className="relative z-[1] flex gap-0.5">
                <DialogButton wide size="sm" variant="ghost" label={<><Pencil size={13} /><span className="sr-only">Edit {label(a)}</span></>} title={`Edit ${label(a)}`}><ActionForm action={saveBankAccount.bind(null, a.id)} resetOnSuccess={false}><AccountFields a={a} banks={banks} /></ActionForm></DialogButton>
                <ActionButton variant="ghost" action={setBankAccountActive.bind(null, a.id, !a.active)} confirm={a.active ? `Close ${label(a)}? Its history and balance are kept and it can be reopened.` : undefined}>{a.active ? <><Archive size={13} /><span className="sr-only">Close {label(a)}</span></> : <><ArchiveRestore size={13} />Reopen</>}</ActionButton></span>}</div>
          </Card> })}
      </section>
      {all.length > open.length && <p className="-mt-3 mb-5 text-sm"><Link href={sp.closed === '1' ? '/banking' : '/banking?closed=1'} className="text-primary">{sp.closed === '1' ? 'Hide closed accounts' : `Show ${all.length - open.length} closed account${all.length - open.length === 1 ? '' : 's'}`}</Link></p>}

      <Card>
        <form className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <select name="acct" defaultValue={acct ?? ''} aria-label="Account" className={`${cls} min-w-52 flex-1`}><option value="">All accounts</option>{all.map(a => <option key={a.id} value={a.id}>{label(a)}</option>)}</select>
          <input name="from" type="date" defaultValue={sp.from} aria-label="From" className={cls} /><input name="to" type="date" defaultValue={sp.to} aria-label="To" className={cls} />
          <button className="h-9 cursor-pointer rounded-md border border-border px-3 text-sm hover:bg-surface-2">Filter</button></form>
        {!rows?.length ? <EmptyState icon={ArrowRightLeft} title="No entries yet" body="Choose “Deposited to” when you record a payment, or “Paid from” on an expense, and it appears here. Deposits, fees and transfers can be entered by hand." compact />
          : <TableWrap><thead className="bg-surface-2/50"><tr><Th>Date</Th><Th>Description</Th>{!acct && <Th>Account</Th>}<Th>Type</Th><Th className="text-right">In (AED)</Th><Th className="text-right">Out (AED)</Th><Th /></tr></thead>
            <tbody className="divide-y divide-border">{rows.map((t: any) => { const [l, tone] = KIND[t.kind] ?? [t.kind, 'neutral']; const n = Number(t.amount), a = byId.get(t.bank_id)
              return <tr key={t.id} className="hover:bg-surface-2/50">
                <Td className="whitespace-nowrap tabular-nums">{t.txn_date}</Td>
                <Td><div className="font-medium">{t.description ?? l}</div><div className="text-xs text-muted">{[t.reference, t.profiles?.full_name].filter(Boolean).join(' · ')}</div></Td>
                {!acct && <Td className="text-muted">{a ? label(a) : '—'}</Td>}
                <Td badge><Badge tone={tone}>{l}</Badge></Td>
                <Td className="text-right tabular-nums text-success">{n > 0 ? fmtMoney(n) : ''}</Td>
                <Td className="text-right tabular-nums">{n < 0 ? fmtMoney(-n) : ''}</Td>
                <Td className="text-right">{t.source_type ? <Link href={SOURCE[t.source_type]} className="text-xs text-primary">View {t.source_type}</Link>
                  : canDelete && <ActionButton variant="ghost" action={deleteBankTxn.bind(null, t.id)} confirm={t.transfer_group ? 'Remove this transfer from both accounts?' : 'Remove this entry?'}><Trash2 size={13} /><span className="sr-only">Remove entry</span></ActionButton>}</Td></tr> })}</tbody></TableWrap>}
        <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} params={sp} base="/banking" />
      </Card></>}
  </>
}
