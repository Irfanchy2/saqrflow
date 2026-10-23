'use client'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useLayoutEffect, useRef, useState } from 'react'
import { m } from 'framer-motion'
import { cn } from '@/lib/utils'
import { popIn, warmGsap } from '@/lib/gsap-pop'
import { ICONS, type NavItem } from '@/components/layout/sidebar'

/** The top-level groups shown as tabs (desktop). "system" pages (users, audit, trash, settings) have no tab of their own. */
export const TOPS = [
  { key: 'home', label: 'Dashboard' }, { key: 'sales', label: 'Sales' }, { key: 'ops', label: 'Operations' }, { key: 'stock', label: 'Stock' },
  { key: 'finance', label: 'Finance' }, { key: 'people', label: 'People' }, { key: 'reports', label: 'Reports' }, { key: 'system', label: 'Settings' },
] as const
export type TopKey = (typeof TOPS)[number]['key']
export type TopItem = NavItem & { top: TopKey }

export function isActive(i: NavItem, path: string, tab: string | null) {
  const base = i.href.split('?')[0]
  if (i.tab) return path === base && (tab === i.tab || (!tab && !!i.fallback))
  return base === '/' ? path === '/' : path === base || path.startsWith(base + '/')
}
function useCurrent(items: TopItem[]) {
  const path = usePathname(), tab = useSearchParams().get('tab')
  const here = items.find(i => isActive(i, path, tab))
  return { here, top: here?.top, path, tab }
}

const SPRING = { type: 'spring', stiffness: 520, damping: 42, mass: 0.8 } as const

/**
 * Main tabs: one pill per group with a count of what needs attention; the ink pill slides to the group you are in.
 * Hovering a tab shows that group's pages (built only while open), clicking it opens the group's first page.
 */
export function TopTabs({ items, counts }: { items: TopItem[]; counts: Partial<Record<TopKey, number>> }) {
  const { top } = useCurrent(items)
  const [peek, setPeek] = useState<TopKey | null>(null), timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const menu = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => { if (peek) popIn(menu.current) }, [peek])
  const open = (k: TopKey | null, wait = 140) => { clearTimeout(timer.current); timer.current = setTimeout(() => setPeek(k), k ? wait : 120) }
  const tabs = TOPS.filter(t => t.key !== 'system' && items.some(i => i.top === t.key))
  return <nav aria-label="Main" className="toptabs relative flex items-center gap-0.5 rounded-full border border-white/70 bg-surface/70 p-1 shadow-card backdrop-blur-xl backdrop-saturate-150 dark:border-white/[.06]"
    onMouseLeave={() => open(null)}>
    {tabs.map(t => {
      const group = items.filter(i => i.top === t.key), on = top === t.key, n = counts[t.key] ?? 0
      return <div key={t.key} className="relative" onMouseEnter={() => open(t.key)} onFocus={() => open(t.key, 0)}>
        <Link href={group[0].href} aria-current={on ? 'page' : undefined} data-top={t.key} {...warmGsap}
          className={cn('relative flex h-10 items-center gap-1.5 rounded-full px-3 text-[13.5px] xl:gap-2 xl:px-4 xl:text-[14px] font-medium transition-colors duration-200', on ? 'text-ink-fg' : 'text-fg/80 hover:text-fg')}>
          {on && <m.span layoutId="top-pill" transition={SPRING} aria-hidden className="absolute inset-0 rounded-full bg-ink shadow-[0_6px_16px_-8px_hsl(var(--shadow)/.6)]" />}
          {!on && <span aria-hidden className="absolute inset-0 rounded-full bg-fg/[.05] opacity-0 transition-opacity duration-150 [div:hover>a>&]:opacity-100" />}
          <span className="relative">{t.label}</span>
          {n > 0 && <span className="relative grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[hsl(14_85%_52%)] px-1 text-[10.5px] font-semibold tabular-nums leading-none text-white" aria-label={`${n} need attention`}>{n > 99 ? '99+' : n}</span>}
        </Link>
        {peek === t.key && group.length > 1 && <div className="absolute start-1/2 top-[calc(100%+10px)] z-pop w-60 -translate-x-1/2 rtl:translate-x-1/2" onMouseEnter={() => open(t.key, 0)}>
          <div ref={menu} role="menu" aria-label={t.label} className="rounded-2xl border border-border/80 bg-surface p-1.5 shadow-pop">
          {group.map(i => { const I = ICONS[i.key]
            return <Link key={i.key} role="menuitem" href={i.href} onClick={() => setPeek(null)} className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-[13.5px] text-fg/85 transition-colors hover:bg-surface-2 hover:text-fg">
              {I && <I size={17} className="shrink-0 text-muted" aria-hidden />}<span className="truncate">{i.label}</span></Link> })}
        </div></div>}
      </div>
    })}
  </nav>
}

/** The pages of the group you are in, as glass pills under the top bar (hidden when the group has a single page). */
export function SubTabs({ items }: { items: TopItem[] }) {
  const { top, path, tab } = useCurrent(items)
  const group = top ? items.filter(i => i.top === top) : []
  if (group.length < 2) return null
  return <nav aria-label="Section" className="subtabs tabstrip -mx-1 flex max-w-full items-center gap-1 overflow-x-auto px-1 py-0.5">
    {group.map(i => { const on = isActive(i, path, tab)
      return <Link key={i.key} href={i.href} aria-current={on ? 'page' : undefined}
        className={cn('relative flex h-9 shrink-0 items-center rounded-full px-3.5 text-[13px] font-medium transition-colors duration-200', on ? 'text-fg' : 'text-muted hover:text-fg')}>
        {on && <m.span layoutId="sub-pill" transition={SPRING} aria-hidden className="absolute inset-0 rounded-full border border-white/80 bg-surface shadow-card dark:border-white/[.06]" />}
        <span className="relative whitespace-nowrap">{i.label}</span></Link> })}
  </nav>
}
