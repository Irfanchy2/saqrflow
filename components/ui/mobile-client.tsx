'use client'
import Link from 'next/link'
import { useState, type ReactNode } from 'react'
import { Plus, SlidersHorizontal } from '@/components/icons'
import { cn } from '@/lib/utils'

/**
 * Floating "+" on phones and tablets (above the tab bar). `open` names a DialogButton's openParam on this page and opens
 * that form directly; `href` navigates instead.
 */
/** The floating + : a lit "arc" squircle above the tab bar (same light as the open tab), with a firm press. Shared with the sales FAB. */
export const FAB = 'fab arc no-print fixed bottom-[calc(86px+env(safe-area-inset-bottom))] end-4 z-nav grid h-14 w-14 cursor-pointer place-items-center rounded-[20px] transition-transform duration-150 ease-out active:scale-90 disabled:opacity-70 lg:hidden'
export function Fab({ label, open, href }: { label: string; open?: string; href?: string }) {
  const cls = FAB
  if (href) return <Link href={href} aria-label={label} className={cls}><Plus size={24} strokeWidth={2.4} /></Link>
  return <button type="button" aria-label={label} className={cls} onClick={() => dispatchEvent(new CustomEvent('averiqo:open', { detail: open }))}><Plus size={24} strokeWidth={2.4} /></button>
}

/**
 * Search row: the search box is always visible; the other filters fold behind a filter button on phones
 * (always shown from sm up). Children are the extra controls (selects, dates, the Filter button).
 */
export function FilterBar({ search, children, active, className }: { search: ReactNode; children?: ReactNode; active?: boolean; className?: string }) {
  const [open, setOpen] = useState(!!active)
  return <div className={cn('flex flex-wrap gap-2', className)}>
    <div className="flex min-w-0 flex-1 basis-60 gap-2">{search}
      {children && <button type="button" aria-label="Filters" aria-expanded={open} onClick={() => setOpen(o => !o)}
        className={cn('relative grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-lg border bg-surface sm:hidden', open ? 'border-primary text-primary' : 'border-border text-muted')}>
        <SlidersHorizontal size={17} />{active && <span className="absolute end-2 top-2 h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />}</button>}</div>
    {children && <div className={cn('w-full flex-wrap gap-2 sm:flex sm:w-auto [&>*]:max-sm:flex-1', open ? 'flex' : 'hidden')}>{children}</div>}
  </div>
}
