import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Download, History, RefreshCw, Trash2, Undo2, Upload } from 'lucide-react'
import { getCtx } from '@/lib/auth'
import { Badge, Card, CardHeader, EmptyState, Field, Input, LinkButton, Td, Th, TableWrap, Textarea } from '@/components/ui/primitives'
import { DialogButton } from '@/components/ui/dialog'
import { ActionButton, ActionForm } from '@/components/ui/action-form'
import { DocFields } from '@/components/documents/doc-fields'
import { StatusBadge } from '@/components/documents/status-badge'
import { recordRenewal, replaceFile, setDeleted, updateDocument } from '@/app/actions/documents'
import { ACCEPT_ATTR } from '@/lib/files'
import { formatAed } from '@/lib/time'

export const metadata = { title: 'Document' }
const kb = (n: number) => n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const c = await getCtx()
  const { data: doc } = await c.supabase.from('documents').select('*, category:document_categories(id,name), responsible:profiles!documents_responsible_user_id_fkey(full_name)').eq('id', id).maybeSingle()
  if (!doc) notFound()
  const [{ data: versions }, { data: renewals }, { data: cats }, { data: people }, access, employee] = await Promise.all([
    c.supabase.from('document_versions').select('id,version_no,file_name,mime_type,size_bytes,note,created_at,uploader:profiles!document_versions_uploaded_by_fkey(full_name)').eq('document_id', id).order('version_no', { ascending: false }),
    c.supabase.from('document_renewals').select('id,renewed_at,previous_expiry,new_expiry,fee,notes').eq('document_id', id).order('created_at', { ascending: false }),
    c.supabase.from('document_categories').select('id,name,scope').order('name'),
    c.supabase.from('profiles').select('id,full_name').eq('is_active', true).order('full_name'),
    c.can('audit.view') ? c.supabase.from('document_access_logs').select('id,action,created_at,user:profiles!document_access_logs_user_id_fkey(full_name)').eq('document_id', id).order('created_at', { ascending: false }).limit(25) : Promise.resolve({ data: [] as any[] }),
    doc.owner_type === 'employee' && doc.owner_id ? c.supabase.from('employees').select('id,full_name').eq('id', doc.owner_id).maybeSingle() : Promise.resolve({ data: null }),
  ])
  const current = versions?.find(v => v.id === doc.current_version_id) ?? versions?.[0]
  const previewable = current && (current.mime_type === 'application/pdf' || current.mime_type.startsWith('image/'))
  const back = employee.data ? `/employees/${employee.data.id}` : doc.owner_type === 'vault' ? '/vault' : '/documents'

  return <>
    <Link href={back} className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-fg"><ArrowLeft size={14} />Back</Link>
    {doc.deleted_at && <div className="mb-4 flex items-center justify-between rounded-md border border-warning/30 bg-warning/10 px-4 py-2 text-sm"><span>This document is in the recycle bin.</span>
      {c.can('records.delete') && <ActionButton action={setDeleted.bind(null, id, false)} variant="secondary"><Undo2 size={13} />Restore</ActionButton>}</div>}
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-xl font-semibold tracking-tight">{doc.name}</h1>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted"><StatusBadge doc={doc} today={c.today} />
          {doc.category?.name && <Badge>{doc.category.name}</Badge>}{employee.data && <Link href={`/employees/${employee.data.id}`} className="hover:text-primary">· {employee.data.full_name}</Link>}
          {!doc.reminders_active && <Badge tone="amber">Reminders off</Badge>}</div></div>
      <div className="flex flex-wrap gap-2">
        {current && <LinkButton href={`/api/documents/${id}/download`} variant="secondary"><Download size={15} />Download</LinkButton>}
        {c.can('documents.upload') && <DialogButton variant="secondary" label="Replace file" title="Upload a new version" icon={<Upload size={15} />}>
          <ActionForm action={replaceFile.bind(null, id)} submit="Upload version"><p className="text-sm text-muted">The current file stays available in version history.</p>
            <input type="file" name="file" required accept={ACCEPT_ATTR} className="text-sm file:me-3 file:rounded-md file:border-0 file:bg-primary-soft file:px-3 file:py-2 file:text-primary" />
            <Field label="Note (optional)"><Input name="note" maxLength={200} placeholder="e.g. Renewed copy from DED" /></Field></ActionForm></DialogButton>}
        {c.can('records.edit') && <DialogButton label="Record renewal" title="Record a renewal" icon={<RefreshCw size={15} />}>
          <ActionForm action={recordRenewal.bind(null, id)} submit="Save renewal">
            <p className="text-sm text-muted">Current expiry: <b>{doc.expiry_date ?? 'none'}</b>. Reminders restart from the new date.</p>
            <div className="grid gap-4 sm:grid-cols-2"><Field label="New issue date"><Input type="date" name="new_issue" /></Field><Field label="New expiry date *"><Input type="date" name="new_expiry" required /></Field></div>
            <Field label="Fee paid (AED)"><Input type="number" name="fee" step="0.01" min="0" defaultValue={doc.renewal_fee ?? ''} /></Field>
            <Field label="Renewed copy (optional)"><input type="file" name="file" accept={ACCEPT_ATTR} className="text-sm" /></Field>
            <Field label="Notes"><Textarea name="notes" /></Field></ActionForm></DialogButton>}
        {c.can('records.delete') && !doc.deleted_at && <ActionButton action={setDeleted.bind(null, id, true)} variant="ghost" confirm="Move this document to the recycle bin? It can be restored later."><Trash2 size={14} />Delete</ActionButton>}
      </div></div>

    <div className="grid gap-5 lg:grid-cols-5">
      <div className="space-y-5 lg:col-span-3">
        <Card><CardHeader title="Preview" sub={current ? `${current.file_name} · v${current.version_no} · ${kb(current.size_bytes)}` : undefined} />
          {previewable ? <iframe title="Document preview" src={`/api/documents/${id}/download?mode=preview`} className="h-[560px] w-full rounded-b-lg bg-surface-2" />
            : <EmptyState title={current ? 'No inline preview for this file type' : 'No file attached'} body={current ? 'Use Download to open it.' : 'Use “Replace file” to attach a scan.'} />}</Card>
        <Card><CardHeader title="Version history" sub="Old versions are never removed automatically." />
          {versions?.length ? <TableWrap><thead className="border-b border-border"><tr><Th>Ver.</Th><Th>File</Th><Th>Uploaded</Th><Th>Note</Th><Th /></tr></thead>
            <tbody className="divide-y divide-border">{versions.map((v: any) => <tr key={v.id}><Td>v{v.version_no}{v.id === doc.current_version_id && <Badge tone="blue" className="ms-2">current</Badge>}</Td>
              <Td>{v.file_name}<div className="text-xs text-muted">{kb(v.size_bytes)}</div></Td><Td className="text-muted">{v.created_at.slice(0, 10)}<div className="text-xs">{v.uploader?.full_name}</div></Td>
              <Td className="text-muted">{v.note ?? '—'}</Td><Td><Link className="text-primary hover:underline" href={`/api/documents/${id}/download?v=${v.id}`}>Download</Link></Td></tr>)}</tbody></TableWrap>
            : <EmptyState title="No versions yet" />}</Card>
      </div>
      <div className="space-y-5 lg:col-span-2">
        <Card><CardHeader title="Details" />
          {c.can('records.edit') ? <div className="p-4"><ActionForm action={updateDocument.bind(null, id)} resetOnSuccess={false}>
            <DocFields withFile={false} categories={cats?.filter(x => (doc.owner_type === 'employee' ? x.scope === 'employee' : x.scope !== 'employee')) ?? []} people={people ?? []}
              d={{ name: doc.name, category_id: doc.category_id ?? '', reference_no: doc.reference_no ?? '', issuing_authority: doc.issuing_authority ?? '', issue_date: doc.issue_date ?? '', expiry_date: doc.expiry_date ?? '', responsible_user_id: doc.responsible_user_id ?? '', renewal_fee: doc.renewal_fee ?? '', notes: doc.notes ?? '', reminder_days: doc.reminder_days ?? [] }} />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="reminders_active" defaultChecked={doc.reminders_active} />Send reminders for this document</label></ActionForm></div>
            : <dl className="grid grid-cols-2 gap-3 p-4 text-sm">{[['Reference', doc.reference_no], ['Authority', doc.issuing_authority], ['Issued', doc.issue_date], ['Expires', doc.expiry_date], ['Responsible', doc.responsible?.full_name], ['Renewal fee', doc.renewal_fee != null ? formatAed(doc.renewal_fee) : null]].map(([k, v]) => <div key={k as string}><dt className="text-xs text-muted">{k}</dt><dd>{v ?? '—'}</dd></div>)}</dl>}</Card>
        <Card><CardHeader title="Renewal history" />
          {renewals?.length ? <ul className="divide-y divide-border text-sm">{renewals.map(r => <li key={r.id} className="px-4 py-3"><div className="font-medium">{r.previous_expiry ?? '—'} → {r.new_expiry}</div>
            <div className="text-xs text-muted">Recorded {r.renewed_at}{r.fee != null && ` · ${formatAed(r.fee)}`}{r.notes && ` · ${r.notes}`}</div></li>)}</ul> : <EmptyState title="No renewals recorded" />}</Card>
        {c.can('audit.view') && <Card><CardHeader title="Access history" action={<History size={15} className="text-muted" />} />
          {access.data?.length ? <ul className="max-h-64 divide-y divide-border overflow-y-auto text-sm">{access.data.map((a: any) => <li key={a.id} className="flex justify-between px-4 py-2"><span><b className="capitalize">{a.action}</b> · {a.user?.full_name ?? 'System'}</span><span className="text-xs text-muted">{a.created_at.slice(0, 16).replace('T', ' ')}</span></li>)}</ul> : <EmptyState title="No access recorded" />}</Card>}
      </div></div></>
}
