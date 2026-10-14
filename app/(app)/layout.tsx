import { CalendarDays, Search } from 'lucide-react'
import { supabaseConfigured } from '@/lib/env'
import { SetupRequired } from '@/components/layout/setup-required'
import { getCtx } from '@/lib/auth'
import { Sidebar, type NavItem } from '@/components/layout/sidebar'
import { SIDEBAR_COOKIE } from '@/lib/ui-prefs'
import { cookies } from 'next/headers'
import { NotificationBell } from '@/components/layout/notification-bell'
import { Pwa } from '@/components/pwa'
import { t, isRtl } from '@/lib/i18n'
import { Toaster } from '@/components/ui/toast'
import { CommandPalette, PaletteHint } from '@/components/layout/command-palette'
import { BottomNav } from '@/components/layout/bottom-nav'
import { NavProgress } from '@/components/layout/nav-progress'
import { Suspense } from 'react'
import { MotionRoot } from '@/components/motion'
import { MenuButton } from '@/components/layout/menu-button'
import { RowNavigator } from '@/components/layout/row-navigator'
import { QuickActions } from '@/components/layout/quick-actions'

export const dynamic = 'force-dynamic'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!supabaseConfigured()) return <SetupRequired />
  const c = await getCtx()
  const l = c.profile.locale
  // grouped by job; the first group needs no label. Every entry is enforced again on the server (pages + RLS), hiding is only convenience.
  const items: (NavItem & { show: boolean })[] = [
    { key: 'overview', group: '', href: '/', show: true },
    { key: 'inbox', group: '', href: '/inbox', show: c.can('documents.upload') || c.can('employees.view_sensitive') },
    { key: 'brief', group: '', href: '/brief', show: true },
    { key: 'tasks', group: '', href: '/tasks', show: true },
    { key: 'approvals', group: '', href: '/approvals', show: c.can('records.edit') || c.can('approvals.decide') || c.can('sales.approve') || c.can('finance.view') },
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
    { key: 'tickets', group: 'Projects & site', href: '/tickets', show: true },
    { key: 'cheques', group: 'Finance', href: '/cheques', show: c.can('finance.view') },
    { key: 'expenses', group: 'Finance', href: '/expenses', show: c.can('finance.view') },
    { key: 'employees', group: 'People & documents', href: '/employees', show: true },
    { key: 'documents', group: 'People & documents', href: '/documents', show: c.can('documents.view') },
    { key: 'vault', group: 'People & documents', href: '/vault', show: c.can('documents.view') },
    { key: 'kb', group: 'People & documents', href: '/kb', show: true },
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
  const tz = c.company.timezone || 'Asia/Dubai'
  const today = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz }).format(new Date())
  const city = tz.split('/').pop()!.replace(/_/g, ' ')
  return <MotionRoot><div className="flex min-h-screen">
    <a href="#main" className="sr-only z-toast rounded-md bg-primary px-3 py-2 text-sm text-primary-fg focus:not-sr-only focus:fixed focus:start-3 focus:top-3">Skip to content</a>
    <Sidebar items={visible} company={c.company.name} user={c.profile.full_name} role={c.profile.role} rtl={isRtl(l)} initialCollapsed={(await cookies()).get(SIDEBAR_COOKIE)?.value === '1'} />
    <div className="flex min-w-0 flex-1 flex-col overflow-x-clip">
      <header className="no-print sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border bg-surface/85 px-2 backdrop-blur-md sm:gap-3 sm:px-4 lg:px-6">
        <MenuButton />
        <div className="min-w-0 flex-1 truncate text-[15px] font-semibold sm:hidden">{c.company.name}</div>
        <form action="/search" role="search" className="relative hidden max-w-[560px] flex-1 sm:block"><Search size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
          <input name="q" type="search" placeholder={t(l, 'search')} aria-label="Global search" className="h-9 w-full rounded-md border border-transparent bg-surface-2 pe-[72px] ps-9 text-sm transition-[border-color,background-color,box-shadow] placeholder:text-muted/70 hover:border-border focus:border-primary focus:bg-surface focus-visible:ring-4 focus-visible:ring-primary/[.12] focus-visible:ring-offset-0" />
          <PaletteHint /></form>
        <div className="ms-auto flex items-center gap-1 sm:gap-2">
          <span className="hidden items-center gap-1.5 rounded-md px-2 text-[13px] text-muted xl:inline-flex" title={tz}><CalendarDays size={14} aria-hidden /><span className="font-medium text-fg">{today}</span><span aria-hidden>·</span>{city}</span>
          <a href="/search" aria-label="Search" className="grid h-10 w-10 place-items-center rounded-md text-muted hover:bg-surface-2 sm:hidden"><Search size={19} /></a>
          <NotificationBell items={notes ?? []} unread={unread ?? 0} />
          <span className="hidden sm:block"><QuickActions can={{ sales: c.can('finance.view') && c.can('records.edit'), docs: c.can('documents.upload'), people: c.can('records.edit'), assets: c.can('records.edit') }} /></span>
        </div></header>
      <main id="main" tabIndex={-1} className="mx-auto w-full min-w-0 max-w-[1680px] flex-1 overflow-x-clip px-4 pb-24 pt-5 sm:px-6 sm:pb-24 sm:pt-6 lg:px-8 lg:pb-10">{children}</main>
    </div><BottomNav items={[
      { href: '/', label: 'Home', icon: 'home' as const }, { href: '/tasks', label: 'Tasks', icon: 'tasks' as const },
      c.can('crm.view') ? { href: '/leads', label: 'Leads', icon: 'leads' as const } : c.can('finance.view') ? { href: '/invoices', label: 'Sales', icon: 'sales' as const } : null,
      c.can('documents.view') ? { href: '/projects', label: 'Projects', icon: 'projects' as const } : null,
    ].filter(x => !!x)} /><Suspense><NavProgress /></Suspense><Toaster /><Pwa /><CommandPalette links={[...visible.map(i => ({ label: i.label, href: i.href, group: i.group })),
      ...(c.can('records.edit') ? [{ label: 'Import data (Excel / CSV)', href: '/import', group: 'Data' }] : []),
      ...(c.can('data.export') || c.can('settings.manage') ? [{ label: 'Backup status', href: '/backup', group: 'Data' }] : []),
      ...(c.can('settings.manage') ? [{ label: 'Notification rules', href: '/settings#rules', group: 'Settings' }, { label: 'Scheduled reports', href: '/settings#schedules', group: 'Settings' }, { label: 'API & webhooks', href: '/settings#integrations', group: 'Settings' }] : []),
      ...(c.can('users.manage') ? [{ label: 'Sign-in activity', href: '/users/activity', group: 'Security' }] : []),
      { label: 'My devices & sign-in history', href: '/settings#account', group: 'Security' }]} canSales={c.can('records.edit') && c.can('finance.view')} /><RowNavigator /></div></MotionRoot>
}

