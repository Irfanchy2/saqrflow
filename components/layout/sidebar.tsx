'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Inbox, LayoutDashboard, FileText, Users, Vault, Landmark, Receipt, HardHat, Handshake, Truck, BellRing, CalendarDays, BarChart3, Sparkles, ShieldCheck, Settings, PanelLeftClose, PanelLeftOpen, Menu, X } from 'lucide-react'
import { cn } from '@/lib/utils'

const ICONS = { inbox: Inbox, overview: LayoutDashboard, documents: FileText, employees: Users, vault: Vault, cheques: Landmark, invoices: Receipt, projects: HardHat, parties: Handshake, assets: Truck, reminders: BellRing, calendar: CalendarDays, reports: BarChart3, assistant: Sparkles, users: ShieldCheck, settings: Settings }
export interface NavItem { key: keyof typeof ICONS; href: string; label: string; group: string; status: 'live' | 'partial' | 'planned' }

export function Sidebar({ items, company, rtl }: { items: NavItem[]; company: string; rtl: boolean }) {
  const path = usePathname()
  const [collapsed, setCollapsed] = useState(false)
  const [open, setOpen] = useState(false)
  useEffect(() => { try { setCollapsed(localStorage.getItem('sf-sidebar') === '1') } catch {} }, [])
  useEffect(() => setOpen(false), [path])
  const toggle = () => setCollapsed(c => { try { localStorage.setItem('sf-sidebar', c ? '0' : '1') } catch {}; return !c })
  const active = (h: string) => (h === '/' ? path === '/' : path === h || path.startsWith(h + '/'))
  const Collapse = rtl ? PanelLeftOpen : PanelLeftClose, Expand = rtl ? PanelLeftClose : PanelLeftOpen

  const nav = (full: boolean) => <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 py-2">
    {items.map((i, n) => { const Icon = ICONS[i.key]; const head = n > 0 && items[n - 1].group !== i.group; return (<div key={i.key}>
      {head && (full ? <div className="px-2.5 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-wider text-muted/80">{i.group}</div> : <div className="mx-2 my-2 border-t border-border" />)}
      <Link href={i.href} title={i.status === 'planned' ? `${i.label} (planned)` : i.status === 'partial' ? `${i.label} (partially built)` : i.label} aria-current={active(i.href) ? 'page' : undefined}
        className={cn('group flex items-center gap-3 rounded-md px-2.5 py-2 text-sm transition-colors', active(i.href) ? 'bg-primary-soft font-medium text-primary' : 'text-muted hover:bg-surface-2 hover:text-fg')}>
        <Icon size={17} className="shrink-0" />
        {full && <span className="flex-1 truncate">{i.label}</span>}
        {full && i.status !== 'live' && <span className={cn('rounded px-1.5 text-[10px] font-medium uppercase tracking-wide', i.status === 'planned' ? 'bg-surface-2 text-muted' : 'bg-warning/15 text-warning')}>{i.status === 'planned' ? 'Soon' : 'Beta'}</span>}
      </Link></div>) })}
  </nav>
  const brand = (full: boolean) => <div className="flex h-14 items-center gap-2.5 border-b border-border px-4">
    <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-primary text-sm font-bold text-primary-fg">S</div>
    {full && <div className="min-w-0 leading-tight"><div className="text-sm font-semibold">SaqrFlow</div><div className="truncate text-[11px] text-muted">{company}</div></div>}</div>

  return <>
    <button aria-label="Open menu" className="fixed start-3 top-3 z-30 rounded-md border border-border bg-surface p-2 shadow-card lg:hidden" onClick={() => setOpen(true)}><Menu size={18} /></button>
    {open && <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setOpen(false)} />}
    <aside className={cn('fixed inset-y-0 start-0 z-50 flex w-64 flex-col border-e border-border bg-surface transition-transform lg:hidden', open ? 'translate-x-0' : rtl ? 'translate-x-full' : '-translate-x-full')}>
      <button aria-label="Close menu" className="absolute end-3 top-3 rounded p-1 text-muted" onClick={() => setOpen(false)}><X size={16} /></button>{brand(true)}{nav(true)}</aside>
    <aside className={cn('sticky top-0 hidden h-screen shrink-0 flex-col border-e border-border bg-surface transition-[width] duration-200 lg:flex', collapsed ? 'w-[60px]' : 'w-64')}>
      {brand(!collapsed)}{nav(!collapsed)}
      <button onClick={toggle} className="m-2 flex items-center gap-2 rounded-md px-2.5 py-2 text-xs text-muted hover:bg-surface-2" aria-label="Collapse sidebar">
        {collapsed ? <Expand size={16} /> : <><Collapse size={16} />Collapse</>}</button>
    </aside></>
}
