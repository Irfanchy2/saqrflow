import Link from 'next/link'
import { redirect } from 'next/navigation'
import { CheckCheck, FileSearch, Inbox, Sparkles, Upload } from 'lucide-react'
import { getCtx } from '@/lib/auth'
import { flat } from '@/lib/queries'
import { Alert, Card, EmptyState, PageHeader, StatCard, Td, Th, TableWrap } from '@/components/ui/primitives'
import { DialogButton } from '@/components/ui/dialog'
import { ActionButton, ActionForm } from '@/components/ui/action-form'
import { DropZone } from '@/components/ui/drop-zone'
import { Confidence, PathCrumbs, StatusPill } from '@/components/inbox/bits'
import { confirmAllReady, uploadToInbox } from '@/app/actions/inbox'
import { aiEnabled } from '@/lib/inbox/pipeline'
import { cn } from '@/lib/utils'

export const metadata = { title: 'Smart Document Inbox' }
export const maxDuration = 60
const TABS = [['recent', 'Recent'], ['ready', 'Ready to file'], ['needs_review', 'Needs review'], ['duplicate', 'Duplicates'], ['filed', 'Filed'], ['rejected', 'Rejected']] as const

export default async function InboxPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await getCtx(); if (!c.can('documents.upload') && !c.can('employees.view_sensitive')) redirect('/'); const sp = await flat(searchParams)
  const batch = (sp.batch ?? '').split(',').filter(x => /^[0-9a-f-]{36}$/i.test(x))
  const tab = batch.length ? 'batch' : TABS.some(([k]) => k === sp.tab) ? sp.tab! : 'recent'
  let q = c.supabase.from('document_inbox').select('id,file_name,status,doc_type,confidence,review_reasons,suggestion,created_at,filed_document_id,source').order('created_at', { ascending: false }).limit(100)
  if (tab === 'batch') q = q.in('id', batch); else if (tab !== 'recent') q = q.eq('status', tab)
  const [{ data: rows }, { data: all }, ai] = await Promise.all([q, c.supabase.from('document_inbox').select('status').limit(5000), aiEnabled(c)])
  const n = (s: string) => (all ?? []).filter(r => r.status === s).length

  return <>
    <PageHeader title="Smart Document Inbox" sub="Drop any document. SaqrFlow works out what it is, who it belongs to and where it goes — you confirm before anything is filed."
      actions={<>{n('ready') > 0 && <ActionButton action={confirmAllReady} variant="secondary" size="md" confirm={`File all ${n('ready')} high-confidence document(s) to their suggested destinations?`}><CheckCheck size={15} />Confirm all suggested ({n('ready')})</ActionButton>}
        <DialogButton wide label="Upload documents" title="Upload to Smart Inbox" icon={<Upload size={15} />}>
          <ActionForm action={uploadToInbox} submit="Upload & analyse" resetOnSuccess={false}><DropZone />
            <p className="text-xs text-muted">Up to 20 files · PDF, JPG, PNG, WEBP, Office · on mobile you can take a photo. Files are stored privately; nothing is filed until you confirm.</p></ActionForm></DialogButton></>} />
    <div className="mb-5"><Alert tone={ai ? 'green' : 'blue'}>{ai ? <><Sparkles size={14} className="me-1 inline" /><b>AI reading is on</b> — scans and photos are read with OCR by Claude (Anthropic API).</> : <><b>Local reading mode.</b> Digital PDFs are read and classified on the server; scanned images go to manual review. An admin can enable AI OCR under Settings.</>}</Alert></div>
    {sp.warn && <div className="mb-4"><Alert tone="amber">{sp.warn}</Alert></div>}
    <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Ready to file" value={n('ready')} icon={CheckCheck} tone="green" href="/inbox?tab=ready" />
      <StatCard label="Needs review" value={n('needs_review')} icon={FileSearch} tone={n('needs_review') ? 'amber' : 'neutral'} href="/inbox?tab=needs_review" />
      <StatCard label="Possible duplicates" value={n('duplicate')} icon={Inbox} tone={n('duplicate') ? 'red' : 'neutral'} href="/inbox?tab=duplicate" />
      <StatCard label="Filed" value={n('filed')} icon={Sparkles} href="/inbox?tab=filed" />
    </div>
    {tab === 'batch' ? <h2 className="mb-3 text-sm font-semibold">{rows?.length ?? 0} document{rows?.length === 1 ? '' : 's'} processed <Link href="/inbox" className="ms-2 font-normal text-primary hover:underline">Back to inbox</Link></h2>
      : <div className="mb-4 flex gap-1 overflow-x-auto border-b border-border">{TABS.map(([k, l]) => <Link key={k} href={`/inbox?tab=${k}`} className={cn('-mb-px whitespace-nowrap border-b-2 px-4 py-2 text-sm', tab === k ? 'border-primary font-medium text-primary' : 'border-transparent text-muted hover:text-fg')}>{l}{k !== 'recent' && n(k) > 0 && <span className="ms-1.5 text-xs text-muted">{n(k)}</span>}</Link>)}</div>}
    <Card className="overflow-hidden">{!rows?.length ? <EmptyState icon={Inbox} title="Nothing here" body={tab === 'recent' ? 'Upload a trade licence, Emirates ID, visa, tenancy contract, invoice… and SaqrFlow will suggest where it belongs.' : 'No documents in this list.'} /> :
      <TableWrap><thead className="border-b border-border bg-surface-2/60"><tr><Th>File</Th><Th>Detected</Th><Th>Destination</Th><Th>Status</Th><Th /></tr></thead>
        <tbody className="divide-y divide-border">{rows.map((r: any) => <tr key={r.id} className="hover:bg-surface-2/50">
          <Td><div className="max-w-[220px] truncate font-medium" title={r.file_name}>{r.file_name}</div><div className="text-xs text-muted">{new Date(r.created_at).toLocaleString('en-GB', { timeZone: c.company.timezone, dateStyle: 'medium', timeStyle: 'short' })}</div></Td>
          <Td><div className="font-medium">{r.suggestion?.label ?? '—'}</div><Confidence v={r.confidence} /></Td>
          <Td>{r.suggestion?.path ? <PathCrumbs path={r.suggestion.path} /> : <span className="text-muted">—</span>}{r.suggestion?.owner && <div className="text-xs text-muted">Matched: {r.suggestion.owner.name}{r.suggestion.owner.confidence ? ` · ${Math.round(r.suggestion.owner.confidence * 100)}%` : ''}</div>}</Td>
          <Td><StatusPill s={r.status} />{r.review_reasons?.length > 0 && r.status !== 'filed' && <ul className="mt-1 max-w-[260px] text-xs text-muted">{r.review_reasons.slice(0, 2).map((x: string) => <li key={x}>• {x}</li>)}</ul>}</Td>
          <Td>{r.status === 'filed' && r.filed_document_id ? <Link className="text-sm text-primary hover:underline" href={`/documents/${r.filed_document_id}`}>Open</Link>
            : r.status !== 'rejected' && <Link className="text-sm font-medium text-primary hover:underline" href={`/inbox/${r.id}`}>{r.status === 'ready' ? 'Confirm' : 'Review'}</Link>}</Td></tr>)}</tbody></TableWrap>}</Card></>
}
