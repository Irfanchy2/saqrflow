import Link from 'next/link'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

const TONES = {
  blue: 'bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300', amber: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300',
  green: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300', red: 'bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300',
  slate: 'bg-surface-2 text-muted', violet: 'bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300',
} as const

/** A compact figure for the portal: icon tile, label, big value, one line of context. Links when `href` is given. */
export function PortalStat({ label, value, hint, icon: Icon, tone = 'slate', href, testId }: {
  label: string; value: ReactNode; hint?: ReactNode; icon: React.ComponentType<{ size?: number; strokeWidth?: number }>; tone?: keyof typeof TONES; href?: string; testId?: string
}) {
  const body = <div className={cn('flex h-full flex-col gap-2 rounded-2xl border border-border/80 bg-surface p-4 shadow-card', href && 'transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-px hover:border-border-strong/80 hover:shadow-lift active:scale-[.99]')}>
    <div className="flex items-center gap-2.5"><span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-xl', TONES[tone])} aria-hidden><Icon size={18} strokeWidth={1.9} /></span>
      <span className="min-w-0 text-[13px] font-medium leading-snug text-muted">{label}</span></div>
    <div className="text-[22px] font-semibold leading-tight tracking-[-0.03em] tabular-nums [overflow-wrap:anywhere]" data-stat={testId}>{value}</div>
    {hint && <div className="text-[12.5px] leading-snug text-muted">{hint}</div>}
  </div>
  return href ? <Link href={href} className="block h-full rounded-2xl">{body}</Link> : body
}

/** Section card used across the portal: a title row with an optional action, then the content. */
export function PortalCard({ title, action, children, className, sub }: { title: string; action?: ReactNode; children: ReactNode; className?: string; sub?: ReactNode }) {
  return <section className={cn('overflow-hidden rounded-2xl border border-border/80 bg-surface shadow-card', className)}>
    <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-4 sm:px-5"><div className="min-w-0"><h2 className="text-[16px] font-semibold tracking-[-0.015em]">{title}</h2>{sub && <p className="mt-0.5 text-[12.5px] text-muted">{sub}</p>}</div>{action}</div>
    {children}
  </section>
}
