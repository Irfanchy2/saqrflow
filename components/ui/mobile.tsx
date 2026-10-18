// Phone list building blocks. Server-safe (icon components can be passed in); the interactive pieces live in mobile-client.
import Link from 'next/link'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
export { Fab, FilterBar } from './mobile-client'

/** Phone list (hidden from sm up, where the table shows instead). */
export function MList({ children, className }: { children: ReactNode; className?: string }) {
  return <ul className={cn('mlist divide-y divide-border sm:hidden', className)}>{children}</ul>
}

/**
 * One phone list row: a leading tile/avatar/checkbox, title (the link), a sub line, an optional third line
 * (amount + badge), and a right column (badge or menu on top, date / time below). The whole row opens `href`.
 */
export function MRow({ href, lead, title, sub, line, right, rightSub, className }: {
  href?: string; lead?: ReactNode; title: ReactNode; sub?: ReactNode; line?: ReactNode; right?: ReactNode; rightSub?: ReactNode; className?: string
}) {
  // long names wrap onto a second line (then ellipsis) instead of being cut after a few words; the full text is the tooltip
  const full = typeof title === 'string' ? title : undefined, subFull = typeof sub === 'string' ? sub : undefined
  const head = 'line-clamp-2 text-[15px] font-semibold leading-[1.3] tracking-[-0.01em] [overflow-wrap:anywhere]'
  return <li data-row-link={href ? '' : undefined} className={cn('flex items-center gap-3 px-4 py-3.5 transition-colors duration-150 active:bg-fg/[.045]', className)}>
    {lead && <span className="shrink-0">{lead}</span>}
    <div className="min-w-0 flex-1">
      {href ? <Link href={href} data-row-primary title={full} className={head}>{title}</Link> : <div title={full} className={head}>{title}</div>}
      {sub && <div title={subFull} className="mt-0.5 truncate text-[13px] text-muted">{sub}</div>}
      {line && <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-2 text-[14px]">{line}</div>}
    </div>
    {(right || rightSub) && <div className="flex shrink-0 flex-col items-end gap-1.5 self-stretch justify-between py-0.5 text-end">
      <span>{right}</span>{rightSub && <span className="text-xs tabular-nums text-muted">{rightSub}</span>}</div>}
  </li>
}

/** Rounded icon tile used at the start of phone rows. */
export function Tile({ icon: Icon, tint, size = 44 }: { icon: React.ComponentType<{ size?: number; strokeWidth?: number }>; tint: string; size?: number }) {
  return <span className={cn('grid place-items-center rounded-xl', tint)} style={{ width: size, height: size }} aria-hidden><Icon size={Math.round(size * 0.45)} strokeWidth={1.9} /></span>
}
export const TINTS = {
  blue: 'bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300', green: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300',
  orange: 'bg-orange-50 text-orange-600 dark:bg-orange-500/15 dark:text-orange-300', violet: 'bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300',
  rose: 'bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300', sky: 'bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300',
  amber: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300', teal: 'bg-teal-50 text-teal-600 dark:bg-teal-500/15 dark:text-teal-300',
  slate: 'bg-surface-2 text-muted',
} as const
export type TintKey = keyof typeof TINTS

/** Underline tabs that filter a list by URL (?status=…). Used on phones and desktop alike. */
export function FilterTabs({ tabs, label, className }: { tabs: { href: string; label: string; active: boolean; count?: number }[]; label: string; className?: string }) {
  return <nav aria-label={label} className={cn('tabstrip flex gap-1 overflow-x-auto border-b border-border', className)}>
    {tabs.map(t => <Link key={t.href} href={t.href} aria-current={t.active ? 'page' : undefined} scroll={false}
      className={cn('-mb-px inline-flex shrink-0 items-center whitespace-nowrap border-b-2 px-3 py-2.5 text-[13.5px] font-medium transition-[color,border-color] duration-150', t.active ? 'border-primary text-primary' : 'border-transparent text-muted hover:border-border-strong hover:text-fg')}>
      {t.label}{t.count !== undefined && <span className={cn('ms-1.5 min-w-[20px] rounded-full px-1.5 text-center text-[11px] font-semibold leading-[18px] tabular-nums', t.active ? 'bg-primary text-primary-fg' : 'bg-surface-2 text-muted ring-1 ring-inset ring-border')}>{t.count}</span>}</Link>)}
  </nav>
}

