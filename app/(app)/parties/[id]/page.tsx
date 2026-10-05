import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft, FileText, HardHat, Landmark, Mail, MapPin, Pencil, Phone, Receipt, Target, Wallet } from 'lucide-react'
import { getCtx } from '@/lib/auth'
import { Badge, Card, CardHeader, EmptyState, Field, Input, StatCard, Td, Th, TableWrap, Textarea } from '@/components/ui/primitives'
import { DialogButton } from '@/components/ui/dialog'
import { ActionForm } from '@/components/ui/action-form'
import { NewSalesButtons } from '@/components/sales/new-buttons'
import { updateParty } from '@/app/actions/projects'
import { DOC_META, STATUS_LABEL, STATUS_TONE, type SalesType } from '@/lib/sales/docs'
import { fmtMoney } from '@/lib/sales/money'
import { salesKpis } from '@/lib/sales/summary'
import { PROJECT_STATUS } from '@/lib/projects'
import { formatAed } from '@/lib/time'

export const metadata = { title: 'Customer' }

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const c = await getCtx(); if (!c.can('documents.view')) redirect('/')
  const { data: cu } = await c.supabase.from('customers').select('*').eq('id', id).maybeSingle()
  if (!cu) notFound()
  const fin = c.can('finance.view'), edit = c.can('records.edit')
  const [{ data: sales }, { data: projects }, { data: rel }, { data: cheques }, { data: pays }] = await Promise.all([
    fin ? c.supabase.from('invoices').select('id,doc_type,number,status,total,issue_date,due_date,customer_name,customer_id').eq('customer_id', id).order('issue_date', { ascending: false }).limit(500) : Promise.resolve({ data: [] as any[] }),
    c.supabase.from('projects').select('id,name,code,status,contract_value').eq('customer_id', id).order('created_at', { ascending: false }),
    c.supabase.from('document_relationships').select('role,document:documents(id,name,created_at,deleted_at)').eq('related_type', 'customer').eq('related_id', id).limit(200),
    fin ? c.supabase.from('cheques').select('id,cheque_no,amount,cheque_date,status').eq('customer_id', id).order('cheque_date', { ascending: false }).limit(50) : Promise.resolve({ data: [] as any[] }),
    fin ? c.supabase.from('payments').select('amount,paid_on').eq('customer_id', id).limit(5000) : Promise.resolve({ data: [] as any[] }),
  ])
  const ids = (sales ?? []).filter((s: any) => s.doc_type === 'invoice').map((s: any) => s.id)
  const { data: bals } = ids.length ? await c.supabase.from('invoice_balances').select('id,paid').in('id', ids) : { data: [] as any[] }
  const paid = new Map((bals ?? []).map((b: any) => [b.id, Number(b.paid)]))
  const rows = (sales ?? []).map((s: any) => ({ ...s, total: Number(s.total), paid: paid.get(s.id) ?? 0 }))
  const k = salesKpis(rows, (pays ?? []) as any, c.today)
  const lifetime = (pays ?? []).reduce((s: number, p: any) => s + Number(p.amount), 0)
  const docs = (rel ?? []).map((r: any) => ({ ...r.document, role: r.role })).filter((d: any) => d.id && !d.deleted_at)

  return <>
    <Link href="/parties" className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg"><ArrowLeft size={14} />Clients & Suppliers</Link>
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-primary-soft text-lg font-semibold text-primary" aria-hidden>{cu.name.slice(0, 1).toUpperCase()}</div>
        <div><h1 className="text-xl font-semibold tracking-tight">{cu.name}</h1>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
            {cu.contact_person && <span>{cu.contact_person}</span>}
            {cu.phone && <a href={`tel:${cu.phone}`} className="inline-flex items-center gap-1 hover:text-primary"><Phone size={13} aria-hidden />{cu.phone}</a>}
            {cu.email && <a href={`mailto:${cu.email}`} className="inline-flex items-center gap-1 hover:text-primary"><Mail size={13} aria-hidden />{cu.email}</a>}
            {cu.address && <span className="inline-flex items-center gap-1"><MapPin size={13} aria-hidden />{cu.address}</span>}
            {cu.trn && <span className="font-mono text-xs">TRN {cu.trn}</span>}
          </div></div></div>
      <div className="flex flex-wrap gap-2">
        {edit && <DialogButton wide variant="secondary" label="Edit" title="Edit client" icon={<Pencil size={14} />}><ActionForm action={updateParty.bind(null, 'customers', id)} resetOnSuccess={false}>
          <div className="grid gap-4 sm:grid-cols-2"><Field label="Name *"><Input name="name" required defaultValue={cu.name} /></Field><Field label="Contact person"><Input name="contact_person" defaultValue={cu.contact_person ?? ''} /></Field>
            <Field label="Phone"><Input name="phone" inputMode="tel" defaultValue={cu.phone ?? ''} /></Field><Field label="Email"><Input name="email" type="email" defaultValue={cu.email ?? ''} /></Field>
            <Field label="TRN"><Input name="trn" defaultValue={cu.trn ?? ''} /></Field><Field label="Address"><Input name="address" defaultValue={cu.address ?? ''} /></Field>
            <Field label="Notes" className="sm:col-span-2"><Textarea name="notes" defaultValue={cu.notes ?? ''} /></Field></div></ActionForm></DialogButton>}
        {edit && fin && <NewSalesButtons customerId={id} only={['quotation', 'invoice']} />}
      </div>
    </div>

    {fin && <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Outstanding" value={formatAed(k.outstanding)} hint={`${k.openCount} open invoice${k.openCount === 1 ? '' : 's'}`} icon={Wallet} tone={k.outstanding ? 'amber' : 'neutral'} />
      <StatCard label="Overdue" value={formatAed(k.overdue)} icon={Receipt} tone={k.overdue ? 'red' : 'neutral'} />
      <StatCard label="Received (all time)" value={formatAed(lifetime)} icon={Landmark} tone="green" />
      <StatCard label="Open quotations" value={formatAed(k.pipeline)} hint={k.winRate !== null ? `${k.winRate}% win rate` : undefined} icon={Target} />
    </div>}

    <div className="grid gap-5 xl:grid-cols-3">
      {fin && <Card className="xl:col-span-2"><CardHeader title="Sales documents" />
        {!rows.length ? <EmptyState icon={Receipt} title="No quotations or invoices yet" />
          : <TableWrap><thead className="bg-surface-2/50"><tr><Th>No.</Th><Th>Type</Th><Th>Date</Th><Th className="text-right">Total</Th><Th className="text-right">Balance</Th><Th>Status</Th></tr></thead>
            <tbody className="divide-y divide-border">{rows.map((s: any) => <tr key={s.id} className="hover:bg-surface-2/50">
              <Td><Link href={`/invoices/${s.id}`} className="font-mono text-[13px] text-primary hover:underline">{s.number}</Link></Td><Td>{DOC_META[s.doc_type as SalesType]?.label}</Td><Td className="tabular-nums">{s.issue_date}</Td>
              <Td className="text-right tabular-nums">{DOC_META[s.doc_type as SalesType]?.priced ? fmtMoney(s.total) : '—'}</Td>
              <Td className="text-right tabular-nums">{s.doc_type === 'invoice' && !['draft', 'cancelled'].includes(s.status) ? fmtMoney(s.total - s.paid) : '—'}</Td>
              <Td><Badge tone={STATUS_TONE[s.status]}>{STATUS_LABEL[s.status]}</Badge></Td></tr>)}</tbody></TableWrap>}
      </Card>}
      <div className="flex flex-col gap-5">
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
              <FileText size={15} className="text-primary" aria-hidden /><span className="min-w-0 flex-1 truncate">{d.name}</span><span className="text-xs text-muted">{d.created_at.slice(0, 10)}</span></Link></li>)}</ul>}</Card>
      </div>
    </div>
  </>
}
