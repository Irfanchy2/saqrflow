'use client'
import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CornerDownLeft, Loader2, Plus, Search } from '@/components/icons'
import { newSalesDoc } from '@/app/actions/sales'
import { paletteSearch, type PaletteHit } from '@/app/actions/palette'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'

export interface PaletteLink { label: string; href: string; group: string }
type Cmd = { id: string; label: string; group: string; run: () => void; hint?: string }

/** Ctrl/⌘ + K: jump to any page, create a document, or search everything. */
export function CommandPalette({ links, canSales }: { links: PaletteLink[]; canSales: boolean }) {
  const [open, setOpen] = useState(false), [q, setQ] = useState(''), [sel, setSel] = useState(0)
  const [pending, start] = useTransition()
  const [hits, setHits] = useState<PaletteHit[]>([]), [looking, setLooking] = useState(false)
  // live record results while typing (debounced; a newer query wins over a slower older one)
  useEffect(() => {
    const term = q.trim(); if (term.length < 2) { setHits([]); setLooking(false); return }
    let live = true; setLooking(true)
    const h = setTimeout(async () => { const r = await paletteSearch(term).catch(() => []); if (live) { setHits(r); setLooking(false); setSel(0) } }, 200)
    return () => { live = false; clearTimeout(h) }
  }, [q])
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
      { id: 'nl', label: 'New lead', group: 'Create', run: go('/leads?new=lead') },
      { id: 'nt', label: 'New task', group: 'Create', run: go('/tasks?new=task') },
      { id: 'nar', label: 'New approval request', group: 'Create', run: go('/approvals?new=approval') },
      { id: 'ntk', label: 'New service ticket', group: 'Create', run: go('/tickets?new=ticket') },
      { id: 'nwr', label: 'Record a warranty', group: 'Create', run: go('/tickets?tab=warranties&new=warranty') },
      { id: 'nkb', label: 'New knowledge base article', group: 'Create', run: go('/kb?new=kb') },
      { id: 'nsv', label: 'Schedule site visit', group: 'Create', run: go('/site-visits?new=site_visit') },
      { id: 'nwo', label: 'New work order', group: 'Create', run: go('/work-orders?new=work_order') },
      { id: 'ndsr', label: 'New daily site report', group: 'Create', run: go('/site-reports?new=site_report') },
      { id: 'up', label: 'Upload documents to Smart Inbox', group: 'Create', run: go('/inbox') },
      { id: 'nc', label: 'Add customer', group: 'Create', run: go('/parties?new=customer') },
      { id: 'ne', label: 'Add employee', group: 'Create', run: go('/employees?new=employee') },
      { id: 'nx', label: 'Add expense', group: 'Create', run: go('/expenses?new=expense') },
      { id: 'np', label: 'New project', group: 'Create', run: go('/projects?new=project') },
      { id: 'nd2', label: 'Add company document', group: 'Create', run: go('/documents?new=document') },
      { id: 'nv', label: 'Add vehicle', group: 'Create', run: go('/assets?tab=vehicles&new=vehicle') },
      { id: 'na', label: 'Add asset or equipment', group: 'Create', run: go('/assets?tab=assets&new=asset') },
      { id: 'nsr', label: 'Receive stock', group: 'Create', run: go('/stock?new=receive') },
      { id: 'nsi', label: 'Issue stock to a job', group: 'Create', run: go('/stock?new=issue') },
      { id: 'nst', label: 'Add stock item', group: 'Create', run: go('/stock?new=stock_item') },
      { id: 'nba', label: 'Add bank account', group: 'Create', run: go('/banking?new=bank_account') },
      { id: 'rp', label: 'Open reports', group: 'Go to', run: go('/reports'), hint: 'Insights' },
      { id: 'sp', label: 'Search projects…', group: 'Go to', run: go('/projects'), hint: 'Projects' },
      ...links.map(l => ({ id: l.href, label: l.label, group: 'Go to', run: go(l.href), hint: l.group })),
    ]
  }, [links, canSales, router, pending])
  const term = q.trim().toLowerCase()
  const go2 = (href: string) => () => { setOpen(false); router.push(href) }
  const list = term ? [...hits.map(h => ({ id: `r:${h.href}`, label: h.label, group: 'Records', run: go2(h.href), hint: h.hint })), ...cmds.filter(c => c.label.toLowerCase().includes(term)),
    { id: 'search', label: `Search everything for “${q.trim()}”`, group: 'Search', run: go2(`/search?q=${encodeURIComponent(q.trim())}`) },
    { id: 'ask', label: `Ask Averiqo AI: “${q.trim()}”`, group: 'Search', run: go2(`/assistant?q=${encodeURIComponent(q.trim())}`) }] : cmds
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(list.length - 1, s + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(0, s - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); list[sel]?.run() }
  }
  let lastGroup = ''
  return <dialog ref={dlg} onClose={() => setOpen(false)} onClick={e => { if (e.target === dlg.current) setOpen(false) }} aria-label="Command palette"
    className="m-auto mt-[12vh] w-[calc(100%-2rem)] max-w-xl overflow-hidden rounded-2xl border border-border/80 bg-surface p-0 text-start text-fg shadow-pop">
    <div className="flex items-center gap-2 border-b border-border px-4">
      {pending || looking ? <Loader2 size={16} className="animate-spin text-muted" /> : <Search size={16} className="text-muted" aria-hidden />}
      <input ref={input} value={q} onChange={e => { setQ(e.target.value); setSel(0) }} onKeyDown={onKey} placeholder="Type a command, a name or a number…" aria-label="Command" role="combobox" aria-expanded aria-controls="palette-list" aria-activedescendant={list[sel] ? `cmd-${list[sel].id}` : undefined}
        className="h-14 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted/70 focus-visible:ring-0" />
      <kbd className="inline-flex h-6 items-center rounded-md border border-border bg-surface px-1.5 text-[11px] text-muted shadow-key">Esc</kbd>
    </div>
    <ul id="palette-list" role="listbox" className="max-h-[55vh] overflow-y-auto p-2">
      {/* built only while open: the closed palette used to put every command into each page's HTML */}
      {open && list.map((c, i) => { const head = c.group !== lastGroup; lastGroup = c.group
        return <li key={c.id} role="presentation">{head && <div className="px-2.5 pb-1.5 pt-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted/80">{c.group}</div>}
          <div id={`cmd-${c.id}`} role="option" aria-selected={i === sel} onMouseMove={() => setSel(i)} onClick={() => c.run()}
            className={cn('flex min-h-10 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors duration-100', i === sel && 'bg-primary-soft text-primary')}>
            {c.group === 'Create' ? <Plus size={15} aria-hidden /> : c.group === 'Search' ? <Search size={15} aria-hidden /> : <CornerDownLeft size={15} className="opacity-50" aria-hidden />}
            <span className="flex-1">{c.label}</span>{c.hint && <span className="text-xs text-muted">{c.hint}</span>}</div></li> })}
    </ul>
  </dialog>
}
