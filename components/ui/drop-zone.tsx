'use client'
import { useRef, useState } from 'react'
import { UploadCloud } from 'lucide-react'
import { ACCEPT_ATTR } from '@/lib/file-types'
import { cn } from '@/lib/utils'

/** Drag-and-drop (or click / camera on mobile) multi-file picker that feeds a normal <input type=file name=file multiple>. */
export function DropZone({ name = 'file', multiple = true }: { name?: string; multiple?: boolean }) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false); const [names, setNames] = useState<string[]>([])
  const sync = () => setNames(Array.from(input.current?.files ?? []).map(f => f.name))
  return <div onDragOver={e => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
    onDrop={e => { e.preventDefault(); setOver(false); if (input.current && e.dataTransfer.files.length) { input.current.files = e.dataTransfer.files; sync() } }}
    onClick={() => input.current?.click()} role="button" tabIndex={0} onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
    className={cn('flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-border px-6 py-8 text-center transition-colors hover:border-primary/50', over && 'border-primary bg-primary-soft')}>
    <UploadCloud className="text-primary" size={26} />
    <p className="text-sm font-medium">Drop files here, or click to browse</p><p className="text-xs text-muted">PDF, JPG, PNG, WEBP, DOC(X), XLS(X) · max 15 MB each · up to 20 files</p>
    <input ref={input} type="file" name={name} multiple={multiple} accept={ACCEPT_ATTR} required className="sr-only" onChange={sync} />
    {names.length > 0 && <ul className="mt-1 max-h-24 w-full overflow-y-auto text-start text-xs text-muted">{names.map((n, i) => <li key={i} className="truncate">• {n}</li>)}</ul>}</div>
}
