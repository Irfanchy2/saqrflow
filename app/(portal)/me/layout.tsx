import Link from 'next/link'
import type { Metadata } from 'next'
import { supabaseConfigured } from '@/lib/env'
import { SetupRequired } from '@/components/layout/setup-required'
import { getMe } from '@/lib/me'
import { AveriqoMark } from '@/components/brand/logo'
import { NotificationBell } from '@/components/layout/notification-bell'
import { PortalNav } from '@/components/portal/portal-nav'
import { NavProgress } from '@/components/layout/nav-progress'
import { Toaster } from '@/components/ui/toast'
import { Pwa } from '@/components/pwa'
import { EmptyState, LinkButton } from '@/components/ui/primitives'
import { LogOut, UserRound } from '@/components/icons'
import { signOut } from '@/app/actions/auth'
import { returnToAdmin } from '@/app/actions/impersonate'
import { readImpersonation } from '@/lib/impersonation'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'My portal' }

/**
 * Employee Portal shell: the signed-in person's own expenses, attendance, salary and profile, nothing else. Employees
 * land here (getCtx + middleware send them nowhere else); a manager whose login is linked to an employee record can open
 * it too, to see their own records.
 */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  if (!supabaseConfigured()) return <SetupRequired />
  const { c, emp } = await getMe()
  const [{ data: notes }, { count: unread }] = await Promise.all([
    c.supabase.from('in_app_notifications').select('id,title,body,link,severity,read_at,created_at').eq('user_id', c.userId).order('created_at', { ascending: false }).limit(8),
    c.supabase.from('in_app_notifications').select('id', { count: 'exact', head: true }).eq('user_id', c.userId).is('read_at', null),
  ])
  const staff = c.profile.role !== 'employee'
  const imp = await readImpersonation()
  const viewing = imp && emp && imp.employeeId === emp.id ? imp : null
  return <div className="flex min-h-screen flex-col bg-bg">
    {viewing && <div className="no-print relative z-30 bg-amber-500 text-white" role="status" data-impersonating>
      <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2 text-[13px]">
        <span className="min-w-0 flex-1"><b className="font-semibold">Viewing as {viewing.employeeName}.</b> Signed in by {viewing.adminName}; what you do here is recorded.</span>
        <form action={returnToAdmin}><button className="h-8 cursor-pointer rounded-full bg-white px-3.5 text-[13px] font-semibold text-amber-700 hover:bg-amber-50" data-back-to-admin>Back to admin</button></form>
      </div></div>}
    <a href="#main" className="sr-only z-toast rounded-md bg-primary px-3 py-2 text-sm text-primary-fg focus:not-sr-only focus:fixed focus:start-3 focus:top-3">Skip to content</a>
    <header className="no-print sticky top-0 z-20 bg-bg/80 backdrop-blur-xl backdrop-saturate-150">
      <div className="mx-auto flex h-16 w-full max-w-3xl items-center gap-3 px-4">
        <Link href="/me" className="flex min-w-0 flex-1 items-center gap-2.5" aria-label={`My portal · ${c.company.name}`}>
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-surface shadow-card ring-1 ring-white/70 dark:ring-white/[.06]"><AveriqoMark size={24} /></span>
          <span className="min-w-0 leading-tight"><span className="block truncate text-[16px] font-bold tracking-[-0.02em]">{emp?.full_name ?? c.profile.full_name}</span>
            <span className="block truncate text-[12px] text-muted">{c.company.name}</span></span></Link>
        {staff && <Link href="/" className="hidden h-10 items-center rounded-full px-3 text-[13px] font-medium text-muted hover:bg-fg/[.05] hover:text-fg sm:inline-flex">Back to Averiqo</Link>}
        <span className="grid h-10 w-10 place-items-center rounded-full bg-surface/80 shadow-card ring-1 ring-white/70 dark:ring-white/[.06]"><NotificationBell items={notes ?? []} unread={unread ?? 0} /></span>
        <form action={signOut}><button aria-label="Sign out" title="Sign out" className="grid h-10 w-10 cursor-pointer place-items-center rounded-full text-muted transition-colors hover:bg-fg/[.05] hover:text-fg"><LogOut size={18} aria-hidden /></button></form>
      </div>
      {emp && <PortalNav part="tabs" />}
    </header>
    {/* the phone tab bar lives outside the header: the header's backdrop blur would pin a fixed bar to the header itself */}
    {emp && <PortalNav part="bar" />}
    <main id="main" tabIndex={-1} className="mx-auto w-full max-w-3xl flex-1 px-4 pb-[calc(7.5rem+env(safe-area-inset-bottom))] pt-4 sm:pb-12 sm:pt-6">
      {emp ? children : <div className="mt-10 rounded-2xl border border-border/80 bg-surface shadow-card">
        <EmptyState icon={UserRound} title="Your login is not linked to an employee record yet"
          body="Ask HR or your administrator to link your login to your employee record (Employees → open your record → Portal access). Then your expenses, attendance and salary appear here."
          action={staff ? <LinkButton href="/" variant="secondary">Back to Averiqo</LinkButton> : undefined} /></div>}
    </main>
    <NavProgress /><Toaster /><Pwa />
  </div>
}
