import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, CalendarClock, Hourglass, Landmark, Plus, Undo2 } from 'lucide-react'
import { getCtx } from '@/lib/auth'
import { PAGE_SIZE, flat, pageOf, sanitizeQ } from '@/lib/queries'
import { Alert, Badge, Card, EmptyState, Field, Input, LinkButton, PageHeader, Pagination, Select, SortTh, Metrics, StatCard, Td, Th, TableWrap, Textarea, type Tone } from '@/components/ui/primitives'
import { DialogButton } from '@/components/ui/dialog'
import { ActionForm } from '@/components/ui/action-form'
import { MonthGrid } from '@/components/ui/month-grid'
import { changeChequeStatus, createCheque } from '@/app/actions/cheques'
import { nextStatuses, summarizeCheques, type ChequeStatus, type Direction } from '@/lib/cheques'
import { formatAed } from '@/lib/time'
import { ACCEPT_ATTR } from '@/lib/files'
import { SavedViews } from '@/components/saved-views'

export const metadata = { title: 'Banking & Cheques' }
const STATUS_TONE: Record<string, Tone> = { received: 'blue', issued: 'blue', scheduled: 'blue', deposited: 'amber', presented: 'amber', cleared: 'green', returned: 'red', cancelled: 'neutral' }
const ALL = ['received', 'issued', 'scheduled', 'deposited', 'presented', 'cleared', 'returned', 'cancelled']

export default async function Cheques({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await getCtx(); if (!c.can('finance.view')) redirect('/'); const sp = await flat(searchParams)
  const manage = c.can('cheques.manage')
  const { data: all } = await c.supabase.from('cheques').select('id,direction,status,amount,cheque_date,cheque_no,party_name,kind').limit(5000)
  const s = summarizeCheques((all ?? []) as any, c.today)

  const page = pageOf(sp.page), term = sanitizeQ(sp.q)
  let q = c.supabase.from('cheques').select('*', { count: 'exact' })
  if (term) q = q.or(`cheque_no.ilike.%${term}%,party_name.ilike.%${term}%,bank_name.ilike.%${term}%,purpose.ilike.%${term}%`)
  if (sp.direction) q = q.eq('direction', sp.direction)
  if (sp.status) q = q.eq('status', sp.status)
  if (sp.kind) q = q.eq('kind', sp.kind)
  if (sp.open && /^[0-9a-f-]{36}$/i.test(sp.open)) q = q.eq('id', sp.open)
  if (sp.from) q = q.gte('cheque_date', sp.from); if (sp.to) q = q.lte('cheque_date', sp.to)
  const sort = ['cheque_date', 'amount', 'party_name', 'status'].includes(sp.sort ?? '') ? sp.sort! : 'cheque_date'
  const { data: rows, count } = await q.order(sort, { ascending: sp.dir ? sp.dir === 'asc' : sort !== 'cheque_date' }).range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
  const [{ data: banks }, { data: cust }, { data: sup }, { data: openInv }] = await Promise.all([c.supabase.from('banks').select('name,account_display_name').order('name'), c.supabase.from('customers').select('name').order('name').limit(2000), c.supabase.from('suppliers').select('name').order('name').limit(2000),
    manage ? c.supabase.from('invoices').select('id,number,customer_name,total').eq('doc_type', 'invoice').in('status', ['sent', 'overdue', 'partially_paid']).order('issue_date', { ascending: false }).limit(300) : Promise.resolve({ data: [] as any[] })])
  const invNo = new Map((openInv ?? []).map((i: any) => [i.id, i.number]))
  const view = sp.view === 'calendar' ? 'calendar' : 'list'
  const month = /^\d{4}-\d{2}$/.test(sp.m ?? '') ? sp.m! : c.today.slice(0, 7)
  const cls = 'h-9 rounded-md border border-border bg-surface px-3 text-sm'

  return <>
    <PageHeader title="Banking & Cheques" sub="A tracker for incoming, outgoing and post-dated cheques."
      actions={<><SavedViews page="/cheques" />{c.can('data.export') && <LinkButton href="/api/export/cheques" variant="secondary">Export CSV</LinkButton>}
        {manage && <DialogButton wide label="Add cheque" title="Add cheque" icon={<Plus size={15} />}>
          <ActionForm action={createCheque} submit="Save cheque">
            <div className="grid gap-4 sm:grid-cols-3"><Field label="Direction *"><Select name="direction" defaultValue="incoming"><option value="incoming">Incoming (received)</option><option value="outgoing">Outgoing (issued)</option></Select></Field>
              <Field label="Cheque type *"><Select name="kind" defaultValue="regular"><option value="regular">Regular</option><option value="pdc">Post-dated (PDC)</option><option value="security">Security</option><option value="rental">Rental</option></Select></Field>
              <Field label="Party type *"><Select name="party_type" defaultValue="customer"><option value="customer">Customer</option><option value="supplier">Supplier</option><option value="landlord">Landlord</option><option value="other">Other</option></Select></Field></div>
            <div className="grid gap-4 sm:grid-cols-2"><Field label="Customer / supplier *"><Input name="party_name" required list="parties" /><datalist id="parties">{[...(cust ?? []), ...(sup ?? [])].map(p => <option key={p.name} value={p.name} />)}</datalist></Field>
              <Field label="Cheque number *"><Input name="cheque_no" required maxLength={40} /></Field>
              <Field label="Bank name *"><Input name="bank_name" required list="banks" placeholder="e.g. Emirates NBD" /><datalist id="banks">{[...new Set((banks ?? []).map(b => b.name))].map(b => <option key={b} value={b} />)}</datalist></Field>
              <Field label="Account display name" hint="A label like “ENBD Current”. Never enter account numbers or passwords."><Input name="account_display_name" maxLength={120} /></Field>
              <Field label="Amount (AED) *"><Input name="amount" type="number" step="0.01" min="0.01" required /></Field>
              <Field label="Cheque date *"><Input name="cheque_date" type="date" required /></Field>
              <Field label="Issue date"><Input name="issue_date" type="date" /></Field>
              <Field label="Planned deposit / presentation date"><Input name="deposit_date" type="date" /></Field>
              <Field label="Purpose" className="sm:col-span-2"><Input name="purpose" maxLength={300} placeholder="e.g. Progress payment – Project ABC" /></Field>
              <Field label="Linked tax invoice (incoming)" hint="When you later confirm the cheque as Cleared, you can apply it to this invoice." className="sm:col-span-2"><Select name="invoice_id" defaultValue=""><option value="">— None —</option>{(openInv ?? []).map((i: any) => <option key={i.id} value={i.id}>{i.number} · {i.customer_name ?? '—'} · AED {Number(i.total).toFixed(2)}</option>)}</Select></Field>
              <Field label="Cheque image (optional)" className="sm:col-span-2"><input type="file" name="file" accept={ACCEPT_ATTR} className="text-sm" /></Field>
              <Field label="Notes" className="sm:col-span-2"><Textarea name="notes" /></Field></div></ActionForm></DialogButton>}</>} />
    <div className="mb-5"><Alert tone="amber"><b>Manual tracking only.</b> Averiqo does not connect to your bank, move money, check balances or detect clearance. “Cleared” is set by you after verifying with your bank.</Alert></div>

    <Metrics className="mb-5" cols={4}>
      <StatCard label="Incoming (open)" value={formatAed(s.incomingTotal)} hint={`${s.incomingCount} cheque${s.incomingCount === 1 ? '' : 's'}`} icon={ArrowDownLeft} tone="green" />
      <StatCard label="Outgoing (open)" value={formatAed(s.outgoingTotal)} hint={`${s.outgoingCount} cheque${s.outgoingCount === 1 ? '' : 's'}`} icon={ArrowUpRight} tone="blue" />
      <StatCard label="Due this week" value={s.dueThisWeek.length} hint={formatAed(s.dueThisWeek.reduce((a, x) => a + Number(x.amount), 0))} icon={CalendarClock} tone="amber" href="/cheques?status=scheduled" />
      <StatCard label="Due this month" value={s.dueThisMonth.length} hint={formatAed(s.dueThisMonth.reduce((a, x) => a + Number(x.amount), 0))} icon={CalendarClock} />
      <StatCard label="Overdue – action needed" value={s.overdue.length} hint="Cheque date passed, not yet banked" icon={AlertTriangle} tone={s.overdue.length ? 'red' : 'neutral'} />
      <StatCard label="Awaiting clearance" value={s.awaitingClearance.length} hint="Confirm after checking your bank" icon={Hourglass} tone="amber" href="/cheques?status=deposited" />
      <StatCard label="Returned / bounced" value={s.returned.length} icon={Undo2} tone={s.returned.length ? 'red' : 'neutral'} href="/cheques?status=returned" />
      <StatCard label="Net open position" value={formatAed(s.netPosition)} hint="Incoming − outgoing" icon={Landmark} />
    </Metrics>

    <div className="mb-4 flex gap-1 border-b border-border">{[['list', 'List'], ['calendar', 'Monthly calendar']].map(([k, l]) => <Link key={k} href={`/cheques?view=${k}`} className={`-mb-px border-b-2 px-4 py-2 text-sm ${view === k ? 'border-primary font-medium text-primary' : 'border-transparent text-muted'}`}>{l}</Link>)}</div>

    {view === 'calendar' ? <MonthGrid month={month} today={c.today} base="/cheques" extraParams="view=calendar"
      items={(all ?? []).filter(x => !['cleared', 'cancelled'].includes(x.status)).map(x => ({ date: x.cheque_date, label: `${x.direction === 'incoming' ? '↓' : '↑'} ${formatAed(x.amount)} · ${x.party_name}`, href: `/cheques?q=${encodeURIComponent(x.cheque_no)}`, tone: x.status === 'returned' ? 'red' : x.direction === 'incoming' ? 'green' : 'blue' }))} />
      : <>
        <form className="mb-4 flex flex-wrap gap-2"><input name="q" defaultValue={sp.q} placeholder="Search cheque no., party, bank, purpose…" className={`${cls} min-w-52 flex-1`} />
          <select name="direction" defaultValue={sp.direction ?? ''} className={cls}><option value="">In & out</option><option value="incoming">Incoming</option><option value="outgoing">Outgoing</option></select>
          <select name="kind" defaultValue={sp.kind ?? ''} className={cls}><option value="">Any type</option><option value="regular">Regular</option><option value="pdc">PDC</option><option value="security">Security</option><option value="rental">Rental</option></select>
          <select name="status" defaultValue={sp.status ?? ''} className={cls}><option value="">Any status</option>{ALL.map(x => <option key={x} value={x}>{x}</option>)}</select>
          <input type="date" name="from" defaultValue={sp.from} className={cls} aria-label="From date" /><input type="date" name="to" defaultValue={sp.to} className={cls} aria-label="To date" />
          <button className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-fg">Filter</button></form>
        <Card className="overflow-hidden">{!rows?.length ? <EmptyState icon={Landmark} title={Object.keys(sp).length ? 'No cheques match your filters' : 'No cheques recorded'} body="Add incoming, outgoing and post-dated cheques to see due dates, totals and get reminders before each cheque date." /> : <>
          <TableWrap><thead className="border-b border-border bg-surface-2/60"><tr><SortTh label="Cheque date" col="cheque_date" params={sp} base="/cheques" /><Th>No.</Th><SortTh label="Party" col="party_name" params={sp} base="/cheques" /><Th>Bank</Th><SortTh label="Amount" col="amount" params={sp} base="/cheques" /><Th>Type</Th><SortTh label="Status" col="status" params={sp} base="/cheques" />{manage && <Th />}</tr></thead>
            <tbody className="divide-y divide-border">{rows.map(r => { const next = nextStatuses(r.direction as Direction, r.status as ChequeStatus); const late = ['received', 'issued', 'scheduled'].includes(r.status) && r.cheque_date < c.today
              return <tr key={r.id} className="hover:bg-surface-2/50"><Td className="tabular-nums">{r.cheque_date}{late && <Badge tone="red" className="ms-2">overdue</Badge>}</Td><Td className="font-mono text-xs">{r.cheque_no}</Td>
                <Td><div className="font-medium">{r.party_name}</div><div className="text-xs text-muted">{r.purpose}</div>{r.invoice_id && <Link href={`/invoices/${r.invoice_id}`} className="text-xs text-primary hover:underline">Invoice {invNo.get(r.invoice_id) ?? ''}</Link>}</Td><Td className="text-muted">{r.bank_name}{r.account_display_name && <div className="text-xs">{r.account_display_name}</div>}</Td>
                <Td className={`tabular-nums font-medium ${r.direction === 'incoming' ? 'text-success' : ''}`}>{r.direction === 'incoming' ? '+' : '−'}{formatAed(r.amount)}</Td>
                <Td><span className="capitalize text-muted">{r.direction} · {r.kind === 'pdc' ? 'PDC' : r.kind}</span></Td><Td><Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>{r.approval_status && r.approval_status !== 'approved' && <Badge tone={r.approval_status === 'pending' ? 'amber' : 'red'} className="ms-1">{r.approval_status === 'pending' ? 'Awaiting approval' : r.approval_status === 'rejected' ? 'Rejected' : 'Changes requested'}</Badge>}{r.returned_reason && <div className="mt-1 text-xs text-danger">{r.returned_reason}</div>}</Td>
                {manage && <Td>{next.length > 0 && <DialogButton size="sm" variant="secondary" label="Update" title={`Cheque ${r.cheque_no} – update status`}>
                  <ActionForm action={changeChequeStatus.bind(null, r.id)} submit="Update status">
                    <p className="text-sm text-muted">{formatAed(r.amount)} · {r.party_name} · currently <b>{r.status}</b></p>
                    <Field label="New status"><Select name="status" required defaultValue={next[0]}>{next.map(n => <option key={n} value={n}>{n}</option>)}</Select></Field>
                    <Field label="Deposit / presentation date" hint="Used when marking deposited or presented."><Input type="date" name="deposit_date" defaultValue={r.deposit_date ?? ''} /></Field>
                    <Field label="Reason (required if returned)"><Input name="reason" maxLength={300} placeholder="e.g. Insufficient funds" /></Field>
                    <label className="flex items-start gap-2 rounded-md bg-surface-2 p-3 text-sm"><input type="checkbox" name="confirm" className="mt-0.5" /><span>For <b>Cleared</b>: I have verified with my bank (statement or confirmation) that this cheque has cleared. A cheque date passing is not clearance.</span></label>
                    {r.direction === 'incoming' && r.invoice_id && <label className="flex items-start gap-2 rounded-md bg-surface-2 p-3 text-sm"><input type="checkbox" name="apply_payment" defaultChecked className="mt-0.5" /><span>When cleared, record it as a payment on invoice <b>{invNo.get(r.invoice_id) ?? 'linked invoice'}</b> (updates the balance).</span></label>}</ActionForm></DialogButton>}</Td>}</tr> })}</tbody></TableWrap>
          <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} params={sp} base="/cheques" /></>}</Card></>}</>
}
