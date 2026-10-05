'use client'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Loader2, UploadCloud, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/primitives'
import { StatusPill } from './bits'
import { useDialog } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

const ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx'
type Row = { name: string; id?: string; phase: 'queued' | 'uploading' | 'processing' | 'done' | 'error'; status?: string; label?: string; error?: string }

/** Drag & drop / camera upload with real progress: bytes uploaded, then each document's OCR + AI step. */
export function UploadPanel() {
  const input = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<File[]>([]), [over, setOver] = useState(false)
  const [rows, setRows] = useState<Row[]>([]), [pct, setPct] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null)
  const router = useRouter(), { close } = useDialog()
  const pick = (list: FileList | null) => { if (list) { setFiles(Array.from(list).slice(0, 20)); setRows([]); setError(null) } }

  async function start() {
    if (!files.length) { setError('Choose at least one file.'); return }
    setBusy(true); setError(null); setPct(0)
    setRows(files.map(f => ({ name: f.name, phase: 'uploading' })))
    const fd = new FormData(); files.forEach(f => fd.append('file', f))
    if (/Android|iPhone|iPad/i.test(navigator.userAgent)) fd.append('source', 'mobile')
    const res = await new Promise<{ items: { id: string; name: string }[]; problems: string[]; error?: string }>((resolve) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', '/api/inbox/upload')
      xhr.upload.onprogress = e => { if (e.lengthComputable) setPct(Math.round((e.loaded / e.total) * 100)) }
      xhr.onload = () => { try { resolve(JSON.parse(xhr.responseText)) } catch { resolve({ items: [], problems: [], error: `Upload failed (${xhr.status})` }) } }
      xhr.onerror = () => resolve({ items: [], problems: [], error: 'Network error during upload' })
      xhr.send(fd)
    })
    setPct(100)
    if (!res.items?.length) { setBusy(false); setError(res.error ?? res.problems?.join(' | ') ?? 'Nothing was uploaded.'); setRows(r => r.map(x => ({ ...x, phase: 'error' }))); return }
    const next: Row[] = files.map(f => {
      const it = res.items.find(i => i.name === f.name)
      return it ? { name: f.name, id: it.id, phase: 'queued' } : { name: f.name, phase: 'error', error: res.problems.find(p => p.startsWith(f.name)) ?? 'Rejected' }
    })
    setRows(next)
    const queue = next.filter(r => r.id)
    const work = async () => {
      for (let r = queue.shift(); r; r = queue.shift()) {
        const id = r.id!
        setRows(rs => rs.map(x => (x.id === id ? { ...x, phase: 'processing' } : x)))
        const j = await fetch(`/api/inbox/${id}/process`, { method: 'POST' }).then(x => x.json()).catch(() => ({ status: 'failed', error: 'Network error' }))
        setRows(rs => rs.map(x => (x.id === id ? { ...x, phase: j.status === 'failed' ? 'error' : 'done', status: j.status, label: j.label, error: j.error } : x)))
      }
    }
    await Promise.all([work(), work()])                                      // two at a time: friendly to provider rate limits
    const ids = res.items.map(i => i.id).join(',')
    const warn = res.problems?.length ? `&warn=${encodeURIComponent(`Skipped: ${res.problems.join(' | ')}`)}` : ''
    close(); setBusy(false); setFiles([])
    router.push(`/inbox?batch=${ids}${warn}`); router.refresh()
  }

  const done = rows.filter(r => r.phase === 'done' || r.phase === 'error').length
  return <div className="flex flex-col gap-4">
    <div onDragOver={e => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)} onDrop={e => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files) }}
      onClick={() => !busy && input.current?.click()} role="button" tabIndex={0} onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
      className={cn('flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-border px-6 py-8 text-center transition-colors hover:border-primary/50', over && 'border-primary bg-primary-soft', busy && 'pointer-events-none opacity-60')}>
      <UploadCloud className="text-primary" size={26} aria-hidden />
      <p className="text-sm font-medium">Drop files here, or click to browse</p><p className="text-xs text-muted">PDF, JPG, PNG (also WEBP, Office) · max 15 MB each · up to 20 files · on a phone you can take a photo</p>
      <input ref={input} type="file" name="file" multiple accept={ACCEPT} className="sr-only" aria-label="Choose documents" onChange={e => pick(e.target.files)} />
    </div>
    {rows.length === 0 && files.length > 0 && <ul className="max-h-28 overflow-y-auto text-xs text-muted">{files.map((f, i) => <li key={i} className="truncate">• {f.name}</li>)}</ul>}
    {rows.length > 0 && <div className="space-y-2" aria-live="polite">
      <div className="flex justify-between text-xs text-muted"><span>{pct < 100 ? `Uploading… ${pct}%` : `Reading documents… ${done}/${rows.length}`}</span></div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-2"><div className="h-full bg-primary transition-[width]" style={{ width: `${pct < 100 ? pct / 2 : 50 + (done / rows.length) * 50}%` }} /></div>
      <ul className="max-h-60 divide-y divide-border overflow-y-auto rounded-md border border-border text-sm">{rows.map((r, i) => <li key={i} className="flex items-center gap-2 px-3 py-2">
        {r.phase === 'done' ? <CheckCircle2 size={15} className="text-success" /> : r.phase === 'error' ? <XCircle size={15} className="text-danger" /> : <Loader2 size={15} className="animate-spin text-primary" />}
        <span className="min-w-0 flex-1 truncate">{r.name}</span>
        <span className="shrink-0 text-xs text-muted">{r.phase === 'uploading' ? 'Uploading' : r.phase === 'queued' ? 'Waiting' : r.phase === 'processing' ? 'OCR + AI…' : r.status ? <StatusPill s={r.status} /> : r.error}</span></li>)}</ul>
    </div>}
    {error && <div role="alert" className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{error}</div>}
    <p className="text-xs text-muted">Files are stored privately first; nothing is filed until you confirm.</p>
    <div className="flex justify-end"><Button onClick={start} disabled={busy}>{busy && <Loader2 size={14} className="animate-spin" />}Upload & analyse</Button></div>
  </div>
}
