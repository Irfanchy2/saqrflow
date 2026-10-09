import { FileText } from 'lucide-react'
import { Badge, Card, CardHeader, Field, Input, Metrics, StatCard } from '@/components/ui/primitives'
import { LinkGone, PublicShell } from '@/components/public/shell'
import { PublicForm } from '@/components/public/public-form'
import { logLinkEvent, resolveLink } from '@/lib/portal'
import { buildLedger } from '@/lib/ledger'
import { fmtMoney } from '@/lib/sales/money'
import { DOC_META, statusLabel, STATUS_TONE, type SalesType } from '@/lib/sales/docs'
import { publicRespondQuote } from '@/app/actions/public'

export const metadata = { title: 'Customer portal' }

/** Customer portal: quotations (accept / decline), invoices with balances, statement, project progress. Read-only otherwise. */
export default async function CustomerPortal({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const r = await resolveLink(token, 'customer_portal')
  if (!r || !r.link.customer_id) return <LinkGone what="portal" />
  const cid = r.company.id, cust = r.link.customer_id
  const { data: cu } = await r.admin.from('customers').select('id,name').eq('id', cust).eq('company_id', cid).maybeSingle()
  if (!cu) return <LinkGone what="portal" />
  await logLinkEvent(r, 'opened')
  const [{ data: docs }, ledger, { data: projects }] = await Promise.all([
    r.admin.from('invoices').select('id,doc_type,number,status,issue_date,due_date,valid_until,total,subject').eq('company_id', cid).eq('customer_id', cust).is('deleted_at', null)
      .in('doc_type', ['quotation', 'invoice', 'credit_note', 'delivery_note']).not('status', 'in', '(draft,cancelled)').order('issue_date', { ascending: false }).limit(200),
    buildLedger(r.ctx, cust, {}),
    r.admin.from('projects').select('id,name,code,status,fabrication_progress,site_progress,expected_completion').eq('company_id', cid).eq('customer_id', cust).is('deleted_at', null).in('status', ['planning', 'active', 'on_hold', 'completed']).order('created_at', { ascending: false }).limit(20),
  ])
  const pids = (projects ?? []).map(p => p.id)
  const { data: miles } = pids.length ? await r.admin.from('project_milestones').select('project_id,title,due_date,done').eq('company_id', cid).in('project_id', pids).order('due_date') : { data: [] as any[] }
  const bal = new Map(ledger.invoices.map((i: any) => [i.id, i]))
  const quotes = (docs ?? []).filter(d => d.doc_type === 'quotation'), invoices = (docs ?? []).filter(d => d.doc_type === 'invoice'), others = (docs ?? []).filter(d => d.doc_type === 'credit_note' || d.doc_type === 'delivery_note')
  const openQ = (q: any) => ['sent', 'viewed', 'follow_up'].includes(q.status) && !(q.valid_until && q.valid_until < r.ctx.today)
  const Pdf = ({ id }: { id: string }) => <a href={`/p/${token}/doc/${id}`} target="_blank" rel="noopener" className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:underline"><FileText size={13} />PDF</a>

  return <PublicShell company={r.company.name} title={cu.name} sub="Your quotations, invoices, statement and project updates">
    {r.link.message && <Card className="whitespace-pre-line p-4 text-sm">{r.link.message}</Card>}
    <Metrics cols={3}>
      <StatCard label="Outstanding" value={`${r.company.currency} ${fmtMoney(ledger.outstanding)}`} tone={ledger.outstanding > 0 ? 'amber' : 'neutral'} />
      <StatCard label="Overdue" value={`${r.company.currency} ${fmtMoney(ledger.overdue)}`} tone={ledger.overdue > 0 ? 'red' : 'neutral'} />
      <StatCard label="Open quotations" value={quotes.filter(openQ).length} />
    </Metrics>

    <Card><CardHeader title="Quotations" sub="Open quotations can be accepted or declined here" />
      {!quotes.length ? <p className="px-4 py-4 text-sm text-muted">No quotations yet.</p> : <ul className="divide-y divide-border">{quotes.map((q: any) => <li key={q.id} className="space-y-3 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2 text-sm"><span className="min-w-0 flex-1"><span className="block font-medium">{q.number}{q.subject ? ` · ${q.subject}` : ''}</span>
          <span className="block text-xs text-muted">{q.issue_date}{q.valid_until ? ` · valid until ${q.valid_until}` : ''}</span></span>
          <span className="tabular-nums">{fmtMoney(q.total)}</span><Badge tone={STATUS_TONE[q.status]}>{statusLabel('quotation' as SalesType, q.status)}</Badge><Pdf id={q.id} /></div>
        {(q.status === 'accepted' || q.status === 'converted') && <p className="text-xs text-success">Accepted. Thank you, our team will contact you to schedule the work.</p>}
        {openQ(q) && <details className="rounded-md border border-border"><summary className="cursor-pointer px-3 py-2 text-sm font-medium text-primary">Accept or decline {q.number}</summary>
          <div className="grid gap-4 border-t border-border p-3 sm:grid-cols-2">
            <PublicForm action={publicRespondQuote.bind(null, token, 'customer_portal', q.id)} submit="Accept"><input type="hidden" name="decision" value="accepted" />
              <Field label="Your name *"><Input name="name" required minLength={2} maxLength={120} defaultValue={r.link.recipient_name ?? ''} /></Field><Field label="Note"><Input name="note" maxLength={500} /></Field></PublicForm>
            <PublicForm action={publicRespondQuote.bind(null, token, 'customer_portal', q.id)} submit="Decline" variant="secondary"><input type="hidden" name="decision" value="rejected" />
              <Field label="Your name *"><Input name="name" required minLength={2} maxLength={120} defaultValue={r.link.recipient_name ?? ''} /></Field><Field label="Reason"><Input name="note" maxLength={500} /></Field></PublicForm>
          </div></details>}
      </li>)}</ul>}</Card>

    <Card><CardHeader title="Invoices" sub="Balance after payments and credit notes" action={<a href={`/p/${token}/statement`} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"><FileText size={14} />Statement of account</a>} />
      {!invoices.length ? <p className="px-4 py-4 text-sm text-muted">No invoices yet.</p> : <ul className="divide-y divide-border">{invoices.map((i: any) => { const b: any = bal.get(i.id)
        return <li key={i.id} className="flex flex-wrap items-center gap-2 px-4 py-3 text-sm"><span className="min-w-0 flex-1"><span className="block font-medium">{i.number}{i.subject ? ` · ${i.subject}` : ''}</span>
          <span className={b?.daysOverdue > 0 ? 'block text-xs text-danger' : 'block text-xs text-muted'}>{i.issue_date}{i.due_date ? ` · due ${i.due_date}` : ''}{b?.daysOverdue > 0 ? ` · ${b.daysOverdue} days overdue` : ''}</span></span>
          <span className="text-end tabular-nums"><span className="block">{fmtMoney(i.total)}</span>{b && b.balance > 0.004 && <span className="block text-xs text-muted">balance {fmtMoney(b.balance)}</span>}</span>
          <Badge tone={STATUS_TONE[i.status]}>{statusLabel('invoice' as SalesType, i.status)}</Badge><Pdf id={i.id} /></li> })}</ul>}</Card>

    {others.length > 0 && <Card><CardHeader title="Delivery notes & credit notes" />
      <ul className="divide-y divide-border">{others.map((o: any) => <li key={o.id} className="flex items-center gap-2 px-4 py-3 text-sm"><span className="min-w-0 flex-1 font-medium">{DOC_META[o.doc_type as SalesType].label} {o.number}</span><span className="text-xs text-muted">{o.issue_date}</span><Pdf id={o.id} /></li>)}</ul></Card>}

    {(projects ?? []).length > 0 && <Card><CardHeader title="Project updates" />
      <ul className="divide-y divide-border">{(projects ?? []).map((p: any) => { const ms = (miles ?? []).filter((m: any) => m.project_id === p.id)
        return <li key={p.id} className="space-y-2 px-4 py-3 text-sm">
          <div className="flex flex-wrap items-center gap-2"><span className="min-w-0 flex-1 font-medium">{p.name}{p.code ? ` · ${p.code}` : ''}</span><Badge tone={p.status === 'completed' ? 'green' : p.status === 'on_hold' ? 'amber' : 'blue'}>{p.status.replace('_', ' ')}</Badge></div>
          <div className="grid gap-2 sm:grid-cols-2">{[['Fabrication', p.fabrication_progress], ['Site work', p.site_progress]].map(([l, v]) => <div key={l as string}>
            <div className="flex justify-between text-xs text-muted"><span>{l}</span><span className="tabular-nums">{Number(v ?? 0)}%</span></div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, Math.max(0, Number(v ?? 0)))}%` }} /></div></div>)}</div>
          {p.expected_completion && <p className="text-xs text-muted">Planned completion: {p.expected_completion}</p>}
          {ms.length > 0 && <ul className="space-y-0.5 text-xs">{ms.slice(0, 8).map((m: any, i: number) => <li key={i} className={m.done ? 'text-success' : 'text-muted'}>{m.done ? '✓' : '○'} {m.title} · {m.due_date}</li>)}</ul>}
        </li> })}</ul></Card>}
  </PublicShell>
}
