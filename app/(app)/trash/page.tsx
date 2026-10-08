import { redirect } from 'next/navigation'
import { ArchiveRestore, Trash2 } from 'lucide-react'
import { getCtx } from '@/lib/auth'
import { Alert, Badge, Card, EmptyState, PageHeader, Td, Th, TableWrap } from '@/components/ui/primitives'
import { ActionButton } from '@/components/ui/action-form'
import { purgeRecord, restoreRecord } from '@/app/actions/trash'

export const metadata = { title: 'Trash' }
const LABEL: Record<string, string> = { customer: 'Customer', supplier: 'Supplier', project: 'Project', invoice: 'Sales document', employee: 'Employee', asset: 'Vehicle / asset', document: 'Document', lead: 'Lead', site_visit: 'Site visit', work_order: 'Work order', task: 'Task', site_report: 'Daily site report' }

export default async function TrashPage() {
  const c = await getCtx(); if (!c.can('records.delete')) redirect('/')
  const { data, error } = await c.supabase.rpc('trash_list')
  const ids = [...new Set((data ?? []).map((r: any) => r.deleted_by).filter(Boolean))]
  const { data: people } = ids.length ? await c.supabase.from('profiles').select('id,full_name').in('id', ids) : { data: [] as any[] }
  const who = new Map((people ?? []).map((p: any) => [p.id, p.full_name]))
  const purge = c.can('records.purge')
  return <>
    <PageHeader title="Trash" sub="Deleted records stay here until restored. Nothing is removed permanently unless an owner chooses “Delete forever”." />
    {error && <div className="mb-4"><Alert tone="red">The trash could not be loaded. Please try again.</Alert></div>}
    <Card>{!(data ?? []).length ? <EmptyState icon={Trash2} title="Trash is empty" body="Deleted customers, projects, draft documents, employees, vehicles and documents appear here and can be restored." />
      : <TableWrap><thead className="bg-surface-2/50"><tr><Th>Item</Th><Th>Type</Th><Th>Deleted</Th><Th>By</Th><Th /></tr></thead>
        <tbody className="divide-y divide-border">{(data ?? []).map((r: any) => <tr key={`${r.entity}-${r.id}`} className="hover:bg-surface-2/50">
          <Td><div className="font-medium">{r.label}</div>{r.sub && <div className="text-xs text-muted">{r.sub}</div>}</Td>
          <Td><Badge>{LABEL[r.entity] ?? r.entity}</Badge></Td>
          <Td className="whitespace-nowrap text-muted">{new Date(r.deleted_at).toLocaleString('en-GB', { timeZone: c.company.timezone, dateStyle: 'medium', timeStyle: 'short' })}</Td>
          <Td className="text-muted">{who.get(r.deleted_by) ?? '—'}</Td>
          <Td className="text-right"><div className="flex justify-end gap-1">
            <ActionButton action={restoreRecord.bind(null, r.entity, r.id)}><ArchiveRestore size={14} />Restore</ActionButton>
            {purge && r.entity !== 'document' && <ActionButton variant="ghost" action={purgeRecord.bind(null, r.entity, r.id)} confirm={`Delete “${r.label}” forever? This cannot be undone.`}><Trash2 size={14} /><span className="text-danger">Delete forever</span></ActionButton>}
          </div></Td></tr>)}</tbody></TableWrap>}</Card>
  </>
}
