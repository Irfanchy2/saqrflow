'use client'
import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CornerDownLeft, Loader2, Plus, Search } from 'lucide-react'
import { newSalesDoc } from '@/app/actions/sales'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'

export interface PaletteLink { label: string; href: string; group: string }
type Cmd = { id: string; label: string; group: string; run: () => void; hint?: string }

/** Ctrl/⌘ + K — jump to any page, create a document, or search everything. */
export function CommandPalette({ links, canSales }: { links: PaletteLink[]; canSales: boolean }) {
  const [open, setOpen] = useState(false), [q, setQ] = useState(''), [sel, setSel] = useState(0)
  const [pending, start] = useTransition()
  const router = useRouter(), dlg = useRef<HTMLDialogElement>(null), input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen(o => !o) } }
    const ext = () => setOpen(true)
    addEventListener('keydown', on); addEventListener('saqrflow:palette', ext)
    return () => { removeEventListener('keydown', on); removeEventListener('saqrflow:palette', ext) }
  }, [])
  useEffect(() => { const d = dlg.current; if (!d) return; if (open && !d.open) { d.showModal(); setQ(''); setSel(0); setTimeout(() => input.current?.focus(), 0) } else if (!open && d.open) d.close() }, [open])

  const cmds = useMemo<Cmd[]>(() => {
    const go = (href: string) => () => { setOpen(false); router.push(href) }
    const make = (t: 'quotation' | 'invoice' | 'delivery_note') => () => { if (pending) return; start(async () => { const r = await newSalesDoc(t, { token: crypto.randomUUID() }); if (r?.error) toast(r.error, 'error'); setOpen(false) }) }
    return [
      ...(canSales ? [{ id: 'nq', label: 'New quotation', group: 'Create', run: make('quotation') }, { id: 'ni', label: 'New tax invoice', group: 'Create', run: make('invoice') }, { id: 'nd', label: 'New delivery note', group: 'Create', run: make('delivery_note') }] : []),
      { id: 'up', label: 'Upload documents to Smart Inbox', group: 'Create', run: go('/inbox') },
      { id: 'nc', label: 'Add customer', group: 'Create', run: go('/parties?new=customer') },
      { id: 'ne', label: 'Add employee', group: 'Create', run: go('/employees?new=employee') },
      { id: 'nx', label: 'Add expense', group: 'Create', run: go('/expenses?new=expense') },
      { id: 'np', label: 'New project', group: 'Create', run: go('/projects?new=project') },
      { id: 'nd2', label: 'Add company document', group: 'Create', run: go('/documents?new=document') },
      { id: 'sp', label: 'Search projects…', group: 'Go to', run: go('/projects'), hint: 'Projects' },
      ...links.map(l => ({ id: l.href, label: l.label, group: 'Go to', run: go(l.href), hint: l.group })),
    ]
  }, [links, canSales, router, pending])
  const term = q.trim().toLowerCase()
  const list = term ? [...cmds.filter(c => c.label.toLowerCase().includes(term)), { id: 'search', label: `Search everything for “${q.trim()}”`, group: 'Search', run: () => { setOpen(false); router.push(`/search?q=${encodeURIComponent(q.trim())}`) } }] : cmds
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(list.length - 1, s + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(0, s - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); list[sel]?.run() }
  }
  let lastGroup = ''
  return <dialog ref={dlg} onClose={() => setOpen(false)} onClick={e => { if (e.target === dlg.current) setOpen(false) }} aria-label="Command palette"
    className="m-auto mt-[12vh] w-[calc(100%-2rem)] max-w-xl rounded-xl border border-border bg-surface p-0 text-fg shadow-2xl">
    <div className="flex items-center gap-2 border-b border-border px-4">
      {pending ? <Loader2 size={16} className="animate-spin text-muted" /> : <Search size={16} className="text-muted" aria-hidden />}
      <input ref={input} value={q} onChange={e => { setQ(e.target.value); setSel(0) }} onKeyDown={onKey} placeholder="Type a command or search…" aria-label="Command" role="combobox" aria-expanded aria-controls="palette-list" aria-activedescendant={list[sel] ? `cmd-${list[sel].id}` : undefined}
        className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted/70 focus-visible:ring-0" />
      <kbd className="rounded border border-border px-1.5 text-[10px] text-muted">Esc</kbd>
    </div>
    <ul id="palette-list" role="listbox" className="max-h-[55vh] overflow-y-auto p-2">
      {list.map((c, i) => { const head = c.group !== lastGroup; lastGroup = c.group
        return <li key={c.id} role="presentation">{head && <div className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted">{c.group}</div>}
          <div id={`cmd-${c.id}`} role="option" aria-selected={i === sel} onMouseMove={() => setSel(i)} onClick={() => c.run()}
            className={cn('flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm', i === sel && 'bg-primary-soft text-primary')}>
            {c.group === 'Create' ? <Plus size={15} aria-hidden /> : c.group === 'Search' ? <Search size={15} aria-hidden /> : <CornerDownLeft size={15} className="opacity-50" aria-hidden />}
            <span className="flex-1">{c.label}</span>{c.hint && <span className="text-xs text-muted">{c.hint}</span>}</div></li> })}
    </ul>
  </dialog>
}

export function PaletteHint() {
  return <button type="button" onClick={() => dispatchEvent(new Event('saqrflow:palette'))} className="hidden cursor-pointer items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted hover:bg-surface-2 hover:text-fg md:inline-flex" aria-label="Open command palette (Ctrl+K)">
    <kbd className="font-sans">Ctrl K</kbd></button>
}
