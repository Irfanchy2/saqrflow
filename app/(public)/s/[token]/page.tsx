import { FileText } from 'lucide-react'
import { Badge, Card, CardHeader, Field, Input, Select, Textarea } from '@/components/ui/primitives'
import { LinkGone, PublicShell } from '@/components/public/shell'
import { PublicForm } from '@/components/public/public-form'
import { logLinkEvent, resolveLink } from '@/lib/portal'
import { fmtMoney } from '@/lib/sales/money'
import { ACCEPT_ATTR } from '@/lib/files'
import { publicConfirmDelivery, publicUpload } from '@/app/actions/public'

export const metadata = { title: 'Supplier portal' }

/** Supplier portal: purchase orders addressed to this supplier, delivery confirmation, invoice upload (to Smart Inbox review). */
export default async function SupplierPortal({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const r = await resolveLink(token, 'supplier_portal')
  if (!r || !r.link.supplier_id) return <LinkGone what="portal" />
  const { data: sup } = await r.admin.from('suppliers').select('id,name').eq('id', r.link.supplier_id).eq('company_id', r.company.id).maybeSingle()
  if (!sup) return <LinkGone what="portal" />
  await logLinkEvent(r, 'opened')
  const { data: pos } = await r.admin.from('invoices').select('id,number,status,issue_date,total,subject,supplier_confirmed_at,supplier_confirmation').eq('company_id', r.company.id).eq('doc_type', 'purchase_order')
    .eq('supplier_id', sup.id).is('deleted_at', null).not('status', 'in', '(draft,cancelled)').order('issue_date', { ascending: false }).limit(100)
  return <PublicShell company={r.company.name} title={`Purchase orders for ${sup.name}`} sub="Download purchase orders, confirm deliveries and send your invoices">
    {r.link.message && <Card className="whitespace-pre-line p-4 text-sm">{r.link.message}</Card>}
    <Card><CardHeader title="Purchase orders" />
      {!(pos ?? []).length ? <p className="px-4 py-4 text-sm text-muted">No purchase orders yet.</p> : <ul className="divide-y divide-border">{(pos ?? []).map((p: any) => <li key={p.id} className="space-y-3 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2 text-sm"><span className="min-w-0 flex-1"><span className="block font-medium">{p.number}{p.subject ? ` · ${p.subject}` : ''}</span><span className="block text-xs text-muted">{p.issue_date}</span></span>
          <span className="tabular-nums">{fmtMoney(p.total)}</span>
          {p.supplier_confirmed_at ? <Badge tone="green">Delivered {p.supplier_confirmation?.delivered_on ?? ''}</Badge> : <Badge tone="blue">Open</Badge>}
          <a href={`/s/${token}/doc/${p.id}`} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"><FileText size={13} />PDF</a></div>
        {!p.supplier_confirmed_at && <details className="rounded-md border border-border"><summary className="cursor-pointer px-3 py-2 text-sm font-medium text-primary">Confirm delivery of {p.number}</summary>
          <div className="border-t border-border p-3"><PublicForm action={publicConfirmDelivery.bind(null, token, p.id)} submit="Confirm delivery">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Your name *"><Input name="name" required minLength={2} maxLength={120} defaultValue={r.link.recipient_name ?? ''} /></Field>
              <Field label="Delivered on *"><Input name="delivered_on" type="date" required defaultValue={r.ctx.today} max={r.ctx.today} /></Field>
              <Field label="Delivery note no."><Input name="reference" maxLength={80} /></Field>
              <Field label="Note"><Input name="note" maxLength={500} /></Field>
            </div></PublicForm></div></details>}
      </li>)}</ul>}</Card>
    <Card><CardHeader title="Send an invoice" sub="PDF or photo. Our accounts team reviews it before it is recorded." />
      <div className="p-4"><PublicForm action={publicUpload.bind(null, token, 'supplier_portal')} submit="Upload invoice" keepOnSuccess>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Your name *"><Input name="name" required minLength={2} maxLength={120} defaultValue={r.link.recipient_name ?? ''} /></Field>
          <Field label="For purchase order"><Select name="po_number" defaultValue=""><option value="">Not linked to a PO</option>{(pos ?? []).map((p: any) => <option key={p.id} value={p.number}>{p.number}</option>)}</Select></Field>
          <Field label="Invoice number"><Input name="reference" maxLength={60} /></Field>
          <Field label="Amount (AED)"><Input name="amount" type="number" min={0} step="0.01" /></Field>
        </div>
        <Field label="Invoice file(s) *"><input name="file" type="file" required multiple accept={ACCEPT_ATTR} className="block w-full text-sm" /></Field>
        <Field label="Comment"><Textarea name="note" rows={2} maxLength={500} /></Field>
      </PublicForm></div></Card>
  </PublicShell>
}
