'use client'
import { startTransition, useActionState, useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, Download, Loader2, UploadCloud } from '@/components/icons'
import { uploadPreviousInvoices } from '@/app/actions/previous'
import { fmtMoney } from '@/lib/sales/money'
import { TEMPLATE_CSV } from '@/lib/sales/previous-import'
import type { ActionState } from '@/lib/utils'

type Sum = { mode: 'check' | 'import'; total: number; ready: number; unpaid: number; saved?: number; columns: string[]; problems: { line: number; error: string }[]; problemCount: number; dupes: { line: number; number: string }[]; dupeCount: number }

/** Excel / CSV upload of previous invoices: “Check file” first (nothing saved), then “Save invoices”. */
export function PreviousUpload() {
  // the chosen file is kept here: a form action resets its inputs, and "Save" must send the same file that was checked
  const [file, setFile] = useState<File | null>(null), [mode, setMode] = useState<'check' | 'import'>('check')
  const [state, run, pending] = useActionState(async (_: ActionState, fd: FormData) => uploadPreviousInvoices(_, fd), null)
  const s = state?.data as Sum | undefined
  const template = `data:text/csv;charset=utf-8,${encodeURIComponent('﻿' + TEMPLATE_CSV)}`
  const send = (m: 'check' | 'import') => { if (!file) return; setMode(m); const fd = new FormData(); fd.set('file', file); fd.set('mode', m); startTransition(() => run(fd)) }
  return <div className="space-y-4" data-previous-upload>
    <ol className="list-decimal space-y-1 ps-5 text-sm text-muted">
      <li>Your Excel needs one row per invoice and these column headings in the first row: <b className="text-fg">Customer, Invoice number, Invoice date, Amount incl. VAT</b>. Optional: Due date, LPO / reference, Description, VAT %, Already paid. <a href={template} download="previous-invoices-template.csv" className="inline-flex items-center gap-1 font-medium text-primary hover:underline"><Download size={13} aria-hidden />Download the template</a></li>
      <li>Customer names must match a customer already in Averiqo (same spelling).</li>
      <li>Check the file first. Nothing is saved until you press “Save invoices”.</li>
    </ol>
    <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-surface-2/40 px-4 py-6 text-center text-sm hover:bg-surface-2">
      <UploadCloud size={22} className="text-muted" aria-hidden />
      <span><b>Choose your Excel or CSV file</b><span className="block text-xs text-muted">.xlsx or .csv, up to 1,000 invoices</span></span>
      <input type="file" name="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" aria-label="Excel or CSV file of previous invoices" onChange={e => setFile(e.target.files?.[0] ?? null)} className="max-w-full text-xs file:me-2 file:rounded file:border-0 file:bg-surface file:px-2 file:py-1" />
    </label>
    <div className="flex flex-wrap gap-2">
      <button type="button" onClick={() => send('check')} disabled={pending || !file} className="inline-flex h-10 items-center gap-1.5 rounded-full border border-border bg-surface px-4 text-sm font-medium hover:bg-surface-2 disabled:opacity-50">{pending && mode === 'check' && <Loader2 size={14} className="animate-spin" />}Check file</button>
      {s?.mode === 'check' && s.ready > 0 && <button type="button" onClick={() => send('import')} disabled={pending} className="inline-flex h-10 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-medium text-primary-fg hover:opacity-90 disabled:opacity-50">{pending && mode === 'import' && <Loader2 size={14} className="animate-spin" />}Save {s.ready} invoice{s.ready === 1 ? '' : 's'}</button>}
    </div>
    {state?.error && <p role="alert" className="rounded-md border border-danger/25 bg-danger/5 px-3 py-2 text-sm text-danger">{state.error}</p>}
    {s && <div className="space-y-3 rounded-xl border border-border p-4 text-sm" data-upload-result={s.mode}>
      {s.mode === 'import'
        ? <p className="flex items-center gap-2 font-medium text-success"><CheckCircle2 size={16} aria-hidden />{state?.message} <Link href="/invoices?tab=receivables" className="font-normal text-primary hover:underline">See receivables</Link></p>
        : <p><b>{s.ready}</b> of {s.total} row{s.total === 1 ? '' : 's'} ready to save{s.ready ? <>, AED <b>{fmtMoney(s.unpaid)}</b> unpaid in total</> : null}.</p>}
      <details><summary className="cursor-pointer text-muted">Columns found</summary><ul className="mt-1 list-disc ps-5 text-xs text-muted">{s.columns.map(x => <li key={x}>{x}</li>)}</ul></details>
      {s.dupeCount > 0 && <p className="text-muted">{s.dupeCount} skipped: the invoice number is already in Averiqo or repeated in the file ({s.dupes.slice(0, 8).map(d => d.number).join(', ')}{s.dupeCount > 8 ? '…' : ''}).</p>}
      {s.problemCount > 0 && <div><p className="font-medium text-danger">{s.problemCount} row{s.problemCount === 1 ? '' : 's'} with a problem (not saved):</p>
        <ul className="mt-1 max-h-56 space-y-0.5 overflow-y-auto text-xs" data-upload-problems>{s.problems.map(p => <li key={p.line}>Row {p.line}: {p.error}</li>)}</ul></div>}
    </div>}
  </div>
}
