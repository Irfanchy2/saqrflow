'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { CalendarCheck, Home, Receipt, UserRound, Wallet } from '@/components/icons'
import { cn } from '@/lib/utils'

export const PORTAL_TABS = [
  { href: '/me', label: 'Home', icon: Home },
  { href: '/me/expenses', label: 'Expenses', icon: Receipt },
  { href: '/me/attendance', label: 'Attendance', icon: CalendarCheck },
  { href: '/me/salary', label: 'Salary', icon: Wallet },
  { href: '/me/profile', label: 'Profile', icon: UserRound },
] as const

const isOn = (path: string, href: string) => (href === '/me' ? path === '/me' : path === href || path.startsWith(href + '/'))

/** Employee Portal tabs: a graphite tab bar at the bottom of a phone, plain tabs under the header on wider screens. */
export function PortalNav({ part }: { part: 'tabs' | 'bar' }) {
  const path = usePathname()
  if (part === 'tabs') return <nav aria-label="My portal" className="hidden border-b border-border sm:block">
      <div className="mx-auto flex max-w-3xl gap-1 px-4">{PORTAL_TABS.map(t => { const on = isOn(path, t.href)
        return <Link key={t.href} href={t.href} prefetch aria-current={on ? 'page' : undefined}
          className={cn('-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-3 text-[14px] font-medium transition-colors', on ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-fg')}>
          <t.icon size={17} aria-hidden />{t.label}</Link> })}</div>
    </nav>
  return <nav aria-label="My portal" className="capsule no-print fixed inset-x-3 bottom-[calc(10px+env(safe-area-inset-bottom))] z-nav mx-auto flex max-w-md rounded-[24px] p-[5px] sm:hidden">
      {PORTAL_TABS.map(t => { const on = isOn(path, t.href)
        return <Link key={t.href} href={t.href} prefetch aria-current={on ? 'page' : undefined}
          className={cn('relative flex h-[56px] min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-[18px] outline-none transition-colors', on ? 'arc text-white' : 'text-[hsl(220_10%_66%)] active:text-white')}>
          <t.icon size={22} weight={on ? 'fill' : 'regular'} aria-hidden />
          <span className="font-tech text-[11px] font-semibold leading-none tracking-[0.02em]">{t.label}</span></Link> })}
    </nav>
}
