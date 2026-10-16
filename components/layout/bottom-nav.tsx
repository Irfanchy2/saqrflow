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
  const cell = 'group/tab relative flex min-h-[58px] min-w-0 flex-1 basis-0 flex-col items-center justify-center gap-[3px] text-[11px] font-medium tracking-[-0.005em] transition-colors duration-150'
  // the active pill is one soft-tinted element that glides to the tab you open (layoutId); the icon fills and the label turns blue
  return <nav aria-label="Quick navigation" className="no-print fixed inset-x-0 bottom-0 z-nav flex border-t border-border/60 bg-surface/[.92] px-1.5 pb-[env(safe-area-inset-bottom)] shadow-[0_-10px_28px_-18px_hsl(var(--shadow)/.3)] backdrop-blur-xl backdrop-saturate-150 lg:hidden">
    {list.map(i => { const I = ICONS[i.key], a = on(i.href)
      return <Link key={i.key} href={i.href} aria-current={a ? 'page' : undefined} className={cn(cell, a ? 'text-primary' : 'text-muted active:text-fg')}>
        <span className="relative grid h-7 w-12 place-items-center transition-transform duration-150 ease-out group-active/tab:scale-90">
          {a && <m.span layoutId="tab-on" transition={{ type: 'spring', stiffness: 560, damping: 40, mass: 0.7 }} aria-hidden className="absolute inset-0 rounded-full bg-primary/[.12] ring-1 ring-inset ring-primary/15 dark:bg-primary/20" />}
          <I size={20} weight={a ? 'fill' : 'regular'} aria-hidden className="relative" /></span>
        <span className={cn('max-w-full truncate px-1', a && 'font-semibold')}>{short[i.key] ?? i.label}</span></Link> })}
    <button type="button" onClick={() => dispatchEvent(new Event('averiqo:menu'))} className={cn(cell, 'cursor-pointer text-muted active:text-fg')}><span className="grid h-7 w-12 place-items-center transition-transform duration-150 ease-out group-active/tab:scale-90"><ListIcon size={20} aria-hidden /></span><span>More</span></button>
  </nav>
}
