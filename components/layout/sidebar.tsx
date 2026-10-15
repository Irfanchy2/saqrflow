'use client'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, m } from 'framer-motion'
import { Inbox, LayoutDashboard, FileText, Users, Vault, Landmark, Receipt, HardHat, Handshake, Truck, BellRing, CalendarDays, BarChart3, Sparkles, ShieldCheck, Settings, PanelLeftClose, PanelLeftOpen, X, Wallet, Package, History, Trash2, Target, MapPinned, ClipboardList, ListTodo, ClipboardCheck, BadgeCheck, Sunrise, Wrench, BookOpen, ScrollText, PackageCheck, Banknote, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AveriqoMark } from '@/components/brand/logo'
import { SIDEBAR_COOKIE } from '@/lib/ui-prefs'
import { T } from '@/components/motion'

export const ICONS = { approvals: BadgeCheck, brief: Sunrise, tickets: Wrench, kb: BookOpen, inbox: Inbox, overview: LayoutDashboard, documents: FileText, employees: Users, vault: Vault, cheques: Landmark, invoices: Receipt, projects: HardHat, parties: Handshake, assets: Truck, reminders: BellRing, calendar: CalendarDays, reports: BarChart3, assistant: Sparkles, users: ShieldCheck, settings: Settings, expenses: Wallet, catalog: Package, audit: History, trash: Trash2, leads: Target, site_visits: MapPinned, work_orders: ClipboardList, tasks: ListTodo, site_reports: ClipboardCheck, quotations: ScrollText, tax_invoices: Receipt, delivery_notes: PackageCheck, payments: Banknote }
/** `tab`: the item opens one tab of a page (/invoices?tab=…) and is active only there. `fallback`: also active on that page when no tab is chosen. */
export interface NavItem { key: keyof typeof ICONS; href: string; label: string; group: string; tab?: string; fallback?: boolean }

const W_OPEN = 256, W_RAIL = 68

/**
 * Navigation on a deep navy surface (same in light and dark themes): brand, sections with small uppercase labels,
 * the current page as a filled blue pill. Desktop: full sidebar ↔ 68 px icon rail with tooltips; the choice is a cookie,
 * so the server renders the right width (no flash). Phone / tablet: the same navigation in a slide-in drawer. Ctrl+\ toggles.
 */
export function Sidebar({ items, company, rtl, initialCollapsed = false, user = '', role = '' }: { items: NavItem[]; company: string; rtl: boolean; initialCollapsed?: boolean; user?: string; role?: string }) {
  const path = usePathname(), params = useSearchParams()
  const [collapsed, setCollapsed] = useState(initialCollapsed)
  const [open, setOpen] = useState(false)
  const [tip, setTip] = useState<{ label: string; top: number } | null>(null)
  useEffect(() => setOpen(false), [path, params])
  useEffect(() => { const o = () => setOpen(true); addEventListener('averiqo:menu', o); return () => removeEventListener('averiqo:menu', o) }, [])
  useEffect(() => {   // drawer: Escape closes it, the page behind does not scroll
    if (!open) return
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden'; addEventListener('keydown', k)
    return () => { document.body.style.overflow = prev; removeEventListener('keydown', k) }
  }, [open])
  const first = useRef(true)
  useEffect(() => {
    if (first.current) { first.current = false; return }
    document.cookie = `${SIDEBAR_COOKIE}=${collapsed ? '1' : '0'}; path=/; max-age=31536000; samesite=lax`
  }, [collapsed])
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === '\\') { e.preventDefault(); setCollapsed(c => !c); setTip(null) } }
    addEventListener('keydown', k); return () => removeEventListener('keydown', k)
  }, [])
  const active = (i: NavItem) => {
    const base = i.href.split('?')[0]
    if (i.tab) { const cur = params.get('tab'); return path === base && (cur === i.tab || (!cur && !!i.fallback)) }
    return base === '/' ? path === '/' : path === base || path.startsWith(base + '/')
  }
  const groups = useMemo(() => {
    const out: { name: string; items: NavItem[] }[] = []
    for (const i of items) { const last = out[out.length - 1]; if (last && last.name === i.group) last.items.push(i); else out.push({ name: i.group, items: [i] }) }
    return out
  }, [items])
  const Collapse = rtl ? PanelLeftOpen : PanelLeftClose, Expand = rtl ? PanelLeftClose : PanelLeftOpen
  const showTip = (label: string, el: HTMLElement) => setTip({ label, top: el.getBoundingClientRect().top + el.offsetHeight / 2 })

  const link = (i: NavItem, full: boolean) => {
    const Icon = ICONS[i.key], on = active(i)
    return <Link key={i.key} href={i.href} aria-label={full ? undefined : i.label} aria-current={on ? 'page' : undefined}
      onMouseEnter={e => { if (!full) showTip(i.label, e.currentTarget) }} onMouseLeave={() => setTip(null)}
      onFocus={e => { if (!full) showTip(i.label, e.currentTarget) }} onBlur={() => setTip(null)}
      className={cn('group/l flex h-11 shrink-0 items-center gap-3 rounded-lg text-[14.5px] transition-colors duration-150 lg:h-10 lg:text-[14px]', full ? 'px-3' : 'mx-auto w-11 justify-center px-0',
        on ? 'bg-sb-accent font-medium text-white shadow-[0_6px_16px_-8px_hsl(var(--sb-accent)/.8)]' : 'text-sb-muted hover:bg-white/[.06] hover:text-sb-fg')}>
      <Icon size={18} strokeWidth={1.8} className={cn('shrink-0', on ? 'text-white' : 'text-sb-muted group-hover/l:text-sb-fg')} aria-hidden />
      {full && <span className="flex-1 truncate">{i.label}</span>}
    </Link>
  }
  const nav = (full: boolean) => <nav className="sb-scroll flex flex-1 flex-col overflow-y-auto overflow-x-hidden px-3 pb-4 pt-1" aria-label="Main">
    {groups.map((g, gi) => <div key={g.name || '_'} className={cn(gi > 0 && (full ? 'mt-5' : 'mt-3 border-t border-sb-line pt-3'))}>
      {full && g.name && <div className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-sb-muted/75">{g.name}</div>}
      <div className="flex flex-col gap-0.5">{g.items.map(i => link(i, full))}</div>
    </div>)}
  </nav>
  const brand = <Link href="/" className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg">
    <AveriqoMark size={34} className="shrink-0" />
    <span className="min-w-0 leading-tight"><span className="block text-[19px] font-bold tracking-[-0.02em] text-white">Averiqo</span>
      <span className="block truncate text-[11px] text-sb-muted">Business Operating System</span></span></Link>
  const search = <button type="button" onClick={() => dispatchEvent(new Event('saqrflow:palette'))}
    className="flex h-9 w-full cursor-pointer items-center gap-2 rounded-lg bg-sb-accent px-3 text-[13px] font-medium text-white transition-colors hover:bg-sb-accent/90">
    <Search size={14} aria-hidden /><span className="flex-1 text-start">Quick search</span><kbd className="rounded bg-white/15 px-1.5 font-sans text-[11px]">Ctrl K</kbd></button>

  return <>
    <AnimatePresence>{open && <m.div key="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={T.fast} className="fixed inset-0 z-40 bg-[hsl(222_40%_4%/.5)] lg:hidden" onClick={() => setOpen(false)} aria-hidden />}</AnimatePresence>
    <m.aside aria-label="Navigation" aria-hidden={!open} inert={!open} initial={false} animate={{ x: open ? 0 : rtl ? '100%' : '-100%' }} transition={T.base} style={{ x: rtl ? '100%' : '-100%' }}
      className="sb fixed inset-y-0 start-0 z-drawer flex w-[300px] max-w-[86vw] flex-col bg-sb text-sb-fg shadow-pop lg:hidden">
      <div className="flex h-16 shrink-0 items-center gap-2.5 ps-4 pe-2">{brand}
        <button aria-label="Close menu" className="grid h-10 w-10 cursor-pointer place-items-center rounded-lg text-sb-muted hover:bg-white/[.06] hover:text-sb-fg" onClick={() => setOpen(false)}><X size={18} /></button></div>
      <Link href="/settings#account" className="mx-3 mb-2 flex items-center gap-3 rounded-xl bg-sb-2/70 p-3 ring-1 ring-inset ring-sb-line">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-primary to-[hsl(var(--sb-accent))] text-[13px] font-semibold text-white" aria-hidden>{user.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('')}</span>
        <span className="min-w-0 leading-tight"><span className="block truncate text-[14px] font-semibold text-white">{user}</span><span className="block truncate text-xs capitalize text-sb-muted">{role.replace(/_/g, ' ')} · {company}</span></span></Link>
      {nav(true)}
      <div className="shrink-0 pb-[env(safe-area-inset-bottom)]" />
    </m.aside>

    <m.aside aria-label="Navigation" data-collapsed={collapsed} initial={false} animate={{ width: collapsed ? W_RAIL : W_OPEN }} transition={T.base} style={{ width: collapsed ? W_RAIL : W_OPEN }}
      className="sb no-print sticky top-0 hidden h-[100dvh] shrink-0 flex-col overflow-hidden bg-sb text-sb-fg lg:flex">
      <div className={cn('flex h-[72px] shrink-0 items-center', collapsed ? 'justify-center px-2' : 'gap-2 ps-5 pe-3')}>
        {!collapsed && brand}
        <button type="button" onClick={() => { setCollapsed(c => !c); setTip(null) }} aria-expanded={!collapsed} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={`${collapsed ? 'Expand' : 'Collapse'} sidebar (Ctrl+\\)`}
          className={cn('group grid shrink-0 cursor-pointer place-items-center rounded-lg text-sb-muted transition-colors hover:bg-white/[.06] hover:text-sb-fg', collapsed ? 'h-11 w-11' : 'h-8 w-8')}>
          {collapsed
            ? <><AveriqoMark size={32} className="col-start-1 row-start-1 transition-opacity group-hover:opacity-0 group-focus-visible:opacity-0" /><Expand size={18} className="col-start-1 row-start-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" /></>
            : <Collapse size={17} />}</button>
      </div>
      {nav(!collapsed)}
      {!collapsed && <div className="shrink-0 p-3"><div className="rounded-xl border border-sb-line bg-sb-2/60 p-3.5">
        <div className="truncate text-[13px] font-semibold text-sb-fg" title={company}>{company}</div>
        <p className="mb-3 mt-0.5 text-xs leading-relaxed text-sb-muted">Find any customer, invoice, person or vehicle.</p>{search}</div></div>}
    </m.aside>
    <AnimatePresence>{collapsed && tip && <m.div key={tip.label} role="tooltip" initial={{ opacity: 0, x: rtl ? 4 : -4 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={T.fast}
      className="pointer-events-none fixed start-[76px] z-toast whitespace-nowrap rounded-md bg-sb px-2.5 py-1.5 text-xs font-medium text-sb-fg shadow-pop ring-1 ring-white/[.08]" style={{ top: tip.top, y: '-50%' }}>{tip.label}</m.div>}</AnimatePresence>
  </>
}
