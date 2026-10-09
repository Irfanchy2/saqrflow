import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/auth'
import { Badge, Card, CardHeader, PageHeader, Td, Th } from '@/components/ui/primitives'
import { ActionButton } from '@/components/ui/action-form'
import { ImportWizard } from '@/components/import-wizard'
import { undoImport } from '@/app/actions/import-wizard'
import { IMPORT_ENTITIES } from '@/lib/import-spec'

export const metadata = { title: 'Import data' }

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const c = await getCtx(); if (!c.can('records.edit')) redirect('/')
  const { type } = await searchParams
  const allowed = Object.entries(IMPORT_ENTITIES).filter(([, s]) => !s.sensitive || c.can('employees.view_sensitive')).map(([k]) => k)
  const { data: batches } = await c.supabase.from('import_batches').select('*').order('created_at', { ascending: false }).limit(30)
  const { data: people } = await c.supabase.from('profiles').select('id,full_name')
  const who = new Map((people ?? []).map(p => [p.id, p.full_name as string]))
  const fmt = (d: string) => new Date(d).toLocaleString('en-GB', { timeZone: c.company.timezone, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  return <><PageHeader title="Import data" sub="Customers, suppliers, products & services, employees and leads from Excel or CSV, with column matching, a full check before saving and undo." />
    <div className="flex flex-col gap-5">
      <ImportWizard allowed={allowed} initial={type} />
      <Card><CardHeader title="Import history" sub="Each import is one batch. Undo moves its records to the Trash (products are switched to inactive)." />
        <div className="overflow-x-auto"><table className="w-full min-w-[720px]" data-import-history><thead><tr><Th>When</Th><Th>What</Th><Th>File</Th><Th>Imported</Th><Th>Skipped</Th><Th>Problems</Th><Th>By</Th><Th /></tr></thead>
          <tbody>{(batches ?? []).map((b: any) => <tr key={b.id}><Td className="whitespace-nowrap text-xs tabular-nums text-muted">{fmt(b.created_at)}</Td><Td>{IMPORT_ENTITIES[b.entity]?.label ?? b.entity}</Td>
            <Td className="max-w-[200px] truncate text-xs" title={b.file_name}>{b.file_name}</Td><Td className="tabular-nums">{b.imported}</Td><Td className="tabular-nums">{b.skipped}</Td><Td className="tabular-nums">{b.failed}</Td>
            <Td className="text-xs">{who.get(b.created_by) ?? '—'}</Td>
            <Td>{b.undone_at ? <Badge>Undone {fmt(b.undone_at)}</Badge> : b.imported > 0 && (IMPORT_ENTITIES[b.entity]?.trash ? c.can('records.delete') : true)
              ? <ActionButton variant="ghost" action={undoImport.bind(null, b.id)} confirm={`Undo this import? ${IMPORT_ENTITIES[b.entity]?.trash ? `The ${b.imported} imported record(s) go to the Trash.` : `The ${b.imported} imported item(s) are switched to inactive.`}`}>Undo</ActionButton> : null}</Td></tr>)}
            {!(batches ?? []).length && <tr><Td colSpan={8} className="text-muted">No imports yet.</Td></tr>}</tbody></table></div></Card>
    </div></>
}
