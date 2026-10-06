import { redirect } from 'next/navigation'
import Link from 'next/link'
import { History } from 'lucide-react'
import { getCtx } from '@/lib/auth'
import { flat, pageOf } from '@/lib/queries'
import { Badge, Card, EmptyState, LinkButton, PageHeader, Pagination, Td, Th, TableWrap } from '@/components/ui/primitives'
import { ACTION_LABEL, TABLE_LABEL, changeSummary } from '@/lib/audit'

export const metadata = { title: 'Audit log' }
const SIZE = 30
const LINK: Record<string, (id: string) => string> = { invoices: id => `/invoices/${id}`, customers: id => `/parties/${id}`, projects: id => `/projects/${id}`, documents: id => `/documents/${id}`, employees: id => `/employees/${id}`, assets: id => `/assets/${id}` }

/** Who changed what and when. Read-only; secrets and confidential values are redacted (see lib/audit.ts and audit_row()). */
export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await getCtx(); if (!c.can('audit.view')) redirect('/')
  const sp = await flat(searchParams), page = pageOf(sp.page)
  let q = c.supabase.from('audit_logs').select('id,action,table_name,record_id,user_id,changes,created_at', { count: 'exact' })
  if (sp.table && sp.table in TABLE_LABEL) q = q.eq('table_name', sp.table)
  if (sp.action && sp.action in ACTION_LABEL) q = q.eq('action', sp.action)
  if (sp.user && /^[0-9a-f-]{36}$/.test(sp.user)) q = q.eq('user_id', sp.user)
  if (sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from)) q = q.gte('created_at', `${sp.from}T00:00:00+04:00`)
  if (sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to)) q = q.lte('created_at', `${sp.to}T23:59:59+04:00`)
  if (sp.record && /^[0-9a-f-]{36}$/.test(sp.record)) q = q.eq('record_id', sp.record)
  const [{ data, count }, { data: people }] = await Promise.all([
    q.order('created_at', { ascending: false }).range((page - 1) * SIZE, page * SIZE - 1),
    c.supabase.from('profiles').select('id,full_name').order('full_name'),
  ])
  const who = new Map((people ?? []).map(p => [p.id, p.full_name]))
  const cls = 'h-9 rounded-md border border-border bg-surface px-3 text-sm'
  return <>
    <PageHeader title="Audit log" sub="Every create, edit, delete, restore, payment, status change, export and settings change — with the user and time. Passwords, API keys and confidential values are never logged." />
    <Card>
      <form className="flex flex-wrap gap-2 border-b border-border p-3">
        <select name="table" defaultValue={sp.table ?? ''} aria-label="Record type" className={cls}><option value="">All records</option>{Object.entries(TABLE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <select name="action" defaultValue={sp.action ?? ''} aria-label="Action" className={cls}><option value="">All actions</option>{Object.entries(ACTION_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <select name="user" defaultValue={sp.user ?? ''} aria-label="User" className={cls}><option value="">All users</option>{(people ?? []).map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select>
        <input type="date" name="from" defaultValue={sp.from} aria-label="From" className={cls} /><input type="date" name="to" defaultValue={sp.to} aria-label="To" className={cls} />
        <button className="h-9 cursor-pointer rounded-md border border-border px-3 text-sm hover:bg-surface-2">Filter</button>
        {(sp.table || sp.action || sp.user || sp.from || sp.to || sp.record) && <LinkButton href="/audit" variant="ghost">Clear</LinkButton>}</form>
      {!data?.length ? <EmptyState icon={History} title="No matching activity" body="Try a wider date range or fewer filters." />
        : <TableWrap><thead className="bg-surface-2/50"><tr><Th>When</Th><Th>User</Th><Th>Action</Th><Th>Record</Th><Th>Change</Th></tr></thead>
          <tbody className="divide-y divide-border">{data.map((a: any) => { const sum = changeSummary(a.table_name, a.action, a.changes), href = a.record_id && LINK[a.table_name] && a.action !== 'PURGE' && a.action !== 'DELETE' ? LINK[a.table_name](a.record_id) : null
            return <tr key={a.id} className="align-top hover:bg-surface-2/50">
              <Td className="whitespace-nowrap text-xs text-muted">{new Date(a.created_at).toLocaleString('en-GB', { timeZone: c.company.timezone, dateStyle: 'medium', timeStyle: 'medium' })}</Td>
              <Td className="whitespace-nowrap">{a.user_id ? who.get(a.user_id) ?? 'Former user' : <span className="text-muted">System</span>}</Td>
              <Td><Badge tone={a.action === 'DELETE' || a.action === 'PURGE' ? 'red' : a.action === 'TRASH' ? 'amber' : a.action === 'INSERT' ? 'green' : 'neutral'}>{ACTION_LABEL[a.action] ?? a.action}</Badge></Td>
              <Td className="whitespace-nowrap">{href ? <Link href={href} className="text-primary hover:underline">{TABLE_LABEL[a.table_name] ?? a.table_name}</Link> : TABLE_LABEL[a.table_name] ?? a.table_name}</Td>
              <Td className="max-w-[480px] text-xs text-muted">{sum.length ? sum.join(' · ') : '—'}</Td></tr> })}</tbody></TableWrap>}
      <Pagination page={page} pageSize={SIZE} total={count ?? 0} params={sp} base="/audit" />
    </Card>
  </>
}
