'use client'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { FileUp, Upload } from '@/components/icons'
import { Modal } from '@/components/ui/dialog'
import { ActionForm } from '@/components/ui/action-form'
import { DocFields, type Cat, type Person } from '@/components/documents/doc-fields'
import { createDocument } from '@/app/actions/documents'
import { cn } from '@/lib/utils'

// file name → the employee document category it most likely is (the form shows the guess; the person confirms it)
const GUESS: [RegExp, string][] = [
  [/passport|pp[\s_-]/i, 'Passport'], [/emirates|\beid\b|784[\s_-]?\d/i, 'Emirates ID'], [/visa|residen/i, 'Residence Visa'],
  [/permit|labou?r[\s_-]?card|work[\s_-]?card/i, 'Work Permit'], [/contract|offer/i, 'Labour Contract'], [/insurance|medical|health/i, 'Medical Insurance'],
]
export const guessCategory = (file: string, cats: Cat[]) => { const hit = GUESS.find(([re]) => re.test(file)); return hit ? cats.find(c => c.name === hit[1]) : undefined }

/**
 * An employee card that takes files: drop a passport, visa or Emirates ID scan on it and the "Add document" form opens
 * for that person with the file attached and the category guessed from the file name. "Add document" on the card does
 * the same without dragging (keyboard, touch).
 */
export function EmployeeDropCard({ id, name, cats, people, canUpload, className, children }: {
  id: string; name: string; cats: Cat[]; people: Person[]; canUpload: boolean; className?: string; children: ReactNode
}) {
  const [over, setOver] = useState(false), [file, setFile] = useState<File | null>(null), [open, setOpen] = useState(false), [note, setNote] = useState('')
  const depth = useRef(0), form = useRef<HTMLDivElement>(null)
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes('Files')
  // once the form is on screen, hand it the dropped file (a real FileList, so the normal upload path is used)
  useEffect(() => {
    if (!open || !file) return
    let tries = 0, raf = 0
    const attach = () => {   // the modal mounts into <body> a frame later: wait for its file field
      const input = form.current?.querySelector<HTMLInputElement>('input[type=file][name=file]')
      if (input) { const dt = new DataTransfer(); dt.items.add(file); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true })) }
      else if (tries++ < 30) raf = requestAnimationFrame(attach)
    }
    attach(); return () => cancelAnimationFrame(raf)
  }, [open, file])
  const start = (f: File | null, many = false) => { setFile(f); setNote(many ? 'One file at a time: the first one is attached. Drop the next after saving.' : ''); setOpen(true) }
  const cat = file ? guessCategory(file.name, cats) : undefined

  if (!canUpload) return <article className={className}>{children}</article>
  return <article className={cn(className, 'relative')} data-drop-employee={id}
    onDragEnter={e => { if (!hasFiles(e)) return; e.preventDefault(); depth.current++; setOver(true) }}
    onDragOver={e => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' } }}
    onDragLeave={() => { depth.current = Math.max(0, depth.current - 1); if (!depth.current) setOver(false) }}
    onDrop={e => { if (!hasFiles(e)) return; e.preventDefault(); depth.current = 0; setOver(false); const fs = e.dataTransfer.files; if (fs.length) start(fs[0], fs.length > 1) }}>
    {children}
    <button type="button" onClick={() => start(null)} className="absolute end-3 top-3 z-[1] inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full bg-surface-2/90 px-3 text-[12px] font-medium text-muted ring-1 ring-border/70 transition-colors hover:bg-surface-2 hover:text-fg">
      <Upload size={13} aria-hidden />Add document<span className="sr-only"> for {name}</span></button>
    {over && <div aria-hidden className="pointer-events-none absolute inset-0 z-[2] grid place-items-center rounded-[inherit] border-2 border-dashed border-primary bg-primary-soft/90 backdrop-blur-[2px]">
      <span className="flex flex-col items-center gap-2 text-center text-primary"><FileUp size={30} /><span className="text-[14px] font-semibold">Drop to add to {name.split(' ')[0]}’s documents</span>
        <span className="text-[12px] opacity-80">Passport, visa, Emirates ID, contract…</span></span></div>}
    {open && <Modal title={`Add document for ${name}`} onClose={() => { setOpen(false); setFile(null) }} wide>
      <div ref={form} key={file ? `${file.name}:${file.size}:${file.lastModified}` : 'blank'}>
        {file && <p className="mb-4 rounded-lg bg-primary-soft px-3 py-2 text-[13px] text-primary">Attached: <b className="font-semibold">{file.name}</b>{cat ? <> · looks like a <b className="font-semibold">{cat.name}</b>. Check the category before saving.</> : '. Choose the category.'}</p>}
        {note && <p className="mb-4 rounded-lg bg-warning/10 px-3 py-2 text-[13px] text-warning">{note}</p>}
        <ActionForm action={createDocument} submit="Save document">
          <input type="hidden" name="owner_type" value="employee" /><input type="hidden" name="owner_id" value={id} />
          <DocFields categories={cats} people={people} fileRequired d={{ category_id: cat?.id, name: cat ? `${cat.name}: ${name}` : file ? `${file.name.replace(/\.[a-z0-9]+$/i, '')}` : undefined }} />
        </ActionForm>
      </div>
    </Modal>}
  </article>
}
