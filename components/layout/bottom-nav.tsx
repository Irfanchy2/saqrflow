'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { HardHat, LayoutDashboard, ListTodo, Menu, Receipt, Target } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface BottomItem { href: string; label: string; icon: 'home' | 'tasks' | 'leads' | 'sales' | 'projects' }
const ICON = { home: LayoutDashboard, tasks: ListTodo, leads: Target, sales: Receipt, projects: HardHat }

/** Phone tab bar: the four places people go all day, plus More (opens the full menu). Hidden from lg up. */
export function BottomNav({ items }: { items: BottomItem[] }) {
  const path = usePathname()
  const on = (h: string) => (h === '/' ? path === '/' : path === h || path.startsWith(h + '/'))
  const cell = 'flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors'
  return <nav aria-label="Quick navigation" className="no-print fixed inset-x-0 bottom-0 z-nav flex border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm lg:hidden">
    {items.map(i => { const I = ICON[i.icon], a = on(i.href)
      return <Link key={i.href} href={i.href} aria-current={a ? 'page' : undefined} className={cn(cell, a ? 'text-primary' : 'text-muted active:text-fg')}>
        <I size={20} strokeWidth={a ? 2.2 : 1.8} aria-hidden /><span className="max-w-full truncate px-1">{i.label}</span></Link> })}
    <button type="button" onClick={() => dispatchEvent(new Event('averiqo:menu'))} className={cn(cell, 'cursor-pointer text-muted active:text-fg')}><Menu size={20} strokeWidth={1.8} aria-hidden /><span>More</span></button>
  </nav>
}
