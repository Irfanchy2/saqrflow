'use client'
import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, Loader2, Plus } from '@/components/icons'
import { newSalesDoc } from '@/app/actions/sales'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { AnimatePresence, m } from 'framer-motion'
import { T } from '@/components/motion'

type Can = { sales: boolean; docs: boolean; people: boolean; assets: boolean }
/** One "New" menu with the handful of things people create every day (instead of a row of buttons). Keyboard: arrows, Enter, Escape. */
export function QuickActions({ can, label = 'Create' }: { can: Can; label?: string }) {
  const [open, setOpen] = useState(false), [pending, start] = useTransition()
  const router = useRouter(), box = useRef<HTMLDivElement>(null), btn = useRef<HTMLButtonElement>(null)
  const make = (t: 'quotation' | 'invoice') => start(async () => { const r = await newSalesDoc(t, { token: crypto.randomUUID() }); if (r?.error) toast(r.error, 'error') })
  const items: [string, () => void, boolean][] = ([
    ['Quotation', () => make('quotation'), can.sales],
    ['Tax invoice', () => make('invoice'), can.sales],
    ['Customer', () => router.push('/parties?new=customer'), can.people],
    ['Upload document', () => router.push('/inbox'), can.docs],
    ['Employee', () => router.push('/employees?new=employee'), can.people],
    ['Vehicle', () => router.push('/assets?tab=vehicles&new=vehicle'), can.assets],
    ['Asset or equipment', () => router.push('/assets?tab=assets&new=asset'), can.assets],
    ['Expense', () => router.push('/expenses?new=expense'), can.sales],
  ] as [string, () => void, boolean][]).filter(i => i[2])
  useEffect(() => {
    if (!open) return
    const out = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); btn.current?.focus() } }
    addEventListener('mousedown', out); addEventListener('keydown', key)
    box.current?.querySelector<HTMLButtonElement>('[role=menuitem]')?.focus()
    return () => { removeEventListener('mousedown', out); removeEventListener('keydown', key) }
  }, [open])
  if (!items.length) return null
  const move = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault(); const els = [...(box.current?.querySelectorAll<HTMLButtonElement>('[role=menuitem]') ?? [])]
    const i = els.indexOf(document.activeElement as HTMLButtonElement); els[(i + (e.key === 'ArrowDown' ? 1 : -1) + els.length) % els.length]?.focus()
  }
  return <div ref={box} className="relative">
    <button ref={btn} type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)} disabled={pending}
      className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-lg bg-ink ps-4 pe-3 text-sm font-semibold text-ink-fg shadow-btn transition-colors hover:bg-ink/90 disabled:opacity-60 sm:h-10">
      {pending ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Plus size={16} aria-hidden />}{label}<ChevronDown size={14} className={cn('transition-transform', open && 'rotate-180')} aria-hidden /></button>
    <AnimatePresence>{open && <m.div role="menu" aria-label="Create new" onKeyDown={move} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={T.fast}
      className="absolute end-0 z-pop mt-1.5 w-56 overflow-hidden rounded-xl border border-border bg-surface p-1 shadow-pop">
      {items.map(([l, run]) => <button key={l} role="menuitem" type="button" onClick={() => { setOpen(false); run() }}
        className="block w-full cursor-pointer rounded-md px-2.5 py-1.5 text-start text-sm hover:bg-surface-2 focus:bg-surface-2 focus:outline-none">{l}</button>)}</m.div>}</AnimatePresence>
  </div>
}
