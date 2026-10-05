import { Search, LogOut } from 'lucide-react'
import { supabaseConfigured } from '@/lib/env'
import { SetupRequired } from '@/components/layout/setup-required'
import { getCtx } from '@/lib/auth'
import { Sidebar, type NavItem } from '@/components/layout/sidebar'
import { ThemeToggle } from '@/components/layout/theme-toggle'
import { NotificationBell } from '@/components/layout/notification-bell'
import { signOut } from '@/app/actions/auth'
import { t, isRtl } from '@/lib/i18n'
import { Button } from '@/components/ui/primitives'

export const dynamic = 'force-dynamic'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!supabaseConfigured()) return <SetupRequired />
  const c = await getCtx()
  const l = c.profile.locale
  const items: (NavItem & { show: boolean })[] = [
    { key: 'overview', href: '/', status: 'live', show: true },
    { key: 'documents', href: '/documents', status: 'live', show: c.can('documents.view') },
    { key: 'employees', href: '/employees', status: 'live', show: true },
    { key: 'vault', href: '/vault', status: 'live', show: c.can('documents.view') },
    { key: 'cheques', href: '/cheques', status: 'live', show: c.can('finance.view') },
    { key: 'invoices', href: '/invoices', status: 'planned', show: c.can('finance.view') },
    { key: 'projects', href: '/projects', status: 'planned', show: c.can('documents.view') },
    { key: 'parties', href: '/parties', status: 'live', show: c.can('documents.view') },
    { key: 'assets', href: '/assets', status: 'planned', show: c.can('documents.view') },
    { key: 'reminders', href: '/reminders', status: 'live', show: c.can('reminders.create') },
    { key: 'calendar', href: '/calendar', status: 'live', show: c.can('documents.view') },
    { key: 'reports', href: '/reports', status: 'partial', show: c.can('data.export') },
    { key: 'assistant', href: '/assistant', status: 'planned', show: true },
    { key: 'users', href: '/users', status: 'live', show: c.can('users.manage') },
    { key: 'settings', href: '/settings', status: 'live', show: true },
  ].map(i => ({ ...i, label: t(l, i.key as any) }) as NavItem & { show: boolean })
  const { data: notes } = await c.supabase.from('in_app_notifications').select('id,title,body,link,severity,read_at,created_at').order('created_at', { ascending: false }).limit(8)
  const { count: unread } = await c.supabase.from('in_app_notifications').select('id', { count: 'exact', head: true }).is('read_at', null)

  return <div className="flex min-h-screen">
    <Sidebar items={items.filter(i => i.show)} company={c.company.name} rtl={isRtl(l)} />
    <div className="flex min-w-0 flex-1 flex-col overflow-x-clip">
      <header className="no-print sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-surface/80 px-4 backdrop-blur ps-14 lg:ps-6">
        <form action="/search" className="relative max-w-md flex-1"><Search size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted" />
          <input name="q" type="search" placeholder={t(l, 'search')} aria-label="Global search" className="h-9 w-full rounded-md border border-border bg-bg ps-9 pe-3 text-sm placeholder:text-muted/70" /></form>
        <div className="ms-auto flex items-center gap-1">
          <ThemeToggle /><NotificationBell items={notes ?? []} unread={unread ?? 0} />
          <div className="mx-2 hidden text-end leading-tight sm:block"><div className="text-sm font-medium">{c.profile.full_name}</div><div className="text-[11px] capitalize text-muted">{c.profile.role.replace('_', ' ')}</div></div>
          <form action={signOut}><Button variant="ghost" size="icon" aria-label={t(l, 'signout')} title={t(l, 'signout')}><LogOut size={16} /></Button></form>
        </div></header>
      <main className="mx-auto w-full min-w-0 max-w-[1400px] flex-1 overflow-x-clip p-4 sm:p-6">{children}</main>
    </div></div>
}
