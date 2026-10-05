import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/auth'
import { flat } from '@/lib/queries'
import { Alert, Badge, Card, CardHeader, EmptyState, LinkButton, PageHeader, Td, Th, TableWrap } from '@/components/ui/primitives'
import { PrintButton } from '@/components/print-button'
import { addDays, endOfMonth, formatAed } from '@/lib/time'
import { StatusBadge } from '@/components/documents/status-badge'

export const metadata = { title: 'Reports & Analytics' }
export default async function Reports({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await getCtx(); if (!c.can('data.export')) redirect('/'); const sp = await flat(searchParams)
  const month = /^\d{4}-\d{2}$/.test(sp.m ?? '') ? sp.m! : c.today.slice(0, 7)
  const [{ data: exp }, { data: ren }, { data: chq }] = await Promise.all([
    c.supabase.from('documents').select('id,name,expiry_date,status,owner_type,category:document_categories(name)').is('deleted_at', null).gte('expiry_date', month + '-01').lte('expiry_date', endOfMonth(month + '-01')).order('expiry_date'),
    c.supabase.from('documents').select('id,name,expiry_date,status,owner_id,category:document_categories(name)').eq('owner_type', 'employee').is('deleted_at', null).lte('expiry_date', addDays(c.today, 90)).order('expiry_date').limit(200),
    c.can('finance.view') ? c.supabase.from('cheques').select('id,cheque_no,party_name,direction,amount,cheque_date,status').in('status', ['received', 'issued', 'scheduled', 'deposited', 'presented']).order('cheque_date').limit(200) : Promise.resolve({ data: [] as any[] }),
  ])
  const { data: emps } = ren?.length ? await c.supabase.from('employees').select('id,full_name').in('id', [...new Set(ren.map(r => r.owner_id))]) : { data: [] as any[] }
  const nm = Object.fromEntries((emps ?? []).map((e: any) => [e.id, e.full_name]))
  return <><PageHeader title="Reports & Analytics" sub="Printable views and CSV exports." actions={<PrintButton />} />
    <div className="no-print mb-5"><Alert tone="amber"><b>Partial.</b> Available now: expiry, renewal and cheque reports + CSV exports (open in Excel). Native .xlsx and PDF files, receivables, supplier obligations, project reports and monthly reminder analytics arrive with Phase 2.</Alert></div>
    <div className="no-print mb-6 flex flex-wrap gap-2">{[['documents', 'Documents'], ['employees', 'Employees'], ['cheques', 'Cheques'], ['reminder-log', 'Reminder history']].map(([k, l]) => <LinkButton key={k} variant="secondary" href={`/api/export/${k}`}>Download {l} CSV</LinkButton>)}</div>
    <div className="space-y-5">
      <Card><CardHeader title={`Documents expiring in ${month}`} action={<form className="no-print"><input type="month" name="m" defaultValue={month} className="h-8 rounded-md border border-border bg-surface px-2 text-sm" /><button className="ms-2 text-sm text-primary">Go</button></form>} />
        {!exp?.length ? <EmptyState title="No expiries this month" /> : <TableWrap><thead className="border-b border-border"><tr><Th>Document</Th><Th>Category</Th><Th>Expiry</Th><Th>Status</Th></tr></thead><tbody className="divide-y divide-border">{exp.map((d: any) => <tr key={d.id}><Td><Link className="hover:text-primary" href={`/documents/${d.id}`}>{d.name}</Link></Td><Td className="text-muted">{d.category?.name ?? '—'}</Td><Td className="tabular-nums">{d.expiry_date}</Td><Td><StatusBadge doc={d} today={c.today} /></Td></tr>)}</tbody></TableWrap>}</Card>
      <Card><CardHeader title="Employee document renewals — expired or due within 90 days" />
        {!ren?.length ? <EmptyState title="No employee renewals due" /> : <TableWrap><thead className="border-b border-border"><tr><Th>Employee</Th><Th>Document</Th><Th>Expiry</Th><Th>Status</Th></tr></thead><tbody className="divide-y divide-border">{ren.map((d: any) => <tr key={d.id}><Td><Link className="hover:text-primary" href={`/employees/${d.owner_id}`}>{nm[d.owner_id] ?? '—'}</Link></Td><Td>{d.category?.name ?? d.name}</Td><Td className="tabular-nums">{d.expiry_date}</Td><Td><StatusBadge doc={d} today={c.today} /></Td></tr>)}</tbody></TableWrap>}</Card>
      {c.can('finance.view') && <Card><CardHeader title="Open cheques by date" />
        {!chq?.length ? <EmptyState title="No open cheques" /> : <TableWrap><thead className="border-b border-border"><tr><Th>Date</Th><Th>No.</Th><Th>Party</Th><Th>Direction</Th><Th>Amount</Th><Th>Status</Th></tr></thead><tbody className="divide-y divide-border">{chq.map((x: any) => <tr key={x.id}><Td className="tabular-nums">{x.cheque_date}</Td><Td className="font-mono text-xs">{x.cheque_no}</Td><Td>{x.party_name}</Td><Td className="capitalize">{x.direction}</Td><Td className="tabular-nums">{formatAed(x.amount)}</Td><Td><Badge>{x.status}</Badge></Td></tr>)}</tbody></TableWrap>}</Card>}</div></>
}
