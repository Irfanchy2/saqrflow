'use client'
import Link from 'next/link'
import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { m } from 'framer-motion'
import { BookOpen, Loader2, Moon, Plus, Search, Settings, Sun } from '@/components/icons'
import { newSalesDoc } from '@/app/actions/sales'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'

type Can = { sales: boolean; docs: boolean; people: boolean; assets: boolean; projects: boolean; crm: boolean }

const btn = 'group/d relative grid h-11 w-11 cursor-pointer place-items-center rounded-full text-ink-fg/75 transition-[background-color,color,transform] duration-150 hover:bg-ink-fg/10 hover:text-ink-fg active:scale-95'
/** Label to the right of a dock button, shown on hover / keyboard focus. */
function Tip({ children }: { children: React.ReactNode }) {
  return <span role="tooltip" className="pointer-events-none absolute start-[calc(100%+12px)] top-1/2 z-pop -translate-y-1/2 translate-x-[-4px] whitespace-nowrap rounded-lg bg-ink px-2.5 py-1.5 text-[12.5px] font-medium text-ink-fg opacity-0 shadow-pop transition-[opacity,transform] duration-150 group-hover/d:translate-x-0 group-hover/d:opacity-100 group-focus-visible/d:translate-x-0 group-focus-visible/d:opacity-100 rtl:translate-x-[4px]">{children}</span>
}

/**
 * Floating dock at the left edge (desktop): search (Ctrl K), create, theme, help and settings.
 * The create menu opens beside the dock; C opens it from anywhere outside a text field.
 */
export function Dock({ can }: { can: Can }) {
  const [dark, setDark] = useState(false), [open, setOpen] = useState(false), [pending, start] = useTransition()
  const router = useRouter(), box = useRef<HTMLDivElement>(null)
  useEffect(() => setDark(document.documentElement.classList.contains('dark')), [])
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.key.toLowerCase() === 'c' && !e.metaKey && !e.ctrlKey && !e.altKey && !t.closest('input,textarea,select,[contenteditable],dialog')) { e.preventDefault(); setOpen(o => !o) }
      if (e.key === 'Escape') setOpen(false)
    }
    addEventListener('keydown', k); return () => removeEventListener('keydown', k)
  }, [])
  useEffect(() => {
    if (!open) return
    const out = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    addEventListener('pointerdown', out); box.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus()
    return () => removeEventListener('pointerdown', out)
  }, [open])
  const make = (t: 'quotation' | 'invoice') => start(async () => { const r = await newSalesDoc(t, { token: crypto.randomUUID() }); if (r?.error) toast(r.error, 'error') })
  const items = ([
    ['Quotation', () => make('quotation'), can.sales], ['Tax invoice', () => make('invoice'), can.sales],
    ['Lead', () => router.push('/leads?new=lead'), can.crm], ['Customer', () => router.push('/parties?new=customer'), can.people],
    ['Project', () => router.push('/projects?new=project'), can.projects], ['Task', () => router.push('/tasks?new=task'), true],
    ['Expense', () => router.push('/expenses?new=expense'), can.sales], ['Employee', () => router.push('/employees?new=employee'), can.people],
    ['Vehicle or asset', () => router.push('/assets?tab=assets&new=asset'), can.assets], ['Upload document', () => router.push('/inbox'), can.docs],
  ] as [string, () => void, boolean][]).filter(i => i[2])
  const theme = () => { const next = !dark; setDark(next); document.documentElement.classList.toggle('dark', next); try { localStorage.setItem('sf-theme', next ? 'dark' : 'light') } catch {} }
  return <nav aria-label="Quick actions" className="app-dock no-print fixed start-5 top-1/2 z-nav hidden -translate-y-1/2 flex-col items-center gap-1 rounded-full bg-ink p-1.5 shadow-[0_18px_40px_-16px_hsl(var(--shadow)/.55)] lg:flex">
    <button type="button" className={btn} aria-label="Search (Ctrl K)" onClick={() => dispatchEvent(new Event('saqrflow:palette'))}><Search size={19} aria-hidden /><Tip>Search <kbd className="ms-1 rounded bg-ink-fg/15 px-1 text-[11px]">Ctrl K</kbd></Tip></button>
    <div ref={box} className="relative">
      <button type="button" className={cn(btn, open && 'bg-ink-fg/10 text-ink-fg')} aria-label="Create new" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)} disabled={pending}>
        {pending ? <Loader2 size={19} className="animate-spin" aria-hidden /> : <Plus size={20} className={cn('transition-transform duration-200', open && 'rotate-45')} aria-hidden />}{!open && <Tip>Create <kbd className="ms-1 rounded bg-ink-fg/15 px-1 text-[11px]">C</kbd></Tip>}</button>
      {open && <m.div role="menu" aria-label="Create new" initial={{ opacity: 0, x: -6, scale: 0.98 }} animate={{ opacity: 1, x: 0, scale: 1 }} transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
        onKeyDown={e => { if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return; e.preventDefault(); const els = [...(box.current?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? [])], i = els.indexOf(document.activeElement as HTMLElement); els[(i + (e.key === 'ArrowDown' ? 1 : -1) + els.length) % els.length]?.focus() }}
        className="absolute start-[calc(100%+14px)] top-1/2 z-pop w-56 -translate-y-1/2 rounded-2xl border border-border/80 bg-surface/95 p-1.5 shadow-pop backdrop-blur-xl">
        <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Create</div>
        {items.map(([l, run]) => <button key={l} role="menuitem" type="button" onClick={() => { setOpen(false); run() }}
          className="flex w-full cursor-pointer items-center gap-2 rounded-xl px-2.5 py-2 text-start text-[13.5px] hover:bg-surface-2 focus:bg-surface-2 focus:outline-none"><Plus size={14} className="text-muted" aria-hidden />{l}</button>)}
      </m.div>}
    </div>
    <button type="button" className={btn} aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'} onClick={theme}>{dark ? <Sun size={19} aria-hidden /> : <Moon size={19} aria-hidden />}<Tip>{dark ? 'Light theme' : 'Dark theme'}</Tip></button>
    <span aria-hidden className="my-1 h-px w-6 bg-ink-fg/15" />
    <Link href="/kb" className={btn} aria-label="Help and SOPs"><BookOpen size={19} aria-hidden /><Tip>Help & SOPs</Tip></Link>
    <Link href="/settings" className={btn} aria-label="Settings"><Settings size={19} aria-hidden /><Tip>Settings</Tip></Link>
  </nav>
}
