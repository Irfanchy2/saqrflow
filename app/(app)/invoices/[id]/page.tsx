import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowRightLeft, Banknote, FolderOpen, Link2, Plus, Trash2 } from 'lucide-react'
import { getCtx } from '@/lib/auth'
import { brandingFor, loadSalesDoc } from '@/lib/sales/data'
import { DOC_META, STATUS_LABEL, STATUS_TONE, type SalesType } from '@/lib/sales/docs'
import { fmtMoney } from '@/lib/sales/money'
import { SalesEditor } from '@/components/sales/editor'
import { Badge, Card, CardHeader, Field, Input, Select, Td, Th, TableWrap } from '@/components/ui/primitives'
import { DialogButton } from '@/components/ui/dialog'
import { ActionButton, ActionForm } from '@/components/ui/action-form'
import { deletePayment, recordPayment } from '@/app/actions/sales'

export const metadata = { title: 'Sales document' }
const METHOD: Record<string, string> = { cash: 'Cash', bank_transfer: 'Bank transfer', cheque: 'Cheque', pdc: 'PDC cheque', card: 'Card', other: 'Other' }

export default async function SalesDocPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const c = await getCtx(); if (!c.can('finance.view')) redirect('/')
  const d = await loadSalesDoc(c, id); if (!d) notFound()
  const [branding, { data: customers }, { data: projects }, { data: cheques }] = await Promise.all([
    brandingFor(c),
    c.supabase.from('customers').select('id,name,address,trn,phone,contact_person,email').order('name').limit(1000),
    c.supabase.from('projects').select('id,name,code,customer_id,location').not('status', 'in', '(completed,cancelled)').order('name').limit(500),
    d.doc.doc_type === 'invoice' ? c.supabase.from('cheques').select('id,cheque_no,amount,party_name,cheque_date').eq('direction', 'incoming').not('status', 'in', '(cancelled,returned)').order('cheque_date', { ascending: false }).limit(50) : Promise.resolve({ data: [] as any[] }),
  ])
  const t = d.doc.doc_type as SalesType, edit = c.can('records.edit'), isInv = t === 'invoice'
  const locked = d.doc.status === 'cancelled' ? 'This document is cancelled and kept for your records. Duplicate it to start again.'
    : isInv && ['partially_paid', 'paid'].includes(d.doc.status) ? 'This invoice has payments, so its lines are locked. Issue a credit note for corrections.' : null
  const balance = Number(d.doc.total) - d.paid

  return <>
    <SalesEditor doc={d.doc as any} items={d.items} branding={branding} paid={d.paid} customers={(customers ?? []) as any} projects={(projects ?? []) as any}
      editable={edit && !locked} lockedReason={!edit ? 'You can view this document but not change it.' : locked}
      canStatus={edit} canDelete={c.can('records.delete')} canVault={c.can('documents.upload') && edit} />

    <div className="no-print mt-2 grid gap-5 lg:grid-cols-[minmax(380px,520px)_1fr]">
      {isInv && <Card>
        <CardHeader title="Payments" sub={`Paid AED ${fmtMoney(d.paid)} · Balance AED ${fmtMoney(balance)}`}
          action={edit && !['draft', 'cancelled', 'paid'].includes(d.doc.status) ? <DialogButton size="sm" label="Record payment" title={`Record payment — ${d.doc.number}`} icon={<Plus size={14} />}>
            <ActionForm action={recordPayment.bind(null, id)} submit="Save payment">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Amount (AED) *" hint={`Outstanding: AED ${fmtMoney(balance)}`}><Input name="amount" type="number" step="0.01" min="0.01" max={balance.toFixed(2)} defaultValue={balance.toFixed(2)} required /></Field>
                <Field label="Date received *"><Input name="paid_on" type="date" defaultValue={c.today} max={c.today} required /></Field>
                <Field label="Method *"><Select name="method" defaultValue="bank_transfer">{Object.entries(METHOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
                <Field label="Reference" hint="Transfer ref., receipt no."><Input name="reference" maxLength={120} /></Field>
                {(cheques ?? []).length > 0 && <Field label="Linked cheque" className="sm:col-span-2"><Select name="cheque_id" defaultValue=""><option value="">— None —</option>{(cheques ?? []).map((q: any) => <option key={q.id} value={q.id}>#{q.cheque_no} · {q.party_name} · AED {fmtMoney(q.amount)} · {q.cheque_date}</option>)}</Select></Field>}
                <Field label="Notes" className="sm:col-span-2"><Input name="notes" maxLength={1000} /></Field>
              </div>
            </ActionForm></DialogButton> : null} />
        {d.doc.status === 'draft' ? <p className="px-4 py-6 text-sm text-muted">Issue the invoice (⋯ → Issue invoice) before recording payments.</p>
          : d.payments.length === 0 ? <p className="px-4 py-6 text-sm text-muted">No payments recorded yet.</p>
          : <TableWrap><thead><tr><Th>Date</Th><Th>Method</Th><Th>Reference</Th><Th className="text-right">Amount</Th><Th /></tr></thead><tbody className="divide-y divide-border">
            {d.payments.map(p => <tr key={p.id}><Td>{p.paid_on}</Td><Td>{METHOD[p.method] ?? p.method}</Td><Td className="text-muted">{p.reference ?? '—'}</Td><Td className="text-right tabular-nums font-medium">{fmtMoney(p.amount)}</Td>
              <Td className="text-right">{c.can('records.delete') && <ActionButton variant="ghost" action={deletePayment.bind(null, p.id)} confirm="Delete this payment? The invoice balance will be recalculated."><Trash2 size={14} /><span className="sr-only">Delete payment</span></ActionButton>}</Td></tr>)}
          </tbody></TableWrap>}
        <div className="h-2 overflow-hidden rounded-b-lg bg-surface-2" aria-hidden><div className="h-full bg-success transition-all" style={{ width: `${Math.min(100, Number(d.doc.total) ? (d.paid / Number(d.doc.total)) * 100 : 0)}%` }} /></div>
      </Card>}

      <Card className={isInv ? '' : 'lg:col-start-1'}>
        <CardHeader title="Linked records" />
        <ul className="divide-y divide-border text-sm">
          {d.customer && <Linked icon={Link2} href={`/parties/${d.customer.id}`} label="Customer" value={d.customer.name} />}
          {d.project && <Linked icon={FolderOpen} href={`/projects/${d.project.id}`} label="Project" value={`${d.project.code ? d.project.code + ' · ' : ''}${d.project.name}`} />}
          {d.related.filter((r: any) => r.id !== id).map((r: any) => <Linked key={r.id} icon={ArrowRightLeft} href={`/invoices/${r.id}`} label={DOC_META[r.doc_type as SalesType]?.label ?? r.doc_type}
            value={<span className="inline-flex items-center gap-2">{r.number}<Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge></span>} />)}
          {d.doc.pdf_document_id && <Linked icon={Banknote} href={`/documents/${d.doc.pdf_document_id}`} label="Archived PDF" value="Open in Document Vault" />}
          {!d.customer && !d.project && !d.related.some((r: any) => r.id !== id) && !d.doc.pdf_document_id && <li className="px-4 py-5 text-muted">Nothing linked yet. Pick a saved customer or project, or create an invoice / delivery note from this document.</li>}
        </ul>
      </Card>
    </div>
  </>
}
function Linked({ icon: Icon, href, label, value }: { icon: typeof Link2; href: string; label: string; value: React.ReactNode }) {
  return <li><Link href={href} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2/60"><Icon size={15} className="text-muted" aria-hidden /><span className="w-28 shrink-0 text-xs text-muted">{label}</span><span className="min-w-0 truncate font-medium">{value}</span></Link></li>
}
