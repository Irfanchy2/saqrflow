import { Bell } from '@/components/icons'
import { cn } from '@/lib/utils'
import { ActionButton } from '@/components/ui/action-form'
import { markAllRead, markRead } from '@/app/actions/notifications'
import { Check } from '@/components/icons'

export interface Notif { id: string; title: string; body: string | null; link: string | null; severity: string; read_at: string | null; created_at: string }
export function NotificationBell({ items, unread }: { items: Notif[]; unread: number }) {
  return <details className="group relative">
    <summary aria-label={`Notifications (${unread} unread)`} className="relative grid h-10 w-10 cursor-pointer list-none place-items-center rounded-lg text-muted transition-colors hover:bg-fg/[.05] hover:text-fg group-open:bg-fg/[.06] group-open:text-fg [&::-webkit-details-marker]:hidden">
      <Bell size={18} />{unread > 0 && <span className="absolute end-1 top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white ring-2 ring-surface">{unread > 9 ? '9+' : unread}</span>}
    </summary>
    <div className="pop-in absolute end-0 z-40 mt-2 w-[22rem] max-w-[calc(100vw-1rem)] overflow-hidden rounded-xl border border-border/80 bg-surface shadow-pop max-sm:fixed max-sm:inset-x-2 max-sm:top-[60px] max-sm:mt-0 max-sm:w-auto max-sm:max-w-none">
      <div className="flex items-center justify-between border-b border-border/80 px-4 py-3"><span className="flex items-center gap-2 text-[14px] font-semibold tracking-[-0.01em]">Notifications{unread > 0 && <span className="rounded-full bg-primary-soft px-1.5 text-[11px] font-semibold leading-[18px] text-primary tabular-nums">{unread}</span>}</span>
        {unread > 0 && <ActionButton action={markAllRead} variant="ghost">Mark all read</ActionButton>}</div>
      <ul className="max-h-96 overflow-y-auto">
        {items.length === 0 && <li className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-muted"><span className="grid h-10 w-10 place-items-center rounded-xl border border-border/80 bg-surface text-success shadow-card" aria-hidden><Check size={18} /></span>You're all caught up.</li>}
        {items.map(n => <li key={n.id} className={cn('flex items-start border-b border-border/70 last:border-0', !n.read_at && 'bg-primary-soft/40')}>
          <a href={`/api/notifications/${n.id}/open`} className="flex min-w-0 flex-1 gap-3 px-4 py-3 text-sm transition-colors hover:bg-surface-2/70">
            <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.severity === 'critical' ? 'bg-danger' : n.severity === 'warning' ? 'bg-warning' : 'bg-primary')} />
            <span className="min-w-0"><span className="block truncate font-medium">{n.title}</span>{n.body && <span className="line-clamp-2 text-xs text-muted">{n.body}</span>}
              <span className="block text-[11px] text-muted">{new Date(n.created_at).toLocaleString('en-GB', { timeZone: 'Asia/Dubai', dateStyle: 'medium', timeStyle: 'short' })}</span></span></a>
          {!n.read_at && <ActionButton variant="ghost" action={markRead.bind(null, n.id)}><Check size={13} /><span className="sr-only">Mark as read</span></ActionButton>}</li>)}
      </ul></div></details>
}
