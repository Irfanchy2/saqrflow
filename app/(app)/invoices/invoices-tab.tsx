import Link from 'next/link'
import { Receipt } from '@/components/icons'
import { getCtx } from '@/lib/auth'
import { PAGE_SIZE, pageOf, sanitizeQ } from '@/lib/queries'
import { Card, EmptyState, Money, Pagination, TableWrap, Td, Th } from '@/components/ui/primitives'
import { FilterBar, FilterTabs, MList, MRow, Tile, TINTS } from '@/components/ui/mobile'
import { NewDocFab, NewSalesButtons } from '@/components/sales/new-buttons'
import { DocStatusBadge, InvoiceStatus, PayStatusBadge } from '@/components/sales/status-badges'
import { InvoiceRowActions } from '@/components/sales/invoice-actions'
import { daysOverdue, type DocState, type PayState } from '@/lib/sales/status'
import { fmtMoney } from '@/lib/sales/money'
import { formatShortDate } from '@/lib/time'
import { cn } from '@/lib/utils'

// Tax invoices: document status and payment status side by side, the money in its own columns, actions on every row.
const VIEWS: { k: string; label: string; pay?: PayState | 'open'; doc?: DocState }[] = [
  { k: '', label: 'All' }, { k: 'unpaid', label: 'Unpaid', pay: 'unpaid' }, { k: 'partially_paid', label: 'Partially paid', pay: 'partially_paid' },
  { k: 'overdue', label: 'Overdue', pay: 'overdue' }, { k: 'paid', label: 'Paid', pay: 'paid' }, { k: 'draft', label: 'Draft', doc: 'draft' }, { k: 'cancelled', label: 'Cancelled', doc: 'cancelled' },
]
const TINT: Record<string, string> = { paid: TINTS.green, partially_paid: TINTS.amber, overdue: TINTS.rose, unpaid: TINTS.orange, credited: TINTS.slate }
const COLS = 'id,number,status,customer_id,customer_name,subject,site,project_id,issue_date,due_date,total,paid,credited,balance,doc_status,payment_status,viewed_at'

export async function InvoicesTab({ sp, edit }: { sp: Record<string, string | undefined>; edit: boolean }) {
  const c = await getCtx()
  const page = pageOf(sp.page), term = sanitizeQ(sp.q)
  // older links: ?status=overdue|paid|partially_paid|draft|cancelled and the report drill-downs ?due=overdue|open
  const viewKey = sp.view ?? (sp.due === 'overdue' ? 'overdue' : sp.due === 'open' ? 'open' : sp.status === 'sent' ? 'unpaid' : sp.status) ?? ''
  const view = VIEWS.find(v => v.k === viewKey) ?? (viewKey === 'open' ? { k: 'open', label: 'Open', pay: 'open' as const } : VIEWS[0])
  const base = () => {
    let q = c.supabase.from('invoice_list').select(COLS, { count: 'exact' }).eq('doc_type', 'invoice')
    if (term) q = q.or(`number.ilike.%${term}%,customer_name.ilike.%${term}%,subject.ilike.%${term}%,site.ilike.%${term}%,lpo_ref.ilike.%${term}%`)
    if (/^\d{4}-\d{2}-\d{2}$/.test(sp.from ?? '')) q = q.gte('issue_date', sp.from!)
    if (/^\d{4}-\d{2}-\d{2}$/.test(sp.to ?? '')) q = q.lte('issue_date', sp.to!)
    if (sp.issued === '1') q = q.not('status', 'in', '(draft,cancelled)')
    if (/^[0-9a-f-]{36}$/.test(sp.customer ?? '')) q = q.eq('customer_id', sp.customer!)
    if (/^[0-9a-f-]{36}$/.test(sp.project ?? '')) q = q.eq('project_id', sp.project!)
    return q
  }
  let q = base()
  if (view.pay === 'open') q = q.in('payment_status', ['unpaid', 'partially_paid', 'overdue'])
  else if (view.pay) q = q.eq('payment_status', view.pay)
  if (view.doc) q = q.eq('doc_status', view.doc)
  const head = { count: 'exact' as const, head: true }
  const [{ data, count }, ...counts] = await Promise.all([
    q.order('issue_date', { ascending: false }).order('number', { ascending: false }).range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1),
    ...VIEWS.slice(1).map(v => { const b = c.supabase.from('invoice_list').select('id', head).eq('doc_type', 'invoice'); return v.pay ? b.eq('payment_status', v.pay) : b.eq('doc_status', v.doc!) }),
  ])
  const n = Object.fromEntries(VIEWS.slice(1).map((v, i) => [v.k, counts[i].count ?? 0]))
  const rows = (data ?? []) as any[]
  const pids = [...new Set(rows.map(r => r.project_id).filter(Boolean))]
  const { data: projs } = pids.length ? await c.supabase.from('projects').select('id,name').in('id', pids) : { data: [] as { id: string; name: string }[] }
  const projName = new Map((projs ?? []).map(p => [p.id, p.name]))
  const money = (r: any) => ({ id: r.id, number: r.number, status: r.status, total: Number(r.total), paid: Number(r.paid), credited: Number(r.credited), due_date: r.due_date, viewed: !!r.viewed_at })
  const href = (k: string) => `/invoices?tab=invoice${k ? `&view=${k}` : ''}${sp.q ? `&q=${encodeURIComponent(sp.q)}` : ''}`
  const cls = 'h-9 rounded-md border border-border bg-surface px-3 text-sm'
  const filtered = sp.from || sp.to || sp.customer || sp.project || sp.issued
  return <Card>
    <FilterTabs label="Payment status" className="px-2" tabs={VIEWS.map(v => ({ href: href(v.k), label: v.label, active: view.k === v.k, count: v.k ? n[v.k] : undefined }))} />
    <form className="border-b border-border p-3"><input type="hidden" name="tab" value="invoice" />{view.k && <input type="hidden" name="view" value={view.k} />}
      <FilterBar active={false} search={<input name="q" type="search" defaultValue={sp.q} aria-label="Search tax invoices" placeholder="Search number, customer, site, LPO…" className={`${cls} h-11 min-w-0 flex-1 sm:h-10`} />}>
        <button className="h-10 cursor-pointer rounded-lg border border-border px-4 text-sm hover:bg-surface-2">Search</button></FilterBar></form>
    {(filtered || view.k === 'open') && <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-primary-soft/50 px-4 py-2 text-sm">
      <span>Filtered list{view.k === 'open' ? ': open invoices (not fully paid)' : ''}{sp.from || sp.to ? ` · issued ${sp.from ?? '…'} to ${sp.to ?? '…'}` : ''}{sp.customer ? ' · one customer' : ''}{sp.project ? ' · one project' : ''}</span>
      <Link href="/invoices?tab=invoice" className="text-xs font-medium text-primary hover:underline">Clear filter</Link></div>}
    {!rows.length ? <EmptyState icon={Receipt} title={term || view.k ? 'No tax invoices match' : 'No tax invoices yet'}
      body={term || view.k ? 'Try a different search or status.' : 'Create a tax invoice, or convert an accepted quotation (⋯ → Convert to invoice).'}
      action={edit && !term && !view.k ? <NewSalesButtons only={['invoice']} /> : undefined} />
      : <>
        <MList>{rows.map(r => { const late = daysOverdue(r.due_date, c.today), bal = Number(r.balance), issued = !['draft', 'cancelled'].includes(r.status)
          return <MRow key={r.id} href={`/invoices/${r.id}`} lead={<Tile icon={Receipt} tint={TINT[r.payment_status] ?? TINTS.slate} />}
            title={r.number} sub={r.customer_name ?? r.subject ?? '—'}
            line={<div className="flex w-full flex-col gap-1.5" data-invoice-card>
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5"><Money value={r.total} className="text-[15px] font-semibold tracking-[-0.01em]" />
                {issued && bal > 0.005 && <span className={cn('whitespace-nowrap text-[12.5px] font-medium tabular-nums', r.payment_status === 'overdue' ? 'text-danger' : 'text-warning')}>{fmtMoney(bal)} due</span>}
                {issued && Number(r.paid) > 0 && bal > 0.005 && <span className="whitespace-nowrap text-[12px] tabular-nums text-muted">{fmtMoney(r.paid)} paid</span>}</div>
              <InvoiceStatus doc={r.doc_status} pay={r.payment_status} bare className="gap-1.5" /></div>}
            right={<InvoiceRowActions inv={money(r)} today={c.today} canEdit={edit} canDelete={c.can('records.delete')} />}
            rightSub={r.due_date ? <span className={cn(r.payment_status === 'overdue' && 'font-medium text-danger')}>Due {formatShortDate(r.due_date)}</span> : formatShortDate(r.issue_date)} /> })}</MList>
        <div className="hidden sm:block"><TableWrap><thead className="bg-surface-2/50"><tr>
          <Th>No. / date</Th><Th>Customer</Th><Th>Due date</Th><Th>Invoice status</Th><Th>Payment status</Th>
          <Th className="text-right">Total (AED)</Th><Th className="text-right">Paid</Th><Th className="text-right">Balance</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
          <tbody className="divide-y divide-border">{rows.map(r => { const late = daysOverdue(r.due_date, c.today), bal = Number(r.balance), issued = !['draft', 'cancelled'].includes(r.status)
            return <tr key={r.id} className="hover:bg-surface-2/50" data-invoice-row={r.number}>
              <Td><Link href={`/invoices/${r.id}`} className="whitespace-nowrap font-mono text-[13px] font-medium text-primary hover:underline">{r.number}</Link><div className="whitespace-nowrap text-xs tabular-nums text-muted">{r.issue_date}</div></Td>
              <Td className="max-w-[220px]"><div className="truncate" title={r.customer_name ?? undefined}>{r.customer_name ?? <span className="text-muted">—</span>}</div>
                {(r.subject || projName.get(r.project_id) || r.site) && <div className="truncate text-xs text-muted" title={r.subject ?? projName.get(r.project_id) ?? r.site}>{r.subject ?? projName.get(r.project_id) ?? r.site}</div>}</Td>
              <Td className={cn('whitespace-nowrap tabular-nums', r.payment_status === 'overdue' && 'font-medium text-danger')}>{r.due_date ?? '—'}{late > 0 && r.payment_status === 'overdue' && <div className="text-[11px] font-normal">{late} day{late === 1 ? '' : 's'} late</div>}</Td>
              <Td badge><DocStatusBadge state={r.doc_status} /></Td>
              <Td badge>{r.payment_status ? <PayStatusBadge state={r.payment_status} daysLate={late} /> : <span className="text-muted">—</span>}</Td>
              <Td className="text-right tabular-nums">{fmtMoney(r.total)}</Td>
              <Td className={cn('text-right tabular-nums', Number(r.paid) > 0 ? 'text-success' : 'text-muted')}>{issued ? fmtMoney(r.paid) : '—'}</Td>
              <Td className={cn('text-right tabular-nums', issued && bal > 0.005 ? 'font-semibold' : 'text-muted')}>{issued ? fmtMoney(bal) : '—'}</Td>
              <Td className="text-right"><InvoiceRowActions inv={money(r)} today={c.today} canEdit={edit} canDelete={c.can('records.delete')} inline /></Td></tr>
          })}</tbody></TableWrap></div></>}
    {edit && <NewDocFab type="invoice" label="Quick create: tax invoice" />}
    <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} params={sp} base="/invoices" />
  </Card>
}
