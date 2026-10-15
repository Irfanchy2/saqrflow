import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowUpRight, Download, Eye, Handshake, Mail, MapPin, MessageCircle, Phone, Plus, Upload, X } from 'lucide-react'
import { getCtx } from '@/lib/auth'
import { PAGE_SIZE, flat, pageOf, sanitizeQ } from '@/lib/queries'
import { Badge, Card, CardHeader, CardLink, EmptyState, LinkButton, Metrics, PageHeader, Pagination, StatCard, Td, Th, TableWrap } from '@/components/ui/primitives'
import { DialogButton } from '@/components/ui/dialog'
import { ActionForm } from '@/components/ui/action-form'
import { PartyFields } from '@/components/parties/party-fields'
import { ImportForm } from '@/components/import-form'
import { NewSalesButtons } from '@/components/sales/new-buttons'
import { TabStrip } from '@/components/ui/tab-strip'
import { createParty } from '@/app/actions/admin'
import { importParties } from '@/app/actions/imports'
import { formatAed } from '@/lib/time'
import { fmtMoney } from '@/lib/sales/money'
import { cn } from '@/lib/utils'
import { ACTION_LABEL, TABLE_LABEL } from '@/lib/audit'
import { SavedViews } from '@/components/saved-views'
import { Fab, MList, MRow } from '@/components/ui/mobile'

export const metadata = { title: 'Customers & Suppliers' }
const AVATAR = ['bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300', 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300', 'bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
  'bg-orange-50 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300', 'bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300', 'bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300']
const tint = (s: string) => AVATAR[[...s].reduce((a, ch) => a + ch.charCodeAt(0), 0) % AVATAR.length]
const initials = (s: string) => s.replace(/\b(LLC|L\.L\.C|FZE|FZCO|CO|EST|TRADING)\b\.?/gi, '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('') || s[0]?.toUpperCase() || '·'
const wa = (n: string) => `https://wa.me/${n.replace(/[^\d]/g, '')}`

/**
 * Directory of clients and suppliers. Clients show what they bought and what they owe; clicking a client row opens a preview
 * panel beside the list (wide screens) with contact actions, totals and "new quotation"; the name always opens the full profile.
 */
export default async function Parties({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await getCtx(); if (!c.can('documents.view')) redirect('/'); const sp = await flat(searchParams)
  const kind = sp.tab === 'suppliers' ? 'suppliers' : 'customers', q = sanitizeQ(sp.q), page = pageOf(sp.page)
  const isC = kind === 'customers', edit = c.can('records.edit'), fin = c.can('finance.view')
  let query = c.supabase.from(kind).select('id,name,contact_person,phone,email,trn,address,created_at', { count: 'exact' }).order('name').range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
  if (q) query = query.or(`name.ilike.%${q}%,contact_person.ilike.%${q}%,phone.ilike.%${q}%,email.ilike.%${q}%,trn.ilike.%${q}%`)
  const monthStart = `${c.today.slice(0, 7)}-01`, yearAgo = `${Number(c.today.slice(0, 4)) - 1}${c.today.slice(4)}`
  const head = { count: 'exact' as const, head: true }
  const [{ data, count }, totalRes, newRes, salesYear] = await Promise.all([query,
    c.supabase.from(kind).select('id', head), c.supabase.from(kind).select('id', head).gte('created_at', monthStart),
    isC && fin ? c.supabase.from('invoices').select('customer_id,total,vat_amount').eq('doc_type', 'invoice').not('status', 'in', '(draft,cancelled)').is('deleted_at', null).gte('issue_date', yearAgo).limit(20000) : null])
  const ids = (data ?? []).map(p => p.id)
  // per client on this page: invoiced (incl. VAT, all time) and the open balance
  const invRes = isC && fin && ids.length ? await c.supabase.from('invoices').select('id,customer_id,total,status,due_date').eq('doc_type', 'invoice').not('status', 'in', '(draft,cancelled)').is('deleted_at', null).in('customer_id', ids).limit(5000) : null
  const invIds = (invRes?.data ?? []).map(i => i.id)
  const balRes = invIds.length ? await c.supabase.from('invoice_balances').select('id,paid,credited').in('id', invIds) : null
  const paid = new Map((balRes?.data ?? []).map(b => [b.id, Number(b.paid) + Number(b.credited ?? 0)]))
  const per = new Map<string, { sales: number; owed: number; overdue: boolean; count: number }>()
  for (const i of invRes?.data ?? []) {
    const e = per.get(i.customer_id) ?? { sales: 0, owed: 0, overdue: false, count: 0 }
    const bal = Number(i.total) - (paid.get(i.id) ?? 0)
    e.sales += Number(i.total); e.count++; if (bal > 0.005) { e.owed += bal; if (i.due_date && i.due_date < c.today) e.overdue = true }
    per.set(i.customer_id, e)
  }
  const yearSales = (salesYear?.data ?? []).reduce((a, i) => a + Number(i.total) - Number(i.vat_amount ?? 0), 0)
  const activeYear = new Set((salesYear?.data ?? []).map(i => i.customer_id).filter(Boolean)).size

  const picked = /^[0-9a-f-]{36}$/.test(sp.c ?? '') ? sp.c! : null
  // wide screens always show a client in the preview panel (the first on the page until one is picked)
  const byCust = new Map<string, number>(); for (const i of salesYear?.data ?? []) if (i.customer_id) byCust.set(i.customer_id, (byCust.get(i.customer_id) ?? 0) + Number(i.total) - Number(i.vat_amount ?? 0))
  const top = [...byCust.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
  const [topRes, recentAct] = await Promise.all([top.length ? c.supabase.from('customers').select('id,name').in('id', top.map(t => t[0])) : null,
    isC && c.can('audit.view') ? c.supabase.from('audit_logs').select('id,action,table_name,created_at').in('table_name', ['customers', 'invoices', 'payments']).order('created_at', { ascending: false }).limit(6) : null])
  const topNames = new Map((topRes?.data ?? []).map(r => [r.id, r.name as string]))
  const sel = picked ?? (isC && data?.length ? data[0].id : null)
  const selRow = sel ? (data ?? []).find(p => p.id === sel) ?? (await c.supabase.from(kind).select('id,name,contact_person,phone,email,trn,address,created_at').eq('id', sel).maybeSingle()).data : null
  const selExtra = isC && selRow ? await c.supabase.from('customers').select('whatsapp,notes').eq('id', selRow.id).maybeSingle() : null
  const qs = (o: Record<string, string | undefined>) => `/parties?${new URLSearchParams(Object.entries({ tab: kind, q: sp.q, page: sp.page, ...o }).filter(([, v]) => v) as [string, string][])}`
  const label = isC ? 'customer' : 'supplier'

  return <><PageHeader crumbs={[{ label: 'Sales' }, { label: isC ? 'Customers' : 'Suppliers' }]} title={isC ? 'Customers' : 'Suppliers'} sub={isC ? 'Your clients, their contacts, what they bought and what they owe. Open a client for the ledger, documents and timeline.' : 'Companies you buy from. Used by expenses, cheques and documents.'}
    actions={<><SavedViews page="/parties" />
      {c.can('data.export') && <LinkButton href={`/api/export/${kind}`} variant="secondary"><Download size={14} />Export CSV</LinkButton>}
      {edit && <DialogButton wide variant="secondary" label="Import CSV" title={`Import ${isC ? 'clients' : 'suppliers'} from CSV`} icon={<Upload size={14} />}><ImportForm action={importParties.bind(null, kind)} columns="name, contact_person, phone, whatsapp, email, trn, address, notes" /></DialogButton>}
      {edit && <DialogButton wide openParam={label} label={`Add ${isC ? 'client' : 'supplier'}`} title={`Add ${isC ? 'client' : 'supplier'}`} icon={<Plus size={15} />}>
        <ActionForm draftKey={`party:${kind}:new`} action={createParty.bind(null, kind)} resetOnSuccess><PartyFields customer={isC} create /></ActionForm></DialogButton>}</>} />

    <Metrics className="mb-5" cols={isC && fin ? 4 : 2}>
      <StatCard label={isC ? 'Total customers' : 'Total suppliers'} value={totalRes.count ?? 0} icon={Handshake} />
      <StatCard label={`New this month`} value={newRes.count ?? 0} hint={`Added since ${monthStart.slice(8)}/${monthStart.slice(5, 7)}`} />
      {isC && fin && <StatCard label="Buying customers" value={activeYear} hint="Invoiced in the last 12 months" />}
      {isC && fin && <StatCard label="Sales, last 12 months" value={formatAed(yearSales)} hint="Tax invoices, excl. VAT" href="/reports" />}
    </Metrics>

    <div className={cn('grid items-start gap-5', selRow && 'xl:grid-cols-[minmax(0,1fr)_360px]')}>
      <Card className="min-w-0 overflow-hidden">
        <TabStrip label="Directory" className="px-3">{[['customers', 'Clients'], ['suppliers', 'Suppliers']].map(([k, l]) => <Link key={k} href={`/parties?tab=${k}`} aria-current={kind === k ? 'page' : undefined}
          className={cn('-mb-px border-b-2 px-3 py-3 text-sm transition-colors', kind === k ? 'border-primary font-semibold text-primary' : 'border-transparent text-muted hover:text-fg')}>{l}{kind === k && <span className="ms-1.5 rounded-md bg-primary-soft px-1.5 text-[11px] tabular-nums">{count ?? 0}</span>}</Link>)}</TabStrip>
        <form className="flex flex-wrap gap-2 border-b border-border p-3"><input type="hidden" name="tab" value={kind} />
          <input name="q" type="search" defaultValue={sp.q} aria-label="Search" placeholder="Search name, contact, phone, email, TRN…" className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm sm:max-w-md" /></form>
        {!data?.length ? <EmptyState icon={Handshake} title={q ? 'No matches' : `No ${isC ? 'clients' : 'suppliers'} yet`} body="Add the companies you trade with so cheques, invoices and projects can be linked to them." /> :
          <><MList>{data.map(p => { const e = per.get(p.id); return <MRow key={p.id} href={isC ? `/parties/${p.id}` : undefined}
            lead={<span className={cn('grid h-11 w-11 place-items-center rounded-xl text-[13px] font-bold', tint(p.name))} aria-hidden>{initials(p.name)}</span>}
            title={<span className="text-primary">{p.name}</span>} sub={[p.contact_person, p.phone].filter(Boolean).join(' · ') || p.email || '—'}
            right={isC && fin ? (e?.overdue ? <Badge tone="red">Overdue</Badge> : e?.owed ? <Badge tone="amber">Balance due</Badge> : e ? <Badge tone="green">Active</Badge> : <Badge tone="blue">Prospect</Badge>) : undefined}
            rightSub={isC && fin && e ? `AED ${fmtMoney(e.sales)}` : undefined} /> })}</MList>
          <div className="hidden sm:block"><TableWrap><thead><tr><Th>Company</Th><Th>Contact person</Th><Th>Phone</Th><Th>Email</Th>{isC && fin ? <><Th className="text-right">Total sales (AED)</Th><Th>Status</Th></> : <Th>TRN</Th>}{isC && <Th><span className="sr-only">Preview</span></Th>}</tr></thead><tbody className="divide-y divide-border">
            {data.map(p => { const e = per.get(p.id); return <tr key={p.id} className={cn(sel === p.id && 'xl:bg-primary-soft/50')}>
              <Td className="max-w-[260px]"><div className="flex min-w-0 items-center gap-3"><span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[12px] font-bold', tint(p.name))} aria-hidden>{initials(p.name)}</span>
                <span className="min-w-0">{isC ? <Link href={`/parties/${p.id}`} className="block truncate font-semibold hover:text-primary">{p.name}</Link> : <span className="block truncate font-semibold">{p.name}</span>}{p.trn && isC && <span className="block truncate font-mono text-[11px] text-muted">TRN {p.trn}</span>}</span></div></Td>
              <Td className="text-muted">{p.contact_person ?? '—'}</Td><Td className="whitespace-nowrap text-muted">{p.phone ?? '—'}</Td><Td className="max-w-[220px] truncate text-muted">{p.email ?? '—'}</Td>
              {isC && fin ? <><Td className="text-right font-medium tabular-nums">{e ? fmtMoney(e.sales) : <span className="text-muted/60">—</span>}</Td>
                <Td badge>{e?.overdue ? <Badge tone="red">Overdue</Badge> : e?.owed ? <Badge tone="amber">Balance due</Badge> : e ? <Badge tone="green">Active</Badge> : <Badge tone="blue">Prospect</Badge>}</Td></>
                : <Td className="font-mono text-xs text-muted">{p.trn ?? '—'}</Td>}
              {isC && <Td className="text-right"><Link href={qs({ c: p.id })} scroll={false} data-row-primary aria-label={`Preview ${p.name}`} className="hidden h-8 w-8 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg xl:inline-grid"><Eye size={15} /></Link></Td>}
            </tr> })}</tbody></TableWrap></div></>}
        <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} params={sp} base="/parties" />
      </Card>

      {selRow && <aside aria-label={`${selRow.name} preview`} className={cn('min-w-0 xl:sticky xl:top-20', !picked && 'max-xl:hidden')}>
        <Card className="overflow-hidden">
          <div className="flex items-start gap-3 p-5">
            <span className={cn('grid h-12 w-12 shrink-0 place-items-center rounded-xl text-base font-bold', tint(selRow.name))} aria-hidden>{initials(selRow.name)}</span>
            <div className="min-w-0 flex-1"><h2 className="truncate text-[16px] font-bold" title={selRow.name}>{selRow.name}</h2>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">{(() => { const e = per.get(selRow.id); return isC && fin ? (e?.overdue ? <Badge tone="red">Overdue</Badge> : e?.owed ? <Badge tone="amber">Balance due</Badge> : e ? <Badge tone="green">Active</Badge> : <Badge tone="blue">Prospect</Badge>) : null })()}
                <span className="text-xs text-muted">Since {new Date(selRow.created_at).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}</span></div></div>
            <Link href={qs({ c: undefined })} scroll={false} aria-label="Close preview" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg"><X size={16} /></Link>
          </div>
          <dl className="space-y-3 border-t border-border px-5 py-4 text-sm">
            {[[Phone, 'Phone', selRow.phone, selRow.phone ? `tel:${selRow.phone.replace(/[^\d+]/g, '')}` : null], [Mail, 'Email', selRow.email, selRow.email ? `mailto:${selRow.email}` : null], [MapPin, 'Address', selRow.address, null]].map(([I, l, v, href]: any) =>
              <div key={l} className="flex gap-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary" aria-hidden><I size={15} /></span>
                <div className="min-w-0"><dt className="text-xs text-muted">{l}</dt><dd className="break-words font-medium">{v ? (href ? <a href={href} className="hover:text-primary">{v}</a> : v) : <span className="font-normal text-muted">Not recorded</span>}</dd></div></div>)}
            {selRow.contact_person && <div className="flex justify-between gap-3 border-t border-border pt-3"><dt className="text-muted">Contact person</dt><dd className="truncate font-medium">{selRow.contact_person}</dd></div>}
            {selRow.trn && <div className="flex justify-between gap-3"><dt className="text-muted">TRN</dt><dd className="font-mono text-[13px]">{selRow.trn}</dd></div>}
          </dl>
          {isC && fin && (() => { const e = per.get(selRow.id); return <div className="grid grid-cols-2 gap-px border-t border-border bg-border">
            <div className="bg-surface px-5 py-3"><div className="text-xs text-muted">Invoiced (all time)</div><div className="mt-0.5 font-bold tabular-nums">{formatAed(e?.sales ?? 0)}</div><div className="text-[11px] text-muted">{e?.count ?? 0} invoice{e?.count === 1 ? '' : 's'}</div></div>
            <div className="bg-surface px-5 py-3"><div className="text-xs text-muted">Balance due</div><div className={cn('mt-0.5 font-bold tabular-nums', e?.overdue && 'text-danger')}>{formatAed(e?.owed ?? 0)}</div><div className="text-[11px] text-muted">{e?.overdue ? 'Includes overdue' : e?.owed ? 'Not yet due' : 'Nothing owed'}</div></div></div> })()}
          <div className="flex flex-wrap gap-2 border-t border-border p-4">
            {isC && <LinkButton href={`/parties/${selRow.id}`} size="sm"><ArrowUpRight size={14} />Open profile</LinkButton>}
            {selExtra?.data?.whatsapp && <LinkButton href={wa(selExtra.data.whatsapp)} target="_blank" variant="secondary" size="sm"><MessageCircle size={14} />WhatsApp</LinkButton>}
            {isC && fin && edit && <NewSalesButtons customerId={selRow.id} only={['quotation']} size="sm" variant="secondary" />}
          </div>
          {selExtra?.data?.notes && <div className="border-t border-border px-5 py-4"><h3 className="text-[13px] font-semibold">Notes</h3><p className="mt-1 whitespace-pre-wrap text-sm text-muted">{selExtra.data.notes}</p></div>}
        </Card>
      </aside>}
    </div>
    {isC && fin && top.length > 0 && <div className="mt-5 grid gap-5 lg:grid-cols-2"><Card><CardHeader title="Top customers" sub="Invoiced in the last 12 months, excl. VAT" action={<CardLink href="/reports" />} />
      <ol className="space-y-3 px-5 pb-5">{top.map(([id, v], i) => <li key={id} className="flex items-center gap-3 text-sm">
        <span className="w-4 text-xs font-semibold tabular-nums text-muted">{i + 1}</span>
        <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[11px] font-bold', tint(topNames.get(id) ?? '?'))} aria-hidden>{initials(topNames.get(id) ?? '?')}</span>
        <Link href={`/parties/${id}`} className="w-40 shrink-0 truncate font-medium hover:text-primary sm:w-48">{topNames.get(id) ?? 'Customer'}</Link>
        <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2"><span className="block h-full rounded-full bg-primary" style={{ width: `${(v / top[0][1]) * 100}%` }} /></span>
        <span className="w-28 shrink-0 text-end font-semibold tabular-nums">{formatAed(v).replace('.00', '')}</span></li>)}</ol></Card>
      <Card><CardHeader title="Recent customer activity" action={c.can('audit.view') ? <CardLink href="/audit">Audit log</CardLink> : undefined} />
        {!(recentAct?.data ?? []).length ? <EmptyState title="No recent activity" /> : <ul className="px-2 pb-2 text-sm">{(recentAct!.data ?? []).map((a: any) => <li key={a.id} className="flex items-center gap-3 rounded-lg px-3 py-2">
          <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-lg', a.table_name === 'payments' ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300' : a.table_name === 'invoices' ? 'bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300' : 'bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300')} aria-hidden><Handshake size={15} /></span>
          <span className="min-w-0 flex-1 truncate"><span className="font-medium">{TABLE_LABEL[a.table_name] ?? a.table_name}</span> <span className="text-muted">{(ACTION_LABEL[a.action] ?? a.action).toLowerCase()}</span></span>
          <time className="shrink-0 text-xs tabular-nums text-muted">{new Date(a.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: c.company.timezone })}</time></li>)}</ul>}</Card></div>}
    {edit && <Fab label={`Quick create: ${isC ? "client" : "supplier"}`} open={label} />}</>
}
