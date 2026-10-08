import { Plus, FileText, Tags } from 'lucide-react'
import { getCtx } from '@/lib/auth'
import { flat } from '@/lib/queries'
import { listDocs } from '@/lib/doc-queries'
import { PageHeader, EmptyState, Field, Input, Select } from '@/components/ui/primitives'
import { DialogButton } from '@/components/ui/dialog'
import { ActionForm } from '@/components/ui/action-form'
import { DocFields } from '@/components/documents/doc-fields'
import { DocsTable, Filters } from '@/components/documents/docs-table'
import { createDocument, createCategory } from '@/app/actions/documents'
import { LinkButton, Card, CardHeader } from '@/components/ui/primitives'
import { documentTimeline } from '@/lib/timeline'
import { Timeline } from '@/components/timeline'

export const metadata = { title: 'Company Documents' }
export default async function CompanyDocuments({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await getCtx(); const sp = await flat(searchParams)
  const [{ rows, total, page }, { data: cats }, { data: people }] = await Promise.all([
    listDocs(c, sp, { ownerTypes: ['company'] }),
    c.supabase.from('document_categories').select('id,name,scope').in('scope', ['company', 'other']).order('name'),
    c.supabase.from('profiles').select('id,full_name').eq('is_active', true).order('full_name'),
  ])
  const categories = cats ?? []
  const showTimeline = sp.view === 'timeline'
  const events = showTimeline ? await documentTimeline(c, { type: 'company' }) : []
  return <>
    <PageHeader title="Company Documents" sub="Licences, registrations, insurance, tenancy, permits and contracts. With expiry tracking and renewal history."
      actions={<>
        <LinkButton href={showTimeline ? '/documents' : '/documents?view=timeline'} variant="secondary">{showTimeline ? 'List' : 'Timeline'}</LinkButton>
        {c.can('data.export') && <LinkButton href="/api/export/documents" variant="secondary">Export CSV</LinkButton>}
        {c.can('records.edit') && <DialogButton variant="secondary" label="Categories" title="Add custom category" icon={<Tags size={15} />}>
          <ActionForm action={createCategory} submit="Add category">
            <Field label="Name"><Input name="name" required maxLength={120} placeholder="e.g. Civil Defence Certificate" /></Field>
            <Field label="Type"><Select name="scope" defaultValue="company"><option value="company">Company document</option><option value="other">Other</option></Select></Field>
            <Field label="Default reminder days (optional)" hint="Comma-separated, e.g. 120, 60, 30, 7"><Input name="reminder_days" /></Field></ActionForm></DialogButton>}
        {c.can('documents.upload') && <DialogButton wide openParam="document" label="Add document" title="Add company document" icon={<Plus size={15} />}>
          <ActionForm action={createDocument} submit="Save document"><input type="hidden" name="owner_type" value="company" />
            <DocFields categories={categories} people={people ?? []} company={c.company.name} /></ActionForm></DialogButton>}
      </>} />
    {showTimeline ? <Card><CardHeader title="Company document timeline" /><div className="p-4"><Timeline events={events} /></div></Card> : <>
    <Filters sp={sp} base="/documents" categories={categories} />
    <DocsTable rows={rows} total={total} page={page} today={c.today} base="/documents" sp={sp}
      empty={<EmptyState icon={FileText} title={sp.q || sp.category || sp.status ? 'No documents match your filters' : 'No company documents yet'}
        body={sp.q || sp.category || sp.status ? 'Try clearing the filters.' : 'Add your Trade License, VAT certificate, tenancy contract and other documents to start tracking expiry dates automatically.'} />} />
    </>}
  </>
}
