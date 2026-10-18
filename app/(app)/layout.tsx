import Link from 'next/link'
import { MapPin, Search, Settings } from '@/components/icons'
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
import { MotionRoot } from '@/components/motion'
import { MenuButton } from '@/components/layout/menu-button'
import { StripEdges } from '@/components/layout/strip-edges'
import { NavPending } from '@/components/layout/nav-pending'
import { RowNavigator } from '@/components/layout/row-navigator'
import { UserMenu, TopThemeToggle } from '@/components/layout/user-menu'
import { AveriqoMark } from '@/components/brand/logo'
import { signOut } from '@/app/actions/auth'

export const dynamic = 'force-dynamic'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!supabaseConfigured()) return <SetupRequired />
  const c = await getCtx()
  const l = c.profile.locale
  // grouped by job; the first group needs no label. Every entry is enforced again on the server (pages + RLS), hiding is only convenience.
  const items: (NavItem & { show: boolean })[] = [
    { key: 'overview', group: '', href: '/', show: true },
    { key: 'brief', group: '', href: '/brief', show: true },
    { key: 'inbox', group: '', href: '/inbox', show: c.can('documents.upload') || c.can('employees.view_sensitive') },
    { key: 'calendar', group: '', href: '/calendar', show: c.can('documents.view') },
    { key: 'leads', group: 'Sales', href: '/leads', show: c.can('crm.view') },
    { key: 'parties', group: 'Sales', href: '/parties', show: c.can('documents.view') },
    { key: 'site_visits', group: 'Sales', href: '/site-visits', show: c.can('documents.view') },
    { key: 'quotations', group: 'Sales', href: '/invoices?tab=quotation', tab: 'quotation', fallback: true, show: c.can('finance.view') },
    { key: 'tax_invoices', group: 'Sales', href: '/invoices?tab=invoice', tab: 'invoice', show: c.can('finance.view') },
    { key: 'delivery_notes', group: 'Sales', href: '/invoices?tab=delivery_note', tab: 'delivery_note', show: c.can('finance.view') },
    { key: 'payments', group: 'Sales', href: '/invoices?tab=payments', tab: 'payments', show: c.can('finance.view') },
    { key: 'catalog', group: 'Sales', href: '/catalog', show: c.can('finance.view') },
    { key: 'projects', group: 'Operations', href: '/projects', show: c.can('documents.view') },
    { key: 'work_orders', group: 'Operations', href: '/work-orders', show: c.can('documents.view') },
    { key: 'site_reports', group: 'Operations', href: '/site-reports', show: c.can('documents.view') },
    { key: 'tasks', group: 'Operations', href: '/tasks', show: true },
    { key: 'assets', group: 'Operations', href: '/assets', show: c.can('documents.view') },
    { key: 'tickets', group: 'Operations', href: '/tickets', show: true },
    { key: 'expenses', group: 'Finance', href: '/expenses', show: c.can('finance.view') },
    { key: 'cheques', group: 'Finance', href: '/cheques', show: c.can('finance.view') },
    { key: 'employees', group: 'People & documents', href: '/employees', show: true },
    { key: 'documents', group: 'People & documents', href: '/documents', show: c.can('documents.view') },
    { key: 'vault', group: 'People & documents', href: '/vault', show: c.can('documents.view') },
    { key: 'reminders', group: 'People & documents', href: '/reminders', show: c.can('reminders.create') },
    { key: 'kb', group: 'People & documents', href: '/kb', show: true },
    { key: 'reports', group: 'Reports', href: '/reports', show: c.can('finance.view') || c.can('documents.view') || c.can('employees.view') },
    { key: 'approvals', group: 'Reports', href: '/approvals', show: c.can('records.edit') || c.can('approvals.decide') || c.can('sales.approve') || c.can('finance.view') },
    { key: 'assistant', group: 'Reports', href: '/assistant', show: true },
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
  const collapsed = (await cookies()).get(SIDEBAR_COOKIE)?.value === '1'
  const tz = c.company.timezone || 'Asia/Dubai'
  const today = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz }).format(new Date())
  const city = tz.split('/').pop()!.replace(/_/g, ' '), place = tz === 'Asia/Dubai' ? 'Dubai, UAE' : city
  return <MotionRoot><div className="flex min-h-screen">
    <a href="#main" className="sr-only z-toast rounded-md bg-primary px-3 py-2 text-sm text-primary-fg focus:not-sr-only focus:fixed focus:start-3 focus:top-3">Skip to content</a>
    {/* the shell (sidebar, progress bar, tap skeleton) renders in the first HTML chunk, with no Suspense boundary: a boundary
        here streamed the sidebar in a later chunk on every load, and when that chunk landed while React was hydrating the
        page threw React #418 (seen intermittently on any page) */}
    <Sidebar items={visible} company={c.company.name} user={c.profile.full_name} role={c.profile.role} rtl={isRtl(l)} initialCollapsed={collapsed} />
    <div className="flex min-w-0 flex-1 flex-col overflow-x-clip">
      {c.company.is_demo && <div role="note" data-demo-banner className="no-print flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-primary/15 bg-primary-soft px-4 py-2 text-center text-[13px]">
        <span><b className="font-semibold">Shared demo.</b> Sample data, reset every day. Messages are never really sent.</span>
        <form action={signOut}><input type="hidden" name="next" value="signup" /><button className="cursor-pointer font-semibold text-primary underline-offset-2 hover:underline">Create your own account →</button></form></div>}
      <header className="no-print sticky top-0 z-20 flex h-16 items-center gap-2 border-b border-border/70 bg-surface/85 px-2 backdrop-blur-md backdrop-saturate-150 sm:gap-3 sm:px-5 lg:px-8">
        <MenuButton />
        <Link href="/" className="flex h-11 min-w-0 flex-1 items-center gap-2 sm:hidden" aria-label={`Averiqo · ${c.company.name}`}><AveriqoMark size={28} /><span className="text-[18px] font-bold tracking-[-0.02em]">Averiqo</span></Link>
        <form action="/search" role="search" className="relative hidden max-w-[540px] flex-1 sm:block"><Search size={16} className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
          <input name="q" type="search" placeholder={t(l, 'search')} aria-label="Global search" className="h-10 w-full rounded-xl border border-transparent bg-surface-2/80 pe-[76px] ps-10 text-sm shadow-[inset_0_0_0_1px_hsl(var(--border)/.6)] transition-[border-color,background-color,box-shadow] duration-150 placeholder:text-muted/80 hover:bg-surface-2 focus:border-primary/60 focus:bg-surface focus:shadow-focus focus-visible:ring-0 focus-visible:ring-offset-0" />
          <PaletteHint /></form>
        <div className="ms-auto flex items-center gap-0.5 sm:gap-1">
          <span className="me-1 hidden items-center gap-2 rounded-lg px-2.5 text-[13px] font-medium xl:inline-flex" title={`${today} · ${tz}`}>{tz === 'Asia/Dubai' ? <UaeFlag /> : <MapPin size={15} className="text-muted" aria-hidden />}{place}</span>
          <a href="/search" aria-label="Search" className="grid h-10 w-10 place-items-center rounded-lg text-muted transition-colors hover:bg-fg/[.05] active:bg-fg/[.08] sm:hidden"><Search size={19} /></a>
          <NotificationBell items={notes ?? []} unread={unread ?? 0} />
          <Link href="/settings" aria-label="Settings" title="Settings" className="hidden h-10 w-10 place-items-center rounded-lg text-muted transition-colors hover:bg-fg/[.05] hover:text-fg sm:grid"><Settings size={18} /></Link>
          <TopThemeToggle />
          <span className="mx-1.5 hidden h-7 w-px bg-border sm:block" aria-hidden />
          <UserMenu name={c.profile.full_name} role={c.profile.role} company={c.company.name} />
        </div></header>
      <main id="main" tabIndex={-1} className="relative mx-auto w-full min-w-0 max-w-[1680px] flex-1 overflow-x-clip px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-5 has-[.fab]:pb-[calc(10rem+env(safe-area-inset-bottom))] has-[.dock]:pb-[calc(11rem+env(safe-area-inset-bottom))] sm:px-6 sm:pt-6 lg:px-8 lg:!pb-10"><NavPending />{children}</main>
    </div><BottomNav items={visible} /><NavProgress /><Toaster /><Pwa /><CommandPalette links={[...visible.map(i => ({ label: i.label, href: i.href, group: i.group })),
      ...(c.can('records.edit') ? [{ label: 'Import data (Excel / CSV)', href: '/import', group: 'Data' }] : []),
      ...(c.can('data.export') || c.can('settings.manage') ? [{ label: 'Backup status', href: '/backup', group: 'Data' }] : []),
      ...(c.can('settings.manage') ? [{ label: 'Notification rules', href: '/settings#rules', group: 'Settings' }, { label: 'Scheduled reports', href: '/settings#schedules', group: 'Settings' }, { label: 'API & webhooks', href: '/settings#integrations', group: 'Settings' }] : []),
      ...(c.can('users.manage') ? [{ label: 'Sign-in activity', href: '/users/activity', group: 'Security' }] : []),
      { label: 'My devices & sign-in history', href: '/settings#account', group: 'Security' }]} canSales={c.can('records.edit') && c.can('finance.view')} /><RowNavigator /><StripEdges /></div></MotionRoot>
}


/** UAE flag (shown next to the company location when the company runs on Dubai time). */
function UaeFlag() {
  return <svg width="20" height="14" viewBox="0 0 12 8" className="shrink-0 overflow-hidden rounded-[3px] ring-1 ring-black/10" aria-hidden>
    <rect width="12" height="8" fill="#fff" /><rect width="12" height="2.67" fill="#00732f" /><rect y="5.33" width="12" height="2.67" fill="#000" /><rect width="3" height="8" fill="#ff0000" /></svg>
}
