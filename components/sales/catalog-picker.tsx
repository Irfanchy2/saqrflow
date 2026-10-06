'use client'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { PackagePlus, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { fmtMoney } from '@/lib/sales/money'

export interface CatalogOpt { id: string; name: string; description: string | null; unit: string; rate: number; vat_category: string; category: string | null }

/** "Add from catalog": search products / services and insert them as a new line (rate and text stay editable on the line). */
export function CatalogPicker({ items, onPick, priced }: { items: CatalogOpt[]; onPick: (c: CatalogOpt) => void; priced: boolean }) {
  const [open, setOpen] = useState(false), [q, setQ] = useState(''), [hi, setHi] = useState(0)
  const box = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null), listId = useId()
  const list = useMemo(() => {
    const t = q.trim().toLowerCase()
    return (!t ? items : items.filter(c => [c.name, c.description, c.category].some(v => v?.toLowerCase().includes(t)))).slice(0, 40)
  }, [items, q])
  useEffect(() => {
    if (!open) return
    const off = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', off); return () => document.removeEventListener('mousedown', off)
  }, [open])
  useEffect(() => { if (open) { setHi(0); setTimeout(() => input.current?.focus(), 0) } }, [open])
  const choose = (c?: CatalogOpt) => { if (c) onPick(c); setOpen(false); setQ('') }
  return <div ref={box} className="relative flex-1">
    <button type="button" onClick={() => setOpen(o => !o)} aria-haspopup="listbox" aria-expanded={open} disabled={!items.length}
      title={items.length ? undefined : 'Add products & services in Settings → Item catalog'}
      className="flex h-9 w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-border bg-surface px-3 text-sm font-medium text-muted transition-colors hover:border-primary/50 hover:text-fg disabled:cursor-not-allowed disabled:opacity-60">
      <PackagePlus size={15} aria-hidden />Add from catalog{items.length ? '' : ' (empty)'}</button>
    {open && <div className="toast-in absolute inset-x-0 bottom-full z-30 mb-1 overflow-hidden rounded-lg border border-border bg-surface shadow-xl sm:bottom-auto sm:top-full sm:mt-1">
      <div className="flex items-center gap-2 border-b border-border px-3"><Search size={14} className="text-muted" aria-hidden />
        <input ref={input} dir="auto" value={q} onChange={e => { setQ(e.target.value); setHi(0) }} placeholder="Search products & services…" aria-label="Search catalog"
          role="combobox" aria-expanded aria-controls={listId} aria-activedescendant={`${listId}-${hi}`}
          onKeyDown={e => { if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(list.length - 1, h + 1)) } else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(0, h - 1)) } else if (e.key === 'Enter') { e.preventDefault(); choose(list[hi]) } else if (e.key === 'Escape') setOpen(false) }}
          className="h-10 flex-1 bg-transparent text-sm outline-none focus-visible:ring-0" /></div>
      <ul id={listId} role="listbox" className="max-h-72 overflow-y-auto p-1">
        {list.map((c, i) => <li key={c.id} id={`${listId}-${i}`} role="option" aria-selected={i === hi} onMouseMove={() => setHi(i)} onClick={() => choose(c)}
          className={cn('flex cursor-pointer items-start gap-3 rounded-md px-2.5 py-2 text-sm', i === hi && 'bg-primary-soft')}>
          <span className="min-w-0 flex-1"><span className="block truncate font-medium">{c.name}</span><span className="block truncate text-xs text-muted">{c.category ?? c.description ?? '—'}</span></span>
          {priced && <span className="shrink-0 text-xs tabular-nums text-muted">{fmtMoney(c.rate)} / {c.unit}</span>}</li>)}
        {!list.length && <li className="px-3 py-3 text-sm text-muted">Nothing matches “{q}”.</li>}
      </ul>
    </div>}
  </div>
}
