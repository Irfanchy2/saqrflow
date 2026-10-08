import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AlertTriangle, ArrowLeft, Download, RefreshCw, Sparkles, X } from 'lucide-react'
import { getCtx } from '@/lib/auth'
import { Alert, Badge, Card, CardHeader, Field, Input, Select } from '@/components/ui/primitives'
import { ActionButton, ActionForm, SubmitButton } from '@/components/ui/action-form'
import { Confidence, ConfidenceBand, PathCrumbs, StatusPill } from '@/components/inbox/bits'
import { confirmAndFile, rejectInboxItem, reprocessInboxItem } from '@/app/actions/inbox'
import { DOC_TYPES, FIELD_LABELS, typeDef, type FieldKey } from '@/lib/inbox/catalog'
import { defaultsFor } from '@/lib/inbox/file'
import { DEFAULT_OFFSETS } from '@/lib/reminders/schedule'
import { parseSettings } from '@/lib/reminders/settings'
import { addDays, formatLongDate } from '@/lib/time'
import { OCR_MODES } from '@/lib/ai/ocr'

export const metadata = { title: 'Review document' }
export const maxDuration = 120
const ENGINE: Record<string, string> = { text_layer: 'PDF text layer', ocrspace: 'OCR.Space', google_vision: 'Google Vision', tesseract: 'local OCR', cache: 'cached reading' }

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const c = await getCtx()
  const { data: item } = await c.supabase.from('document_inbox').select('*').eq('id', id).maybeSingle()
  if (!item) notFound()
  const [{ data: x }, { data: cats }, { data: emps }, { data: custs }, { data: st }, { data: sups }, { data: projs }, { data: vehs }] = await Promise.all([
    c.supabase.from('document_extractions').select('*').eq('inbox_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    c.supabase.from('document_categories').select('id,name,scope').order('name'),
    c.supabase.from('employees').select('id,full_name,employee_no').neq('status', 'archived').order('full_name').limit(2000),
    c.supabase.from('customers').select('id,name').order('name').limit(2000),
    c.supabase.from('app_settings').select('key,value'),
    c.supabase.from('suppliers').select('id,name').order('name').limit(2000),
    c.supabase.from('projects').select('id,name,code').neq('status', 'cancelled').order('name').limit(1000),
    c.supabase.from('assets').select('id,name,plate_or_serial').eq('kind', 'vehicle').order('name').limit(1000),
  ])
  const s: any = item.suggestion ?? {}
  const def = typeDef(item.doc_type)
  const d = defaultsFor(item, x)
  const fields = (x?.fields ?? {}) as Record<FieldKey, { value: string; confidence: number; source: string }>
  const settings = parseSettings(st ?? [])
  const offsets = settings.offsets ?? DEFAULT_OFFSETS
  const expiry = d.expiry_date
  const schedule = expiry ? offsets.map(o => ({ o, date: addDays(expiry, -o) })).filter(r => r.date >= c.today) : []
  const candidates: { id: string; name: string; confidence: number }[] = s.ownerCandidates ?? []
  const isImg = item.mime_type.startsWith('image/'), isPdf = item.mime_type === 'application/pdf'
  const lowConf = !['ready', 'filed'].includes(item.status)
  const holder = fields.holder_name?.value
  const projectCands: { id: string; name: string; confidence: number }[] = s.projectCandidates ?? []
  const engineInfo = x ? `${ENGINE[x.ocr_provider ?? ''] ?? 'no OCR'} → ${x.engine === 'gemini' ? `Gemini (${x.engine_version})` : x.engine === 'claude' ? `Claude (${x.engine_version})` : 'local rules'}` : null
  const filed = item.status === 'filed'

  return <>
    <Link href="/inbox" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-fg"><ArrowLeft size={14} />Smart Inbox</Link>
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-xl font-semibold tracking-tight">{item.file_name}</h1>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm"><StatusPill s={item.status} /><ConfidenceBand v={item.confidence} />{engineInfo && <span className="text-xs text-muted">{engineInfo}{item.processing_ms ? ` · ${(item.processing_ms / 1000).toFixed(1)}s` : ''}</span>}</div></div>
      <div className="flex flex-wrap gap-2">
        <a href={`/api/inbox/${id}/file?mode=download`} className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-surface px-4 text-sm font-medium hover:bg-surface-2"><Download size={15} />Download</a>
        {!filed && <ActionForm action={reprocessInboxItem.bind(null, id)} hideSubmit resetOnSuccess={false} className="flex items-center gap-1.5">
          <select name="ocr" aria-label="OCR provider for reprocessing" defaultValue="" className="h-9 rounded-md border border-border bg-surface px-2 text-sm"><option value="">Default OCR</option>{OCR_MODES.map(m => <option key={m.id} value={m.id}>{m.id === 'auto' ? 'Auto' : m.label.replace(' (nothing leaves the server)', '')}</option>)}</select>
          <SubmitButton><RefreshCw size={14} />Reprocess</SubmitButton></ActionForm>}
        {!filed && item.status !== 'rejected' && <ActionButton action={rejectInboxItem.bind(null, id)} variant="ghost" size="md" confirm="Delete this upload from the inbox? (It stays in the audit trail; nothing is filed.)"><X size={14} />Delete upload</ActionButton>}
      </div></div>
    {item.error && <div className="mb-4"><Alert tone="red"><b>Processing failed:</b> {item.error}<div className="mt-1 text-xs">Your file is safe in private storage. Options: <b>Reprocess</b> (optionally with another OCR provider), or fill in the details below and <b>Confirm &amp; File</b> manually.</div></Alert></div>}
    {filed && <div className="mb-4"><Alert tone="green">Filed. <Link className="font-medium underline" href={`/documents/${item.filed_document_id}`}>Open the document</Link></Alert></div>}

    <div className="grid gap-5 lg:grid-cols-5">
      <Card className="lg:col-span-2"><CardHeader title="Preview" />
        {isPdf ? <iframe title="Uploaded document" src={`/api/inbox/${id}/file`} className="h-[640px] w-full rounded-b-lg bg-surface-2" />
          : isImg ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={`/api/inbox/${id}/file`} alt="Uploaded document" className="w-full rounded-b-lg" />
          : <p className="p-6 text-sm text-muted">No inline preview for this file type. Use Download.</p>}</Card>

      <div className="space-y-5 lg:col-span-3">
        <Card><CardHeader title="Document detected" sub={s.label ? `${s.label}${item.confidence != null ? ` · ${Math.round(item.confidence * 100)}% confidence` : ''}` : undefined} action={<Badge tone="blue"><Sparkles size={12} />{x?.engine === 'gemini' ? 'Gemini' : x?.engine === 'claude' ? 'Claude' : 'Auto'}</Badge>} />
          <div className="space-y-4 p-4 text-sm">
            <div className="grid gap-3 sm:grid-cols-2">
              <div><div className="text-xs text-muted">Document type</div><div className="flex items-center gap-2 font-medium">{s.label ?? 'Unknown'} <Confidence v={x?.doc_type_confidence} /></div></div>
              <div><div className="text-xs text-muted">{def?.owner === 'employee' ? 'Possible match' : def?.owner === 'customer' ? 'Customer' : def?.owner === 'supplier' ? 'Supplier' : def?.owner === 'project' ? 'Project' : def?.owner === 'vehicle' ? 'Vehicle' : 'Company'}</div>
                <div className="flex items-center gap-2 font-medium">{s.owner?.name ?? <span className="text-danger">Not identified</span>} {s.owner && <Confidence v={s.owner.confidence} />}</div>{s.owner?.reason && <div className="text-xs text-muted">{s.owner.reason}</div>}</div>
              <div className="sm:col-span-2"><div className="text-xs text-muted">Suggested location</div>{s.path ? <PathCrumbs path={s.path} /> : '—'}</div>
            </div>
            {Object.keys(fields).length > 0 && <dl className="grid gap-x-4 gap-y-2 rounded-md bg-surface-2/60 p-3 sm:grid-cols-2">{(Object.entries(fields) as [FieldKey, any][]).map(([k, f]) => <div key={k}>
              <dt className="text-xs text-muted">{FIELD_LABELS[k] ?? k}{f.source === 'inferred' && ' (guessed)'}</dt><dd className="flex items-center gap-2"><span className="break-all">{k.includes('date') && /^\d{4}-\d{2}-\d{2}$/.test(f.value) ? formatLongDate(f.value) : f.value}</span><Confidence v={f.confidence} /></dd></div>)}</dl>}
            {lowConf && !filed && <Alert tone="amber"><b>{item.status === 'failed' ? 'Could not read this document.' : 'Manual review required.'}</b><ul className="mt-1 list-disc ps-5">{(item.review_reasons ?? []).map((r: string) => <li key={r}>{r}</li>)}</ul></Alert>}
            {(s.warnings ?? []).map((w: string) => <Alert key={w} tone="amber"><AlertTriangle size={13} className="me-1 inline" />{w}</Alert>)}
            {(s.duplicates ?? []).length > 0 && <div className="rounded-md border border-danger/30 bg-danger/5 p-3"><div className="mb-2 font-medium text-danger">Possible duplicate detected</div>
              <ul className="space-y-1">{s.duplicates.map((dup: any) => <li key={dup.documentId} className="flex flex-wrap items-center justify-between gap-2"><span>{dup.name} <span className="text-xs text-muted">· {dup.kind === 'same_file' ? 'identical file' : dup.kind === 'same_number' ? 'same document number' : 'earlier version (renewal?)'}{dup.expiry ? ` · expires ${dup.expiry}` : ''}</span></span>
                <Link className="text-xs font-medium text-primary hover:underline" href={`/documents/${dup.documentId}`} target="_blank">View existing</Link></li>)}</ul>
              <p className="mt-2 text-xs text-muted">Below, choose <b>New version of existing</b> (old file stays in history), <b>Replace metadata</b>, <b>New document</b> to keep both. Or <b>Delete upload</b> to cancel.</p></div>}
          </div></Card>

        {!filed && item.status !== 'rejected' && <Card id="edit"><CardHeader title="Edit information & choose destination" sub="Nothing is saved until you press Confirm & File. Change anything first." />
          <div className="p-4"><ActionForm action={confirmAndFile.bind(null, id)} submit="Confirm & File" resetOnSuccess={false}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Document type *"><Select name="doc_type" defaultValue={d.doc_type} required><option value="" disabled>Choose…</option>
                {(['company', 'employee', 'vehicle', 'customer', 'supplier', 'project'] as const).map(g => <optgroup key={g} label={{ company: 'Company', employee: 'Employee', vehicle: 'Vehicle', customer: 'Customer / sales', supplier: 'Supplier', project: 'Project' }[g]}>{DOC_TYPES.filter(t => t.owner === g).map(t => <option key={t.key} value={t.key}>{t.label}</option>)}</optgroup>)}</Select></Field>
              <Field label="Category (optional)" hint="Leave blank to use the standard category for this type."><Select name="category_id" defaultValue=""><option value="">Standard for this type</option>{cats?.map(k => <option key={k.id} value={k.id}>{k.name} ({k.scope})</option>)}</Select></Field>
              {(def?.owner === 'employee' || !def) && <Field label="Employee" hint={candidates.length ? 'Confirm the suggested match, choose a different employee, or create a new one.' : 'No existing employee matched. Choose one, or create a new employee.'}><Select name="owner_id" defaultValue={d.owner_id}><option value="">— choose employee —</option>
                {candidates.length > 0 && <optgroup label="Possible match">{candidates.map(m => <option key={m.id} value={m.id}>{m.name} · {(emps ?? []).find(e => e.id === m.id)?.employee_no} · {Math.round(m.confidence * 100)}%</option>)}</optgroup>}
                <optgroup label="All employees">{emps?.map(e => <option key={e.id} value={e.id}>{e.full_name} ({e.employee_no})</option>)}</optgroup>
                <optgroup label="Not in the list"><option value="__new__">+ Create new employee…</option></optgroup></Select></Field>}
              {(def?.owner === 'employee' || !def) && <Field label="New employee name" hint="Only used if you chose “Create new employee”. Existing names are never duplicated."><Input name="new_employee_name" defaultValue={!d.owner_id ? holder ?? '' : ''} /></Field>}
              {def?.owner === 'customer' && <Field label="Customer"><Select name="owner_id" defaultValue={d.owner_id}><option value="">— not linked —</option>{custs?.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}</Select></Field>}
              {def?.owner === 'customer' && <Field label="Project (optional)"><Select name="project_id" defaultValue={d.project_id}><option value="">— no project —</option>
                {projectCands.length > 0 && <optgroup label="Suggested">{projectCands.map(m => <option key={m.id} value={m.id}>{m.name} · {Math.round(m.confidence * 100)}%</option>)}</optgroup>}
                <optgroup label="All projects">{projs?.map(k => <option key={k.id} value={k.id}>{k.code ? `${k.code} · ` : ''}{k.name}</option>)}</optgroup></Select></Field>}
              {def?.owner === 'supplier' && <Field label="Supplier"><Select name="owner_id" defaultValue={d.owner_id}><option value="">— not linked —</option>{sups?.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}</Select></Field>}
              {def?.owner === 'project' && <Field label="Project"><Select name="owner_id" defaultValue={d.owner_id}><option value="">— choose project —</option>
                {candidates.length > 0 && <optgroup label="Suggested">{candidates.map(m => <option key={m.id} value={m.id}>{m.name} · {Math.round(m.confidence * 100)}%</option>)}</optgroup>}
                <optgroup label="All projects">{projs?.map(k => <option key={k.id} value={k.id}>{k.code ? `${k.code} · ` : ''}{k.name}</option>)}</optgroup></Select></Field>}
              {def?.owner === 'vehicle' && <Field label="Vehicle"><Select name="owner_id" defaultValue={d.owner_id}><option value="">— not linked (filed under the plate number) —</option>{vehs?.map(k => <option key={k.id} value={k.id}>{k.name}{k.plate_or_serial ? ` (${k.plate_or_serial})` : ''}</option>)}</Select></Field>}
              {def?.owner === 'vehicle' && <Field label="Plate number"><Input name="plate_number" defaultValue={d.plate_number} /></Field>}
              <Field label="Document name *" className="sm:col-span-2"><Input name="name" defaultValue={d.name} required /></Field>
              <Field label="Document number"><Input name="reference_no" defaultValue={d.reference_no} /></Field>
              <Field label="Issuing authority"><Input name="issuing_authority" defaultValue={d.issuing_authority} /></Field>
              <Field label="Issue date"><Input type="date" name="issue_date" defaultValue={d.issue_date} /></Field>
              <Field label="Expiry date"><Input type="date" name="expiry_date" defaultValue={d.expiry_date} /></Field>
            </div>
            <fieldset className="space-y-2 rounded-md border border-border p-3 text-sm"><legend className="px-1 font-medium">Save as</legend>
              <label className="flex items-center gap-2"><input type="radio" name="mode" value="new" defaultChecked={d.mode === 'new'} />New document</label>
              <label className="flex items-start gap-2"><input type="radio" name="mode" value="version" defaultChecked={d.mode === 'version'} className="mt-0.5" /><span>New version of existing (renewal / replacement. Previous file stays in version history)
                <Select name="target_document_id" defaultValue={d.target_document_id} className="mt-1"><option value="">— choose existing document —</option>{(s.duplicates ?? []).map((dup: any) => <option key={dup.documentId} value={dup.documentId}>{dup.name}{dup.expiry ? ` (expires ${dup.expiry})` : ''}</option>)}</Select></span></label>
              {(s.duplicates ?? []).length > 0 && <label className="flex items-center gap-2"><input type="radio" name="mode" value="metadata" />Replace metadata of the existing document (keep its file; use the details above)</label>}</fieldset>
            <label className="flex items-start gap-2 rounded-md bg-surface-2/60 p-3 text-sm"><input type="checkbox" name="reminders" defaultChecked={!!expiry} className="mt-0.5" /><span><b>Create expiry reminders</b> (uses your notification settings: WhatsApp / email / in-app)
              {schedule.length > 0 && <span className="mt-1 block text-xs text-muted">{schedule.map(r => `${r.o === 0 ? 'on expiry' : `${r.o}d`} → ${r.date}`).join(' · ')}</span>}
              {expiry && <span className="block text-xs text-muted">A document has exactly one reminder schedule, so renewing an existing document never creates duplicate reminders.</span>}</span></label>
          </ActionForm></div></Card>}
      </div></div></>
}
