'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Menu } from 'lucide-react'
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
  const short: Record<string, string> = { leads: 'CRM', parties: 'Customers', site_visits: 'Visits', work_orders: 'Orders', site_reports: 'Reports', documents: 'Documents', employees: 'People', assets: 'Assets', expenses: 'Expenses', cheques: 'Cheques', reports: 'Reports', overview: 'Home' }
  const cell = 'flex min-h-[60px] flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors'
  return <nav aria-label="Quick navigation" className="no-print fixed inset-x-0 bottom-0 z-nav flex border-t border-border bg-surface/95 px-1 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden">
    {list.map(i => { const I = ICONS[i.key], a = on(i.href)
      return <Link key={i.key} href={i.href} aria-current={a ? 'page' : undefined} className={cn(cell, a ? 'text-primary' : 'text-muted active:text-fg')}>
        <span className={cn('grid h-7 w-9 place-items-center rounded-lg transition-colors', a && 'bg-primary text-primary-fg')}><I size={18} strokeWidth={a ? 2.2 : 1.8} aria-hidden /></span>
        <span className="max-w-full truncate px-1">{short[i.key] ?? i.label}</span></Link> })}
    <button type="button" onClick={() => dispatchEvent(new Event('averiqo:menu'))} className={cn(cell, 'cursor-pointer text-muted active:text-fg')}><span className="grid h-7 w-9 place-items-center"><Menu size={18} strokeWidth={1.8} aria-hidden /></span><span>More</span></button>
  </nav>
}
