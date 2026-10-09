'use client'
import { startTransition, useActionState, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, CheckCircle2, FileSpreadsheet, Loader2, Upload } from 'lucide-react'
import { Alert, Badge, Button, Card, CardHeader, Field, Select } from '@/components/ui/primitives'
import { IMPORT_ENTITIES } from '@/lib/import-spec'
import { previewImport, runImport } from '@/app/actions/import-wizard'
import type { ActionState } from '@/lib/utils'

type Preview = { entity: string; file: string; headers: string[]; sample: string[][]; total: number; mapping: Record<string, number> }
type Result = { mode: 'check' | 'import'; total: number; ready: number; dupes: string[]; dupeCount: number; errors: { row: number; message: string }[]; errorCount: number; batch?: string; imported?: number; list?: string }

const STEPS = ['Upload', 'Match columns', 'Check & import']

/** Upload → match columns (auto-guessed) → check every row → import as one batch (undo from the history below). */
export function ImportWizard({ allowed, initial }: { allowed: string[]; initial?: string }) {
  const router = useRouter()
  const [entity, setEntity] = useState(initial && allowed.includes(initial) ? initial : allowed[0])
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [mapping, setMapping] = useState<Record<string, number>>({})
  const [pState, runPreview, pPending] = useActionState(previewImport, null as ActionState)
  const [rRaw, runRun, rPending] = useActionState(runImport, null as ActionState)
  const [stale, setStale] = useState<ActionState>(null)   // a result from before "start again" is ignored
  const rState = rRaw === stale ? null : rRaw
  const result = rState?.data as Result | undefined
  const step = !preview ? 0 : result?.mode === 'import' ? 3 : 1
  useEffect(() => { if (pState?.ok && pState.data) { const p = pState.data as Preview; setPreview(p); setMapping(p.mapping) } }, [pState])
  useEffect(() => { if (result?.mode === 'import') router.refresh() }, [result, router])
  const spec = IMPORT_ENTITIES[preview?.entity ?? entity]
  const fd = (extra: Record<string, string>) => { const f = new FormData(); f.set('entity', preview?.entity ?? entity); if (file) f.set('file', file); for (const [k, v] of Object.entries(extra)) f.set(k, v); return f }
  const send = (mode: 'check' | 'import') => startTransition(() => runRun(fd({ mapping: JSON.stringify(mapping), mode })))
  const reset = () => { setPreview(null); setFile(null); setMapping({}); setStale(rRaw) }
  const missing = spec.fields.filter(f => f.required && !(mapping[f.key] >= 0))

  return <Card data-import-wizard>
    <CardHeader title="Import from Excel or CSV" sub="Bring in records from another system or a spreadsheet. Nothing is saved until you press Import." />
    <ol className="flex flex-wrap gap-x-6 gap-y-1 border-b border-border px-4 py-3 text-sm" aria-label="Steps">{STEPS.map((s, i) =>
      <li key={s} className={`flex items-center gap-2 ${i <= Math.min(step, 2) ? 'text-fg' : 'text-muted'}`} aria-current={i === Math.min(step, 2) ? 'step' : undefined}>
        <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs ${i < step ? 'bg-success text-white' : i === Math.min(step, 2) ? 'bg-primary text-primary-fg' : 'bg-surface-2'}`}>{i < step ? '✓' : i + 1}</span>{s}</li>)}</ol>

    {step === 0 && <form className="space-y-4 p-4" onSubmit={e => { e.preventDefault(); if (pPending || !file) return; startTransition(() => runPreview(fd({}))) }}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="What are you importing?"><Select name="entity" value={entity} onChange={e => setEntity(e.target.value)}>{allowed.map(k => <option key={k} value={k}>{IMPORT_ENTITIES[k].label}</option>)}</Select></Field>
        <Field label="File" hint=".xlsx or .csv, first row = column names, up to 2,000 rows"><input type="file" name="file" required accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={e => setFile(e.target.files?.[0] ?? null)} className="block w-full text-sm file:me-3 file:rounded-md file:border file:border-border file:bg-surface file:px-3 file:py-1.5 file:text-sm" /></Field>
      </div>
      <p className="text-xs text-muted">Columns this import understands: {spec.fields.map(f => f.label + (f.required ? ' *' : '')).join(', ')}. Column names do not need to match exactly; you can match them in the next step.</p>
      {pState?.error && <Alert tone="red">{pState.error}</Alert>}
      <div className="flex justify-end"><Button type="submit" disabled={!file || pPending}>{pPending ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}Read file</Button></div>
    </form>}

    {preview && step >= 1 && step < 3 && <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-2 text-sm"><FileSpreadsheet size={16} className="text-muted" aria-hidden /><span className="font-medium">{preview.file}</span><Badge>{preview.total} rows</Badge><Badge tone="blue">{IMPORT_ENTITIES[preview.entity].label}</Badge>
        <button type="button" onClick={reset} className="ms-auto inline-flex items-center gap-1 text-primary hover:underline"><ArrowLeft size={13} />Choose another file</button></div>
      <div className="overflow-x-auto rounded-md border border-border"><table className="w-full min-w-[620px] text-sm" data-mapping>
        <thead><tr className="bg-surface-2/60 text-start text-xs text-muted"><th className="px-3 py-2 text-start font-medium">Averiqo field</th><th className="px-3 py-2 text-start font-medium">Column in your file</th><th className="px-3 py-2 text-start font-medium">First values</th></tr></thead>
        <tbody className="divide-y divide-border">{spec.fields.map(f => { const i = mapping[f.key] ?? -1
          return <tr key={f.key}><td className="px-3 py-2"><span className="font-medium">{f.label}</span>{f.required && <span className="text-danger"> *</span>}{f.hint && <div className="text-xs text-muted">{f.hint}</div>}</td>
            <td className="px-3 py-2"><Select aria-label={`Column for ${f.label}`} name={`map_${f.key}`} value={String(i)} onChange={e => { setMapping(m => ({ ...m, [f.key]: Number(e.target.value) })); setStale(rRaw) }} className="w-full max-w-xs">
              <option value="-1">— not imported —</option>{preview.headers.map((h, j) => <option key={j} value={j} disabled={Object.entries(mapping).some(([k, v]) => v === j && k !== f.key)}>{h}</option>)}</Select></td>
            <td className="max-w-[260px] truncate px-3 py-2 text-xs text-muted">{i >= 0 ? preview.sample.map(r => r[i]).filter(Boolean).slice(0, 3).join(' · ') || '(empty)' : ''}</td></tr> })}</tbody></table></div>
      {missing.length > 0 && <Alert tone="amber">Choose the column for: {missing.map(f => f.label).join(', ')}.</Alert>}

      {result?.mode === 'check' && <div className="space-y-2" data-check>
        <div className="flex flex-wrap gap-2 text-sm"><Badge tone="green">{result.ready} ready to import</Badge>{result.dupeCount > 0 && <Badge tone="amber">{result.dupeCount} duplicates skipped</Badge>}{result.errorCount > 0 && <Badge tone="red">{result.errorCount} rows with problems</Badge>}</div>
        {result.dupeCount > 0 && <p className="text-xs text-muted">Already in Averiqo or repeated in the file: {result.dupes.join(', ')}{result.dupeCount > result.dupes.length ? '…' : ''}</p>}
        {result.errorCount > 0 && <details open={result.errorCount <= 10} className="rounded-md border border-danger/30 p-2 text-sm"><summary className="cursor-pointer text-danger">Rows that will not be imported</summary>
          <ul className="mt-1 max-h-56 space-y-0.5 overflow-auto text-xs">{result.errors.map(e => <li key={e.row}><b>Row {e.row}:</b> {e.message}</li>)}{result.errorCount > result.errors.length && <li>… and {result.errorCount - result.errors.length} more</li>}</ul>
          <p className="mt-1 text-xs text-muted">Fix them in the file and import it again later; already-imported rows are then skipped as duplicates.</p></details>}
      </div>}
      {rState?.error && <Alert tone="red">{rState.error}</Alert>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" disabled={rPending || missing.length > 0} onClick={() => send('check')}>{rPending && <Loader2 size={14} className="animate-spin" />}Check rows</Button>
        <Button type="button" disabled={rPending || missing.length > 0 || result?.mode !== 'check' || !result.ready} onClick={() => send('import')}>{rPending && <Loader2 size={14} className="animate-spin" />}Import {result?.mode === 'check' ? result.ready : ''} {IMPORT_ENTITIES[preview.entity].noun}</Button></div>
    </div>}

    {step === 3 && result && <div className="space-y-3 p-4" role="status">
      <p className="flex items-center gap-2 text-sm font-medium text-success"><CheckCircle2 size={16} aria-hidden />{result.imported} {spec.noun} imported{result.dupeCount ? `, ${result.dupeCount} duplicates skipped` : ''}{result.errorCount ? `, ${result.errorCount} rows with problems left out` : ''}.</p>
      <div className="flex flex-wrap gap-2"><Link href={result.list ?? '/'} className="inline-flex h-11 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-fg hover:bg-primary/90 sm:h-9">Open {spec.noun}</Link>
        <Button type="button" variant="secondary" onClick={reset}>Import another file</Button></div>
      <p className="text-xs text-muted">Made a mistake? Undo this import from the history below.</p>
    </div>}
  </Card>
}
