import { FileText } from 'lucide-react'
import { Card, CardHeader, Field, Input, Textarea } from '@/components/ui/primitives'
import { LinkGone, PublicShell } from '@/components/public/shell'
import { PublicForm } from '@/components/public/public-form'
import { logLinkEvent, resolveLink } from '@/lib/portal'
import { markQuoteViewed } from '@/lib/portal-quote'
import { loadSalesDoc } from '@/lib/sales/data'
import { fmtMoney } from '@/lib/sales/money'
import { publicRespondQuote } from '@/app/actions/public'

export const metadata = { title: 'Quotation' }

/** Online quotation: read it, download the PDF, accept or decline. */
export default async function QuoteLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const r = await resolveLink(token, 'quote_response')
  if (!r || !r.link.invoice_id) return <LinkGone />
  const d = await loadSalesDoc(r.ctx, r.link.invoice_id)
  if (!d || (d.doc as any).deleted_at || d.doc.doc_type !== 'quotation' || ['draft', 'cancelled'].includes(d.doc.status)) return <LinkGone what="quotation" />
  await logLinkEvent(r, 'opened'); await markQuoteViewed(r, d.doc.id)
  const q: any = d.doc
  const open = ['sent', 'viewed', 'follow_up'].includes(q.status) && !(q.valid_until && q.valid_until < r.ctx.today)
  const sub = [`Quotation ${q.number}`, q.issue_date && `dated ${q.issue_date}`, q.valid_until && `valid until ${q.valid_until}`].filter(Boolean).join(' · ')
  return <PublicShell company={r.company.name} title={q.subject || 'Your quotation'} sub={sub}>
    {r.link.message && <Card className="p-4 text-sm whitespace-pre-line">{r.link.message}</Card>}
    <Card><CardHeader title={`For ${q.customer_name ?? 'you'}`} sub={q.site ? `Site: ${q.site}` : undefined} action={<a href={`/q/${token}/pdf`} target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"><FileText size={15} />Open PDF</a>} />
      <ul className="divide-y divide-border text-sm">{d.items.map((it, i) => <li key={i} className="flex gap-3 px-4 py-2.5">
        <span className="min-w-0 flex-1 whitespace-pre-line break-words">{it.description}<span className="block text-xs text-muted">{Number(it.quantity)} {it.unit ?? ''} × {fmtMoney(it.unit_price)}</span></span>
        <span className="shrink-0 tabular-nums">{fmtMoney(Number(it.quantity) * Number(it.unit_price) * (1 - Number(it.discount_pct ?? 0) / 100))}</span></li>)}</ul>
      <dl className="space-y-1 border-t border-border px-4 py-3 text-sm">
        <div className="flex justify-between"><dt className="text-muted">Subtotal</dt><dd className="tabular-nums">{fmtMoney(q.subtotal)}</dd></div>
        {Number(q.vat_amount) > 0 && <div className="flex justify-between"><dt className="text-muted">VAT</dt><dd className="tabular-nums">{fmtMoney(q.vat_amount)}</dd></div>}
        <div className="flex justify-between text-base font-semibold"><dt>Total ({r.company.currency})</dt><dd className="tabular-nums">{fmtMoney(q.total)}</dd></div>
      </dl></Card>
    <Card><CardHeader title={open ? 'Your answer' : 'Status'} />
      <div className="p-4">{open ? <div className="grid gap-5 sm:grid-cols-2">
        <PublicForm action={publicRespondQuote.bind(null, token, 'quote_response', q.id)} submit="Accept quotation">
          <input type="hidden" name="decision" value="accepted" />
          <Field label="Your name *"><Input name="name" required minLength={2} maxLength={120} defaultValue={r.link.recipient_name ?? ''} autoComplete="name" /></Field>
          <Field label="Note" hint="optional, e.g. preferred start date"><Input name="note" maxLength={500} /></Field>
          <p className="text-xs text-muted">By accepting you confirm the scope, price and terms in the PDF.</p>
        </PublicForm>
        <PublicForm action={publicRespondQuote.bind(null, token, 'quote_response', q.id)} submit="Decline" variant="secondary">
          <input type="hidden" name="decision" value="rejected" />
          <Field label="Your name *"><Input name="name" required minLength={2} maxLength={120} defaultValue={r.link.recipient_name ?? ''} autoComplete="name" /></Field>
          <Field label="Reason" hint="optional, helps us improve"><Textarea name="note" rows={2} maxLength={500} /></Field>
        </PublicForm>
      </div> : <p className="text-sm">{q.status === 'accepted' || q.status === 'converted' ? 'This quotation is accepted. Thank you.' : q.status === 'rejected' ? 'This quotation was declined.' : q.valid_until && q.valid_until < r.ctx.today ? `This quotation expired on ${q.valid_until}. Please contact us for an updated offer.` : `Status: ${q.status.replace('_', ' ')}.`}</p>}</div>
    </Card>
  </PublicShell>
}
