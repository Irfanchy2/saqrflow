import { Search, LogOut } from 'lucide-react'
import { supabaseConfigured } from '@/lib/env'
import { SetupRequired } from '@/components/layout/setup-required'
import { getCtx } from '@/lib/auth'
import { Sidebar, type NavItem } from '@/components/layout/sidebar'
import { SIDEBAR_COOKIE } from '@/lib/ui-prefs'
import { cookies } from 'next/headers'
import { ThemeToggle } from '@/components/layout/theme-toggle'
import { NotificationBell } from '@/components/layout/notification-bell'
import { signOut } from '@/app/actions/auth'
import { t, isRtl } from '@/lib/i18n'
import { Button } from '@/components/ui/primitives'
import { Toaster } from '@/components/ui/toast'
import { CommandPalette, PaletteHint } from '@/components/layout/command-palette'

export const dynamic = 'force-dynamic'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!supabaseConfigured()) return <SetupRequired />
  const c = await getCtx()
  const l = c.profile.locale
  // grouped by job; the first group needs no label. Every entry is enforced again on the server (pages + RLS), hiding is only convenience.
  const items: (NavItem & { show: boolean })[] = [
    { key: 'overview', group: '', href: '/', show: true },
    { key: 'inbox', group: '', href: '/inbox', show: c.can('documents.upload') || c.can('employees.view_sensitive') },
    { key: 'reminders', group: '', href: '/reminders', show: c.can('reminders.create') },
    { key: 'calendar', group: '', href: '/calendar', show: c.can('documents.view') },
    { key: 'invoices', group: 'Operations', href: '/invoices', show: c.can('finance.view') },
    { key: 'projects', group: 'Operations', href: '/projects', show: c.can('documents.view') },
    { key: 'parties', group: 'Operations', href: '/parties', show: c.can('documents.view') },
    { key: 'catalog', group: 'Operations', href: '/catalog', show: c.can('finance.view') },
    { key: 'assets', group: 'Operations', href: '/assets', show: c.can('documents.view') },
    { key: 'cheques', group: 'Finance', href: '/cheques', show: c.can('finance.view') },
    { key: 'expenses', group: 'Finance', href: '/expenses', show: c.can('finance.view') },
    { key: 'employees', group: 'People & documents', href: '/employees', show: true },
    { key: 'documents', group: 'People & documents', href: '/documents', show: c.can('documents.view') },
    { key: 'vault', group: 'People & documents', href: '/vault', show: c.can('documents.view') },
    { key: 'reports', group: 'Insights', href: '/reports', show: c.can('finance.view') || c.can('documents.view') || c.can('employees.view') },
    { key: 'assistant', group: 'Insights', href: '/assistant', show: true },
    { key: 'users', group: 'System', href: '/users', show: c.can('users.manage') },
    { key: 'audit', group: 'System', href: '/audit', show: c.can('audit.view') },
    { key: 'trash', group: 'System', href: '/trash', show: c.can('records.delete') },
    { key: 'settings', group: 'System', href: '/settings', show: true },
  ].map(i => ({ ...i, label: t(l, i.key as any) }) as NavItem & { show: boolean })
  const { data: notes } = await c.supabase.from('in_app_notifications').select('id,title,body,link,severity,read_at,created_at').order('created_at', { ascending: false }).limit(8)
  const { count: unread } = await c.supabase.from('in_app_notifications').select('id', { count: 'exact', head: true }).is('read_at', null)

  const visible = items.filter(i => i.show)
  return <div className="flex min-h-screen">
    <a href="#main" className="sr-only z-toast rounded-md bg-primary px-3 py-2 text-sm text-primary-fg focus:not-sr-only focus:fixed focus:start-3 focus:top-3">Skip to content</a>
    <Sidebar items={visible} company={c.company.name} rtl={isRtl(l)} initialCollapsed={(await cookies()).get(SIDEBAR_COOKIE)?.value === '1'} />
    <div className="flex min-w-0 flex-1 flex-col overflow-x-clip">
      <header className="no-print sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-bg/90 px-4 backdrop-blur-sm ps-14 lg:ps-6">
        <form action="/search" className="relative max-w-md flex-1"><Search size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted" />
          <input name="q" type="search" placeholder={t(l, 'search')} aria-label="Global search" className="h-9 w-full rounded-md border border-border bg-surface ps-9 pe-3 text-sm placeholder:text-muted/60 hover:border-border-strong" /></form>
        <PaletteHint />
        <div className="ms-auto flex items-center gap-1">
          <ThemeToggle /><NotificationBell items={notes ?? []} unread={unread ?? 0} />
          <div className="mx-2 hidden text-end leading-tight sm:block"><div className="text-sm font-medium">{c.profile.full_name}</div><div className="text-2xs capitalize text-muted">{c.profile.role.replace(/_/g, ' ')}</div></div>
          <form action={signOut}><Button variant="ghost" size="icon" aria-label={t(l, 'signout')} title={t(l, 'signout')}><LogOut size={16} /></Button></form>
        </div></header>
      <main id="main" tabIndex={-1} className="mx-auto w-full min-w-0 max-w-[1760px] flex-1 overflow-x-clip p-4 sm:p-6">{children}</main>
    </div><Toaster /><CommandPalette links={visible.map(i => ({ label: i.label, href: i.href, group: i.group }))} canSales={c.can('records.edit') && c.can('finance.view')} /></div>
}
