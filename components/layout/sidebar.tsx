'use client'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, m } from 'framer-motion'
import {
  SquaresFourIcon, SunHorizonIcon, TrayIcon, CalendarDotsIcon, FunnelIcon, BuildingsIcon, MapPinAreaIcon, ScrollIcon, ReceiptIcon, TruckIcon,
  HandCoinsIcon, PackageIcon, HardHatIcon, ClipboardTextIcon, NotebookIcon, CheckSquareOffsetIcon, VanIcon, WrenchIcon, WalletIcon, BankIcon,
  IdentificationBadgeIcon, FilesIcon, VaultIcon, BellRingingIcon, BookOpenTextIcon, ChartLineUpIcon, SealCheckIcon, SparkleIcon, UserGearIcon,
  ClockCounterClockwiseIcon, TrashIcon, GearSixIcon, SidebarSimpleIcon, MagnifyingGlassIcon, CaretDownIcon, XIcon,
} from '@phosphor-icons/react/dist/ssr'
import type { Icon } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { AveriqoMark } from '@/components/brand/logo'
import { SIDEBAR_COOKIE } from '@/lib/ui-prefs'
import { EASE, T } from '@/components/motion'

/** One icon per module, all Phosphor (regular when idle, fill when it is the page you are on). */
export const ICONS: Record<string, Icon> = {
  overview: SquaresFourIcon, brief: SunHorizonIcon, inbox: TrayIcon, calendar: CalendarDotsIcon,
  leads: FunnelIcon, parties: BuildingsIcon, site_visits: MapPinAreaIcon, quotations: ScrollIcon, tax_invoices: ReceiptIcon, invoices: ReceiptIcon,
  delivery_notes: TruckIcon, payments: HandCoinsIcon, catalog: PackageIcon,
  projects: HardHatIcon, work_orders: ClipboardTextIcon, site_reports: NotebookIcon, tasks: CheckSquareOffsetIcon, assets: VanIcon, tickets: WrenchIcon,
  expenses: WalletIcon, cheques: BankIcon,
  employees: IdentificationBadgeIcon, documents: FilesIcon, vault: VaultIcon, reminders: BellRingingIcon, kb: BookOpenTextIcon,
  reports: ChartLineUpIcon, approvals: SealCheckIcon, assistant: SparkleIcon,
  users: UserGearIcon, audit: ClockCounterClockwiseIcon, trash: TrashIcon, settings: GearSixIcon,
}
/** `tab`: the item opens one tab of a page (/invoices?tab=…) and is active only there. `fallback`: also active on that page when no tab is chosen. */
export interface NavItem { key: string; href: string; label: string; group: string; tab?: string; fallback?: boolean }

const W_OPEN = 244, W_RAIL = 64
const FOLD_KEY = 'averiqo:nav-folded'
const fade = { duration: 0.14, ease: EASE }

/**
 * Navigation on a deep navy surface (same in light and dark themes).
 * - The current page carries a soft highlight that slides from item to item, and its icon switches to the filled weight.
 * - Sections fold (remembered per browser); the section holding the current page always stays open.
 * - Desktop: 244 px ↔ 64 px icon rail. Icons keep their exact position while the labels fade, so collapsing never jumps.
 *   The choice is a cookie, so the server renders the right width (no flash). Ctrl+\ toggles.
 * - Phones and tablets: the same navigation in a slide-in drawer.
 */
export function Sidebar({ items, company, rtl, initialCollapsed = false, user = '', role = '' }: { items: NavItem[]; company: string; rtl: boolean; initialCollapsed?: boolean; user?: string; role?: string }) {
  const path = usePathname(), params = useSearchParams()
  const [collapsed, setCollapsed] = useState(initialCollapsed)
  const [open, setOpen] = useState(false)
  // the phone drawer's contents are built the first time it opens, not on every page (they doubled the HTML of each page)
  const [drawerReady, setDrawerReady] = useState(false)
  useEffect(() => { if (open) setDrawerReady(true) }, [open])
  const [folded, setFolded] = useState<string[]>([])
  const [tip, setTip] = useState<{ label: string; top: number } | null>(null)
  const tipTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => { try { setFolded(JSON.parse(localStorage.getItem(FOLD_KEY) ?? '[]')) } catch {} }, [])
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
  const toggleGroup = (g: string) => setFolded(xs => { const n = xs.includes(g) ? xs.filter(x => x !== g) : [...xs, g]; try { localStorage.setItem(FOLD_KEY, JSON.stringify(n)) } catch {} return n })
  const toggle = () => { setCollapsed(c => !c); setTip(null) }
  const showTip = (label: string, el: HTMLElement) => { clearTimeout(tipTimer.current); const top = el.getBoundingClientRect().top + el.offsetHeight / 2; tipTimer.current = setTimeout(() => setTip({ label, top }), 90) }
  const hideTip = () => { clearTimeout(tipTimer.current); setTip(null) }

  /** `rail`: the desktop sidebar is collapsed (labels hidden, tooltips on). `where` keeps the sliding highlight per instance. */
  const link = (i: NavItem, rail: boolean, where: string) => {
    const I = ICONS[i.key] ?? SquaresFourIcon, on = active(i)
    return <Link key={i.key} href={i.href} aria-label={rail ? i.label : undefined} aria-current={on ? 'page' : undefined}
      onMouseEnter={e => { if (rail) showTip(i.label, e.currentTarget) }} onMouseLeave={hideTip}
      onFocus={e => { if (rail) showTip(i.label, e.currentTarget) }} onBlur={hideTip}
      className={cn('nav-item', on ? 'font-medium text-white' : 'text-sb-muted hover:text-sb-fg')}>
      {/* hover wash (static) and the active highlight (slides between items) */}
      {!on && <span aria-hidden className="nav-wash" />}
      {on && <m.span layoutId={`nav-on-${where}`} transition={{ duration: 0.26, ease: EASE }} aria-hidden
        className="absolute inset-0 rounded-[inherit] bg-[linear-gradient(90deg,hsl(var(--sb-accent)/.26),hsl(var(--sb-accent)/.10))] ring-1 ring-inset ring-sb-accent/25">
        <span className="absolute inset-y-2 start-0 w-[3px] rounded-e-full bg-sb-accent" /></m.span>}
      <I size={19} weight={on ? 'fill' : 'regular'} aria-hidden
        className={cn('nav-ico', on && 'is-on')} />
      <m.span initial={false} animate={{ opacity: rail ? 0 : 1 }} transition={rail ? fade : { ...fade, delay: 0.06 }} className="relative min-w-0 flex-1 truncate">{i.label}</m.span>
    </Link>
  }
  const nav = (rail: boolean, where: string) => <nav className="sb-scroll flex flex-1 flex-col overflow-y-auto overflow-x-hidden px-3 pb-3 pt-1" aria-label="Main">
    {groups.map(g => {
      const hasActive = g.items.some(i => active(i)), isFolded = !rail && !!g.name && folded.includes(g.name) && !hasActive
      return <div key={g.name || '_'} className={cn(g.name && 'mt-2.5')}>
        {g.name && <div className="relative h-7">
          <button type="button" onClick={() => toggleGroup(g.name)} aria-expanded={!isFolded} tabIndex={rail ? -1 : 0} aria-hidden={rail || undefined}
            className={cn('group/g flex h-7 w-full cursor-pointer items-center gap-1.5 rounded-md ps-[10px] pe-2 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-sb-muted/60 transition-[color,opacity,background-color] duration-150 hover:bg-white/[.03] hover:text-sb-fg', rail && 'pointer-events-none opacity-0')}>
            <span className="flex-1 truncate text-start">{g.name}</span>
            {/* a folded section says how much it holds */}
            {isFolded && <span className="rounded-full bg-white/[.07] px-1.5 text-[10px] font-semibold leading-4 tracking-normal tabular-nums text-sb-muted">{g.items.length}</span>}
            <CaretDownIcon size={11} weight="bold" aria-hidden className={cn('opacity-40 transition-[transform,opacity] duration-200 group-hover/g:opacity-100 group-focus-visible/g:opacity-100', isFolded && '-rotate-90 rtl:rotate-90')} /></button>
          {/* in the rail a short rule marks where a section starts */}
          <span aria-hidden className={cn('absolute start-[14px] top-1/2 h-px w-3 bg-sb-line transition-opacity duration-150', rail ? 'opacity-100' : 'opacity-0')} />
        </div>}
        <AnimatePresence initial={false}>{!isFolded && <m.div key="items" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22, ease: EASE }}
          className="flex flex-col gap-0.5 overflow-hidden">{g.items.map(i => link(i, rail, where))}</m.div>}</AnimatePresence>
      </div>
    })}
  </nav>
  const search = (rail: boolean) => <button type="button" onClick={() => dispatchEvent(new Event('saqrflow:palette'))} aria-label={rail ? 'Search (Ctrl K)' : undefined}
    onMouseEnter={e => { if (rail) showTip('Search  ·  Ctrl K', e.currentTarget) }} onMouseLeave={hideTip}
    className="group/s relative mx-3 mb-2 flex h-9 shrink-0 cursor-pointer items-center gap-3 rounded-[10px] bg-white/[.04] ps-[10px] pe-2 text-[13px] text-sb-muted ring-1 ring-inset ring-white/[.06] transition-colors duration-150 hover:bg-white/[.07] hover:text-sb-fg">
    <MagnifyingGlassIcon size={18} aria-hidden className="shrink-0 transition-transform duration-200 group-hover/s:scale-110" />
    <m.span initial={false} animate={{ opacity: rail ? 0 : 1 }} transition={rail ? fade : { ...fade, delay: 0.06 }} className="flex min-w-0 flex-1 items-center justify-between gap-2 whitespace-nowrap">
      Search<kbd className="rounded-md bg-white/[.07] px-1.5 py-px font-sans text-[10.5px] text-sb-muted">Ctrl K</kbd></m.span></button>
  const brand = (rail: boolean) => <Link href="/" className="flex min-w-0 items-center gap-2.5 rounded-lg" aria-label="Averiqo home">
    <AveriqoMark size={30} className="shrink-0" />
    <m.span initial={false} animate={{ opacity: rail ? 0 : 1 }} transition={rail ? fade : { ...fade, delay: 0.06 }} className="min-w-0 whitespace-nowrap leading-tight">
      <span className="block text-[17px] font-bold tracking-[-0.02em] text-white">Averiqo</span>
      <span className="block truncate text-[11px] text-sb-muted" title={company}>{company}</span></m.span></Link>
  const Toggle = SidebarSimpleIcon

  return <>
    {/* phones and tablets */}
    <AnimatePresence>{open && <m.div key="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={T.fast} className="fixed inset-0 z-40 bg-[hsl(222_40%_4%/.5)] backdrop-blur-[2px] lg:hidden" onClick={() => setOpen(false)} aria-hidden />}</AnimatePresence>
    <m.aside aria-label="Navigation" aria-hidden={!open} inert={!open} initial={false} animate={{ x: open ? 0 : rtl ? '100%' : '-100%' }} transition={{ duration: 0.28, ease: EASE }} style={{ x: rtl ? '100%' : '-100%' }}
      className="sb fixed inset-y-0 start-0 z-drawer flex w-[300px] max-w-[86vw] flex-col bg-sb text-sb-fg shadow-pop lg:hidden">
      {(open || drawerReady) && <>
      <div className="flex h-16 shrink-0 items-center gap-2 ps-[22px] pe-2"><div className="min-w-0 flex-1">{brand(false)}</div>
        <button aria-label="Close menu" className="grid h-10 w-10 cursor-pointer place-items-center rounded-lg text-sb-muted transition-colors hover:bg-white/[.06] hover:text-sb-fg" onClick={() => setOpen(false)}><XIcon size={18} /></button></div>
      <Link href="/settings#account" className="mx-3 mb-3 flex items-center gap-3 rounded-xl bg-white/[.04] p-2.5 ring-1 ring-inset ring-white/[.06] transition-colors hover:bg-white/[.07]">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-primary to-[hsl(var(--sb-accent))] text-[12px] font-semibold text-white" aria-hidden>{user.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('')}</span>
        <span className="min-w-0 leading-tight"><span className="block truncate text-[13.5px] font-semibold text-white">{user}</span><span className="block truncate text-[11.5px] capitalize text-sb-muted">{role.replace(/_/g, ' ')} · {company}</span></span></Link>
      {search(false)}
      {nav(false, 'drawer')}
      <div className="shrink-0 pb-[env(safe-area-inset-bottom)]" /></>}
    </m.aside>

    {/* desktop */}
    <m.aside aria-label="Navigation" data-collapsed={collapsed} initial={false} animate={{ width: collapsed ? W_RAIL : W_OPEN }} transition={{ duration: 0.26, ease: EASE }} style={{ width: collapsed ? W_RAIL : W_OPEN }}
      className="sb group/sb no-print sticky top-0 hidden h-[100dvh] shrink-0 flex-col overflow-hidden border-e border-white/[.04] bg-sb text-sb-fg lg:flex">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[radial-gradient(120%_80%_at_0%_0%,hsl(var(--sb-accent)/.10),transparent_70%)]" />
      <div className="relative flex h-16 shrink-0 items-center ps-[17px] pe-3">{brand(collapsed)}</div>
      <div className="relative flex min-h-0 flex-1 flex-col">
        {search(collapsed)}
        {nav(collapsed, 'side')}
      </div>
      <div className="relative shrink-0 border-t border-white/[.05] px-3 py-2.5">
        <button type="button" onClick={toggle} aria-expanded={!collapsed} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={`${collapsed ? 'Expand' : 'Collapse'} sidebar (Ctrl+\\)`}
          onMouseEnter={e => { if (collapsed) showTip('Expand  ·  Ctrl \\', e.currentTarget) }} onMouseLeave={hideTip}
          className="group/t flex h-9 w-full cursor-pointer items-center gap-3 rounded-[10px] ps-[10px] text-[13px] text-sb-muted transition-colors duration-150 hover:bg-white/[.045] hover:text-sb-fg">
          <Toggle size={20} aria-hidden className={cn('shrink-0 transition-transform duration-300 ease-out', collapsed !== rtl && 'rotate-180')} />
          <m.span initial={false} animate={{ opacity: collapsed ? 0 : 1 }} transition={collapsed ? fade : { ...fade, delay: 0.06 }} className="flex flex-1 items-center justify-between whitespace-nowrap pe-1.5">
            Collapse<kbd className="font-sans text-[10.5px] text-sb-muted/70">Ctrl \</kbd></m.span></button>
      </div>
    </m.aside>
    <AnimatePresence>{collapsed && tip && <m.div key={tip.label} role="tooltip" initial={{ opacity: 0, x: rtl ? 6 : -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, transition: { duration: 0.08 } }} transition={{ duration: 0.16, ease: EASE }}
      className="pointer-events-none fixed start-[72px] z-toast whitespace-nowrap rounded-lg bg-[hsl(223_45%_8%)] px-2.5 py-1.5 text-[12.5px] font-medium text-white shadow-pop ring-1 ring-white/[.08]" style={{ top: tip.top, y: '-50%' }}>
      <span aria-hidden className="absolute -start-1 top-1/2 h-2 w-2 -translate-y-1/2 rotate-45 bg-[hsl(223_45%_8%)]" />{tip.label}</m.div>}</AnimatePresence>
  </>
}
