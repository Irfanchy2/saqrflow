'use client'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, m } from 'framer-motion'
import {
  SquaresFourIcon, SunHorizonIcon, TrayIcon, CalendarDotsIcon, FunnelIcon, BuildingsIcon, MapPinAreaIcon, ScrollIcon, ReceiptIcon, TruckIcon,
  HandCoinsIcon, PackageIcon, HardHatIcon, ClipboardTextIcon, NotebookIcon, CheckSquareOffsetIcon, VanIcon, WrenchIcon, WalletIcon, BankIcon,
  IdentificationBadgeIcon, MoneyWavyIcon, FilesIcon, VaultIcon, BellRingingIcon, BookOpenTextIcon, ChartLineUpIcon, SealCheckIcon, SparkleIcon, UserGearIcon,
  ClockCounterClockwiseIcon, TrashIcon, GearSixIcon, CubeIcon, ArrowsLeftRightIcon, CardholderIcon, MagnifyingGlassIcon, CaretDownIcon, XIcon,
} from '@phosphor-icons/react/dist/ssr'
import type { Icon } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { AveriqoMark } from '@/components/brand/logo'
import { EASE, T } from '@/components/motion'

/** One icon per module, all Phosphor (regular when idle, fill when it is the page you are on). */
export const ICONS: Record<string, Icon> = {
  overview: SquaresFourIcon, brief: SunHorizonIcon, inbox: TrayIcon, calendar: CalendarDotsIcon,
  leads: FunnelIcon, parties: BuildingsIcon, site_visits: MapPinAreaIcon, quotations: ScrollIcon, tax_invoices: ReceiptIcon, invoices: ReceiptIcon,
  delivery_notes: TruckIcon, payments: HandCoinsIcon, catalog: PackageIcon,
  projects: HardHatIcon, work_orders: ClipboardTextIcon, site_reports: NotebookIcon, tasks: CheckSquareOffsetIcon, assets: VanIcon, tickets: WrenchIcon,
  stock: CubeIcon, stock_moves: ArrowsLeftRightIcon,
  bank_accounts: CardholderIcon, expenses: WalletIcon, cheques: BankIcon,
  employees: IdentificationBadgeIcon, salary: MoneyWavyIcon, documents: FilesIcon, vault: VaultIcon, reminders: BellRingingIcon, kb: BookOpenTextIcon,
  reports: ChartLineUpIcon, approvals: SealCheckIcon, assistant: SparkleIcon,
  users: UserGearIcon, audit: ClockCounterClockwiseIcon, trash: TrashIcon, settings: GearSixIcon,
}
/** `tab`: the item opens one tab of a page (/invoices?tab=…) and is active only there. `fallback`: also active on that page when no tab is chosen. */
export interface NavItem { key: string; href: string; label: string; group: string; tab?: string; fallback?: boolean }

const FOLD_KEY = 'averiqo:nav-folded'
const fade = { duration: 0.14, ease: EASE }

/**
 * Phones and tablets: the full navigation in a slide-in drawer on the paper surface (desktop uses the top tabs,
 * components/layout/top-nav.tsx). The current page is the ink pill with a filled icon, as on the tabs; sections fold
 * (remembered per browser) and the section holding the current page always stays open.
 */
export function Sidebar({ items, company, rtl, user = '', role = '' }: { items: NavItem[]; company: string; rtl: boolean; user?: string; role?: string }) {
  const path = usePathname(), params = useSearchParams()
  const [open, setOpen] = useState(false)
  // the phone drawer's contents are built the first time it opens, not on every page (they doubled the HTML of each page)
  const [drawerReady, setDrawerReady] = useState(false)
  useEffect(() => { if (open) setDrawerReady(true) }, [open])
  const [folded, setFolded] = useState<string[]>([])
  useEffect(() => { try { setFolded(JSON.parse(localStorage.getItem(FOLD_KEY) ?? '[]')) } catch {} }, [])
  useEffect(() => setOpen(false), [path, params])
  useEffect(() => { const o = () => setOpen(true); addEventListener('averiqo:menu', o); return () => removeEventListener('averiqo:menu', o) }, [])
  useEffect(() => {   // drawer: Escape closes it, the page behind does not scroll
    if (!open) return
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden'; addEventListener('keydown', k)
    return () => { document.body.style.overflow = prev; removeEventListener('keydown', k) }
  }, [open])
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

  /** `rail`: the desktop sidebar is collapsed (labels hidden, tooltips on). `where` keeps the sliding highlight per instance. */
  const link = (i: NavItem, rail: boolean, where: string) => {
    const I = ICONS[i.key] ?? SquaresFourIcon, on = active(i)
    return <Link key={i.key} href={i.href} aria-label={rail ? i.label : undefined} aria-current={on ? 'page' : undefined}
      className={cn('nav-item', on ? 'text-ink-fg' : 'text-fg/80 hover:text-fg')}>
      {/* hover wash (static) and the active highlight (slides between items) */}
      {!on && <span aria-hidden className="nav-wash" />}
      {on && <m.span layoutId={`nav-on-${where}`} transition={{ duration: 0.26, ease: EASE }} aria-hidden
        className="absolute inset-0 rounded-[inherit] bg-ink shadow-[0_6px_16px_-8px_hsl(var(--shadow)/.6)]" />}
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
            className={cn('group/g flex h-7 w-full cursor-pointer items-center gap-1.5 rounded-full ps-[14px] pe-2 text-[11px] font-semibold uppercase tracking-[0.09em] text-muted transition-[color,opacity,background-color] duration-150 hover:bg-fg/[.04] hover:text-fg', rail && 'pointer-events-none opacity-0')}>
            <span className="flex-1 truncate text-start">{g.name}</span>
            {/* a folded section says how much it holds */}
            {isFolded && <span className="rounded-full bg-fg/[.07] px-1.5 text-[11px] font-semibold leading-4 tracking-normal tabular-nums text-muted">{g.items.length}</span>}
            <CaretDownIcon size={11} weight="bold" aria-hidden className={cn('opacity-40 transition-[transform,opacity] duration-200 group-hover/g:opacity-100 group-focus-visible/g:opacity-100', isFolded && '-rotate-90 rtl:rotate-90')} /></button>
          {/* in the rail a short rule marks where a section starts */}
          <span aria-hidden className={cn('absolute start-[14px] top-1/2 h-px w-3 bg-border transition-opacity duration-150', rail ? 'opacity-100' : 'opacity-0')} />
        </div>}
        <AnimatePresence initial={false}>{!isFolded && <m.div key="items" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22, ease: EASE }}
          className="flex flex-col gap-0.5 overflow-hidden">{g.items.map(i => link(i, rail, where))}</m.div>}</AnimatePresence>
      </div>
    })}
  </nav>
  const search = (rail: boolean) => <button type="button" onClick={() => dispatchEvent(new Event('saqrflow:palette'))} aria-label={rail ? 'Search (Ctrl K)' : undefined}
    className="group/s relative mx-3 mb-3 flex h-11 shrink-0 cursor-pointer items-center gap-3 rounded-full bg-surface ps-[14px] pe-3 text-[14px] text-muted shadow-card ring-1 ring-border/70 transition-colors duration-150 hover:text-fg">
    <MagnifyingGlassIcon size={18} aria-hidden className="shrink-0 transition-transform duration-200 group-hover/s:scale-110" />
    <m.span initial={false} animate={{ opacity: rail ? 0 : 1 }} transition={rail ? fade : { ...fade, delay: 0.06 }} className="flex min-w-0 flex-1 items-center justify-between gap-2 whitespace-nowrap">
      Search pages, customers, invoices…</m.span></button>
  const brand = (rail: boolean) => <Link href="/" className="flex min-w-0 items-center gap-2.5 rounded-lg" aria-label="Averiqo home">
    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-surface shadow-card ring-1 ring-white/70 dark:ring-white/[.06]"><AveriqoMark size={24} /></span>
    <m.span initial={false} animate={{ opacity: rail ? 0 : 1 }} transition={rail ? fade : { ...fade, delay: 0.06 }} className="min-w-0 whitespace-nowrap leading-tight">
      <span className="block text-[17px] font-bold tracking-[-0.02em]">Averiqo</span>
      <span className="block truncate text-[11.5px] text-muted" title={company}>{company}</span></m.span></Link>

  return <>
    {/* phones and tablets */}
    <AnimatePresence>{open && <m.div key="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={T.fast} className="fixed inset-0 z-40 bg-[hsl(var(--shadow)/.35)] backdrop-blur-[3px] lg:hidden" onClick={() => setOpen(false)} aria-hidden />}</AnimatePresence>
    <m.aside aria-label="Navigation" aria-hidden={!open} inert={!open} initial={false} animate={{ x: open ? 0 : rtl ? '100%' : '-100%' }} transition={{ duration: 0.28, ease: EASE }} style={{ x: rtl ? '100%' : '-100%' }}
      className="fixed inset-y-0 start-0 z-drawer flex w-[312px] max-w-[88vw] flex-col rounded-e-[28px] bg-bg text-fg shadow-pop lg:hidden">
      {(open || drawerReady) && <>
      <div className="flex h-[72px] shrink-0 items-center gap-2 ps-4 pe-3"><div className="min-w-0 flex-1">{brand(false)}</div>
        <button aria-label="Close menu" className="grid h-10 w-10 cursor-pointer place-items-center rounded-full bg-surface text-fg shadow-card ring-1 ring-border/70 transition-transform active:scale-95" onClick={() => setOpen(false)}><XIcon size={17} /></button></div>
      <Link href="/settings#account" className="mx-3 mb-3 flex items-center gap-3 rounded-2xl bg-surface p-3 shadow-card ring-1 ring-border/60 transition-colors hover:bg-surface-2">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[hsl(185_30%_86%)] text-[13px] font-semibold text-[hsl(190_30%_20%)] dark:bg-[hsl(185_20%_24%)] dark:text-[hsl(185_30%_88%)]" aria-hidden>{user.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('')}</span>
        <span className="min-w-0 leading-tight"><span className="block truncate text-[14px] font-semibold">{user}</span><span className="block truncate text-[12px] capitalize text-muted">{role.replace(/_/g, ' ')} · {company}</span></span></Link>
      {search(false)}
      {nav(false, 'drawer')}
      <div className="shrink-0 pb-[env(safe-area-inset-bottom)]" /></>}
    </m.aside>

  </>
}
