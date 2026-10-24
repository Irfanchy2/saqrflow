'use client'
import Link from 'next/link'
import { useEffect, useLayoutEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Command, Loader2, LogOut, Moon, RotateCw, Settings, Smartphone, Sun, User, Wallet } from '@/components/icons'
import { signOut } from '@/app/actions/auth'
import { resetDemoData } from '@/app/actions/demo'
import { toast } from '@/components/ui/toast'
import { getThemePref, setThemePref, type ThemePref } from '@/lib/theme'
import { popIn, warmGsap } from '@/lib/gsap-pop'
import { cn } from '@/lib/utils'

const initials = (s: string) => s.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('') || '·'

const THEMES: [ThemePref, string, typeof Sun][] = [['light', 'Light', Sun], ['dark', 'Dark', Moon], ['system', 'Match system', Smartphone]]

/**
 * Account menu: the round avatar opens profile, settings, keyboard shortcuts, the theme (light, dark or match the
 * device), "Reset demo data" in the shared demo, and sign out. GSAP animates it in (loaded on first hover).
 */
export function UserMenu({ name, isDemo }: { name: string; isDemo?: boolean }) {
  const [open, setOpen] = useState(false), [pref, setPref] = useState<ThemePref>('system'), [resetting, start] = useTransition()
  const box = useRef<HTMLDivElement>(null), panel = useRef<HTMLDivElement>(null), router = useRouter()
  const close = (focus = false) => { setOpen(false); if (focus) box.current?.querySelector<HTMLButtonElement>('[aria-haspopup]')?.focus() }
  useEffect(() => { const sync = () => setPref(getThemePref()); sync(); addEventListener('sf-theme', sync); return () => removeEventListener('sf-theme', sync) }, [])
  useLayoutEffect(() => { if (open) { popIn(panel.current); panel.current?.querySelector<HTMLElement>('[role^=menuitem]')?.focus() } }, [open])
  useEffect(() => {
    if (!open) return
    const out = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close(true) }
    addEventListener('pointerdown', out); addEventListener('keydown', key)
    return () => { removeEventListener('pointerdown', out); removeEventListener('keydown', key) }
  }, [open])
  const move = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return
    e.preventDefault(); const els = [...(panel.current?.querySelectorAll<HTMLElement>('[role^=menuitem]') ?? [])], i = els.indexOf(document.activeElement as HTMLElement)
    const n = e.key === 'Home' ? 0 : e.key === 'End' ? els.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + els.length) % els.length
    els[n]?.focus()
  }
  const reset = () => start(async () => { const r = (await resetDemoData()) ?? {}; toast(r.error ?? r.message ?? 'Done', r.error ? 'error' : 'success'); if (!r.error) { close(); router.refresh() } })
  const item = 'flex h-12 w-full cursor-pointer items-center gap-3.5 rounded-xl px-3 text-start text-[15px] font-medium outline-none transition-colors duration-100 hover:bg-surface-2 focus-visible:bg-surface-2 disabled:cursor-wait disabled:opacity-60'
  const sep = <div role="separator" className="mx-2 my-1.5 h-px bg-border" />

  return <div ref={box} className="relative">
    <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label={`Account: ${name}`} onClick={() => setOpen(o => !o)} {...warmGsap}
      className="grid h-10 w-10 cursor-pointer place-items-center rounded-full bg-[hsl(185_30%_86%)] text-[13px] font-semibold tracking-[0.02em] text-[hsl(190_30%_20%)] shadow-card ring-[3px] ring-white/80 transition-[transform,box-shadow] duration-150 hover:shadow-lift active:scale-95 dark:bg-[hsl(185_20%_24%)] dark:text-[hsl(185_30%_88%)] dark:ring-white/[.06] lg:h-12 lg:w-12 lg:text-[14px]">
      <span aria-hidden>{initials(name)}</span></button>
    {open && <div ref={panel} role="menu" aria-label="Account" onKeyDown={move}
      className="absolute end-0 top-[calc(100%+12px)] z-pop w-[19rem] max-w-[calc(100vw-2rem)] origin-top-right rounded-[22px] border border-border/80 bg-surface p-2 shadow-pop rtl:origin-top-left">
      <Link role="menuitem" href="/settings#account" onClick={() => close()} className={item}><User size={20} aria-hidden />My profile</Link>
      <Link role="menuitem" href="/me" onClick={() => close()} className={item}><Wallet size={20} aria-hidden />My portal (my expenses, salary)</Link>
      <Link role="menuitem" href="/settings" onClick={() => close()} className={item}><Settings size={20} aria-hidden />Settings</Link>
      <button role="menuitem" type="button" className={item} onClick={() => { close(); dispatchEvent(new Event('saqrflow:shortcuts')) }}><Command size={20} aria-hidden />Keyboard shortcuts</button>
      {sep}
      <div role="group" aria-label="Theme">{THEMES.map(([k, label, I]) =>
        <button key={k} role="menuitemradio" aria-checked={pref === k} type="button" className={item} onClick={() => { setThemePref(k); setPref(k) }}>
          <I size={20} aria-hidden /><span className="flex-1">{label}</span>{pref === k && <Check size={18} weight="bold" aria-hidden />}</button>)}</div>
      {sep}
      {isDemo && <button role="menuitem" type="button" className={item} onClick={reset} disabled={resetting}>
        {resetting ? <Loader2 size={20} className="animate-spin" aria-hidden /> : <RotateCw size={20} aria-hidden />}Reset demo data</button>}
      <form action={signOut} data-signout><button role="menuitem" aria-label="Sign out" className={cn(item, 'text-danger hover:bg-danger/[.07] focus-visible:bg-danger/[.07]')}><LogOut size={20} aria-hidden />Sign out</button></form>
    </div>}
  </div>
}
