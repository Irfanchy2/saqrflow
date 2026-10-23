'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ListIcon } from '@phosphor-icons/react/dist/ssr'
import { m } from 'framer-motion'
import { cn } from '@/lib/utils'
import { ICONS, type NavItem } from '@/components/layout/sidebar'

/**
 * Phone tab bar: Home, Sales, Projects, Tasks and More (the full menu). When the current page is another module
 * (CRM, Customers, Expenses…) it takes the second slot, so the place you are is always visible. Hidden from lg up.
 */
export function BottomNav({ items }: { items: NavItem[] }) {
  const path = usePathname()
  const on = (h: string) => { const b = h.split('?')[0]; return b === '/' ? path === '/' : path === b || path.startsWith(b + '/') }
  const pick = (k: string) => items.find(i => i.key === k)
  const base = [pick('overview'), pick('quotations') && { ...pick('quotations')!, label: 'Sales', href: '/invoices' }, pick('projects'), pick('tasks')].filter(Boolean) as NavItem[]
  const here = items.find(i => !i.tab && i.key !== 'overview' && on(i.href))
  const list = here && !base.some(b => on(b.href)) ? [base[0], here, ...base.slice(1)].slice(0, 4) : base.slice(0, 4)
  const short: Record<string, string> = { leads: 'CRM', parties: 'Customers', site_visits: 'Visits', work_orders: 'Orders', site_reports: 'Reports', documents: 'Documents', employees: 'People', assets: 'Assets', expenses: 'Expenses', cheques: 'Cheques', reports: 'Reports', overview: 'Home', catalog: 'Catalog', users: 'Users', vault: 'Vault', inbox: 'Inbox', brief: 'Brief', calendar: 'Calendar', approvals: 'Approvals', reminders: 'Reminders', settings: 'Settings', tickets: 'Service', kb: 'Guides', audit: 'Audit', trash: 'Trash', payments: 'Payments', assistant: 'Assistant' }
  const cell = 'group/tab relative flex h-[54px] min-w-0 flex-1 basis-0 flex-col items-center justify-center gap-[2px] rounded-full text-[10.5px] font-medium tracking-[-0.005em] transition-colors duration-200'
  // a floating glass bar like the desktop tabs: the ink pill glides to the tab you open (layoutId), its icon and label turn light
  return <nav aria-label="Quick navigation" className="no-print fixed inset-x-3 bottom-[calc(10px+env(safe-area-inset-bottom))] z-nav mx-auto flex max-w-md gap-0.5 rounded-full border border-white/70 bg-surface/85 p-1 shadow-[0_18px_40px_-18px_hsl(var(--shadow)/.55)] backdrop-blur-xl backdrop-saturate-150 dark:border-white/[.06] lg:hidden">
    {list.map(i => { const I = ICONS[i.key], a = on(i.href)
      return <Link key={i.key} href={i.href} aria-current={a ? 'page' : undefined} className={cn(cell, a ? 'text-ink-fg' : 'text-muted active:text-fg')}>
        {a && <m.span layoutId="tab-on" transition={{ type: 'spring', stiffness: 520, damping: 42, mass: 0.8 }} aria-hidden className="absolute inset-0 rounded-full bg-ink shadow-[0_6px_16px_-8px_hsl(var(--shadow)/.6)]" />}
        <I size={20} weight={a ? 'fill' : 'regular'} aria-hidden className="relative transition-transform duration-150 ease-out group-active/tab:scale-90" />
        <span className={cn('relative max-w-full truncate px-1', a && 'font-semibold')}>{short[i.key] ?? i.label}</span></Link> })}
    <button type="button" onClick={() => dispatchEvent(new Event('averiqo:menu'))} className={cn(cell, 'cursor-pointer text-muted active:text-fg')}><ListIcon size={20} aria-hidden className="transition-transform duration-150 ease-out group-active/tab:scale-90" /><span>More</span></button>
  </nav>
}
