import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft, History, Trash2, UploadCloud } from '@/components/icons'
import { getCtx } from '@/lib/auth'
import { Card, CardHeader, EmptyState, Field, Input, PageHeader, Select, Td, Th, TableWrap, Textarea } from '@/components/ui/primitives'
import { ActionButton, ActionForm } from '@/components/ui/action-form'
import { addPreviousInvoice, removePreviousInvoice } from '@/app/actions/previous'
import { PreviousUpload } from '@/components/sales/previous-upload'
import { PREVIOUS } from '@/lib/sales/previous'
import { fmtMoney } from '@/lib/sales/money'
import { showDate } from '@/lib/time'

export const metadata = { title: 'Previous invoices' }

/**
 * Previous invoices: tax invoices issued before Averiqo (kept in Excel or on paper), entered with their own number so
 * they appear in receivables, the customer ledger, reminders and customer statements. No automatic numbering is used.
 */
export default async function PreviousInvoices({ searchParams }: { searchParams: Promise<{ customer?: string }> }) {
  const c = await getCtx(); if (!c.can('finance.view') || !c.can('records.edit')) redirect('/invoices')
  const { customer } = await searchParams
  const [{ data: customers }, { data: list }] = await Promise.all([
    c.supabase.from('customers').select('id,name').order('name').limit(3000),
    c.supabase.from('invoices').select('id,number,customer_name,issue_date,due_date,total').eq('doc_type', 'invoice').eq('external_provider', PREVIOUS).order('created_at', { ascending: false }).limit(300),
  ])
  const { data: bals } = list?.length ? await c.supabase.from('invoice_balances').select('id,balance').in('id', list.map(x => x.id)) : { data: [] as { id: string; balance: number }[] }
  const bal = new Map((bals ?? []).map(b => [b.id, Number(b.balance)]))
  const pre = customer && /^[0-9a-f-]{36}$/i.test(customer) ? customer : ''
  return <>
    <Link href="/invoices?tab=invoice" className="-ms-1 mb-1 inline-flex min-h-10 items-center gap-1.5 px-1 text-sm text-muted hover:text-fg sm:mb-3 sm:min-h-0"><ArrowLeft size={14} className="rtl:rotate-180" />Sales & invoices</Link>
    <PageHeader title="Previous invoices" sub="Add tax invoices you issued before Averiqo (from Excel or paper) with their original number. They show in receivables, the customer ledger and statements. Your automatic numbering is not used or changed." />
    <div className="grid gap-5 xl:grid-cols-2 [&>*]:min-w-0">
      <Card id="add"><CardHeader title="Add one invoice" sub="Type the number exactly as on your invoice. Save, then add the next one." />
        <div className="p-4"><ActionForm action={addPreviousInvoice} submit="Save previous invoice" resetOnSuccess>
          <Field label="Customer *" hint="Not in the list? Add the customer under Customers first.">
            <Select name="customer_id" defaultValue={pre} required><option value="">Choose the customer…</option>{(customers ?? []).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Invoice number *" hint="Your own number, e.g. ASR-2024-0153"><Input name="number" required maxLength={60} autoComplete="off" /></Field>
            <Field label="LPO / reference"><Input name="lpo_ref" maxLength={80} /></Field>
            <Field label="Invoice date *"><Input name="issue_date" type="date" max={c.today} required /></Field>
            <Field label="Due date" hint="Empty = invoice date + your usual payment days"><Input name="due_date" type="date" /></Field>
            <Field label="Amount (AED) *"><Input name="amount" type="number" step="0.01" min="0.01" inputMode="decimal" required /></Field>
            <Field label="The amount is"><Select name="amount_is" defaultValue="total"><option value="total">Including VAT (invoice total)</option><option value="net">Before VAT</option></Select></Field>
            <Field label="VAT %"><Input name="vat_rate" type="number" step="0.01" min="0" max="100" defaultValue="5" inputMode="decimal" /></Field>
            <Field label="Already paid (AED)" hint="0 if nothing was received yet"><Input name="paid" type="number" step="0.01" min="0" defaultValue="0" inputMode="decimal" /></Field>
            <Field label="Paid on" hint="Empty = the invoice date"><Input name="paid_on" type="date" max={c.today} /></Field>
          </div>
          <Field label="Description" hint="Optional, e.g. the work or project"><Textarea name="description" rows={2} maxLength={500} /></Field>
        </ActionForm></div></Card>

      <Card id="upload"><CardHeader title="Upload many from Excel" sub="All your old invoices at once, with their own numbers." action={<UploadCloud size={16} className="text-muted" aria-hidden />} />
        <div className="p-4"><PreviousUpload /></div></Card>
    </div>

    <Card className="mt-5"><CardHeader title="Previous invoices entered" sub="Newest first. Open one to record a payment, or remove an entry made by mistake." action={<History size={16} className="text-muted" aria-hidden />} />
      {!list?.length ? <EmptyState icon={History} title="None yet" body="Invoices you add here appear in this list, in Tax invoices, receivables and customer statements." />
        : <TableWrap><thead className="bg-surface-2/50"><tr><Th>Invoice</Th><Th>Customer</Th><Th>Date</Th><Th>Due</Th><Th className="text-right">Amount</Th><Th className="text-right">Balance</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
          <tbody className="divide-y divide-border" data-previous-list>{list.map(x => <tr key={x.id}>
            <Td><Link href={`/invoices/${x.id}`} className="font-mono text-[13px] text-primary hover:underline">{x.number}</Link></Td><Td>{x.customer_name}</Td>
            <Td className="tabular-nums">{showDate(x.issue_date)}</Td><Td className="tabular-nums">{showDate(x.due_date, '—')}</Td>
            <Td className="text-right tabular-nums">{fmtMoney(x.total)}</Td><Td className="text-right font-medium tabular-nums">{fmtMoney(bal.get(x.id) ?? 0)}</Td>
            <Td className="text-right">{c.can('records.delete') && <ActionButton variant="ghost" action={removePreviousInvoice.bind(null, x.id)} confirm={`Remove ${x.number}? It goes to the Trash and its number can be entered again.`}><Trash2 size={14} /><span className="sr-only">Remove {x.number}</span></ActionButton>}</Td></tr>)}</tbody></TableWrap>}
    </Card>
  </>
}
