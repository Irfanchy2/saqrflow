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
import { BottomNav } from '@/components/layout/bottom-nav'
import { NavProgress } from '@/components/layout/nav-progress'
import { Suspense } from 'react'

export const dynamic = 'force-dynamic'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!supabaseConfigured()) return <SetupRequired />
  const c = await getCtx()
  const l = c.profile.locale
  // grouped by job; the first group needs no label. Every entry is enforced again on the server (pages + RLS), hiding is only convenience.
  const items: (NavItem & { show: boolean })[] = [
    { key: 'overview', group: '', href: '/', show: true },
    { key: 'inbox', group: '', href: '/inbox', show: c.can('documents.upload') || c.can('employees.view_sensitive') },
    { key: 'tasks', group: '', href: '/tasks', show: true },
    { key: 'reminders', group: '', href: '/reminders', show: c.can('reminders.create') },
    { key: 'calendar', group: '', href: '/calendar', show: c.can('documents.view') },
    { key: 'leads', group: 'Sales & CRM', href: '/leads', show: c.can('crm.view') },
    { key: 'site_visits', group: 'Sales & CRM', href: '/site-visits', show: c.can('documents.view') },
    { key: 'invoices', group: 'Sales & CRM', href: '/invoices', show: c.can('finance.view') },
    { key: 'parties', group: 'Sales & CRM', href: '/parties', show: c.can('documents.view') },
    { key: 'catalog', group: 'Sales & CRM', href: '/catalog', show: c.can('finance.view') },
    { key: 'projects', group: 'Projects & site', href: '/projects', show: c.can('documents.view') },
    { key: 'work_orders', group: 'Projects & site', href: '/work-orders', show: c.can('documents.view') },
    { key: 'site_reports', group: 'Projects & site', href: '/site-reports', show: c.can('documents.view') },
    { key: 'assets', group: 'Projects & site', href: '/assets', show: c.can('documents.view') },
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

  // both notification queries in parallel (they used to run one after the other)
  const [{ data: notes }, { count: unread }] = await Promise.all([
    c.supabase.from('in_app_notifications').select('id,title,body,link,severity,read_at,created_at').order('created_at', { ascending: false }).limit(8),
    c.supabase.from('in_app_notifications').select('id', { count: 'exact', head: true }).is('read_at', null),
  ])
  const visible = items.filter(i => i.show)
  return <div className="flex min-h-screen">
    <a href="#main" className="sr-only z-toast rounded-md bg-primary px-3 py-2 text-sm text-primary-fg focus:not-sr-only focus:fixed focus:start-3 focus:top-3">Skip to content</a>
    <Sidebar items={visible} company={c.company.name} user={c.profile.full_name} rtl={isRtl(l)} initialCollapsed={(await cookies()).get(SIDEBAR_COOKIE)?.value === '1'} />
    <div className="flex min-w-0 flex-1 flex-col overflow-x-clip">
      <header className="no-print sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border bg-bg/90 pe-2 ps-14 backdrop-blur-sm sm:gap-3 sm:pe-4 lg:ps-6">
        <div className="min-w-0 flex-1 truncate text-[15px] font-semibold sm:hidden">{c.company.name}</div>
        <form action="/search" className="relative hidden max-w-md flex-1 sm:block"><Search size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted" />
          <input name="q" type="search" placeholder={t(l, 'search')} aria-label="Global search" className="h-9 w-full rounded-md border border-border bg-surface ps-9 pe-3 text-sm placeholder:text-muted/60 hover:border-border-strong" /></form>
        <PaletteHint />
        <div className="ms-auto flex items-center gap-0.5 sm:gap-1">
          <a href="/search" aria-label="Search" className="grid h-10 w-10 place-items-center rounded-md text-muted hover:bg-surface-2 sm:hidden"><Search size={19} /></a>
          <span className="hidden sm:inline-flex"><ThemeToggle /></span><NotificationBell items={notes ?? []} unread={unread ?? 0} />
          <div className="mx-2 hidden text-end leading-tight sm:block"><div className="text-sm font-medium">{c.profile.full_name}</div><div className="text-2xs capitalize text-muted">{c.profile.role.replace(/_/g, ' ')}</div></div>
          <form action={signOut} className="hidden sm:block"><Button variant="ghost" size="icon" aria-label={t(l, 'signout')} title={t(l, 'signout')}><LogOut size={16} /></Button></form>
        </div></header>
      <main id="main" tabIndex={-1} className="mx-auto w-full min-w-0 max-w-[1760px] flex-1 overflow-x-clip p-4 pb-24 sm:p-6 sm:pb-24 lg:pb-6">{children}</main>
    </div><BottomNav items={[
      { href: '/', label: 'Home', icon: 'home' as const }, { href: '/tasks', label: 'Tasks', icon: 'tasks' as const },
      c.can('crm.view') ? { href: '/leads', label: 'Leads', icon: 'leads' as const } : c.can('finance.view') ? { href: '/invoices', label: 'Sales', icon: 'sales' as const } : null,
      c.can('documents.view') ? { href: '/projects', label: 'Projects', icon: 'projects' as const } : null,
    ].filter(x => !!x)} /><Suspense><NavProgress /></Suspense><Toaster /><CommandPalette links={visible.map(i => ({ label: i.label, href: i.href, group: i.group }))} canSales={c.can('records.edit') && c.can('finance.view')} /></div>
}

