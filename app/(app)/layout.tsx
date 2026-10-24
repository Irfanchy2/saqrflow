import Link from 'next/link'
import { redirect } from 'next/navigation'
import { supabaseConfigured } from '@/lib/env'
import { SetupRequired } from '@/components/layout/setup-required'
import { getCtx } from '@/lib/auth'
import { Sidebar, type NavItem } from '@/components/layout/sidebar'
import { NotificationBell } from '@/components/layout/notification-bell'
import { ShortcutsDialog } from '@/components/layout/shortcuts'
import { Pwa } from '@/components/pwa'
import { t, isRtl } from '@/lib/i18n'
import { Toaster } from '@/components/ui/toast'
import { CommandPalette } from '@/components/layout/command-palette'
import { BottomNav } from '@/components/layout/bottom-nav'
import { NavProgress } from '@/components/layout/nav-progress'
import { MotionRoot } from '@/components/motion'
import { MenuButton, SearchButton } from '@/components/layout/menu-button'
import { StripEdges } from '@/components/layout/strip-edges'
import { NavPending } from '@/components/layout/nav-pending'
import { RowNavigator } from '@/components/layout/row-navigator'
import { UserMenu } from '@/components/layout/user-menu'
import { AveriqoMark } from '@/components/brand/logo'
import { TopTabs, SubTabs, type TopItem, type TopKey } from '@/components/layout/top-nav'
import { Dock } from '@/components/layout/dock'
import { addDays } from '@/lib/time'
import { signOut } from '@/app/actions/auth'

export const dynamic = 'force-dynamic'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!supabaseConfigured()) return <SetupRequired />
  const c = await getCtx()
  if (c.profile.role === 'employee') redirect('/me')          // employees use the Employee Portal only (also enforced in getCtx and the database)
  const l = c.profile.locale
  // grouped by job; the first group needs no label. Every entry is enforced again on the server (pages + RLS), hiding is only convenience.
  const items: (TopItem & { show: boolean })[] = [
    { key: 'overview', group: '', top: 'home', href: '/', show: true },
    { key: 'brief', group: '', top: 'home', href: '/brief', show: true },
    { key: 'inbox', group: '', top: 'home', href: '/inbox', show: c.can('documents.upload') || c.can('employees.view_sensitive') },
    { key: 'calendar', group: '', top: 'home', href: '/calendar', show: c.can('documents.view') },
    { key: 'leads', group: 'Sales', top: 'sales', href: '/leads', show: c.can('crm.view') },
    { key: 'parties', group: 'Sales', top: 'sales', href: '/parties', show: c.can('documents.view') },
    { key: 'site_visits', group: 'Sales', top: 'sales', href: '/site-visits', show: c.can('documents.view') },
    { key: 'quotations', group: 'Sales', top: 'sales', href: '/invoices?tab=quotation', tab: 'quotation', fallback: true, show: c.can('finance.view') },
    { key: 'tax_invoices', group: 'Sales', top: 'sales', href: '/invoices?tab=invoice', tab: 'invoice', show: c.can('finance.view') },
    { key: 'delivery_notes', group: 'Sales', top: 'sales', href: '/invoices?tab=delivery_note', tab: 'delivery_note', show: c.can('finance.view') },
    { key: 'payments', group: 'Sales', top: 'sales', href: '/invoices?tab=payments', tab: 'payments', show: c.can('finance.view') },
    { key: 'catalog', group: 'Sales', top: 'sales', href: '/catalog', show: c.can('finance.view') },
    { key: 'projects', group: 'Operations', top: 'ops', href: '/projects', show: c.can('documents.view') },
    { key: 'work_orders', group: 'Operations', top: 'ops', href: '/work-orders', show: c.can('documents.view') },
    { key: 'site_reports', group: 'Operations', top: 'ops', href: '/site-reports', show: c.can('documents.view') },
    { key: 'tasks', group: 'Operations', top: 'ops', href: '/tasks', show: true },
    { key: 'assets', group: 'Operations', top: 'ops', href: '/assets', show: c.can('documents.view') },
    { key: 'tickets', group: 'Operations', top: 'ops', href: '/tickets', show: true },
    { key: 'stock', group: 'Stock', top: 'stock', href: '/stock', tab: 'items', fallback: true, show: c.can('documents.view') },
    { key: 'stock_moves', group: 'Stock', top: 'stock', href: '/stock?tab=movements', tab: 'movements', show: c.can('documents.view') },
    { key: 'bank_accounts', group: 'Finance', top: 'finance', href: '/banking', show: c.can('finance.view') },
    { key: 'expenses', group: 'Finance', top: 'finance', href: '/expenses', show: c.can('finance.view') },
    { key: 'cheques', group: 'Finance', top: 'finance', href: '/cheques', show: c.can('finance.view') },
    { key: 'employees', group: 'People & documents', top: 'people', href: '/employees', show: true },
    { key: 'documents', group: 'People & documents', top: 'people', href: '/documents', show: c.can('documents.view') },
    { key: 'vault', group: 'People & documents', top: 'people', href: '/vault', show: c.can('documents.view') },
    { key: 'reminders', group: 'People & documents', top: 'people', href: '/reminders', show: c.can('reminders.create') },
    { key: 'kb', group: 'People & documents', top: 'people', href: '/kb', show: true },
    { key: 'reports', group: 'Reports', top: 'reports', href: '/reports', show: c.can('finance.view') || c.can('documents.view') || c.can('employees.view') },
    { key: 'approvals', group: 'Reports', top: 'reports', href: '/approvals', show: c.can('records.edit') || c.can('approvals.decide') || c.can('sales.approve') || c.can('finance.view') },
    { key: 'assistant', group: 'Reports', top: 'reports', href: '/assistant', show: true },
    { key: 'users', group: 'System', top: 'system', href: '/users', show: c.can('users.manage') },
    { key: 'audit', group: 'System', top: 'system', href: '/audit', show: c.can('audit.view') },
    { key: 'trash', group: 'System', top: 'system', href: '/trash', show: c.can('records.delete') },
    { key: 'settings', group: 'System', top: 'system', href: '/settings', show: true },
  ].map(i => ({ ...i, label: t(l, i.key as any) }) as TopItem & { show: boolean })

  // notifications and the counts on the top tabs (what needs attention in each group), all in one parallel round;
  // each count is a head-only query the database answers from an index, and a failed one just shows no badge
  const head = { count: 'exact' as const, head: true }, none = Promise.resolve({ count: 0 })
  const [{ data: notes }, { count: unread }, ...tops] = await Promise.all([
    c.supabase.from('in_app_notifications').select('id,title,body,link,severity,read_at,created_at').order('created_at', { ascending: false }).limit(8),
    c.supabase.from('in_app_notifications').select('id', head).is('read_at', null),
    c.can('finance.view') ? c.supabase.from('invoice_list').select('id', head).eq('doc_type', 'invoice').eq('payment_status', 'overdue') : none,
    c.supabase.from('tasks').select('id', head).is('deleted_at', null).in('status', ['todo', 'in_progress', 'waiting']).lt('due_date', c.today),
    c.can('finance.view') ? c.supabase.from('cheques').select('id', head).in('status', ['received', 'issued', 'scheduled']).lte('cheque_date', addDays(c.today, 7)) : none,
    c.can('documents.view') ? c.supabase.from('documents').select('id', head).is('deleted_at', null).eq('status', 'active').lte('expiry_date', addDays(c.today, 30)) : none,
    c.can('documents.view') ? c.supabase.from('stock_items').select('id', head).eq('is_low', true) : none,
  ])
  const counts: Partial<Record<TopKey, number>> = { sales: tops[0].count ?? 0, ops: tops[1].count ?? 0, finance: tops[2].count ?? 0, people: tops[3].count ?? 0, stock: tops[4].count ?? 0 }
  const visible = items.filter(i => i.show)
  return <MotionRoot><div className="flex min-h-screen"><div className="mesh" aria-hidden><i className="mesh__a" /><i className="mesh__b" /><i className="mesh__c" /></div>
    <a href="#main" className="sr-only z-toast rounded-md bg-primary px-3 py-2 text-sm text-primary-fg focus:not-sr-only focus:fixed focus:start-3 focus:top-3">Skip to content</a>
    {/* the shell (sidebar, progress bar, tap skeleton) renders in the first HTML chunk, with no Suspense boundary: a boundary
        here streamed the sidebar in a later chunk on every load, and when that chunk landed while React was hydrating the
        page threw React #418 (seen intermittently on any page) */}
    <Sidebar items={visible} company={c.company.name} user={c.profile.full_name} role={c.profile.role} rtl={isRtl(l)} />
    <div className="flex min-w-0 flex-1 flex-col overflow-x-clip">
      {c.company.is_demo && <div role="note" data-demo-banner className="no-print flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-primary/15 bg-primary-soft px-4 py-2 text-center text-[13px]">
        <span><b className="font-semibold">Shared demo.</b> Sample data, reset every day. Messages are never really sent.</span>
        <form action={signOut}><input type="hidden" name="next" value="signup" /><button className="cursor-pointer font-semibold text-primary underline-offset-2 hover:underline">Create your own account →</button></form></div>}
      {/* one header for every size: phones and tablets keep the compact bar (menu, search, bell, account); from lg the
          brand, the group tabs and the bell + account sit on the page background, aligned with the content */}
      <header className="no-print sticky top-0 z-20 bg-bg/75 backdrop-blur-xl backdrop-saturate-150 lg:relative lg:z-nav lg:bg-transparent lg:backdrop-blur-none">
        <div className="mx-auto flex h-16 w-full max-w-[1680px] items-center gap-2.5 px-4 sm:gap-3 sm:px-5 lg:h-[84px] lg:gap-5 lg:pe-10 lg:ps-[112px]">
        <MenuButton />
        <Link href="/" className="flex min-w-0 flex-1 items-center gap-2.5 lg:flex-none lg:shrink-0 lg:gap-3" aria-label={`Averiqo · ${c.company.name}`}>
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-surface shadow-card ring-1 ring-white/70 dark:ring-white/[.06] lg:h-11 lg:w-11"><AveriqoMark size={24} /></span>
          <span className="min-w-0 leading-tight"><span className="block text-[17px] font-bold tracking-[-0.02em] lg:text-[18px]">Averiqo</span><span className="block max-w-[150px] truncate text-[11.5px] text-muted" title={c.company.name}>{c.company.name}</span></span></Link>
        <div className="hidden min-w-0 flex-1 justify-center lg:flex"><TopTabs items={visible} counts={counts} /></div>
        <div className="ms-auto flex items-center gap-2 lg:ms-0">
          <SearchButton />
          <span className="grid h-10 w-10 place-items-center rounded-full bg-surface/80 shadow-card ring-1 ring-white/70 backdrop-blur dark:ring-white/[.06] lg:h-12 lg:w-12"><NotificationBell items={notes ?? []} unread={unread ?? 0} /></span>
          <UserMenu name={c.profile.full_name} isDemo={!!c.company.is_demo} />
        </div></div></header>
      <main id="main" tabIndex={-1} className="relative mx-auto w-full min-w-0 max-w-[1680px] flex-1 overflow-x-clip px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-5 has-[.fab]:pb-[calc(10rem+env(safe-area-inset-bottom))] has-[.dock]:pb-[calc(11rem+env(safe-area-inset-bottom))] sm:px-6 sm:pt-6 lg:!pb-12 lg:pe-10 lg:ps-[112px] lg:pt-1"><NavPending /><div className="mb-4 empty:hidden"><SubTabs items={visible} /></div>{children}</main>
    </div><BottomNav items={visible} /><ShortcutsDialog /><Dock can={{ sales: c.can('records.edit') && c.can('finance.view'), docs: c.can('documents.upload'), people: c.can('records.edit'), assets: c.can('records.edit') && c.can('documents.view'), projects: c.can('records.edit') && c.can('documents.view'), crm: c.can('crm.view') && c.can('records.edit'), stock: c.can('records.edit') && c.can('documents.view') }} /><NavProgress /><Toaster /><Pwa /><CommandPalette links={[...visible.map(i => ({ label: i.label, href: i.href, group: i.group })),
      ...(c.can('records.edit') ? [{ label: 'Import data (Excel / CSV)', href: '/import', group: 'Data' }] : []),
      ...(c.can('data.export') || c.can('settings.manage') ? [{ label: 'Backup status', href: '/backup', group: 'Data' }] : []),
      ...(c.can('settings.manage') ? [{ label: 'Notification rules', href: '/settings#rules', group: 'Settings' }, { label: 'Scheduled reports', href: '/settings#schedules', group: 'Settings' }, { label: 'API & webhooks', href: '/settings#integrations', group: 'Settings' }] : []),
      ...(c.can('users.manage') ? [{ label: 'Sign-in activity', href: '/users/activity', group: 'Security' }] : []),
      { label: 'My devices & sign-in history', href: '/settings#account', group: 'Security' }]} canSales={c.can('records.edit') && c.can('finance.view')} /><RowNavigator /><StripEdges /></div></MotionRoot>
}

