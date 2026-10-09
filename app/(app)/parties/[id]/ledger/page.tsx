import { WhatsAppSend } from '@/components/whatsapp/send'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft, Download, Mail, Plus, Printer, Wallet } from 'lucide-react'
import { getCtx } from '@/lib/auth'
import { flat } from '@/lib/queries'
import { buildLedger } from '@/lib/ledger'
import { statementParams, statementQuery } from '@/lib/statement-params'
import { fmtMoney } from '@/lib/sales/money'
import { Badge, Card, CardHeader, EmptyState, Field, Input, LinkButton, PageHeader, Select, Metrics, StatCard, Td, Th, TableWrap } from '@/components/ui/primitives'
import { DialogButton } from '@/components/ui/dialog'
import { ActionForm } from '@/components/ui/action-form'
import { recordPaymentOnAccount } from '@/app/actions/sales'
import { formatAed } from '@/lib/time'
import { cn } from '@/lib/utils'

export const metadata = { title: 'Customer ledger' }
const KIND: Record<string, { label: string; tone: 'neutral' | 'blue' | 'green' | 'amber' }> = { opening: { label: 'Opening', tone: 'neutral' }, invoice: { label: 'Invoice', tone: 'blue' }, payment: { label: 'Payment', tone: 'green' }, credit_note: { label: 'Credit note', tone: 'amber' } }

export default async function LedgerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const c = await getCtx(); if (!c.can('finance.view')) redirect('/')
  const sp = await flat(searchParams), f = statementParams(sp)
  const [{ data: cu }, { data: projects }] = await Promise.all([
    c.supabase.from('customers').select('id,name,email,contact_person').eq('id', id).maybeSingle(),
    c.supabase.from('projects').select('id,name').eq('customer_id', id).order('name'),
  ])
  if (!cu) notFound()
  const l = await buildLedger(c, id, f)
  const qs = statementQuery(f)
  const mail = `mailto:${encodeURIComponent(cu.email ?? '')}?subject=${encodeURIComponent(`Statement of account: ${cu.name}`)}&body=${encodeURIComponent(`Dear ${cu.contact_person || 'Sir/Madam'},\n\nPlease find attached your statement of account${f.to ? ` up to ${f.to}` : ''}. The balance due is AED ${fmtMoney(l.outstanding)}${l.overdue ? `, of which AED ${fmtMoney(l.overdue)} is overdue` : ''}.\n\nKind regards,\n${c.company.name}`)}`
  const cls = 'h-9 rounded-md border border-border bg-surface px-3 text-sm'
  return <>
    <Link href={`/parties/${id}`} className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg"><ArrowLeft size={14} />{cu.name}</Link>
    <PageHeader title="Customer ledger" sub={`${cu.name}. Opening balance, invoices, payments, cheques and credit notes with a running balance.`}
      actions={<>
        <LinkButton href={`/print/statement/${id}?${qs}${qs ? '&' : ''}auto=1`} variant="secondary" target="_blank"><Printer size={14} />Print statement</LinkButton>
        <LinkButton href={`/api/statements/${id}?${qs}`} variant="secondary"><Download size={14} />Statement PDF</LinkButton>
        <LinkButton href={mail} variant="secondary"><Mail size={14} />Email</LinkButton>
        {c.can('records.edit') && <WhatsAppSend kind="statement" recordId={id} label="WhatsApp" size="md" />}
        {c.can('records.edit') && <DialogButton label="Payment on account" title={`Payment on account: ${cu.name}`} icon={<Plus size={14} />} wide><ActionForm action={recordPaymentOnAccount.bind(null, id)} submit="Save payment" idempotent>
          <p className="text-sm text-muted">For money not tied to one invoice (e.g. an opening balance). To pay an invoice, open the invoice and use “Record payment”.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Amount (AED) *"><Input name="amount" type="number" step="0.01" min="0.01" required inputMode="decimal" /></Field>
            <Field label="Date received *"><Input name="paid_on" type="date" defaultValue={c.today} max={c.today} required /></Field>
            <Field label="Method *"><Select name="method" defaultValue="bank_transfer"><option value="bank_transfer">Bank transfer</option><option value="cash">Cash</option><option value="cheque">Cheque</option><option value="card">Card</option><option value="other">Other</option></Select></Field>
            <Field label="Reference"><Input name="reference" maxLength={120} /></Field>
          </div></ActionForm></DialogButton>}
      </>} />
    <Metrics className="mb-5" cols={4}>
      <StatCard label="Outstanding balance" value={formatAed(l.outstanding)} icon={Wallet} tone={l.outstanding > 0 ? 'amber' : 'neutral'} />
      <StatCard label="Overdue" value={formatAed(l.overdue)} tone={l.overdue > 0 ? 'red' : 'neutral'} />
      <StatCard label="Invoiced in period" value={formatAed(l.totalDebit)} tone="blue" />
      <StatCard label="Received / credited in period" value={formatAed(l.totalCredit)} tone="green" />
    </Metrics>
    <Card>
      <form className="flex flex-wrap items-end gap-2 border-b border-border p-3">
        <label className="flex flex-col gap-1 text-xs text-muted">From<input type="date" name="from" defaultValue={f.from} className={cls} /></label>
        <label className="flex flex-col gap-1 text-xs text-muted">To<input type="date" name="to" defaultValue={f.to} className={cls} /></label>
        <label className="flex flex-col gap-1 text-xs text-muted">Project<select name="project" defaultValue={f.project ?? ''} className={cls}><option value="">All projects</option>{(projects ?? []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className="flex flex-col gap-1 text-xs text-muted">Invoices<select name="status" defaultValue={f.status ?? ''} className={cls}><option value="">All</option><option value="open">Unpaid</option><option value="overdue">Overdue</option><option value="paid">Paid</option></select></label>
        <button className="h-9 cursor-pointer rounded-md border border-border px-3 text-sm hover:bg-surface-2">Apply</button>
        {qs && <LinkButton href={`/parties/${id}/ledger`} variant="ghost">Clear</LinkButton>}
      </form>
      {l.entries.length <= 1 && !l.opening ? <EmptyState icon={Wallet} title="No transactions yet" body="Issued invoices, payments and credit notes for this customer appear here." />
        : <TableWrap><thead className="bg-surface-2/50"><tr><Th>Date</Th><Th>Type</Th><Th>Reference</Th><Th>Description</Th><Th className="text-right">Debit</Th><Th className="text-right">Credit</Th><Th className="text-right">Balance</Th></tr></thead>
          <tbody className="divide-y divide-border">{l.entries.map((e, i) => <tr key={i} className="hover:bg-surface-2/50">
            <Td className="whitespace-nowrap tabular-nums">{e.date || '—'}</Td><Td><Badge tone={KIND[e.kind].tone}>{KIND[e.kind].label}</Badge></Td>
            <Td className="whitespace-nowrap font-mono text-[13px]">{e.href ? <Link href={e.href} className="text-primary hover:underline">{e.ref}</Link> : e.ref || '—'}</Td>
            <Td className="max-w-[360px] text-muted">{e.description}</Td>
            <Td className="text-right tabular-nums">{e.debit ? fmtMoney(e.debit) : ''}</Td><Td className="text-right tabular-nums text-success">{e.credit ? fmtMoney(e.credit) : ''}</Td>
            <Td className={cn('text-right font-medium tabular-nums', e.balance < 0 && 'text-success')}>{fmtMoney(e.balance)}</Td></tr>)}</tbody>
          <tfoot className="border-t-2 border-border bg-surface-2/40 font-semibold"><tr><Td colSpan={4}>Closing balance</Td><Td className="text-right tabular-nums">{fmtMoney(l.totalDebit)}</Td><Td className="text-right tabular-nums">{fmtMoney(l.totalCredit)}</Td><Td className="text-right tabular-nums">{fmtMoney(l.closing)}</Td></tr></tfoot></TableWrap>}
    </Card>
    {l.invoices.length > 0 && <Card className="mt-5"><CardHeader title="Invoices" sub="Amount, paid / credited, balance and days overdue" />
      <TableWrap><thead className="bg-surface-2/50"><tr><Th>Invoice</Th><Th>Date</Th><Th>Due</Th><Th className="text-right">Amount</Th><Th className="text-right">Paid / credited</Th><Th className="text-right">Balance</Th><Th>Overdue</Th></tr></thead>
        <tbody className="divide-y divide-border">{l.invoices.map(i => <tr key={i.id} className="hover:bg-surface-2/50">
          <Td><Link href={`/invoices/${i.id}`} className="font-mono text-[13px] text-primary hover:underline">{i.number}</Link></Td><Td className="tabular-nums">{i.issue_date}</Td><Td className="tabular-nums">{i.due_date ?? '—'}</Td>
          <Td className="text-right tabular-nums">{fmtMoney(i.total)}</Td><Td className="text-right tabular-nums">{fmtMoney(i.total - i.balance)}</Td><Td className="text-right font-medium tabular-nums">{fmtMoney(i.balance)}</Td>
          <Td>{i.daysOverdue ? <Badge tone="red">{i.daysOverdue} days</Badge> : i.balance > 0.004 ? <Badge tone="blue">Not due</Badge> : <Badge tone="green">Paid</Badge>}</Td></tr>)}</tbody></TableWrap></Card>}
  </>
}
