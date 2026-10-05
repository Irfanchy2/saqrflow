import Link from 'next/link'
import { Bell } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ActionButton } from '@/components/ui/action-form'
import { markAllRead } from '@/app/actions/notifications'

export interface Notif { id: string; title: string; body: string | null; link: string | null; severity: string; read_at: string | null; created_at: string }
export function NotificationBell({ items, unread }: { items: Notif[]; unread: number }) {
  return <details className="group relative">
    <summary aria-label={`Notifications (${unread} unread)`} className="relative grid h-9 w-9 cursor-pointer list-none place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-fg [&::-webkit-details-marker]:hidden">
      <Bell size={17} />{unread > 0 && <span className="absolute end-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">{unread > 9 ? '9+' : unread}</span>}
    </summary>
    <div className="absolute end-0 z-40 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-border bg-surface shadow-xl">
      <div className="flex items-center justify-between border-b border-border px-3 py-2"><span className="text-sm font-semibold">Notifications</span>
        {unread > 0 && <ActionButton action={markAllRead} variant="ghost">Mark all read</ActionButton>}</div>
      <ul className="max-h-96 overflow-y-auto">
        {items.length === 0 && <li className="px-4 py-8 text-center text-sm text-muted">You're all caught up.</li>}
        {items.map(n => <li key={n.id}><Link href={n.link || '/'} className={cn('flex gap-2.5 border-b border-border px-3 py-2.5 text-sm last:border-0 hover:bg-surface-2', !n.read_at && 'bg-primary-soft/50')}>
          <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.severity === 'critical' ? 'bg-danger' : n.severity === 'warning' ? 'bg-warning' : 'bg-primary')} />
          <span className="min-w-0"><span className="block truncate font-medium">{n.title}</span>{n.body && <span className="line-clamp-2 text-xs text-muted">{n.body}</span>}</span></Link></li>)}
      </ul></div></details>
}
