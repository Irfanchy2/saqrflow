'use client'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { Bookmark, Trash2, Users } from 'lucide-react'
import { Button, Field, Input } from '@/components/ui/primitives'
import { ActionForm } from '@/components/ui/action-form'
import { saveView, deleteView } from '@/app/actions/views'
import { toast } from '@/components/ui/toast'

interface View { id: string; name: string; query: string; shared: boolean; own: boolean }

export function SavedViewsMenu({ page, views, canShare, canRemoveShared }: { page: string; views: View[]; canShare: boolean; canRemoveShared: boolean }) {
  const [open, setOpen] = useState(false), box = useRef<HTMLDivElement>(null), dlg = useRef<HTMLDialogElement>(null)
  const path = usePathname(), sp = useSearchParams()
  const current = (() => { const p = new URLSearchParams(sp.toString()); for (const k of ['page', 'open', 'new']) p.delete(k); return p.toString() })()
  useEffect(() => {
    if (!open) return
    const out = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    addEventListener('mousedown', out); addEventListener('keydown', esc)
    return () => { removeEventListener('mousedown', out); removeEventListener('keydown', esc) }
  }, [open])
  const active = views.find(v => v.query === current && path === page)
  return <div ref={box} className="relative">
    <Button variant="secondary" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}><Bookmark size={15} />{active ? active.name : 'Views'}</Button>
    {open && <div role="menu" className="absolute end-0 top-full z-30 mt-1 w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-border bg-surface shadow-pop">
      {!views.length ? <p className="px-3 py-3 text-sm text-muted">No saved views yet. Set the filters you use often, then save them here.</p>
        : <ul className="max-h-72 overflow-y-auto py-1">{views.map(v => <li key={v.id} className="flex items-center gap-1 pe-1">
          <Link role="menuitem" href={`${page}${v.query ? `?${v.query}` : ''}`} onClick={() => setOpen(false)} className="flex min-h-10 min-w-0 flex-1 items-center gap-2 px-3 py-2 text-sm hover:bg-surface-2">
            <span className="truncate">{v.name}</span>{v.shared && <Users size={13} className="shrink-0 text-muted" aria-label="Shared with the team" />}</Link>
          {(v.own || (v.shared && canRemoveShared)) && <button type="button" aria-label={`Remove view ${v.name}`} className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-danger"
            onClick={async () => { if (!confirm(`Remove the view “${v.name}”?`)) return; const r = await deleteView(v.id, page); toast(r?.error ?? r?.message ?? 'Removed', r?.error ? 'error' : 'success') }}><Trash2 size={14} /></button>}
        </li>)}</ul>}
      <div className="border-t border-border p-2"><Button variant="ghost" className="w-full justify-start" onClick={() => { setOpen(false); dlg.current?.showModal() }}>Save current filters as a view…</Button></div>
    </div>}
    <dialog ref={dlg} onClick={e => { if (e.target === dlg.current) dlg.current?.close() }} className="mx-0 mb-0 mt-auto w-full max-w-none rounded-t-xl border border-border bg-surface p-0 text-fg shadow-pop sm:m-auto sm:w-[calc(100%-2rem)] sm:max-w-md sm:rounded-lg">
      <div className="border-b border-border px-5 py-3"><h2 className="text-[15px] font-semibold">Save view</h2></div>
      <div className="p-5"><ActionForm action={saveView.bind(null, page)} submit="Save view">
        <input type="hidden" name="query" value={current} />
        <Field label="Name *"><Input name="name" required maxLength={60} placeholder="e.g. Overdue, high priority" /></Field>
        <p className="text-xs text-muted">{current ? `Saves the current filters (${decodeURIComponent(current).replace(/&/g, ' · ').slice(0, 120)}).` : 'No filters are set: this view opens the list as it is by default.'}</p>
        {canShare && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="shared" />Share with everyone in the company</label>}
      </ActionForm></div>
    </dialog>
  </div>
}
