import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AlertTriangle, Banknote, BellRing, FileClock, FileMinus, Receipt, ScrollText, Target, Truck, Wallet } from 'lucide-react'
import { getCtx } from '@/lib/auth'
import { PAGE_SIZE, flat, pageOf, sanitizeQ } from '@/lib/queries'
import { Badge, Card, EmptyState, PageHeader, Pagination, Metrics, StatCard, Td, Th, TableWrap } from '@/components/ui/primitives'
import { NewSalesButtons } from '@/components/sales/new-buttons'
import { DOC_META, STATUS_TONE, statusLabel, type SalesType } from '@/lib/sales/docs'
import { fmtMoney } from '@/lib/sales/money'
import { AGE_BUCKETS, receivablesAgeing, type InvRow } from '@/lib/sales/summary'
import { loadSalesKpis } from '@/lib/sales/kpis'
import { formatAed } from '@/lib/time'
import { cn } from '@/lib/utils'
import { SavedViews } from '@/components/saved-views'

export const metadata = { title: 'Sales & Invoices' }
const TABS = [
  { k: 'quotation', label: 'Quotations', icon: ScrollText }, { k: 'invoice', label: 'Tax invoices', icon: Receipt }, { k: 'delivery_note', label: 'Delivery notes', icon: Truck },
  { k: 'credit_note', label: 'Credit notes', icon: FileMinus }, { k: 'followups', label: 'Follow-ups', icon: BellRing },
  { k: 'payments', label: 'Payments', icon: Banknote }, { k: 'receivables', label: 'Receivables ageing', icon: FileClock },
] as const
const METHOD: Record<string, string> = { cash: 'Cash', bank_transfer: 'Bank transfer', cheque: 'Cheque', pdc: 'PDC cheque', card: 'Card', other: 'Other' }

export default async function Invoices({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await getCtx(); if (!c.can('finance.view')) redirect('/')
  const sp = await flat(searchParams)
  const tab = TABS.some(t => t.k === sp.tab) ? sp.tab! : 'quotation'
  const edit = c.can('records.edit')

  // KPIs + per-tab counts with targeted queries (never every invoice)
  const head = { count: 'exact' as const, head: true }
  const [{ kpis: k, openRows }, ...tabCounts] = await Promise.all([loadSalesKpis(c),
    ...(['quotation', 'invoice', 'delivery_note', 'credit_note'] as const).map(t => c.supabase.from('invoices').select('id', head).eq('doc_type', t)),
    c.supabase.from('sales_followups').select('id', head).is('done_at', null).lte('due_date', c.today)])
  const counts: Record<string, number> = { quotation: tabCounts[0].count ?? 0, invoice: tabCounts[1].count ?? 0, delivery_note: tabCounts[2].count ?? 0, credit_note: tabCounts[3].count ?? 0, followups: tabCounts[4].count ?? 0 }
  const rows = openRows

  const base = '/invoices'
  const tabHref = (t: string) => `${base}?tab=${t}`
  return <>
    <PageHeader title="Sales & Invoices" sub="Quotations, tax invoices, delivery notes and the payments against them."
      actions={<><SavedViews page="/invoices" />{edit && <NewSalesButtons />}</>} />

    <Metrics className="mb-5" cols={4}>
      <StatCard label="Outstanding receivables" value={formatAed(k.outstanding)} hint={`${k.openCount} open invoice${k.openCount === 1 ? '' : 's'}`} icon={Wallet} tone="blue" href={tabHref('receivables')} />
      <StatCard label="Overdue" value={formatAed(k.overdue)} hint={k.overdueCount ? `${k.overdueCount} invoice${k.overdueCount === 1 ? '' : 's'} past due` : 'Nothing overdue'} icon={AlertTriangle} tone={k.overdueCount ? 'red' : 'neutral'} href={`${base}?tab=invoice&status=overdue`} />
      <StatCard label="Collected this month" value={formatAed(k.collectedThisMonth)} hint={`Invoiced ${formatAed(k.invoicedThisMonth)}`} icon={Banknote} tone="green" href={tabHref('payments')} />
      <StatCard label="Open quotations" value={formatAed(k.pipeline)} hint={`${k.pipelineCount} open${k.winRate !== null ? ` · ${k.winRate}% win rate` : ''}`} icon={Target} tone="amber" href={`${base}?tab=quotation&status=sent`} />
    </Metrics>

    <nav aria-label="Sales sections" className="mb-4 flex gap-1 overflow-x-auto border-b border-border">
      {TABS.map(t => <Link key={t.k} href={tabHref(t.k)} aria-current={tab === t.k ? 'page' : undefined}
        className={cn('-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3.5 py-2 text-sm transition-colors', tab === t.k ? 'border-primary font-medium text-primary' : 'border-transparent text-muted hover:text-fg')}>
        <t.icon size={14} aria-hidden />{t.label}{t.k in counts && <span className="rounded-sm bg-surface-2 px-1.5 text-[11px] tabular-nums text-muted">{counts[t.k]}</span>}</Link>)}
    </nav>

    {tab === 'payments' ? <PaymentsTab sp={sp} /> : tab === 'followups' ? <FollowupsTab /> : tab === 'receivables' ? <Ageing rows={rows} today={c.today} /> : <DocsTab t={tab as SalesType} sp={sp} edit={edit} />}
  </>
}

async function DocsTab({ t, sp, edit }: { t: SalesType; sp: Record<string, string | undefined>; edit: boolean }) {
  const c = await getCtx()
  const meta = DOC_META[t], page = pageOf(sp.page), term = sanitizeQ(sp.q)
  let q = c.supabase.from('invoices').select('id,number,status,customer_name,subject,site,issue_date,due_date,valid_until,total,project:projects(name)', { count: 'exact' }).eq('doc_type', t)
  if (term) q = q.or(`number.ilike.%${term}%,customer_name.ilike.%${term}%,subject.ilike.%${term}%,site.ilike.%${term}%,lpo_ref.ilike.%${term}%`)
  if (sp.status && meta.statuses.includes(sp.status)) q = q.eq('status', sp.status)
  // drill-down filters from Reports & the dashboard (same definitions as report_summary)
  if (t === 'invoice' && sp.due === 'overdue') q = q.in('status', ['sent', 'viewed', 'partially_paid', 'overdue']).lt('due_date', c.today)
  if (t === 'invoice' && sp.due === 'open') q = q.in('status', ['sent', 'viewed', 'partially_paid', 'overdue'])
  if (sp.issued === '1') q = q.not('status', 'in', '(draft,cancelled)')
  if (sp.won === '1') q = q.in('status', ['accepted', 'converted'])
  if (/^\d{4}-\d{2}-\d{2}$/.test(sp.from ?? '')) q = q.gte('issue_date', sp.from!)
  if (/^\d{4}-\d{2}-\d{2}$/.test(sp.to ?? '')) q = q.lte('issue_date', sp.to!)
  if (/^[0-9a-f-]{36}$/.test(sp.customer ?? '')) q = q.eq('customer_id', sp.customer!)
  if (/^[0-9a-f-]{36}$/.test(sp.project ?? '')) q = q.eq('project_id', sp.project!)
  const { data, count } = await q.order('issue_date', { ascending: false }).order('number', { ascending: false }).range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
  const ids = t === 'invoice' ? (data ?? []).map((r: any) => r.id) : []
  const { data: bals } = ids.length ? await c.supabase.from('invoice_balances').select('id,paid,credited').in('id', ids) : { data: [] as { id: string; paid: number; credited: number }[] }
  const paidOf = new Map((bals ?? []).map(b => [b.id, Number(b.paid) + Number(b.credited ?? 0)]))
  const cls = 'h-9 rounded-md border border-border bg-surface px-3 text-sm'
  const isInv = t === 'invoice'
  return <Card>
    <form className="flex flex-wrap gap-2 border-b border-border p-3"><input type="hidden" name="tab" value={t} />
      <input name="q" type="search" defaultValue={sp.q} aria-label={`Search ${meta.plural.toLowerCase()}`} placeholder="Search number, customer, subject, site, LPO…" className={`${cls} min-w-52 flex-1`} />
      <select name="status" defaultValue={sp.status ?? ''} aria-label="Status" className={cls}><option value="">Any status</option>{meta.statuses.map(s => <option key={s} value={s}>{statusLabel(t, s)}</option>)}</select>
      <button className="h-9 cursor-pointer rounded-md border border-border px-3 text-sm hover:bg-surface-2">Filter</button></form>
    {(sp.due || sp.issued || sp.won || sp.from || sp.to || sp.customer || sp.project) && <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-primary-soft/50 px-4 py-2 text-sm">
      <span>Filtered list{sp.due === 'overdue' ? ': overdue (past due date, not fully paid)' : sp.due === 'open' ? ': open invoices' : ''}{sp.won ? ': accepted or converted' : ''}{sp.from || sp.to ? ` · issued ${sp.from ?? '…'} to ${sp.to ?? '…'}` : ''}{sp.customer ? ' · one customer' : ''}{sp.project ? ' · one project' : ''}</span>
      <Link href={`/invoices?tab=${t}`} className="text-xs font-medium text-primary hover:underline">Clear filter</Link></div>}
    {!data?.length ? <EmptyState icon={t === 'invoice' ? Receipt : t === 'quotation' ? ScrollText : t === 'credit_note' ? FileMinus : Truck} title={term || sp.status ? `No ${meta.plural.toLowerCase()} match` : `No ${meta.plural.toLowerCase()} yet`}
      body={term || sp.status ? 'Try a different search or status.' : t === 'credit_note' ? 'Credit notes are created from an issued tax invoice (⋯ → Create credit note). They reduce the invoice balance.' : `Create your first ${meta.label.toLowerCase()}. It uses your letterhead, stamp and terms automatically.`}
      action={edit && !term && !sp.status && t !== 'credit_note' ? <NewSalesButtons only={[t]} /> : undefined} />
      : <TableWrap><thead className="bg-surface-2/50"><tr><Th>No.</Th><Th>Customer</Th><Th>Subject / project</Th><Th>Date</Th>{t !== 'delivery_note' && <Th>{isInv ? 'Due' : 'Valid until'}</Th>}{meta.priced && <Th className="text-right">Total (AED)</Th>}{isInv && <Th className="text-right">Balance</Th>}<Th>Status</Th></tr></thead>
        <tbody className="divide-y divide-border">{data.map((r: any) => {
          const bal = Number(r.total) - (paidOf.get(r.id) ?? 0)
          return <tr key={r.id} className="hover:bg-surface-2/50">
            <Td><Link href={`/invoices/${r.id}`} className="font-mono text-[13px] font-medium text-primary hover:underline">{r.number}</Link></Td>
            <Td className="max-w-[220px] truncate">{r.customer_name ?? <span className="text-muted">—</span>}</Td>
            <Td className="max-w-[260px] truncate text-muted">{r.subject ?? r.project?.name ?? r.site ?? '—'}</Td>
            <Td className="whitespace-nowrap tabular-nums">{r.issue_date}</Td>
            {t !== 'delivery_note' && <Td className={cn('whitespace-nowrap tabular-nums', isInv && r.status === 'overdue' && 'font-medium text-danger')}>{(isInv ? r.due_date : r.valid_until) ?? '—'}</Td>}
            {meta.priced && <Td className="text-right tabular-nums">{fmtMoney(r.total)}</Td>}
            {isInv && <Td className={cn('text-right tabular-nums', bal > 0 && !['draft', 'cancelled'].includes(r.status) ? 'font-medium' : 'text-muted')}>{['draft', 'cancelled'].includes(r.status) ? '—' : fmtMoney(bal)}</Td>}
            <Td><Badge tone={STATUS_TONE[r.status]}>{statusLabel(t, r.status)}</Badge></Td></tr>
        })}</tbody></TableWrap>}
    <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} params={sp} base="/invoices" />
  </Card>
}

async function FollowupsTab() {
  const c = await getCtx()
  const { data } = await c.supabase.from('sales_followups').select('id,due_date,note,invoice:invoices(id,number,customer_name,total,status)').is('done_at', null).order('due_date').limit(200)
  const rows = (data ?? []).filter((f: any) => f.invoice)
  return <Card>{!rows.length ? <EmptyState icon={BellRing} title="No follow-ups open" body="When a quotation is marked as sent, follow-up reminders are created automatically (Settings → Document branding → Quotation workflow)." />
    : <TableWrap><thead className="bg-surface-2/50"><tr><Th>Due</Th><Th>Quotation</Th><Th>Customer</Th><Th>Note</Th><Th className="text-right">Value (AED)</Th></tr></thead>
      <tbody className="divide-y divide-border">{rows.map((f: any) => <tr key={f.id} className="hover:bg-surface-2/50">
        <Td className={cn('whitespace-nowrap tabular-nums', f.due_date <= c.today && 'font-medium text-warning')}>{f.due_date}{f.due_date < c.today ? ' · late' : f.due_date === c.today ? ' · today' : ''}</Td>
        <Td><Link href={`/invoices/${f.invoice.id}`} className="font-mono text-[13px] text-primary hover:underline">{f.invoice.number}</Link></Td>
        <Td className="max-w-[220px] truncate">{f.invoice.customer_name ?? '—'}</Td><Td className="text-muted">{f.note ?? '—'}</Td><Td className="text-right tabular-nums">{fmtMoney(f.invoice.total)}</Td></tr>)}</tbody></TableWrap>}</Card>
}

async function PaymentsTab({ sp }: { sp: Record<string, string | undefined> }) {
  const c = await getCtx()
  const page = pageOf(sp.page)
  const { data, count } = await c.supabase.from('payments').select('id,amount,paid_on,method,reference,invoice:invoices(id,number,customer_name)', { count: 'exact' }).order('paid_on', { ascending: false }).range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
  return <Card>{!data?.length ? <EmptyState icon={Banknote} title="No payments yet" body="Open an issued tax invoice and use “Record payment”. Partial payments update the balance and status automatically." />
    : <TableWrap><thead className="bg-surface-2/50"><tr><Th>Date</Th><Th>Invoice</Th><Th>Customer</Th><Th>Method</Th><Th>Reference</Th><Th className="text-right">Amount (AED)</Th></tr></thead>
      <tbody className="divide-y divide-border">{data.map((p: any) => <tr key={p.id} className="hover:bg-surface-2/50">
        <Td className="tabular-nums">{p.paid_on}</Td>
        <Td>{p.invoice ? <Link href={`/invoices/${p.invoice.id}`} className="font-mono text-[13px] text-primary hover:underline">{p.invoice.number}</Link> : '—'}</Td>
        <Td className="max-w-[220px] truncate">{p.invoice?.customer_name ?? '—'}</Td><Td>{METHOD[p.method] ?? p.method ?? '—'}</Td><Td className="text-muted">{p.reference ?? '—'}</Td>
        <Td className="text-right font-medium tabular-nums text-success">{fmtMoney(p.amount)}</Td></tr>)}</tbody></TableWrap>}
    <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} params={sp} base="/invoices" /></Card>
}

function Ageing({ rows, today }: { rows: InvRow[]; today: string }) {
  const a = receivablesAgeing(rows, today)
  if (!a.list.length) return <Card><EmptyState icon={Wallet} title="No outstanding receivables" body="Issued invoices with an unpaid balance appear here, grouped by how many days they are past due." /></Card>
  return <Card>
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-t-lg border-b border-border bg-border sm:grid-cols-5">
      {AGE_BUCKETS.map((b, i) => <div key={b} className="bg-surface p-3"><div className="text-xs text-muted">{i === 0 ? 'Not yet due' : `${b} days late`}</div>
        <div className={cn('mt-1 text-lg font-semibold tabular-nums', a.totals[i] > 0 && (i >= 3 ? 'text-danger' : i >= 1 ? 'text-warning' : ''))}>{fmtMoney(a.totals[i])}</div>
        <div className="mt-2 h-1.5 rounded-full bg-surface-2"><div className={cn('h-full rounded-full', i === 0 ? 'bg-primary' : i < 3 ? 'bg-warning' : 'bg-danger')} style={{ width: `${a.grand ? (a.totals[i] / a.grand) * 100 : 0}%` }} /></div></div>)}
    </div>
    <TableWrap><thead className="bg-surface-2/50"><tr><Th>Customer</Th>{AGE_BUCKETS.map(b => <Th key={b} className="text-right">{b}</Th>)}<Th className="text-right">Total</Th></tr></thead>
      <tbody className="divide-y divide-border">{a.list.map(e => <tr key={e.customer} className="hover:bg-surface-2/50">
        <Td className="font-medium">{e.customerId ? <Link href={`/parties/${e.customerId}`} className="hover:text-primary hover:underline">{e.customer}</Link> : e.customer}<span className="ms-2 text-xs text-muted">{e.count} inv.</span></Td>
        {e.buckets.map((v, i) => <Td key={i} className={cn('text-right tabular-nums', !v && 'text-muted/50', i >= 3 && v > 0 && 'text-danger')}>{v ? fmtMoney(v) : '—'}</Td>)}
        <Td className="text-right font-semibold tabular-nums">{fmtMoney(e.total)}</Td></tr>)}</tbody>
      <tfoot className="border-t-2 border-border bg-surface-2/40 font-semibold"><tr><Td>Total</Td>{a.totals.map((v, i) => <Td key={i} className="text-right tabular-nums">{fmtMoney(v)}</Td>)}<Td className="text-right tabular-nums">{fmtMoney(a.grand)}</Td></tr></tfoot></TableWrap>
  </Card>
}
