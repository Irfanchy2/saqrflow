'use client'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, LogOut, Moon, Settings, Sun, UserRound } from '@/components/icons'
import { signOut } from '@/app/actions/auth'
import { cn } from '@/lib/utils'

const initials = (s: string) => s.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('') || '·'

/** Theme switch for the top bar (light ↔ dark, remembered in this browser). */
export function TopThemeToggle() {
  const [dark, setDark] = useState(false)
  useEffect(() => setDark(document.documentElement.classList.contains('dark')), [])
  return <button type="button" aria-label="Toggle dark mode" title={dark ? 'Light theme' : 'Dark theme'} onClick={() => {
    const next = !dark; setDark(next); document.documentElement.classList.toggle('dark', next)
    try { localStorage.setItem('sf-theme', next ? 'dark' : 'light') } catch {}
  }} className="hidden h-10 w-10 cursor-pointer place-items-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-fg sm:grid">{dark ? <Sun size={18} /> : <Moon size={18} />}</button>
}

/** Signed-in person: avatar, name and role; the menu holds account, settings and sign-out. */
export function UserMenu({ name, role, company }: { name: string; role: string; company: string }) {
  const [open, setOpen] = useState(false), box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const out = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); box.current?.querySelector<HTMLButtonElement>('[aria-haspopup]')?.focus() } }
    addEventListener('pointerdown', out); addEventListener('keydown', key)
    return () => { removeEventListener('pointerdown', out); removeEventListener('keydown', key) }
  }, [open])
  const item = 'flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-start text-sm hover:bg-surface-2 focus:bg-surface-2 focus:outline-none'
  return <div ref={box} className="relative">
    <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label={`Account: ${name}`} onClick={() => setOpen(o => !o)}
      className="flex h-11 cursor-pointer items-center gap-2.5 rounded-lg ps-1 pe-1.5 transition-colors hover:bg-surface-2 sm:pe-2">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-primary to-[hsl(var(--sb-accent))] text-[13px] font-semibold text-white lg:h-11 lg:w-11 lg:bg-none lg:bg-[hsl(160_40%_88%)] lg:text-[hsl(160_45%_18%)] lg:ring-2 lg:ring-white/80 dark:lg:bg-[hsl(160_25%_22%)] dark:lg:text-[hsl(160_40%_86%)] dark:lg:ring-white/[.06]" aria-hidden>{initials(name)}</span>
      <span className="hidden min-w-0 text-start leading-tight md:block lg:hidden"><span className="block max-w-[150px] truncate text-[13.5px] font-semibold">{name}</span><span className="block text-xs capitalize text-muted">{role.replace(/_/g, ' ')}</span></span>
      <ChevronDown size={15} className={cn('hidden text-muted transition-transform md:block lg:hidden', open && 'rotate-180')} aria-hidden /></button>
    {open && <div role="menu" aria-label="Account" className="absolute end-0 z-pop mt-1.5 w-60 rounded-xl border border-border bg-surface p-1.5 shadow-pop">
      <div className="px-2.5 pb-2 pt-1.5"><div className="truncate text-sm font-semibold">{name}</div><div className="truncate text-xs text-muted">{company}</div></div>
      <div className="my-1 h-px bg-border" />
      <Link role="menuitem" href="/settings#account" onClick={() => setOpen(false)} className={item}><UserRound size={15} className="text-muted" aria-hidden />My account & devices</Link>
      <Link role="menuitem" href="/settings" onClick={() => setOpen(false)} className={item}><Settings size={15} className="text-muted" aria-hidden />Settings</Link>
      <button role="menuitem" type="button" className={cn(item, 'sm:hidden')} onClick={() => {
        const next = !document.documentElement.classList.contains('dark'); document.documentElement.classList.toggle('dark', next)
        try { localStorage.setItem('sf-theme', next ? 'dark' : 'light') } catch {}; setOpen(false)
      }}><Moon size={15} className="text-muted" aria-hidden />Switch theme</button>
      <div className="my-1 h-px bg-border" />
      <form action={signOut} data-signout><button role="menuitem" aria-label="Sign out" className={cn(item, 'text-danger')}><LogOut size={15} aria-hidden />Sign out</button></form>
    </div>}
  </div>
}
