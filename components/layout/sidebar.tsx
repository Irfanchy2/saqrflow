'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { Inbox, LayoutDashboard, FileText, Users, Vault, Landmark, Receipt, HardHat, Handshake, Truck, BellRing, CalendarDays, BarChart3, Sparkles, ShieldCheck, Settings, PanelLeftClose, PanelLeftOpen, Menu, X } from 'lucide-react'
import { cn } from '@/lib/utils'

const ICONS = { inbox: Inbox, overview: LayoutDashboard, documents: FileText, employees: Users, vault: Vault, cheques: Landmark, invoices: Receipt, projects: HardHat, parties: Handshake, assets: Truck, reminders: BellRing, calendar: CalendarDays, reports: BarChart3, assistant: Sparkles, users: ShieldCheck, settings: Settings }
export interface NavItem { key: keyof typeof ICONS; href: string; label: string; group: string; status: 'live' | 'partial' | 'planned' }
import { SIDEBAR_COOKIE } from '@/lib/ui-prefs'

/**
 * Desktop: collapsible rail (icons only + tooltips). The choice is stored in a cookie so the server renders the right width
 * on the next load (no flash). Mobile: slide-in drawer. Ctrl+\ toggles.
 */
export function Sidebar({ items, company, rtl, initialCollapsed = false }: { items: NavItem[]; company: string; rtl: boolean; initialCollapsed?: boolean }) {
  const path = usePathname()
  const [collapsed, setCollapsed] = useState(initialCollapsed)
  const [open, setOpen] = useState(false)
  const [tip, setTip] = useState<{ label: string; top: number } | null>(null)
  useEffect(() => setOpen(false), [path])
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

  const nav = (full: boolean) => <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto overflow-x-hidden px-2 py-2" aria-label="Main">
    {items.map((i, n) => { const Icon = ICONS[i.key]; const head = n > 0 && items[n - 1].group !== i.group; return (<div key={i.key}>
      {head && (full ? <div className="px-2.5 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-wider text-muted/80">{i.group}</div> : <div className="mx-2 my-2 border-t border-border" />)}
      <Link href={i.href} aria-label={full ? undefined : i.label} aria-current={active(i.href) ? 'page' : undefined}
        title={full && i.status !== 'live' ? `${i.label} (${i.status === 'planned' ? 'planned' : 'partially built'})` : undefined}
        onMouseEnter={e => { if (!full) showTip(i.label, e.currentTarget) }} onMouseLeave={() => setTip(null)}
        onFocus={e => { if (!full) showTip(i.label, e.currentTarget) }} onBlur={() => setTip(null)}
        className={cn('group flex items-center gap-3 rounded-md py-2 text-sm transition-colors', full ? 'px-2.5' : 'justify-center px-0', active(i.href) ? 'bg-primary-soft font-medium text-primary' : 'text-muted hover:bg-surface-2 hover:text-fg')}>
        <Icon size={17} className="shrink-0" aria-hidden />
        {full && <span className="flex-1 truncate">{i.label}</span>}
        {full && i.status !== 'live' && <span className={cn('rounded px-1.5 text-[10px] font-medium uppercase tracking-wide', i.status === 'planned' ? 'bg-surface-2 text-muted' : 'bg-warning/15 text-warning')}>{i.status === 'planned' ? 'Soon' : 'Beta'}</span>}
      </Link></div>) })}
  </nav>
  const logo = <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-primary text-sm font-bold text-primary-fg" aria-hidden>S</div>
  const brand = <div className="min-w-0 flex-1 leading-tight"><div className="text-sm font-semibold">SaqrFlow</div><div className="truncate text-[11px] text-muted">{company}</div></div>

  return <>
    <button aria-label="Open menu" className="fixed start-3 top-3 z-30 rounded-md border border-border bg-surface p-2 shadow-card lg:hidden" onClick={() => setOpen(true)}><Menu size={18} /></button>
    {open && <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setOpen(false)} aria-hidden />}
    <aside aria-label="Navigation" className={cn('fixed inset-y-0 start-0 z-50 flex w-64 flex-col border-e border-border bg-surface transition-transform duration-200 lg:hidden', open ? 'translate-x-0' : rtl ? 'translate-x-full' : '-translate-x-full')}>
      <div className="flex h-14 items-center gap-2.5 border-b border-border ps-4 pe-2">{logo}{brand}
        <button aria-label="Close menu" className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-surface-2" onClick={() => setOpen(false)}><X size={16} /></button></div>
      {nav(true)}</aside>

    <aside aria-label="Navigation" data-collapsed={collapsed} className={cn('sticky top-0 hidden h-screen shrink-0 flex-col border-e border-border bg-surface transition-[width] duration-200 ease-out lg:flex', collapsed ? 'w-[60px]' : 'w-64')}>
      <div className={cn('flex h-14 items-center border-b border-border', collapsed ? 'justify-center px-2' : 'gap-2.5 ps-4 pe-2')}>
        {!collapsed && <>{logo}{brand}</>}
        <button type="button" onClick={() => { toggle(); setTip(null) }} aria-expanded={!collapsed} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={`${collapsed ? 'Expand' : 'Collapse'} sidebar (Ctrl+\\)`}
          className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-fg">
          {collapsed ? <Expand size={17} /> : <Collapse size={17} />}</button>
      </div>
      {nav(!collapsed)}
    </aside>
    {collapsed && tip && <div role="tooltip" className="toast-in pointer-events-none fixed start-[68px] z-[70] -translate-y-1/2 whitespace-nowrap rounded-md bg-fg px-2.5 py-1 text-xs font-medium text-bg shadow-lg" style={{ top: tip.top }}>{tip.label}</div>}
  </>
}
