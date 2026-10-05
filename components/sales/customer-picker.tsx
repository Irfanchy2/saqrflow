'use client'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Check, ChevronsUpDown, Search, UserPlus, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface CustomerOpt { id: string; name: string; address: string | null; trn: string | null; phone: string | null; contact_person: string | null; email: string | null }

/** Searchable customer selector (name, TRN, phone, contact, e-mail). Keyboard: ↑ ↓ Enter Esc. */
export function CustomerPicker({ customers, value, onPick, disabled }: { customers: CustomerOpt[]; value: string | null | undefined; onPick: (c: CustomerOpt | null) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false), [q, setQ] = useState(''), [hi, setHi] = useState(0)
  const box = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null), listId = useId()
  const current = customers.find(c => c.id === value)
  const list = useMemo(() => {
    const t = q.trim().toLowerCase()
    const rows = !t ? customers : customers.filter(c => [c.name, c.trn, c.phone, c.contact_person, c.email].some(v => v?.toLowerCase().includes(t)))
    return rows.slice(0, 50)
  }, [customers, q])
  useEffect(() => {
    if (!open) return
    const off = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', off); return () => document.removeEventListener('mousedown', off)
  }, [open])
  useEffect(() => { if (open) { setHi(0); setTimeout(() => input.current?.focus(), 0) } }, [open])
  const choose = (c: CustomerOpt | null) => { onPick(c); setOpen(false); setQ('') }
  const key = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(list.length, h + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(0, h - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); choose(hi === list.length ? null : list[hi] ?? null) }
    else if (e.key === 'Escape') setOpen(false)
  }
  return <div ref={box} className="relative">
    <button type="button" disabled={disabled} onClick={() => setOpen(o => !o)} aria-haspopup="listbox" aria-expanded={open} aria-controls={listId}
      className="flex h-9 w-full cursor-pointer items-center gap-2 rounded-md border border-border bg-surface px-3 text-start text-sm transition-colors hover:border-muted/50 disabled:cursor-default disabled:opacity-60">
      <span className={cn('min-w-0 flex-1 truncate', !current && 'text-muted')}>{current ? current.name : 'Search customers… (or type a one-off customer below)'}</span>
      {current && !disabled && <span role="button" tabIndex={-1} aria-label="Clear customer" onClick={e => { e.stopPropagation(); choose(null) }} className="rounded p-0.5 text-muted hover:text-fg"><X size={14} /></span>}
      <ChevronsUpDown size={14} className="shrink-0 text-muted" aria-hidden />
    </button>
    {open && <div className="toast-in absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-lg border border-border bg-surface shadow-xl">
      <div className="flex items-center gap-2 border-b border-border px-3"><Search size={14} className="text-muted" aria-hidden />
        <input ref={input} dir="auto" value={q} onChange={e => { setQ(e.target.value); setHi(0) }} onKeyDown={key} placeholder="Name, TRN, phone, contact…" aria-label="Search customers"
          role="combobox" aria-expanded aria-controls={listId} aria-activedescendant={`${listId}-${hi}`} className="h-10 flex-1 bg-transparent text-sm outline-none focus-visible:ring-0" /></div>
      <ul id={listId} role="listbox" className="max-h-72 overflow-y-auto p-1">
        {list.map((c, i) => <li key={c.id} id={`${listId}-${i}`} role="option" aria-selected={c.id === value} onMouseMove={() => setHi(i)} onClick={() => choose(c)}
          className={cn('flex cursor-pointer items-start gap-2 rounded-md px-2.5 py-2 text-sm', i === hi && 'bg-primary-soft')}>
          <Check size={14} className={cn('mt-0.5 shrink-0', c.id === value ? 'text-primary' : 'invisible')} aria-hidden />
          <span className="min-w-0"><span className="block truncate font-medium">{c.name}</span>
            <span className="block truncate text-xs text-muted">{[c.contact_person, c.phone, c.trn && `TRN ${c.trn}`].filter(Boolean).join(' · ') || '—'}</span></span></li>)}
        {list.length === 0 && <li className="px-3 py-3 text-sm text-muted">No saved customer matches “{q}”.</li>}
        <li id={`${listId}-${list.length}`} role="option" aria-selected={false} onMouseMove={() => setHi(list.length)} onClick={() => choose(null)}
          className={cn('mt-1 flex cursor-pointer items-center gap-2 rounded-md border-t border-border px-2.5 py-2 text-sm text-primary', hi === list.length && 'bg-primary-soft')}>
          <UserPlus size={14} aria-hidden />One-off / new customer (type the details below)</li>
      </ul>
    </div>}
  </div>
}
