import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowRightLeft, BellRing, CheckCircle2, Clock, FileMinus, FolderOpen, History, Link2, Paperclip, Plus, ShieldCheck, Trash2, Truck } from 'lucide-react'
import { getCtx } from '@/lib/auth'
import { brandingFor, loadSalesDoc, salesSettings } from '@/lib/sales/data'
import { APPROVAL_LABEL, DOC_META, STATUS_TONE, statusLabel, type SalesType } from '@/lib/sales/docs'
import { fmtMoney } from '@/lib/sales/money'
import { SalesEditor } from '@/components/sales/editor'
import { matchesFormat, NUMBER_FORMAT_COLS } from '@/lib/numbering'
import { Badge, Card, CardHeader, Field, Input, Select, Td, Th, TableWrap, Textarea } from '@/components/ui/primitives'
import { DialogButton } from '@/components/ui/dialog'
import { ActionButton, ActionForm } from '@/components/ui/action-form'
import { addFollowup, completeFollowup, decideApproval, deletePayment, recordPayment } from '@/app/actions/sales'
import { ACCEPT_ATTR } from '@/lib/files'
import { formatLongDate } from '@/lib/time'

export const metadata = { title: 'Sales document' }
const METHOD: Record<string, string> = { cash: 'Cash', bank_transfer: 'Bank transfer', cheque: 'Cheque', pdc: 'PDC cheque', card: 'Card', other: 'Other' }
const EVENT: Record<string, string> = { created: 'Created', revised: 'Revised', status: 'Status changed', converted: 'Converted', downloaded: 'PDF downloaded', printed: 'Opened for printing', emailed: 'Email drafted', whatsapp: 'Shared on WhatsApp', archived: 'Saved to Vault', payment: 'Payment', approval: 'Approval', followup: 'Follow-up' }

export default async function SalesDocPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const c = await getCtx(); if (!c.can('finance.view')) redirect('/')
  const d = await loadSalesDoc(c, id); if (!d) notFound()
  const t = d.doc.doc_type as SalesType, isInv = t === 'invoice', isQtn = t === 'quotation'
  const [branding, settings, { data: customers }, { data: projects }, { data: catalog }, { data: templates }, { data: people }, { data: deliv }, { data: revisions }, { data: events }, { data: followups }, { data: cheques }] = await Promise.all([
    brandingFor(c), salesSettings(c),
    c.supabase.from('customers').select('id,name,address,trn,phone,contact_person,email').order('name').limit(2000),
    c.supabase.from('projects').select('id,name,code,customer_id,location').not('status', 'in', '(completed,cancelled)').order('name').limit(500),
    c.supabase.from('catalog_items').select('id,name,description,unit,rate,vat_category,category').eq('active', true).order('name').limit(1000),
    c.supabase.from('terms_templates').select('id,name,kind,lines,is_default').order('name'),
    c.supabase.from('profiles').select('id,full_name').eq('is_active', true).order('full_name'),
    isQtn ? c.supabase.from('quotation_delivery').select('item_id,ordered,delivered').eq('quotation_id', id) : Promise.resolve({ data: [] as any[] }),
    c.supabase.from('sales_doc_revisions').select('id,revision,changes,created_at,created_by').eq('invoice_id', id).order('revision', { ascending: false }).limit(50),
    c.supabase.from('sales_doc_events').select('id,event,detail,user_id,created_at').eq('invoice_id', id).order('created_at', { ascending: false }).limit(40),
    isQtn ? c.supabase.from('sales_followups').select('id,due_date,note,done_at,outcome').eq('invoice_id', id).order('due_date') : Promise.resolve({ data: [] as any[] }),
    // only cheques confirmed CLEARED can settle an invoice (a cheque date passing is not clearance)
    isInv ? c.supabase.from('cheques').select('id,cheque_no,amount,party_name,cheque_date,bank_name,invoice_id,customer_id').eq('direction', 'incoming').eq('status', 'cleared').order('cheque_date', { ascending: false }).limit(100) : Promise.resolve({ data: [] as any[] }),
  ])
  const names = new Map((people ?? []).map(p => [p.id, p.full_name]))
  const edit = c.can('records.edit')
  const pendingApproval = d.doc.approval_status === 'pending'
  const locked = d.doc.status === 'cancelled' ? 'This document is cancelled and kept for your records. Duplicate it to start again.'
    : isInv && ['partially_paid', 'paid'].includes(d.doc.status) ? 'This invoice has payments, so its lines are locked. Issue a credit note for corrections.'
    : t === 'credit_note' && d.doc.status !== 'draft' ? 'This credit note is issued and can no longer be edited.'
    : pendingApproval && !c.can('sales.approve') ? 'Waiting for manager approval. Editing is locked until a decision is made.' : null
  const credited = (d as any).credited as number
  const balance = Number(d.doc.total) - d.paid - credited
  const usedCheques = new Set(d.payments.map((p: any) => p.cheque_id).filter(Boolean))
  const applicable = (cheques ?? []).filter((q: any) => !usedCheques.has(q.id) && (q.invoice_id === id || !q.invoice_id) && (!q.customer_id || !d.doc.customer_id || q.customer_id === d.doc.customer_id))
  const chequeOf = new Map((cheques ?? []).map((q: any) => [q.id, q]))
  const delivery = Object.fromEntries((deliv ?? []).map((x: any) => [x.item_id, { ordered: Number(x.ordered), delivered: Number(x.delivered) }]))
  const deliveryNotes = d.related.filter((r: any) => r.doc_type === 'delivery_note' && r.quotation_id === id)
  const creditNotes = d.related.filter((r: any) => r.doc_type === 'credit_note' && r.source_invoice_id === id)
  const { data: payDocs } = isInv && d.payments.some((p: any) => p.document_id) ? await c.supabase.from('documents').select('id,name').in('id', d.payments.map((p: any) => p.document_id).filter(Boolean)) : { data: [] as any[] }
  const docName = new Map((payDocs ?? []).map((x: any) => [x.id, x.name]))

  // a draft still carrying a number from before the custom format was configured (e.g. QTN-2026-0004) can take a new one
  const { data: fmt } = edit && d.doc.status === 'draft' && !(d.doc as any).sent_at && !d.doc.revision ? await c.supabase.from('document_number_formats').select(NUMBER_FORMAT_COLS).eq('doc_type', d.doc.doc_type).maybeSingle() : { data: null }
  const canRenumber = !!fmt && !matchesFormat(d.doc.number, fmt)
  return <>
    <SalesEditor doc={d.doc as any} items={d.items} branding={branding} paid={d.paid + credited} customers={(customers ?? []) as any} projects={(projects ?? []) as any}
      catalog={(catalog ?? []).map((x: any) => ({ ...x, rate: Number(x.rate) }))} templates={(templates ?? []) as any} salespeople={people ?? []} delivery={delivery}
      editable={edit && !locked} lockedReason={!edit ? 'You can view this document but not change it.' : locked} requireApproval={settings.requireApproval}
      canStatus={edit && !(pendingApproval && !c.can('sales.approve'))} canDelete={c.can('records.delete')} canVault={c.can('documents.upload') && edit} canRenumber={canRenumber} />

    <div className="no-print mt-2 grid gap-5 px-0 lg:grid-cols-2 2xl:grid-cols-3 [&>*]:min-w-0">
      {isQtn && pendingApproval && c.can('sales.approve') && <Card className="border-warning/40"><CardHeader title="Approval requested" sub="Review the quotation, then decide" action={<ShieldCheck size={16} className="text-warning" aria-hidden />} />
        <div className="p-4"><ActionForm action={decideApproval.bind(null, id)} submit="Save decision">
          <Field label="Decision *"><Select name="decision" defaultValue="approved"><option value="approved">Approve. It can be sent</option><option value="changes_requested">Request changes</option><option value="rejected">Reject</option></Select></Field>
          <Field label="Note" hint="Required when requesting changes or rejecting"><Textarea name="note" maxLength={500} /></Field></ActionForm></div></Card>}

      {isInv && <Card className="lg:col-span-2 2xl:col-span-2">
        <CardHeader title="Payments" sub={`Invoice AED ${fmtMoney(d.doc.total)} · Paid AED ${fmtMoney(d.paid)}${credited ? ` · Credited AED ${fmtMoney(credited)}` : ''} · Balance AED ${fmtMoney(balance)}${d.doc.due_date && balance > 0 && d.doc.due_date < c.today ? ` · ${Math.round((Date.parse(c.today) - Date.parse(d.doc.due_date)) / 864e5)} days overdue` : ''}`}
          action={edit && !['draft', 'cancelled', 'paid'].includes(d.doc.status) ? <DialogButton size="sm" label="Record payment" title={`Record payment: ${d.doc.number}`} icon={<Plus size={14} />} wide>
            <ActionForm action={recordPayment.bind(null, id)} submit="Save payment" idempotent>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Amount (AED) *" hint={`Outstanding: AED ${fmtMoney(balance)}`}><Input name="amount" type="number" step="0.01" min="0.01" max={balance.toFixed(2)} defaultValue={balance.toFixed(2)} required inputMode="decimal" /></Field>
                <Field label="Date received *"><Input name="paid_on" type="date" defaultValue={c.today} max={c.today} required /></Field>
                <Field label="Method *"><Select name="method" defaultValue="bank_transfer">{Object.entries(METHOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
                <Field label="Reference" hint="Transfer ref., receipt no."><Input name="reference" maxLength={120} /></Field>
                <Field label="Bank"><Input name="bank_name" maxLength={120} placeholder="e.g. Emirates NBD" /></Field>
                <Field label="Cleared cheque" hint={applicable.length ? 'Only cheques you confirmed as Cleared appear here' : 'No cleared cheques to apply. Mark the cheque Cleared under Cheques first.'}>
                  <Select name="cheque_id" defaultValue="" disabled={!applicable.length}><option value="">— None —</option>{applicable.map((q: any) => <option key={q.id} value={q.id}>#{q.cheque_no} · {q.party_name} · AED {fmtMoney(q.amount)} · {q.cheque_date}</option>)}</Select></Field>
                {c.can('documents.upload') && <Field label="Receipt / proof (optional)" className="sm:col-span-2"><input type="file" name="file" accept={ACCEPT_ATTR} className="text-sm" /></Field>}
                <Field label="Notes" className="sm:col-span-2"><Input name="notes" maxLength={1000} /></Field>
              </div>
            </ActionForm></DialogButton> : null} />
        {d.doc.status === 'draft' ? <p className="px-4 py-6 text-sm text-muted">Issue the invoice (⋯ → Issue tax invoice) before recording payments.</p>
          : d.payments.length === 0 ? <p className="px-4 py-6 text-sm text-muted">No payments recorded yet.</p>
          : <TableWrap><thead className="bg-surface-2/50"><tr><Th>Date</Th><Th>Method</Th><Th>Reference</Th><Th>Cheque / bank</Th><Th>By</Th><Th className="text-right">Amount</Th><Th /></tr></thead><tbody className="divide-y divide-border">
            {d.payments.map((p: any) => { const q = p.cheque_id ? chequeOf.get(p.cheque_id) : null
              return <tr key={p.id}><Td className="whitespace-nowrap tabular-nums">{p.paid_on}</Td><Td>{METHOD[p.method] ?? p.method ?? '—'}</Td>
                <Td className="text-muted">{p.reference ?? '—'}{p.notes && <div className="text-xs">{p.notes}</div>}{p.document_id && <Link href={`/documents/${p.document_id}`} className="mt-0.5 inline-flex items-center gap-1 text-xs text-primary hover:underline"><Paperclip size={11} />{docName.get(p.document_id) ?? 'Attachment'}</Link>}</Td>
                <Td className="text-muted">{q ? <Link href={`/cheques?open=${q.id}`} className="text-primary hover:underline">#{q.cheque_no}</Link> : null}{q ? ` · ${q.bank_name}` : p.bank_name ?? '—'}</Td>
                <Td className="text-muted">{names.get(p.created_by) ?? '—'}</Td>
                <Td className="text-right font-medium tabular-nums">{fmtMoney(p.amount)}</Td>
                <Td className="text-right">{c.can('records.delete') && <ActionButton variant="ghost" action={deletePayment.bind(null, p.id)} confirm="Delete this payment? The invoice balance will be recalculated."><Trash2 size={14} /><span className="sr-only">Delete payment</span></ActionButton>}</Td></tr> })}
          </tbody></TableWrap>}
        <div className="h-2 overflow-hidden rounded-b-lg bg-surface-2" aria-hidden><div className="h-full bg-success transition-all" style={{ width: `${Math.min(100, Number(d.doc.total) ? ((d.paid + credited) / Number(d.doc.total)) * 100 : 0)}%` }} /></div>
      </Card>}

      {isInv && creditNotes.length > 0 && <Card><CardHeader title="Credit notes" action={<FileMinus size={15} className="text-muted" aria-hidden />} />
        <ul className="divide-y divide-border text-sm">{creditNotes.map((r: any) => <li key={r.id}><Link href={`/invoices/${r.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2/60"><span className="flex-1 font-mono text-[13px]">{r.number}</span><Badge tone={STATUS_TONE[r.status]}>{statusLabel('credit_note', r.status)}</Badge><span className="tabular-nums">{fmtMoney(r.total)}</span></Link></li>)}</ul></Card>}

      {isQtn && <Card><CardHeader title="Deliveries" sub="Partial deliveries against this quotation" action={<Truck size={15} className="text-muted" aria-hidden />} />
        {!d.items.length ? <p className="px-4 py-5 text-sm text-muted">No lines yet.</p> : <TableWrap><thead className="bg-surface-2/50"><tr><Th>Line</Th><Th className="text-right">Ordered</Th><Th className="text-right">Delivered</Th><Th className="text-right">Remaining</Th></tr></thead>
          <tbody className="divide-y divide-border">{d.items.map((it: any, i: number) => { const x = delivery[it.id] ?? { ordered: Number(it.quantity), delivered: 0 }
            return <tr key={it.id}><Td className="max-w-[14rem]"><span className="line-clamp-1">{i + 1}. {it.description}</span></Td><Td className="text-right tabular-nums">{x.ordered} {it.unit}</Td><Td className="text-right tabular-nums">{x.delivered}</Td>
              <Td className="text-right tabular-nums">{x.ordered - x.delivered > 0 ? <b>{+(x.ordered - x.delivered).toFixed(3)}</b> : <Badge tone="green">Complete</Badge>}</Td></tr> })}</tbody></TableWrap>}
        {deliveryNotes.length > 0 && <ul className="divide-y divide-border border-t border-border text-sm">{deliveryNotes.map((r: any) => <li key={r.id}><Link href={`/invoices/${r.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2/60"><Truck size={14} className="text-muted" aria-hidden /><span className="flex-1 font-mono text-[13px]">{r.number}</span><span className="text-xs text-muted">{r.issue_date}</span><Badge tone={STATUS_TONE[r.status]}>{statusLabel('delivery_note', r.status)}</Badge></Link></li>)}</ul>}
      </Card>}

      {isQtn && <Card><CardHeader title="Follow-ups" sub="Created automatically when the quotation is sent" action={edit ? <DialogButton size="sm" variant="secondary" label="Add" title="Schedule follow-up" icon={<Plus size={14} />}><ActionForm action={addFollowup.bind(null, id)} submit="Schedule">
          <Field label="Date *"><Input name="due_date" type="date" required min={c.today} defaultValue={c.today} /></Field><Field label="Note"><Input name="note" maxLength={500} placeholder="e.g. Call Mr. Ahmed about revised price" /></Field></ActionForm></DialogButton> : null} />
        {!(followups ?? []).length ? <p className="px-4 py-5 text-sm text-muted">{d.doc.status === 'draft' ? 'Follow-ups are scheduled when you mark the quotation as sent.' : 'No follow-ups scheduled.'}</p>
          : <ul className="divide-y divide-border text-sm">{(followups ?? []).map((f: any) => { const due = !f.done_at && f.due_date <= c.today
            return <li key={f.id} className="flex items-center gap-3 px-4 py-2.5">
              {f.done_at ? <CheckCircle2 size={16} className="shrink-0 text-success" aria-hidden /> : <BellRing size={16} className={due ? 'shrink-0 text-warning' : 'shrink-0 text-muted'} aria-hidden />}
              <span className="min-w-0 flex-1"><span className={f.done_at ? 'text-muted line-through' : ''}>{f.note ?? 'Follow up'}</span><span className="block text-xs text-muted">{formatLongDate(f.due_date)}{f.outcome ? ` · ${f.outcome}` : ''}{due ? ' · due' : ''}</span></span>
              {!f.done_at && edit && <DialogButton size="sm" variant="ghost" label="Done" title="Complete follow-up"><ActionForm action={completeFollowup.bind(null, f.id)} submit="Mark done"><Field label="Outcome"><Input name="outcome" maxLength={500} placeholder="e.g. Customer asked for 5% discount" /></Field></ActionForm></DialogButton>}</li> })}</ul>}
      </Card>}

      {t !== 'delivery_note' && <Card><CardHeader title="Revisions" sub={d.doc.revision ? `Current: revision ${d.doc.revision}` : 'Revision 0 (original)'} action={<History size={15} className="text-muted" aria-hidden />} />
        {!(revisions ?? []).length ? <p className="px-4 py-5 text-sm text-muted">{d.doc.status === 'draft' ? 'Drafts are edited in place. Once sent, every change keeps the previous version here.' : 'No changes since it was sent.'}</p>
          : <ul className="divide-y divide-border text-sm">
            <li className="flex items-center gap-3 px-4 py-2.5"><Badge tone="blue">Rev.{d.doc.revision}</Badge><span className="flex-1 text-muted">Current version</span></li>
            {(revisions ?? []).map((r: any) => <li key={r.id}><Link href={`/invoices/${id}/revisions/${r.revision}`} className="block px-4 py-2.5 hover:bg-surface-2/60">
              <div className="flex items-center gap-2"><Badge>Rev.{r.revision}</Badge><span className="text-xs text-muted">replaced {new Date(r.created_at).toLocaleString('en-GB', { timeZone: c.company.timezone, dateStyle: 'medium', timeStyle: 'short' })} by {names.get(r.created_by) ?? 'someone'}</span></div>
              <div className="mt-1 line-clamp-2 text-xs">{(r.changes ?? []).join(' · ') || 'Changes'}</div></Link></li>)}</ul>}
      </Card>}

      <Card><CardHeader title="Linked records" />
        <ul className="divide-y divide-border text-sm">
          {d.customer && <Linked icon={Link2} href={`/parties/${d.customer.id}`} label="Customer" value={d.customer.name} />}
          {d.project && <Linked icon={FolderOpen} href={`/projects/${d.project.id}`} label="Project" value={`${d.project.code ? d.project.code + ' · ' : ''}${d.project.name}`} />}
          {d.related.filter((r: any) => r.id !== id).map((r: any) => <Linked key={r.id} icon={ArrowRightLeft} href={`/invoices/${r.id}`} label={DOC_META[r.doc_type as SalesType]?.label ?? r.doc_type}
            value={<span className="inline-flex items-center gap-2">{r.number}<Badge tone={STATUS_TONE[r.status]}>{statusLabel(r.doc_type, r.status)}</Badge></span>} />)}
          {d.doc.pdf_document_id && <Linked icon={Paperclip} href={`/documents/${d.doc.pdf_document_id}`} label="Archived PDF" value="Open in Document Vault" />}
          {!d.customer && !d.project && !d.related.some((r: any) => r.id !== id) && !d.doc.pdf_document_id && <li className="px-4 py-5 text-muted">Nothing linked yet. Pick a saved customer or project, or convert this document.</li>}
        </ul>
      </Card>

      <Card><CardHeader title="History" sub="Created, sent, printed, downloaded, emailed …" action={<Clock size={15} className="text-muted" aria-hidden />} />
        {!(events ?? []).length ? <p className="px-4 py-5 text-sm text-muted">No activity recorded yet.</p>
          : <ul className="max-h-80 divide-y divide-border overflow-y-auto text-sm">{(events ?? []).map((e: any) => <li key={e.id} className="px-4 py-2">
            <div className="flex items-baseline justify-between gap-2"><span className="font-medium">{EVENT[e.event] ?? e.event}</span><span className="shrink-0 text-xs text-muted">{new Date(e.created_at).toLocaleString('en-GB', { timeZone: c.company.timezone, dateStyle: 'medium', timeStyle: 'short' })}</span></div>
            <div className="text-xs text-muted">{[e.detail, names.get(e.user_id)].filter(Boolean).join(' · ')}</div></li>)}</ul>}
        {d.doc.approval_status && <p className="border-t border-border px-4 py-2 text-xs text-muted">Approval: {APPROVAL_LABEL[d.doc.approval_status]}{d.doc.approved_by ? ` by ${names.get(d.doc.approved_by) ?? '—'}` : ''}</p>}
      </Card>
    </div>
  </>
}
function Linked({ icon: Icon, href, label, value }: { icon: typeof Link2; href: string; label: string; value: React.ReactNode }) {
  return <li><Link href={href} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2/60"><Icon size={15} className="text-muted" aria-hidden /><span className="w-28 shrink-0 text-xs text-muted">{label}</span><span className="min-w-0 truncate font-medium">{value}</span></Link></li>
}
