import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AlertOctagon, CheckCheck, FileSearch, Inbox, Sparkles, Upload, UploadCloud } from 'lucide-react'
import { getCtx } from '@/lib/auth'
import { flat } from '@/lib/queries'
import { Alert, Card, EmptyState, PageHeader, StatCard, Td, Th, TableWrap } from '@/components/ui/primitives'
import { DialogButton } from '@/components/ui/dialog'
import { ActionButton } from '@/components/ui/action-form'
import { UploadPanel } from '@/components/inbox/upload-panel'
import { Confidence, PathCrumbs, StatusPill } from '@/components/inbox/bits'
import { confirmAllReady } from '@/app/actions/inbox'
import { aiSettings } from '@/lib/inbox/pipeline'
import { ocrProviders } from '@/lib/ai/ocr'
import { aiProviders, pickAi } from '@/lib/ai/llm'
import { cn } from '@/lib/utils'
import { zonedToUtc } from '@/lib/time'

export const metadata = { title: 'Smart Document Inbox' }
export const maxDuration = 60
const TABS = [['recent', 'All'], ['processing', 'Processing'], ['ready', 'Ready for review'], ['filed', 'Successfully filed'], ['needs_review', 'Needs review'], ['duplicate', 'Duplicates'], ['failed', 'Failed'], ['rejected', 'Deleted']] as const
const PROCESSING = ['uploaded', 'processing', 'ocr_complete', 'classification_complete']

export default async function InboxPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await getCtx(); if (!c.can('documents.upload') && !c.can('employees.view_sensitive')) redirect('/'); const sp = await flat(searchParams)
  const batch = (sp.batch ?? '').split(',').filter(x => /^[0-9a-f-]{36}$/i.test(x))
  const tab = batch.length ? 'batch' : TABS.some(([k]) => k === sp.tab) ? sp.tab! : 'recent'
  let q = c.supabase.from('document_inbox').select('id,file_name,status,doc_type,confidence,review_reasons,suggestion,created_at,filed_document_id,source').order('created_at', { ascending: false }).limit(100)
  if (tab === 'batch') q = q.in('id', batch); else if (tab === 'processing') q = q.in('status', PROCESSING); else if (tab !== 'recent') q = q.eq('status', tab)
  // tab badges = count-only queries; "Today" = only today's rows (not the whole inbox history)
  const head = { count: 'exact' as const, head: true }, STATUSES = ['ready', 'needs_review', 'duplicate', 'filed', 'failed', 'rejected']
  const dayStart = zonedToUtc(c.today, '00:00', c.company.timezone).toISOString()   // company-local midnight
  const [{ data: rows }, st, ocrP, aiP, { data: todayAll }, procCount, ...statusCounts] = await Promise.all([q, aiSettings(c), ocrProviders(c.company.id), aiProviders(c.company.id),
    c.supabase.from('document_inbox').select('status,created_at').gte('created_at', dayStart).limit(1000),
    c.supabase.from('document_inbox').select('id', head).in('status', PROCESSING),
    ...STATUSES.map(x => c.supabase.from('document_inbox').select('id', head).eq('status', x))])
  const countOf: Record<string, number> = Object.fromEntries(STATUSES.map((x, i) => [x, statusCounts[i].count ?? 0]))
  const n = (s: string) => (s === 'processing' ? procCount.count ?? 0 : countOf[s] ?? 0)
  const todayRows = (todayAll ?? []).filter(r => new Date(r.created_at).toLocaleDateString('en-CA', { timeZone: c.company.timezone }) === c.today)
  const t = (f: (s: string) => boolean) => todayRows.filter(r => f(r.status)).length
  const ocrNames = (st.ocr === 'auto' ? (['google_vision', 'ocrspace', 'tesseract'] as const) : st.ocr === 'tesseract' ? (['tesseract'] as const) : [st.ocr, 'tesseract'] as const).filter(k => ocrP[k].configured()).map(k => ocrP[k].label)
  const ai = st.ai === 'rules' ? null : pickAi(st.ai, aiP, true)

  return <>
    <PageHeader title="Smart Document Inbox" sub="Drop any document. Averiqo works out what it is, who it belongs to and where it goes. You confirm before anything is filed."
      actions={<>{n('ready') > 0 && <ActionButton action={confirmAllReady} variant="secondary" size="md" confirm={`File all ${n('ready')} high-confidence document(s) to their suggested destinations?`}><CheckCheck size={15} />Confirm all suggested ({n('ready')})</ActionButton>}
        <DialogButton wide label="Upload documents" title="Upload to Smart Inbox" icon={<Upload size={15} />}><UploadPanel /></DialogButton></>} />
    <div className="mb-5"><Alert tone={ai ? 'green' : 'blue'}>{ai ? <><Sparkles size={14} className="me-1 inline" /><b>AI classification: {ai.label}</b>{ai.id === 'gemini' ? ` (${ai.model}). Only the OCR text is sent${st.redact ? ', with ID numbers removed' : ''}` : '. Reads the file itself'}.</> : <><b>Local reading mode</b>. No AI service is used.</>}
      {' '}OCR: {ocrNames.length ? ocrNames.join(' → ') : 'none configured'} (digital PDFs are read directly on the server). {c.can('settings.manage') && <Link href="/settings#ai" className="font-medium text-primary hover:underline">Settings → AI & Automation</Link>}</Alert></div>
    <h2 className="mb-2 text-xs font-medium text-muted">Today</h2>
    <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
      <StatCard label="Documents uploaded" value={todayRows.length} icon={UploadCloud} tone="blue" />
      <StatCard label="Successfully classified" value={t(s => ['ready', 'filed'].includes(s))} icon={CheckCheck} tone="green" />
      <StatCard label="Needs review" value={t(s => s === 'needs_review')} icon={FileSearch} tone={t(s => s === 'needs_review') ? 'amber' : 'neutral'} href="/inbox?tab=needs_review" />
      <StatCard label="Duplicates" value={t(s => s === 'duplicate')} icon={Inbox} tone={t(s => s === 'duplicate') ? 'red' : 'neutral'} href="/inbox?tab=duplicate" />
      <StatCard label="Failed" value={t(s => s === 'failed')} icon={AlertOctagon} tone={t(s => s === 'failed') ? 'red' : 'neutral'} href="/inbox?tab=failed" />
    </div>
    {sp.warn && <div className="mb-4"><Alert tone="amber">{sp.warn}</Alert></div>}
    {tab === 'batch' ? <h2 className="mb-3 text-sm font-semibold">{rows?.length ?? 0} document{rows?.length === 1 ? '' : 's'} processed <Link href="/inbox" className="ms-2 font-normal text-primary hover:underline">Back to inbox</Link></h2>
      : <div className="mb-4 flex gap-1 overflow-x-auto border-b border-border">{TABS.map(([k, l]) => <Link key={k} href={`/inbox?tab=${k}`} className={cn('-mb-px whitespace-nowrap border-b-2 px-4 py-2 text-sm', tab === k ? 'border-primary font-medium text-primary' : 'border-transparent text-muted hover:text-fg')}>{l}{k !== 'recent' && n(k) > 0 && <span className="ms-1.5 text-xs text-muted">{n(k)}</span>}</Link>)}</div>}
    <Card className="overflow-hidden">{!rows?.length ? <EmptyState icon={Inbox} title="Nothing here" body={tab === 'recent' ? 'Upload a trade licence, Emirates ID, visa, tenancy contract, invoice… and Averiqo will suggest where it belongs.' : 'No documents in this list.'} /> :
      <TableWrap><thead className="border-b border-border bg-surface-2/60"><tr><Th>File</Th><Th>Detected</Th><Th>Destination</Th><Th>Status</Th><Th /></tr></thead>
        <tbody className="divide-y divide-border">{rows.map((r: any) => <tr key={r.id} className="hover:bg-surface-2/50">
          <Td><div className="max-w-[220px] truncate font-medium" title={r.file_name}>{r.file_name}</div><div className="text-xs text-muted">{new Date(r.created_at).toLocaleString('en-GB', { timeZone: c.company.timezone, dateStyle: 'medium', timeStyle: 'short' })}</div></Td>
          <Td><div className="font-medium">{r.suggestion?.label ?? '—'}</div><Confidence v={r.confidence} /></Td>
          <Td>{r.suggestion?.path ? <PathCrumbs path={r.suggestion.path} /> : <span className="text-muted">—</span>}{r.suggestion?.owner && <div className="text-xs text-muted">Matched: {r.suggestion.owner.name}{r.suggestion.owner.confidence ? ` · ${Math.round(r.suggestion.owner.confidence * 100)}%` : ''}</div>}</Td>
          <Td><StatusPill s={r.status} />{r.review_reasons?.length > 0 && r.status !== 'filed' && <ul className="mt-1 max-w-[260px] text-xs text-muted">{r.review_reasons.slice(0, 2).map((x: string) => <li key={x}>• {x}</li>)}</ul>}</Td>
          <Td>{r.status === 'filed' && r.filed_document_id ? <Link className="text-sm text-primary hover:underline" href={`/documents/${r.filed_document_id}`}>Open</Link>
            : r.status !== 'rejected' && <Link className="text-sm font-medium text-primary hover:underline" href={`/inbox/${r.id}`}>{r.status === 'ready' ? 'Confirm' : r.status === 'failed' ? 'Retry / enter manually' : 'Review'}</Link>}</Td></tr>)}</tbody></TableWrap>}</Card></>
}
