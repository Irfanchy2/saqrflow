'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, m } from 'framer-motion'
import { Inbox, LayoutDashboard, FileText, Users, Vault, Landmark, Receipt, HardHat, Handshake, Truck, BellRing, CalendarDays, BarChart3, Sparkles, ShieldCheck, Settings, PanelLeftClose, PanelLeftOpen, X, LogOut, Wallet, Package, History, Trash2, Target, MapPinned, ClipboardList, ListTodo, ClipboardCheck, BadgeCheck, Sunrise, Wrench, BookOpen, ChevronDown, Moon, Sun } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AveriqoLogo, AveriqoMark } from '@/components/brand/logo'
import { signOut } from '@/app/actions/auth'
import { SIDEBAR_COOKIE } from '@/lib/ui-prefs'
import { T } from '@/components/motion'

const ICONS = { approvals: BadgeCheck, brief: Sunrise, tickets: Wrench, kb: BookOpen, inbox: Inbox, overview: LayoutDashboard, documents: FileText, employees: Users, vault: Vault, cheques: Landmark, invoices: Receipt, projects: HardHat, parties: Handshake, assets: Truck, reminders: BellRing, calendar: CalendarDays, reports: BarChart3, assistant: Sparkles, users: ShieldCheck, settings: Settings, expenses: Wallet, catalog: Package, audit: History, trash: Trash2, leads: Target, site_visits: MapPinned, work_orders: ClipboardList, tasks: ListTodo, site_reports: ClipboardCheck }
export interface NavItem { key: keyof typeof ICONS; href: string; label: string; group: string }

const W_OPEN = 248, W_RAIL = 60
const GROUPS_KEY = 'averiqo:nav-closed'
const initials = (s: string) => s.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('') || '·'

/**
 * Navigation on a deep navy surface (same in light and dark themes).
 * Desktop: full sidebar ↔ 60 px icon rail with tooltips; the choice is a cookie, so the server renders the right width (no flash).
 * Sections can be folded (remembered per browser). Phone / tablet: the same navigation in a slide-in drawer. Ctrl+\ toggles.
 */
export function Sidebar({ items, company, rtl, initialCollapsed = false, user = '', role = '' }: { items: NavItem[]; company: string; rtl: boolean; initialCollapsed?: boolean; user?: string; role?: string }) {
  const path = usePathname()
  const [collapsed, setCollapsed] = useState(initialCollapsed)
  const [open, setOpen] = useState(false)
  const [tip, setTip] = useState<{ label: string; top: number } | null>(null)
  const [closed, setClosed] = useState<string[]>([])
  const [dark, setDark] = useState(false)
  useEffect(() => { try { setClosed(JSON.parse(localStorage.getItem(GROUPS_KEY) ?? '[]')) } catch {} setDark(document.documentElement.classList.contains('dark')) }, [])
  useEffect(() => setOpen(false), [path])
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
  const toggleGroup = (g: string) => setClosed(xs => { const n = xs.includes(g) ? xs.filter(x => x !== g) : [...xs, g]; try { localStorage.setItem(GROUPS_KEY, JSON.stringify(n)) } catch {} return n })
  const toggleTheme = () => { const next = !dark; setDark(next); document.documentElement.classList.toggle('dark', next); try { localStorage.setItem('sf-theme', next ? 'dark' : 'light') } catch {} }
  const active = (h: string) => (h === '/' ? path === '/' : path === h || path.startsWith(h + '/'))
  const groups = useMemo(() => {
    const out: { name: string; items: NavItem[] }[] = []
    for (const i of items) { const last = out[out.length - 1]; if (last && last.name === i.group) last.items.push(i); else out.push({ name: i.group, items: [i] }) }
    return out
  }, [items])
  const Collapse = rtl ? PanelLeftOpen : PanelLeftClose, Expand = rtl ? PanelLeftClose : PanelLeftOpen
  const showTip = (label: string, el: HTMLElement) => setTip({ label, top: el.getBoundingClientRect().top + el.offsetHeight / 2 })

  const link = (i: NavItem, full: boolean, where: string) => {
    const Icon = ICONS[i.key], on = active(i.href)
    return <Link key={i.key} href={i.href} aria-label={full ? undefined : i.label} aria-current={on ? 'page' : undefined}
      onMouseEnter={e => { if (!full) showTip(i.label, e.currentTarget) }} onMouseLeave={() => setTip(null)}
      onFocus={e => { if (!full) showTip(i.label, e.currentTarget) }} onBlur={() => setTip(null)}
      className={cn('group/l relative flex h-11 shrink-0 items-center gap-3 rounded-md text-[15px] transition-colors duration-150 lg:h-8 lg:text-[13.5px]', full ? 'px-2.5' : 'justify-center px-0',
        on ? 'bg-sb-2 font-medium text-white' : 'text-sb-muted hover:bg-white/[.05] hover:text-sb-fg')}>
      {on && <m.span layoutId={`nav-active-${where}`} transition={T.base} aria-hidden className="absolute inset-y-1.5 start-0 w-[2px] rounded-full bg-sb-accent" />}
      <Icon size={16} strokeWidth={1.8} className={cn('shrink-0 transition-colors', on ? 'text-sb-accent' : 'text-sb-muted group-hover/l:text-sb-fg')} aria-hidden />
      {full && <span className="flex-1 truncate">{i.label}</span>}
    </Link>
  }
  const nav = (full: boolean, where: string) => <nav className="sb-scroll flex flex-1 flex-col overflow-y-auto overflow-x-hidden px-2.5 pb-3 pt-1" aria-label="Main">
    {groups.map((g, gi) => {
      const folded = full && !!g.name && closed.includes(g.name) && !g.items.some(i => active(i.href))
      return <div key={g.name || '_'} className={cn(gi > 0 && (full ? 'mt-3' : 'mt-2 border-t border-sb-line pt-2'))}>
        {full && g.name && <button type="button" onClick={() => toggleGroup(g.name)} aria-expanded={!folded}
          className="flex h-7 w-full cursor-pointer items-center gap-1 rounded px-2.5 text-[11.5px] font-medium tracking-[0.01em] text-sb-muted/80 transition-colors hover:text-sb-fg">
          <span className="flex-1 text-start">{g.name}</span><ChevronDown size={13} className={cn('transition-transform duration-200', folded && '-rotate-90')} aria-hidden /></button>}
        <AnimatePresence initial={false}>
          {!folded && <m.div key="items" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={T.base} className="flex flex-col gap-px overflow-hidden">
            {g.items.map(i => link(i, full, where))}</m.div>}
        </AnimatePresence>
      </div>
    })}
  </nav>
  const me = (full: boolean) => <div className={cn('shrink-0 border-t border-sb-line p-2.5', !full && 'flex flex-col items-center')}>
    <div className={cn('flex items-center', full ? 'gap-2 rounded-md ps-1' : 'flex-col gap-1')}>
      <span title={full ? undefined : user} className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-sb-2 text-[12px] font-semibold text-sb-fg ring-1 ring-inset ring-white/[.06]" aria-hidden>{initials(user)}</span>
      {full && <span className="min-w-0 flex-1 ps-0.5 leading-tight"><span className="block truncate text-[13px] font-medium text-sb-fg">{user}</span><span className="block truncate text-[11.5px] capitalize text-sb-muted">{role.replace(/_/g, ' ')}</span></span>}
      <button type="button" onClick={toggleTheme} aria-label="Toggle dark mode" title={dark ? 'Light theme' : 'Dark theme'} className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-md text-sb-muted transition-colors hover:bg-white/[.06] hover:text-sb-fg lg:h-8 lg:w-8">{dark ? <Sun size={15} /> : <Moon size={15} />}</button>
      <form action={signOut} data-signout><button aria-label="Sign out" title="Sign out" className="grid h-9 w-9 cursor-pointer place-items-center rounded-md text-sb-muted transition-colors hover:bg-white/[.06] hover:text-sb-fg lg:h-8 lg:w-8"><LogOut size={15} /></button></form>
    </div></div>
  const brand = <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 leading-tight"><AveriqoLogo height={20} tone="dark" /><span className="sr-only">Averiqo</span>
    <span className="truncate text-[11.5px] text-sb-muted" title={company}>{company}</span></div>

  return <>
    <AnimatePresence>{open && <m.div key="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={T.fast} className="fixed inset-0 z-40 bg-[hsl(222_40%_4%/.5)] lg:hidden" onClick={() => setOpen(false)} aria-hidden />}</AnimatePresence>
    <m.aside aria-label="Navigation" aria-hidden={!open} inert={!open} initial={false} animate={{ x: open ? 0 : rtl ? '100%' : '-100%' }} transition={T.base} style={{ x: rtl ? '100%' : '-100%' }}
      className="sb fixed inset-y-0 start-0 z-drawer flex w-[300px] max-w-[86vw] flex-col bg-sb text-sb-fg shadow-pop lg:hidden">
      <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-sb-line ps-4 pe-2">{brand}
        <button aria-label="Close menu" className="grid h-10 w-10 cursor-pointer place-items-center rounded-md text-sb-muted hover:bg-white/[.06] hover:text-sb-fg" onClick={() => setOpen(false)}><X size={18} /></button></div>
      {nav(true, 'drawer')}
      <div className="pb-[env(safe-area-inset-bottom)]">{me(true)}</div>
    </m.aside>

    <m.aside aria-label="Navigation" data-collapsed={collapsed} initial={false} animate={{ width: collapsed ? W_RAIL : W_OPEN }} transition={T.base} style={{ width: collapsed ? W_RAIL : W_OPEN }}
      className="sb no-print sticky top-0 hidden h-[100dvh] shrink-0 flex-col overflow-hidden bg-sb text-sb-fg lg:flex">
      <div className={cn('flex h-14 shrink-0 items-center', collapsed ? 'justify-center px-2' : 'gap-2 ps-4 pe-2')}>
        {!collapsed && brand}
        <button type="button" onClick={() => { setCollapsed(c => !c); setTip(null) }} aria-expanded={!collapsed} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={`${collapsed ? 'Expand' : 'Collapse'} sidebar (Ctrl+\\)`}
          className={cn('group grid shrink-0 cursor-pointer place-items-center rounded-md text-sb-muted transition-colors hover:bg-white/[.06] hover:text-sb-fg', collapsed ? 'h-10 w-10' : 'h-8 w-8')}>
          {collapsed
            ? <><AveriqoMark size={28} className="col-start-1 row-start-1 transition-opacity group-hover:opacity-0 group-focus-visible:opacity-0" /><Expand size={17} className="col-start-1 row-start-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" /></>
            : <Collapse size={17} />}</button>
      </div>
      {nav(!collapsed, 'side')}
      {me(!collapsed)}
    </m.aside>
    <AnimatePresence>{collapsed && tip && <m.div key={tip.label} role="tooltip" initial={{ opacity: 0, x: rtl ? 4 : -4 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={T.fast}
      className="pointer-events-none fixed start-[68px] z-toast whitespace-nowrap rounded-md bg-sb px-2.5 py-1.5 text-xs font-medium text-sb-fg shadow-pop ring-1 ring-white/[.08]" style={{ top: tip.top, y: '-50%' }}>{tip.label}</m.div>}</AnimatePresence>
  </>
}
