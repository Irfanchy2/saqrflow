'use client'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePathname } from 'next/navigation'
import { Bell, Check } from '@/components/icons'
import { cn } from '@/lib/utils'
import { ActionButton } from '@/components/ui/action-form'
import { markAllRead, markRead } from '@/app/actions/notifications'

export interface Notif { id: string; title: string; body: string | null; link: string | null; severity: string; read_at: string | null; created_at: string }

/**
 * The bell and its panel. The panel is drawn on the page body, not inside the header: a header (or the bell's round
 * button) with a blur effect would otherwise become the frame a "fixed" panel is measured against, squeezing it to the
 * bell's width on phones. Phones: the panel spans the screen under the header. Larger screens: under the bell, aligned
 * to its right edge. Closes on a tap outside, Escape, or when a page opens.
 */
export function NotificationBell({ items, unread }: { items: Notif[]; unread: number }) {
  const [open, setOpen] = useState(false), [pos, setPos] = useState<{ top: number; right: number; phone: boolean } | null>(null)
  const btn = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null)
  const path = usePathname()
  const place = useCallback(() => {
    const b = btn.current?.getBoundingClientRect(); if (!b) return
    setPos({ top: Math.round(b.bottom + 8), right: Math.max(8, Math.round(window.innerWidth - b.right)), phone: window.innerWidth < 640 })
  }, [])
  useLayoutEffect(() => { if (open) place() }, [open, place])
  useEffect(() => { setOpen(false) }, [path])
  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => { const t = e.target as Node; if (!panel.current?.contains(t) && !btn.current?.contains(t)) setOpen(false) }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); btn.current?.focus() } }
    addEventListener('pointerdown', away); addEventListener('keydown', key); addEventListener('resize', place); addEventListener('scroll', place, true)
    return () => { removeEventListener('pointerdown', away); removeEventListener('keydown', key); removeEventListener('resize', place); removeEventListener('scroll', place, true) }
  }, [open, place])

  return <>
    <button ref={btn} type="button" aria-label={`Notifications (${unread} unread)`} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(o => !o)} data-bell
      className={cn('relative grid h-10 w-10 cursor-pointer place-items-center rounded-full text-fg transition-colors hover:bg-fg/[.05] hover:text-fg lg:h-12 lg:w-12', open && 'bg-fg/[.06]')}>
      <Bell size={19} />{unread > 0 && <span aria-hidden className="absolute end-[9px] top-[9px] h-2.5 w-2.5 rounded-full bg-[hsl(14_85%_52%)] ring-2 ring-surface" />}
    </button>
    {open && pos && createPortal(
      <div ref={panel} role="dialog" aria-label="Notifications" data-notifications
        style={pos.phone ? { top: pos.top, left: 8, right: 8 } : { top: pos.top, right: pos.right, width: 'min(22rem, calc(100vw - 1rem))' }}
        className="pop-in fixed z-[70] flex max-h-[calc(100dvh-6rem)] flex-col overflow-hidden rounded-xl border border-border/80 bg-surface text-fg shadow-pop">
        <div className="flex shrink-0 items-center justify-between border-b border-border/80 px-4 py-3"><span className="flex items-center gap-2 text-[14px] font-semibold tracking-[-0.01em]">Notifications{unread > 0 && <span className="rounded-full bg-primary-soft px-1.5 text-[11px] font-semibold leading-[18px] text-primary tabular-nums">{unread}</span>}</span>
          {unread > 0 && <ActionButton action={markAllRead} variant="ghost">Mark all read</ActionButton>}</div>
        <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain sm:max-h-96">
          {items.length === 0 && <li className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-muted"><span className="grid h-10 w-10 place-items-center rounded-xl border border-border/80 bg-surface text-success shadow-card" aria-hidden><Check size={18} /></span>You&apos;re all caught up.</li>}
          {items.map(n => <li key={n.id} className={cn('flex items-start border-b border-border/70 last:border-0', !n.read_at && 'bg-primary-soft/40')}>
            <a href={`/api/notifications/${n.id}/open`} className="flex min-w-0 flex-1 gap-3 px-4 py-3 text-sm transition-colors hover:bg-surface-2/70">
              <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.severity === 'critical' ? 'bg-danger' : n.severity === 'warning' ? 'bg-warning' : 'bg-primary')} />
              <span className="min-w-0"><span className="block font-medium [overflow-wrap:anywhere] sm:truncate">{n.title}</span>{n.body && <span className="line-clamp-2 text-xs text-muted">{n.body}</span>}
                <span className="block text-[11px] text-muted">{new Date(n.created_at).toLocaleString('en-GB', { timeZone: 'Asia/Dubai', dateStyle: 'medium', timeStyle: 'short' })}</span></span></a>
            {!n.read_at && <ActionButton variant="ghost" action={markRead.bind(null, n.id)}><Check size={13} /><span className="sr-only">Mark as read</span></ActionButton>}</li>)}
        </ul></div>, document.body)}
  </>
}
