import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft, BookOpen, Clock, FileText, HardHat, Landmark, Mail, MapPin, MessageCircle, Pencil, Phone, Receipt, Target, Trash2, Wallet } from 'lucide-react'
import { getCtx } from '@/lib/auth'
import { Badge, Card, CardHeader, EmptyState, LinkButton, Metrics, StatCard, Td, Th, TableWrap } from '@/components/ui/primitives'
import { DialogButton } from '@/components/ui/dialog'
import { ActionButton, ActionForm } from '@/components/ui/action-form'
import { NewSalesButtons } from '@/components/sales/new-buttons'
import { PartyFields } from '@/components/parties/party-fields'
import { updateParty } from '@/app/actions/projects'
import { trashRecord } from '@/app/actions/trash'
import { DOC_META, STATUS_TONE, statusLabel, type SalesType } from '@/lib/sales/docs'
import { fmtMoney } from '@/lib/sales/money'
import { buildLedger } from '@/lib/ledger'
import { PROJECT_STATUS } from '@/lib/projects'
import { formatAed, localDate } from '@/lib/time'
import { RecordActivity } from '@/components/record-activity'
import { RecordTasks } from '@/components/record-tasks'
import { CustomFieldsCard } from '@/components/custom-fields-card'
import { ShareLinks } from '@/components/share-links'

export const metadata = { title: 'Customer' }
type Ev = { at: string; icon: typeof FileText; text: string; href?: string }

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const c = await getCtx(); if (!c.can('documents.view')) redirect('/')
  const { data: cu } = await c.supabase.from('customers').select('*').eq('id', id).maybeSingle()
  if (!cu) notFound()
  const fin = c.can('finance.view'), edit = c.can('records.edit')
  const [{ data: sales }, { data: projects }, { data: rel }, { data: cheques }, { data: pays }, ledger] = await Promise.all([
    fin ? c.supabase.from('invoices').select('id,doc_type,number,status,total,issue_date,due_date,created_at').eq('customer_id', id).order('issue_date', { ascending: false }).limit(300) : Promise.resolve({ data: [] as any[] }),
    c.supabase.from('projects').select('id,name,code,status,contract_value,created_at').eq('customer_id', id).order('created_at', { ascending: false }),
    c.supabase.from('document_relationships').select('role,created_at,document:documents(id,name,created_at,deleted_at)').eq('related_type', 'customer').eq('related_id', id).limit(200),
    fin ? c.supabase.from('cheques').select('id,cheque_no,amount,cheque_date,status,created_at').eq('customer_id', id).order('cheque_date', { ascending: false }).limit(50) : Promise.resolve({ data: [] as any[] }),
    fin ? c.supabase.from('payments').select('id,amount,paid_on,method,reference,created_at,invoice:invoices(id,number)').eq('customer_id', id).order('paid_on', { ascending: false }).limit(50) : Promise.resolve({ data: [] as any[] }),
    fin ? buildLedger(c, id) : Promise.resolve(null),
  ])
  const docs = (rel ?? []).map((r: any) => ({ ...r.document, role: r.role })).filter((d: any) => d.id && !d.deleted_at)
  const lifetime = (pays ?? []).reduce((s: number, p: any) => s + Number(p.amount), 0)
  const openQ = (sales ?? []).filter((s: any) => s.doc_type === 'quotation' && ['sent', 'viewed', 'follow_up', 'draft'].includes(s.status))
  const decided = (sales ?? []).filter((s: any) => s.doc_type === 'quotation' && ['accepted', 'converted', 'rejected', 'expired'].includes(s.status))
  const won = decided.filter((s: any) => ['accepted', 'converted'].includes(s.status)).length
  const wa = (cu.whatsapp || '').replace(/\D/g, '').replace(/^00/, '').replace(/^0(5\d{8})$/, '971$1')

  // timeline: what happened with this customer, newest first
  const ev: Ev[] = [
    ...(sales ?? []).map((s: any) => ({ at: s.created_at, icon: s.doc_type === 'invoice' ? Receipt : FileText, text: `${DOC_META[s.doc_type as SalesType]?.label ?? s.doc_type} ${s.number}: ${statusLabel(s.doc_type, s.status).toLowerCase()}`, href: `/invoices/${s.id}` })),
    ...(pays ?? []).map((p: any) => ({ at: p.created_at, icon: Wallet, text: `Payment received AED ${fmtMoney(p.amount)}${p.invoice ? ` for ${p.invoice.number}` : ' on account'}`, href: p.invoice ? `/invoices/${p.invoice.id}` : undefined })),
    ...(cheques ?? []).map((q: any) => ({ at: q.created_at, icon: Landmark, text: `Cheque #${q.cheque_no} AED ${fmtMoney(q.amount)}: ${q.status}`, href: `/cheques?open=${q.id}` })),
    ...(projects ?? []).map((p: any) => ({ at: p.created_at, icon: HardHat, text: `Project “${p.name}” created`, href: `/projects/${p.id}` })),
    ...docs.map((d: any) => ({ at: d.created_at, icon: FileText, text: `Document uploaded: ${d.name}`, href: `/documents/${d.id}` })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 25)
  const when = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { timeZone: c.company.timezone, day: '2-digit', month: 'short', year: 'numeric' })

  return <>
    <Link href="/parties" className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg"><ArrowLeft size={14} />Customers & Suppliers</Link>
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-primary-soft text-lg font-semibold text-primary" aria-hidden>{cu.name.slice(0, 1).toUpperCase()}</div>
        <div className="min-w-0"><h1 className="text-xl font-semibold tracking-tight">{cu.name}</h1>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
            {cu.contact_person && <span>{cu.contact_person}</span>}
            {cu.phone && <a href={`tel:${cu.phone}`} className="inline-flex items-center gap-1 hover:text-primary"><Phone size={13} aria-hidden />{cu.phone}</a>}
            {wa.length >= 9 && <a href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-primary"><MessageCircle size={13} aria-hidden />WhatsApp</a>}
            {cu.email && <a href={`mailto:${cu.email}`} className="inline-flex items-center gap-1 hover:text-primary"><Mail size={13} aria-hidden />{cu.email}</a>}
            {cu.address && <span className="inline-flex items-center gap-1 whitespace-pre-line"><MapPin size={13} aria-hidden />{cu.address}</span>}
            {cu.trn && <span className="font-mono text-xs">TRN {cu.trn}</span>}
            {cu.credit_days != null && <span>Credit terms: {cu.credit_days} days</span>}
          </div>
          {cu.notes && <p className="mt-2 max-w-3xl whitespace-pre-line text-sm text-muted">{cu.notes}</p>}</div></div>
      <div className="flex flex-wrap gap-2">
        {fin && <LinkButton href={`/parties/${id}/ledger`} variant="secondary"><BookOpen size={14} />Ledger & statement</LinkButton>}
        {edit && <DialogButton wide variant="secondary" label="Edit" title="Edit client" icon={<Pencil size={14} />}><ActionForm action={updateParty.bind(null, 'customers', id)} resetOnSuccess={false}><PartyFields p={cu} /></ActionForm></DialogButton>}
        {edit && fin && <NewSalesButtons customerId={id} only={['quotation', 'invoice']} />}
        {c.can('records.delete') && <ActionButton variant="ghost" size="md" action={trashRecord.bind(null, 'customer', id)} confirm={`Move “${cu.name}” to the trash? Their documents and invoices are kept; an admin can restore the customer from Settings → Trash.`}><Trash2 size={14} />Delete</ActionButton>}
      </div>
    </div>

    {fin && ledger && <Metrics className="mb-5" cols={4}>
      <StatCard label="Outstanding" value={formatAed(ledger.outstanding)} hint={cu.opening_balance ? `incl. opening balance ${formatAed(cu.opening_balance)}` : `${ledger.invoices.filter(i => i.balance > 0.004).length} open invoice(s)`} icon={Wallet} tone={ledger.outstanding > 0 ? 'amber' : 'neutral'} href={`/parties/${id}/ledger`} />
      <StatCard label="Overdue" value={formatAed(ledger.overdue)} icon={Receipt} tone={ledger.overdue ? 'red' : 'neutral'} href={`/parties/${id}/ledger?status=overdue`} />
      <StatCard label="Received (all time)" value={formatAed(lifetime)} icon={Landmark} tone="green" />
      <StatCard label="Open quotations" value={formatAed(openQ.reduce((s: number, q: any) => s + Number(q.total), 0))} hint={decided.length ? `${Math.round((won / decided.length) * 100)}% win rate` : undefined} icon={Target} />
    </Metrics>}

    <div className="grid gap-5 xl:grid-cols-3 [&>*]:min-w-0">
      {fin && <Card className="xl:col-span-2"><CardHeader title="Quotations, invoices, delivery & credit notes" />
        {!(sales ?? []).length ? <EmptyState icon={Receipt} title="No sales documents yet" body="Create a quotation. This customer’s details are filled in for you." action={edit ? <NewSalesButtons customerId={id} only={['quotation']} /> : undefined} />
          : <TableWrap><thead className="bg-surface-2/50"><tr><Th>No.</Th><Th>Type</Th><Th>Date</Th><Th className="text-right">Total</Th><Th className="text-right">Balance</Th><Th>Status</Th></tr></thead>
            <tbody className="divide-y divide-border">{(sales ?? []).map((s: any) => { const b = ledger?.invoices.find(i => i.id === s.id)
              return <tr key={s.id} className="hover:bg-surface-2/50">
                <Td><Link href={`/invoices/${s.id}`} className="font-mono text-[13px] text-primary hover:underline">{s.number}</Link></Td><Td>{DOC_META[s.doc_type as SalesType]?.label}</Td><Td className="tabular-nums">{s.issue_date}</Td>
                <Td className="text-right tabular-nums">{DOC_META[s.doc_type as SalesType]?.priced ? fmtMoney(s.total) : '—'}</Td>
                <Td className="text-right tabular-nums">{b ? fmtMoney(b.balance) : '—'}</Td>
                <Td><Badge tone={STATUS_TONE[s.status]}>{statusLabel(s.doc_type, s.status)}</Badge></Td></tr> })}</tbody></TableWrap>}
      </Card>}
      <Card><CardHeader title="Timeline" action={<Clock size={15} className="text-muted" aria-hidden />} />
        {!ev.length ? <p className="px-4 py-5 text-sm text-muted">Nothing yet.</p> : <ol className="max-h-[520px] divide-y divide-border overflow-y-auto text-sm">{ev.map((e, i) => <li key={i}>
          {e.href ? <Link href={e.href} className="flex gap-3 px-4 py-2.5 hover:bg-surface-2/60"><e.icon size={15} className="mt-0.5 shrink-0 text-muted" aria-hidden /><span className="min-w-0 flex-1">{e.text}<span className="block text-xs text-muted">{when(e.at)}</span></span></Link>
            : <div className="flex gap-3 px-4 py-2.5"><e.icon size={15} className="mt-0.5 shrink-0 text-muted" aria-hidden /><span className="min-w-0 flex-1">{e.text}<span className="block text-xs text-muted">{when(e.at)}</span></span></div>}</li>)}</ol>}</Card>
      {fin && <Card><CardHeader title="Payments" action={<Link href={`/parties/${id}/ledger`} className="text-xs text-primary hover:underline">Ledger</Link>} />
        {!(pays ?? []).length ? <p className="px-4 py-5 text-sm text-muted">No payments yet.</p> :
          <ul className="divide-y divide-border text-sm">{(pays ?? []).slice(0, 10).map((p: any) => <li key={p.id} className="flex items-center gap-3 px-4 py-2.5"><span className="tabular-nums text-xs text-muted">{p.paid_on}</span><span className="min-w-0 flex-1 truncate">{p.invoice?.number ?? 'On account'}{p.reference ? ` · ${p.reference}` : ''}</span><span className="font-medium tabular-nums text-success">{fmtMoney(p.amount)}</span></li>)}</ul>}</Card>}
      <Card><CardHeader title="Projects" />
        {!(projects ?? []).length ? <p className="px-4 py-5 text-sm text-muted">No projects.</p> :
          <ul className="divide-y divide-border">{(projects ?? []).map((p: any) => <li key={p.id}><Link href={`/projects/${p.id}`} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-surface-2/60">
            <HardHat size={15} className="text-muted" aria-hidden /><span className="min-w-0 flex-1 truncate">{p.name}</span><Badge tone={PROJECT_STATUS[p.status].tone}>{PROJECT_STATUS[p.status].label}</Badge></Link></li>)}</ul>}</Card>
      {fin && <Card><CardHeader title="Cheques" />
        {!(cheques ?? []).length ? <p className="px-4 py-5 text-sm text-muted">No cheques linked.</p> :
          <ul className="divide-y divide-border">{(cheques ?? []).map((q: any) => <li key={q.id}><Link href={`/cheques?open=${q.id}`} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-surface-2/60">
            <span className="font-mono text-xs">#{q.cheque_no}</span><span className="flex-1 text-xs text-muted">{q.cheque_date} · {q.status}</span><span className="tabular-nums">{fmtMoney(q.amount)}</span></Link></li>)}</ul>}</Card>}
      <Card><CardHeader title="Documents" />
        {!docs.length ? <p className="px-4 py-5 text-sm text-muted">No linked documents.</p> :
          <ul className="divide-y divide-border">{docs.map((d: any) => <li key={d.id}><Link href={`/documents/${d.id}`} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-surface-2/60">
            <FileText size={15} className="text-primary" aria-hidden /><span className="min-w-0 flex-1 truncate">{d.name}</span><span className="text-xs text-muted">{localDate(d.created_at, c.company.timezone)}</span></Link></li>)}</ul>}</Card>
    </div>
    <div className="mt-5 grid gap-5 xl:grid-cols-2 [&>*]:min-w-0"><ShareLinks c={c} kind="customer_portal" target="customer" targetId={id} recipient={cu.contact_person ?? cu.name} sub="Your customer sees their quotations (and can accept them), invoices, statement and project progress. Read-only." shareText={`Your account with ${c.company.name}`} /><ShareLinks c={c} kind="document_request" target="customer" targetId={id} title="Request documents" recipient={cu.contact_person ?? cu.name} sub="Ask for trade licence, TRN certificate, LPO and similar. Files arrive in Smart Inbox for review." shareText={`${c.company.name}: documents requested`} /><CustomFieldsCard c={c} entity="customer" recordId={id} /><RecordTasks c={c} type="customer" id={id} title={`Follow up ${cu.name}`} /><RecordActivity c={c} table="customers" id={id} className="xl:col-span-2" /></div>
  </>
}
