'use client'
import { useEffect, useRef, useState } from 'react'
import { X } from '@/components/icons'

const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const ROWS: [string, string[][]][] = [
  ['Anywhere', [['Search and jump to any page', 'Mod', 'K'], ['Quick create (new quotation, invoice, task…)', 'C'], ['Show these shortcuts', '?'], ['Close a menu or dialog', 'Esc']]],
  ['In menus', [['Move between items', '↑', '↓'], ['Choose', 'Enter']]],
  ['Quotations and invoices', [['Save the document', 'Mod', 'S']]],
]

/** Keyboard shortcuts sheet: opened from the account menu or with "?" outside a text field. */
export function ShortcutsDialog() {
  const [open, setOpen] = useState(false), dlg = useRef<HTMLDialogElement>(null), [mac, setMac] = useState(false)
  useEffect(() => {
    setMac(MAC)
    const show = () => setOpen(true)
    const key = (e: KeyboardEvent) => { const t = e.target as HTMLElement; if (e.key === '?' && !e.ctrlKey && !e.metaKey && !t.closest('input,textarea,select,[contenteditable]')) { e.preventDefault(); setOpen(true) } }
    addEventListener('saqrflow:shortcuts', show); addEventListener('keydown', key)
    return () => { removeEventListener('saqrflow:shortcuts', show); removeEventListener('keydown', key) }
  }, [])
  useEffect(() => { const d = dlg.current; if (!d) return; if (open && !d.open) d.showModal(); else if (!open && d.open) d.close() }, [open])
  const k = (s: string) => s === 'Mod' ? (mac ? '⌘' : 'Ctrl') : s
  return <dialog ref={dlg} aria-label="Keyboard shortcuts" onClose={() => setOpen(false)} onClick={e => { if (e.target === dlg.current) setOpen(false) }}
    className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-border/80 bg-surface p-0 text-fg shadow-pop">
    {open && <div className="p-5">
      <div className="flex items-center justify-between"><h2 className="text-[17px] font-semibold tracking-[-0.01em]">Keyboard shortcuts</h2>
        <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="grid h-9 w-9 cursor-pointer place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-fg"><X size={17} /></button></div>
      {ROWS.map(([group, rows]) => <section key={group} className="mt-4"><h3 className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-muted">{group}</h3>
        <ul className="mt-1.5 divide-y divide-border/70">{rows.map(([label, ...keys]) => <li key={label} className="flex items-center justify-between gap-4 py-2 text-[14px]">
          <span>{label}</span><span className="flex shrink-0 gap-1">{keys.map(x => <kbd key={x} className="inline-grid h-7 min-w-7 place-items-center rounded-md border border-border bg-surface-2 px-1.5 font-sans text-[12px] font-medium shadow-key">{k(x)}</kbd>)}</span></li>)}</ul></section>)}
    </div>}
  </dialog>
}
