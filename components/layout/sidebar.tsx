'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { Inbox, LayoutDashboard, FileText, Users, Vault, Landmark, Receipt, HardHat, Handshake, Truck, BellRing, CalendarDays, BarChart3, Sparkles, ShieldCheck, Settings, PanelLeftClose, PanelLeftOpen, Menu, X, LogOut, Wallet, Package, History, Trash2, Target, MapPinned, ClipboardList, ListTodo, ClipboardCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AveriqoWordmark } from '@/components/brand/logo'
import { ThemeToggle } from './theme-toggle'
import { signOut } from '@/app/actions/auth'

const ICONS = { inbox: Inbox, overview: LayoutDashboard, documents: FileText, employees: Users, vault: Vault, cheques: Landmark, invoices: Receipt, projects: HardHat, parties: Handshake, assets: Truck, reminders: BellRing, calendar: CalendarDays, reports: BarChart3, assistant: Sparkles, users: ShieldCheck, settings: Settings, expenses: Wallet, catalog: Package, audit: History, trash: Trash2, leads: Target, site_visits: MapPinned, work_orders: ClipboardList, tasks: ListTodo, site_reports: ClipboardCheck }
export interface NavItem { key: keyof typeof ICONS; href: string; label: string; group: string }
import { SIDEBAR_COOKIE } from '@/lib/ui-prefs'

/**
 * Desktop: collapsible rail (icons only + tooltips). The choice is stored in a cookie so the server renders the right width
 * on the next load (no flash). Mobile: slide-in drawer. Ctrl+\ toggles.
 */
export function Sidebar({ items, company, rtl, initialCollapsed = false, user = '' }: { items: NavItem[]; company: string; rtl: boolean; initialCollapsed?: boolean; user?: string }) {
  const path = usePathname()
  const [collapsed, setCollapsed] = useState(initialCollapsed)
  const [open, setOpen] = useState(false)
  const [tip, setTip] = useState<{ label: string; top: number } | null>(null)
  useEffect(() => setOpen(false), [path])
  useEffect(() => { const o = () => setOpen(true); addEventListener('averiqo:menu', o); return () => removeEventListener('averiqo:menu', o) }, [])
  // mobile drawer: Escape closes it, the page behind does not scroll
  useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden'; addEventListener('keydown', k)
    return () => { document.body.style.overflow = prev; removeEventListener('keydown', k) }
  }, [open])
  const toggle = () => setCollapsed(c => !c)
  const first = useRef(true)
  useEffect(() => {
    if (first.current) { first.current = false; return }
    document.cookie = `${SIDEBAR_COOKIE}=${collapsed ? '1' : '0'}; path=/; max-age=31536000; samesite=lax`
  }, [collapsed])
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === '\\') { e.preventDefault(); toggle(); setTip(null) } }
    addEventListener('keydown', k); return () => removeEventListener('keydown', k)
  }, [])
  const active = (h: string) => (h === '/' ? path === '/' : path === h || path.startsWith(h + '/'))
  const Collapse = rtl ? PanelLeftOpen : PanelLeftClose, Expand = rtl ? PanelLeftClose : PanelLeftOpen
  const showTip = (label: string, el: HTMLElement) => setTip({ label, top: el.getBoundingClientRect().top + el.offsetHeight / 2 })

  const nav = (full: boolean) => <nav className="flex flex-1 flex-col overflow-y-auto overflow-x-hidden px-2 py-2" aria-label="Main">
    {items.map((i, n) => { const Icon = ICONS[i.key]; const head = n > 0 && items[n - 1].group !== i.group; const on = active(i.href); return (<div key={i.key}>
      {head && (full ? (i.group ? <div className="px-2.5 pb-1 pt-4 text-2xs font-medium text-muted">{i.group}</div> : <div className="h-3" />) : <div className="mx-2.5 my-2 border-t border-border" />)}
      <Link href={i.href} aria-label={full ? undefined : i.label} aria-current={on ? 'page' : undefined}
        onMouseEnter={e => { if (!full) showTip(i.label, e.currentTarget) }} onMouseLeave={() => setTip(null)}
        onFocus={e => { if (!full) showTip(i.label, e.currentTarget) }} onBlur={() => setTip(null)}
        className={cn('relative flex h-11 items-center gap-2.5 rounded-md text-[15px] transition-colors lg:h-8 lg:text-[13.5px]', full ? 'px-2.5' : 'justify-center px-0',
          on ? 'bg-surface-2 font-medium text-fg' : 'text-muted hover:bg-surface-2/70 hover:text-fg')}>
        {on && <span aria-hidden className="absolute inset-y-1.5 start-0 w-[2px] rounded-full bg-primary" />}
        <Icon size={16} strokeWidth={1.75} className={cn('shrink-0', on && 'text-primary')} aria-hidden />
        {full && <span className="flex-1 truncate">{i.label}</span>}
      </Link></div>) })}
  </nav>
  const brand = <AveriqoWordmark sub={company} className="flex-1" />

  return <>
    <button aria-label="Open menu" className="fixed start-2 top-2 z-nav grid h-10 w-10 place-items-center rounded-md text-muted hover:bg-surface-2 lg:hidden" onClick={() => setOpen(true)}><Menu size={20} /></button>
    {open && <div className="fixed inset-0 z-40 bg-[hsl(222_30%_6%/.45)] lg:hidden" onClick={() => setOpen(false)} aria-hidden />}
    <aside aria-label="Navigation" aria-hidden={!open} inert={!open} className={cn('fixed inset-y-0 start-0 z-drawer flex w-72 max-w-[85vw] flex-col border-e border-border bg-nav shadow-pop transition-transform duration-200 ease-out lg:hidden', open ? 'translate-x-0' : rtl ? 'translate-x-full' : '-translate-x-full')}>
      <div className="flex h-14 items-center gap-2.5 border-b border-border ps-4 pe-2">{brand}
        <button aria-label="Close menu" className="grid h-10 w-10 place-items-center rounded-md text-muted hover:bg-surface-2" onClick={() => setOpen(false)}><X size={18} /></button></div>
      {nav(true)}
      <div className="flex items-center gap-2 border-t border-border px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <ThemeToggle /><span className="flex-1 truncate text-xs text-muted">{user}</span>
        <form action={signOut}><button className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md px-3 text-sm text-muted hover:bg-surface-2 hover:text-fg"><LogOut size={16} />Sign out</button></form>
      </div></aside>

    <aside aria-label="Navigation" data-collapsed={collapsed} className={cn('sticky top-0 hidden h-[100dvh] shrink-0 flex-col border-e border-border bg-nav transition-[width] duration-200 ease-out lg:flex', collapsed ? 'w-[60px]' : 'w-60')}>
      <div className={cn('flex h-14 items-center border-b border-border', collapsed ? 'flex-col justify-center gap-0 px-2' : 'gap-2.5 ps-4 pe-2')}>
        {!collapsed ? brand : <span className="sr-only">Averiqo</span>}
        <button type="button" onClick={() => { toggle(); setTip(null) }} aria-expanded={!collapsed} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={`${collapsed ? 'Expand' : 'Collapse'} sidebar (Ctrl+\\)`}
          className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-fg">
          {collapsed ? <Expand size={17} /> : <Collapse size={17} />}</button>
      </div>
      {nav(!collapsed)}
    </aside>
    {collapsed && tip && <div role="tooltip" className="toast-in pointer-events-none fixed start-[68px] z-toast -translate-y-1/2 whitespace-nowrap rounded-md bg-fg px-2 py-1 text-xs font-medium text-bg shadow-pop" style={{ top: tip.top }}>{tip.label}</div>}
  </>
}
