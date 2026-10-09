import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Upload, Vault as VaultIcon } from 'lucide-react'
import { getCtx } from '@/lib/auth'
import { flat } from '@/lib/queries'
import { listDocs } from '@/lib/doc-queries'
import { EmptyState, Field, Input, LinkButton, PageHeader, Select } from '@/components/ui/primitives'
import { DialogButton } from '@/components/ui/dialog'
import { ActionForm } from '@/components/ui/action-form'
import { DropZone } from '@/components/ui/drop-zone'
import { DocsTable, Filters } from '@/components/documents/docs-table'
import { bulkUpload } from '@/app/actions/documents'
import { cn } from '@/lib/utils'
import { SavedViews } from '@/components/saved-views'

export const metadata = { title: 'Document Vault' }
export default async function Vault({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await getCtx(); if (!c.can('documents.view')) redirect('/'); const sp = await flat(searchParams)
  const bin = sp.bin === '1' && c.can('records.delete')
  const [{ rows, total, page }, { data: cats }, { data: emps }] = await Promise.all([
    listDocs(c, sp, { deleted: bin }),
    c.supabase.from('document_categories').select('id,name').order('name'),
    c.can('employees.view_sensitive') ? c.supabase.from('employees').select('id,full_name').order('full_name') : Promise.resolve({ data: [] as any[] }),
  ])
  const cls = 'h-9 rounded-md border border-border bg-surface px-3 text-sm'
  return <>
    <PageHeader title="Document Vault" sub="Every file in one private place. Employee and cheque files stay linked to their record. No duplicates."
      actions={<><SavedViews page="/vault" />{c.can('data.export') && <LinkButton href="/api/export/documents" variant="secondary">Export list (CSV)</LinkButton>}
        {c.can('documents.upload') && <DialogButton wide label="Upload files" title="Upload to vault" icon={<Upload size={15} />}>
          <ActionForm action={bulkUpload} submit="Upload"><DropZone />
            <div className="grid gap-4 sm:grid-cols-2"><Field label="Category (optional)"><Select name="category_id" defaultValue=""><option value="">—</option>{cats?.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field>
              <Field label="Folder (optional)"><Input name="folder" maxLength={120} placeholder="e.g. Projects/ABC Tower" /></Field></div>
            <p className="text-xs text-muted">Files are stored privately and checked for type, size and content. Identical files already in the vault are flagged. Add expiry dates afterwards to activate reminders.</p></ActionForm></DialogButton>}</>} />
    {c.can('records.delete') && <div className="mb-4 flex gap-1 border-b border-border">{[['', 'Files'], ['1', 'Recycle bin']].map(([k, l]) => <Link key={k} href={k ? '/vault?bin=1' : '/vault'} className={cn('-mb-px border-b-2 px-4 py-2 text-sm', (k === '1') === bin ? 'border-primary font-medium text-primary' : 'border-transparent text-muted')}>{l}</Link>)}</div>}
    <Filters sp={sp} base="/vault" categories={cats ?? []} extra={<>
      <select name="owner" defaultValue={sp.owner ?? ''} className={cls}><option value="">All records</option><option value="company">Company</option><option value="employee">Employees</option><option value="vault">Vault only</option><option value="cheque">Cheques</option><option value="vehicle">Vehicles</option><option value="resource">Equipment & assets</option><option value="project">Projects</option></select>
      {!!emps?.length && <select name="employee" defaultValue={sp.employee ?? ''} className={cls}><option value="">Any employee</option>{emps.map((e: any) => <option key={e.id} value={e.id}>{e.full_name}</option>)}</select>}
      {bin && <input type="hidden" name="bin" value="1" />}</>} />
    <DocsTable showOwner rows={rows} total={total} page={page} today={c.today} base="/vault" sp={sp}
      empty={<EmptyState icon={VaultIcon} title={bin ? 'Recycle bin is empty' : 'No files found'} body={bin ? 'Deleted documents can be restored from here.' : 'Upload files or add documents from the Company Documents and Employees pages.'} />} /></>
}
