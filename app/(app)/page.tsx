import Link from 'next/link'
import { Banknote, CalendarDays, CheckCircle2, FileText, HardHat, Landmark, Receipt, ScrollText, ShieldCheck, Truck, Flag, Users, Wallet } from '@/components/icons'
import { getCtx } from '@/lib/auth'
import { Badge, Card, CardHeader, CardLink, EmptyState, Metrics, MiniBars, StatCard, Td, Th, TableWrap } from '@/components/ui/primitives'
import { buildAlerts } from '@/lib/dashboard'
import { summarizeCheques } from '@/lib/cheques'
import { addDays, formatAed, formatShortDate } from '@/lib/time'
import { cn } from '@/lib/utils'
import { SmartInboxPanel } from '@/components/inbox/smart-center'
import { loadSalesKpis } from '@/lib/sales/kpis'
import { receivablesAgeing } from '@/lib/sales/summary'
import { PROJECT_STATUS } from '@/lib/projects'
import { ACTION_LABEL, TABLE_LABEL } from '@/lib/audit'
import { QuickActions } from '@/components/layout/quick-actions'
import { DashboardCustomize } from '@/components/dashboard-customize'
import { normalizeLayout, type WidgetKey } from '@/lib/dashboard-widgets'
import { canDecide } from '@/lib/approvals'
import { buildTrend, greeting } from '@/lib/dashboard-trend'
import { TrendChart } from '@/components/dashboard/trend-chart'
import { CardTabs } from '@/components/dashboard/tabs'
import { QuickGrid } from '@/components/dashboard/quick-grid'
import { MiniCalendar } from '@/components/dashboard/mini-calendar'
import { DashboardBanner } from '@/components/dashboard/banner'
import { TaskCheck } from '@/components/dashboard/task-check'
import { STATUS_TONE, statusLabel } from '@/lib/sales/docs'
import { fmtMoney } from '@/lib/sales/money'

export const metadata = { title: 'Dashboard' }

/**
 * Dashboard hierarchy: 1) financial pulse (money owed, sales, collections, cheques) 2) what needs attention now
 * 3) operations (projects, compliance counts, inbox, activity). Every number is a link to the list it counts.
 */
export default async function Dashboard() {
  const c = await getCtx(); const sb = c.supabase; const head = { count: 'exact' as const, head: true }
  const canDocs = c.can('documents.view') || c.can('employees.view_sensitive'), canFin = c.can('finance.view')
  const in30 = addDays(c.today, 30), week = addDays(c.today, 7)
  const yearStart = (() => { const d = new Date(`${c.today.slice(0, 7)}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 11); return d.toISOString().slice(0, 10) })()

  // field operations: my open tasks due today / overdue, lead follow-ups due, visits today
  const head1 = { count: 'exact' as const, head: true }
  const opsCounts = Promise.all([
    c.supabase.from('tasks').select('id', head1).eq('owner_id', c.userId).in('status', ['todo', 'in_progress', 'waiting']).lte('due_date', c.today),
    c.can('crm.view') ? c.supabase.from('leads').select('id', head1).lte('next_followup', c.today).not('stage', 'in', '(won,lost,on_hold)') : Promise.resolve({ count: undefined }),
    c.can('documents.view') ? c.supabase.from('site_visits').select('id', head1).in('status', ['scheduled', 'rescheduled']).eq('scheduled_date', c.today) : Promise.resolve({ count: undefined }),
  ])
  const prefsP = Promise.resolve(c.supabase.from('user_preferences').select('value').eq('user_id', c.userId).eq('key', 'dashboard.layout').maybeSingle())   // query builders are lazy: Promise.resolve starts it now
  const since8 = (() => { const d = new Date(`${c.today.slice(0, 7)}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 7); return d.toISOString().slice(0, 10) })()
  const mainP = Promise.all([
    sb.from('reminder_sources').select('source_type,source_id,title,subject,owner_type,due_date,amount,direction,link').lte('due_date', in30).order('due_date').limit(60),
    canFin ? sb.from('cheques').select('direction,status,amount,cheque_date').in('status', ['received', 'issued', 'scheduled', 'deposited', 'presented']).limit(5000) : null,
    c.can('audit.view') ? sb.from('audit_logs').select('id,action,table_name,created_at,user_id,record_id').in('table_name', ['invoices', 'payments', 'customers', 'projects', 'cheques', 'documents', 'employees', 'assets', 'project_expenses']).order('created_at', { ascending: false }).limit(8) : null,
    canFin ? loadSalesKpis(c) : null,
    canFin ? sb.from('invoices').select('issue_date,total,vat_amount').eq('doc_type', 'invoice').not('status', 'in', '(draft,cancelled)').is('deleted_at', null).gte('issue_date', yearStart).lte('issue_date', c.today).limit(20000) : null,
    canFin ? sb.from('project_expenses').select('spent_on,amount').gte('spent_on', yearStart).lte('spent_on', c.today).limit(20000) : null,
    canFin ? sb.from('invoices').select('id', head).eq('doc_type', 'invoice').in('status', ['sent', 'partially_paid']).gte('due_date', c.today).lte('due_date', week) : null,
    canFin ? sb.from('sales_followups').select('id', head).is('done_at', null).lte('due_date', c.today) : null,
    c.can('documents.view') ? sb.from('projects').select('id,name,status,fabrication_progress,site_progress,customer:customers(name)').in('status', ['active', 'planning', 'on_hold']).order('updated_at', { ascending: false }).limit(5) : null,
    c.can('documents.view') ? sb.from('projects').select('id', head).eq('status', 'active') : null,
    canDocs ? sb.from('documents').select('id', head).is('deleted_at', null).not('status', 'in', '(cancelled,archived)').gte('expiry_date', c.today).lte('expiry_date', in30) : null,
    canDocs ? sb.from('documents').select('id', head).is('deleted_at', null).lt('expiry_date', c.today).not('status', 'in', '(cancelled,archived,renewal_in_progress)') : null,
    c.can('employees.view_sensitive') ? sb.from('documents').select('id, category:document_categories!inner(name)', head).is('deleted_at', null).eq('owner_type', 'employee').ilike('category.name', '%visa%').gte('expiry_date', c.today).lte('expiry_date', addDays(c.today, 60)) : null,
    c.can('documents.view') ? sb.from('assets').select('id', head).is('archived_at', null).or(`registration_expiry.lte.${in30},insurance_expiry.lte.${in30},inspection_expiry.lte.${in30},next_service_date.lte.${in30}`) : null,
    c.can('employees.view') ? sb.from('employees').select('id', head).eq('status', 'active') : null,
    canDocs ? sb.from('documents').select('id', head).is('deleted_at', null).limit(1) : null,
    c.can('audit.view') ? sb.from('profiles').select('id,full_name') : null,
  ])
  // chart history does not depend on the dashboard layout either: it starts now, alongside the main counts
  const histP = Promise.all([
    c.can('documents.view') ? sb.from('projects').select('created_at').gte('created_at', since8).limit(5000) : null,
    canFin ? sb.from('invoices').select('issue_date').eq('doc_type', 'quotation').is('deleted_at', null).gte('issue_date', since8).limit(5000) : null,
    canFin ? sb.from('payments').select('paid_on,amount').gte('paid_on', yearStart).lte('paid_on', c.today).limit(20000) : null,
  ])
  const prefs = await prefsP
  // per-user layout + the optional widgets (only queried when shown)
  const layout = normalizeLayout(prefs.data?.value)
  const on = (k: WidgetKey) => layout.items.some(i => i.key === k && !i.hidden)
  const extras = Promise.all([
    on('mytasks') ? c.supabase.from('tasks').select('id,title,due_date,project:projects(name)').eq('owner_id', c.userId).in('status', ['todo', 'in_progress', 'waiting']).is('deleted_at', null).order('due_date', { nullsFirst: false }).limit(8) : null,
    on('approvals') ? c.supabase.from('approval_requests').select('id,title,amount,entity_type').eq('status', 'pending').order('requested_at').limit(20) : null,
  ])
  const recentGroup = Promise.all([
    canFin && on('recent') ? sb.from('project_expenses').select('id,spent_on,amount,description,category,project:projects(id,name)').order('spent_on', { ascending: false }).order('created_at', { ascending: false }).limit(6) : null,
    canFin && on('recent') ? sb.from('invoices').select('id,number,customer_name,subject,site,issue_date,valid_until,total,status,doc_type,project:projects(name)').eq('doc_type', 'quotation').is('deleted_at', null).order('created_at', { ascending: false }).limit(6) : null,
    canFin && on('recent') ? sb.from('invoices').select('id,number,customer_name,subject,site,issue_date,due_date,total,status,doc_type,project:projects(name)').eq('doc_type', 'invoice').is('deleted_at', null).order('created_at', { ascending: false }).limit(6) : null,
    canFin && on('recent') ? sb.from('payments').select('id,amount,paid_on,method,reference,invoice:invoices(id,number,customer_name),customer:customers(id,name)').order('paid_on', { ascending: false }).order('created_at', { ascending: false }).limit(6) : null,
  ])
  const [sources, cheques, activity, salesData, monthInv, monthExp, dueSoon, followDue, activeProjects, activeCount, exp30, expired, visas, vehicles, emp, docsAny, people] = await mainP
  const [myTasksRes, apprRes] = await extras
  const [[projMonths, quoteMonths, payYear], [recentE, recentQ, recentI, recentP]] = await Promise.all([histP, recentGroup])
  const trend = canFin ? buildTrend(c.today, (monthInv?.data ?? []) as any, (payYear?.data ?? []) as any, (monthExp?.data ?? []) as any) : null
  const myTasks = myTasksRes ? myTasksRes.data ?? [] : null
  const pendingApprovals = apprRes ? (apprRes.data ?? []).filter(a => canDecide(a.entity_type, c.can)).slice(0, 8) : null
  const alerts = buildAlerts((sources.data ?? []) as any, c.today)
  const salesNet = trend?.mtd.sales ?? 0
  const expenses = trend?.months[trend.months.length - 1].expenses ?? 0
  const who = new Map((people?.data ?? []).map(p => [p.id, p.full_name]))
  const sk = salesData?.kpis ?? null
  const cs = cheques ? summarizeCheques((cheques.data ?? []) as any, c.today) : null
  const ageing = salesData ? receivablesAgeing(salesData.openRows, c.today) : null
  const weekIn = cs?.dueThisWeek.filter(x => x.direction === 'incoming') ?? [], weekOut = cs?.dueThisWeek.filter(x => x.direction === 'outgoing') ?? []
  const amt = (xs: { amount: number | string }[]) => xs.reduce((a, x) => a + Number(x.amount), 0)
  const isNew = (docsAny?.count ?? 0) + (emp?.count ?? 0) + (cheques?.data?.length ?? 0) + (sk?.openCount ?? 0) + (sk?.pipelineCount ?? 0) === 0
  const date = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: c.company.timezone }).format(new Date())
  const firstName = (c.profile.full_name || '').trim().split(/\s+/)[0] || ''

  // operations / compliance counts: one compact list, zero values stay quiet
  const [myDue, leadDue, visitsToday] = await opsCounts
  const ops: { l: string; v: number | null | undefined; href: string; bad?: boolean; warn?: boolean }[] = [
    { l: 'My tasks due today or overdue', v: myDue.count, href: '/tasks?view=mine', warn: true },
    { l: 'Lead follow-ups due', v: leadDue.count, href: '/leads?view=list&due=1', warn: true },
    { l: 'Site visits today', v: visitsToday.count, href: '/site-visits' },
    { l: 'Quotation follow-ups due', v: followDue?.count, href: '/invoices?tab=followups', warn: true },
    { l: 'Invoices due in 7 days', v: dueSoon?.count, href: '/invoices?tab=invoice&status=sent', warn: true },
    { l: 'Documents expiring in 30 days', v: exp30?.count, href: '/vault?status=expiring30', warn: true },
    { l: 'Documents already expired', v: expired?.count, href: '/vault?status=expired', bad: true },
    { l: 'Visa expiries in 60 days', v: visas?.count, href: '/reports?section=compliance', warn: true },
    { l: 'Vehicle and asset renewals in 30 days', v: vehicles?.count, href: '/assets?due=30', warn: true },
    { l: 'Cheques past date, not banked', v: cs?.overdue.length, href: '/cheques?view=list', bad: true },
    { l: 'Cheques awaiting clearance', v: cs?.awaitingClearance.length, href: '/cheques?status=deposited' },
  ].filter(x => x.v !== undefined && x.v !== null)
  const opsNow = ops.filter(o => (o.v ?? 0) > 0)

  const months8 = trend ? trend.months.slice(-8) : []
  const bucket = (dates: string[]) => { const keys = months8.map(m => m.key); return keys.map(k => dates.filter(d => d.slice(0, 7) === k).length) }
  const projBars = months8.length ? bucket((projMonths?.data ?? []).map((r: any) => String(r.created_at).slice(0, 10))) : []
  const quoteBars = months8.length ? bucket((quoteMonths?.data ?? []).map((r: any) => r.issue_date)) : []
  const dueMap = new Map<string, number>(); for (const s of sources.data ?? []) dueMap.set(s.due_date, (dueMap.get(s.due_date) ?? 0) + 1)
  const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: c.company.timezone || 'Asia/Dubai' }).format(new Date())
  const tz = c.company.timezone || 'Asia/Dubai', place = tz === 'Asia/Dubai' ? 'Dubai, UAE' : tz.split('/').pop()!.replace(/_/g, ' ')
  const can = { sales: canFin && c.can('records.edit'), docs: c.can('documents.upload'), people: c.can('records.edit'), assets: c.can('records.edit') }
  const ALERT_ICON: Record<string, [typeof FileText, string]> = { document: [FileText, 'bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300'], cheque: [Landmark, 'bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300'], followup: [CalendarDays, 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300'], lead_followup: [CalendarDays, 'bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300'], task: [CheckCircle2, 'bg-teal-50 text-teal-600 dark:bg-teal-500/15 dark:text-teal-300'],
    invoice: [Receipt, 'bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300'], milestone: [Flag, 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300'], asset: [Truck, 'bg-orange-50 text-orange-600 dark:bg-orange-500/15 dark:text-orange-300'] }
  const alertIcon = (key: string) => { const t = key.split(':')[0]; return ALERT_ICON[t.startsWith('asset_') ? 'asset' : t] ?? [ShieldCheck, 'bg-surface-2 text-muted'] }
  const ACT: Record<string, [typeof FileText, string]> = { invoices: [Receipt, 'bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300'], payments: [Banknote, 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300'], projects: [HardHat, 'bg-orange-50 text-orange-600 dark:bg-orange-500/15 dark:text-orange-300'], cheques: [Landmark, 'bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300'], documents: [FileText, 'bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300'],
    customers: [Users, 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300'], employees: [Users, 'bg-teal-50 text-teal-600 dark:bg-teal-500/15 dark:text-teal-300'],
    assets: [Truck, 'bg-orange-50 text-orange-600 dark:bg-orange-500/15 dark:text-orange-300'], project_expenses: [Wallet, 'bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300'] }
  const ago = (iso: string) => { const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000)); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : m < 2880 ? 'yesterday' : formatShortDate(iso.slice(0, 10)) }
  const tone = (st: string): 'green' | 'amber' | 'red' | 'blue' | 'neutral' => st === 'active' ? 'green' : st === 'on_hold' ? 'amber' : st === 'planning' ? 'blue' : 'neutral'

  const W: Partial<Record<WidgetKey, React.ReactNode>> = {
    banner: <DashboardBanner company={c.company.name} stats={[
      ...(activeCount ? [{ label: 'Active projects', value: activeCount.count ?? 0, href: '/projects' }] : []),
      ...(visitsToday.count !== undefined && visitsToday.count !== null ? [{ label: 'Site visits today', value: visitsToday.count, href: '/site-visits' }] : []),
      { label: 'My tasks due', value: myDue.count ?? 0, href: '/tasks?view=mine' },
    ]} />,
    finance: (sk && ageing && cs && trend) ? <section aria-label="Key figures" className="mb-5">
      <Metrics cols={4}>
        <StatCard label="Sales this month" value={formatAed(salesNet)} change={trend.change.sales} hint="vs same days last month" bars={months8.map(m => m.sales)} href="/reports?period=month" icon={Receipt} />
        <StatCard label="Outstanding receivables" value={formatAed(sk.outstanding)} hint={sk.overdueCount > 0 ? <span className="font-medium text-danger">{formatAed(sk.overdue)} overdue</span> : `${sk.openCount} open invoice${sk.openCount === 1 ? '' : 's'}`} bars={ageing.grand > 0 ? ageing.totals : undefined} href="/invoices?tab=receivables" />
        <StatCard label="Collected this month" value={formatAed(trend.mtd.collected)} change={trend.change.collected} hint="vs same days last month" bars={months8.map(m => m.collected)} href="/invoices?tab=payments" icon={Banknote} />
        <StatCard label="Open quotations" value={formatAed(sk.pipeline)} hint={(followDue?.count ?? 0) > 0 ? <span className="font-medium text-warning">{followDue!.count} follow-up{followDue!.count === 1 ? '' : 's'} due</span> : `${sk.pipelineCount} open · no follow-ups due`} bars={quoteBars} href="/invoices?tab=quotation" />
      </Metrics>
      <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1.5 rounded-xl border border-border bg-surface px-5 py-2.5 text-[13px] text-muted shadow-card">
        <Link href="/cheques" className="hover:text-fg">Cheques this week <span className="font-semibold tabular-nums text-fg">In {formatAed(amt(weekIn))}</span> · <span className="font-semibold tabular-nums text-fg">Out {formatAed(amt(weekOut))}</span></Link>
        {expenses > 0 && <Link href="/expenses" className="hover:text-fg" title="Sales excluding VAT minus recorded expenses; labour and overheads count only if recorded">Recorded expenses this month <span className="font-semibold tabular-nums text-fg">{formatAed(expenses)}</span> · Estimated margin <span className="font-semibold tabular-nums text-fg">{formatAed(salesNet - expenses)}</span></Link>}
        {(dueSoon?.count ?? 0) > 0 && <Link href="/invoices?tab=invoice&status=sent" className="hover:text-fg"><span className="font-semibold tabular-nums text-fg">{dueSoon!.count}</span> invoice{dueSoon!.count === 1 ? '' : 's'} due in 7 days</Link>}
        {sk.winRate !== null && <span>Quotation win rate <span className="font-semibold tabular-nums text-fg">{sk.winRate}%</span></span>}
      </div>
    </section> : null,
    trend: trend ? <Card><TrendChart months={trend.months} change={{ sales: trend.change.sales, collected: trend.change.collected }} action={<CardLink href="/reports">Reports</CardLink>} /></Card> : null,
    quick: <Card className="h-full"><CardHeader title="Quick actions" /><QuickGrid can={{ sales: can.sales, crm: c.can('crm.view') && c.can('records.edit'), docs: can.docs, people: can.people, projects: c.can('documents.view') && c.can('records.edit') }} /></Card>,
    recent: canFin && recentQ ? <Card><CardTabs id="recent" action={<CardLink href="/invoices">All documents</CardLink>} tabs={[
      { key: 'q', label: 'Recent quotations', panel: <DocTable rows={recentQ.data ?? []} dateCol="Valid until" date={(r: any) => r.valid_until} empty="No quotations yet" /> },
      { key: 'i', label: 'Recent invoices', panel: <DocTable rows={recentI?.data ?? []} dateCol="Due" date={(r: any) => r.due_date} empty="No invoices yet" /> },
      { key: 'p', label: 'Recent payments', panel: !(recentP?.data ?? []).length ? <EmptyState title="No payments yet" /> : <TableWrap><thead><tr><Th>Date</Th><Th>Received from</Th><Th>Against</Th><Th>Method</Th><Th className="text-right">Amount</Th></tr></thead>
        <tbody className="divide-y divide-border">{(recentP!.data ?? []).map((x: any) => <tr key={x.id}><Td className="whitespace-nowrap tabular-nums">{formatShortDate(x.paid_on)}</Td>
          <Td className="max-w-[240px] truncate font-medium">{x.invoice?.customer_name ?? x.customer?.name ?? '—'}</Td>
          <Td>{x.invoice ? <Link href={`/invoices/${x.invoice.id}`} className="font-medium text-primary hover:underline">{x.invoice.number}</Link> : x.customer ? <Link href={`/parties/${x.customer.id}`} className="text-muted hover:text-fg">On account</Link> : <span className="text-muted">On account</span>}</Td>
          <Td className="capitalize text-muted">{String(x.method ?? '—').replace(/_/g, ' ')}</Td>
          <Td className="text-right font-semibold tabular-nums text-success">{fmtMoney(x.amount)}</Td></tr>)}</tbody></TableWrap> },
      ...(activeProjects ? [{ key: 'pr', label: 'Ongoing projects', panel: !(activeProjects.data ?? []).length ? <EmptyState title="No open projects" /> : <TableWrap><thead><tr><Th>Project</Th><Th>Customer</Th><Th>Fabrication</Th><Th>Site</Th><Th>Status</Th></tr></thead>
        <tbody className="divide-y divide-border">{(activeProjects.data ?? []).map((p: any) => <tr key={p.id}><Td className="max-w-[260px] truncate font-medium"><Link href={`/projects/${p.id}`} className="hover:text-primary">{p.name}</Link></Td>
          <Td className="max-w-[200px] truncate text-muted">{p.customer?.name ?? '—'}</Td><Td className="tabular-nums">{p.fabrication_progress ?? 0}%</Td><Td className="tabular-nums">{p.site_progress ?? 0}%</Td>
          <Td badge><Badge tone={tone(p.status)}>{PROJECT_STATUS[p.status]?.label ?? p.status}</Badge></Td></tr>)}</tbody></TableWrap> }] : []),
      ...(recentE ? [{ key: 'e', label: 'Recent expenses', panel: !(recentE.data ?? []).length ? <EmptyState title="No expenses yet" /> : <TableWrap><thead><tr><Th>Date</Th><Th>Description</Th><Th>Project</Th><Th>Category</Th><Th className="text-right">Amount</Th></tr></thead>
        <tbody className="divide-y divide-border">{(recentE.data ?? []).map((x: any) => <tr key={x.id}><Td className="whitespace-nowrap tabular-nums">{formatShortDate(x.spent_on)}</Td>
          <Td className="max-w-[260px] truncate font-medium">{x.description}</Td><Td className="max-w-[200px] truncate">{x.project ? <Link href={`/projects/${x.project.id}`} className="text-muted hover:text-fg">{x.project.name}</Link> : '—'}</Td>
          <Td className="capitalize text-muted">{x.category}</Td><Td className="text-right tabular-nums">{fmtMoney(x.amount)}</Td></tr>)}</tbody></TableWrap> }] : []),
    ]} /></Card> : null,
    attention: <Card><CardHeader title="Needs attention" sub="Overdue or due within 30 days" action={c.can('reminders.create') ? <CardLink href="/reminders" /> : undefined} />
        {!alerts.length ? <EmptyState icon={CheckCircle2} title="Nothing is due" body="No documents, cheques, invoices or renewals fall due in the next 30 days." /> :
          <ul className="max-h-[440px] overflow-y-auto overscroll-contain px-2 pb-2">{alerts.slice(0, 20).map(a => { const [I, tint] = alertIcon(a.key); return <li key={a.key}><Link href={a.href} className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors hover:bg-surface-2/70">
            <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-lg', tint)} aria-hidden><I size={16} /></span>
            <span className="min-w-0 flex-1"><span className="block truncate font-medium" title={a.text}>{a.text}</span><span className="block truncate text-xs text-muted">{a.sub}</span></span>
            <span className={cn('shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums', a.severity === 'critical' ? 'bg-danger/10 text-danger' : a.severity === 'warning' ? 'bg-warning/10 text-warning' : 'bg-surface-2 text-muted')}>{a.days < 0 ? `${-a.days}d late` : a.days === 0 ? 'Today' : `${a.days} days`}</span></Link></li> })}</ul>}</Card>,
    calendar: <Card className="hidden md:block"><MiniCalendar today={c.today} due={dueMap} /></Card>,
    operations: ops.length > 0 && <Card><CardHeader title="Operations" sub={opsNow.length ? 'Counts that need someone today' : undefined} />
          {!opsNow.length ? <p className="flex items-center gap-2 px-5 pb-4 text-sm text-muted"><CheckCircle2 size={15} className="text-success" aria-hidden />All clear: no tasks, follow-ups, renewals or cheques waiting.</p> :
          <ul className="px-2 pb-2">{opsNow.map(o => <li key={o.l}><Link href={o.href} className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm hover:bg-surface-2/70">
            <span className="min-w-0 truncate text-muted">{o.l}</span>
            <span className={cn('min-w-7 rounded-md px-1.5 text-center text-xs font-semibold leading-6 tabular-nums', o.bad ? 'bg-danger/10 text-danger' : o.warn ? 'bg-warning/10 text-warning' : 'bg-surface-2 text-fg')}>{o.v}</span></Link></li>)}</ul>}</Card> || null,
    inbox: (c.can('documents.upload') || c.can('employees.view_sensitive')) ? <SmartInboxPanel c={c} /> : null,
    projects: activeProjects && <Card className="h-full"><CardHeader title="Projects in progress" sub={`${activeCount?.count ?? 0} active`} action={<CardLink href="/projects" />} />
        {!(activeProjects.data ?? []).length ? <EmptyState icon={HardHat} title="No open projects" body="Create a project to follow fabrication and site progress, costs and billing." /> :
          <ul className="px-2 pb-2">{(activeProjects.data ?? []).map((p: any) => { const pct = Math.round(((p.fabrication_progress ?? 0) + (p.site_progress ?? 0)) / 2); return <li key={p.id}><Link href={`/projects/${p.id}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 rounded-lg px-3 py-2.5 hover:bg-surface-2/70 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto]">
            <span className="min-w-0"><span className="block truncate text-sm font-medium">{p.name}</span><span className="block truncate text-xs text-muted">{p.customer?.name ?? 'No customer'}</span></span>
            <span className="col-span-2 flex items-center gap-2.5 sm:col-span-1" title={`Fabrication ${p.fabrication_progress ?? 0}% · Site ${p.site_progress ?? 0}%`}><span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2"><span className={cn('block h-full rounded-full', pct >= 75 ? 'bg-success' : pct >= 40 ? 'bg-primary' : 'bg-warning')} style={{ width: `${pct}%` }} /></span><span className="w-9 text-end text-xs font-medium tabular-nums">{pct}%</span></span>
            <span className="row-start-1 col-start-2 sm:col-start-3"><Badge tone={tone(p.status)}>{PROJECT_STATUS[p.status]?.label ?? p.status}</Badge></span></Link></li> })}</ul>}</Card> || null,
    activity: <Card className="h-full"><CardHeader title="Recent activity" action={c.can('audit.view') ? <CardLink href="/audit">Audit log</CardLink> : undefined} />
        {activity ? ((activity.data?.length ?? 0) === 0 ? <EmptyState title="No activity yet" /> :
          <ul className="px-2 pb-2 text-sm">{activity.data!.map(a => { const [I, tint] = ACT[a.table_name] ?? [FileText, 'bg-surface-2 text-muted']; return <li key={a.id} className="flex items-center gap-3 rounded-lg px-3 py-2">
            <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-lg', tint)} aria-hidden><I size={15} /></span>
            <span className="min-w-0 flex-1 truncate"><span className="font-medium">{TABLE_LABEL[a.table_name] ?? a.table_name.replace(/_/g, ' ')}</span> <span className="text-muted">{(ACTION_LABEL[a.action] ?? a.action).toLowerCase()} by {a.user_id ? who.get(a.user_id) ?? 'a former user' : 'the system'}</span></span>
            <time dateTime={a.created_at} title={new Date(a.created_at).toLocaleString('en-GB', { timeZone: c.company.timezone })} className="shrink-0 text-xs tabular-nums text-muted">{ago(a.created_at)}</time></li> })}</ul>)
          : <EmptyState title="Activity is visible to owners" body="Ask an owner for access to the audit trail." />}</Card>,
    mytasks: myTasks ? <Card><CardHeader title="My tasks" sub="Open, by due date" action={<CardLink href="/tasks?view=mine" />} />
      {!myTasks.length ? <EmptyState icon={CheckCircle2} title="No open tasks" /> : <ul className="px-2 pb-2 text-sm">{myTasks.map((t: any) => <li key={t.id} className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-surface-2/70">
        <TaskCheck id={t.id} title={t.title} />
        <Link href={`/tasks?view=mine&open=${t.id}`} className="min-w-0 flex-1"><span className="block truncate font-medium">{t.title}</span>{t.project?.name && <span className="block truncate text-xs text-muted">{t.project.name}</span>}</Link>
        {t.due_date && <span className={cn('shrink-0 text-xs tabular-nums', t.due_date < c.today ? 'font-semibold text-danger' : t.due_date === c.today ? 'font-semibold text-warning' : 'text-muted')}>{t.due_date === c.today ? 'Today' : formatShortDate(t.due_date)}</span>}</li>)}</ul>}</Card> : null,
    approvals: pendingApprovals ? <Card><CardHeader title="Waiting for approval" action={<CardLink href="/approvals" />} />
      {!pendingApprovals.length ? <EmptyState icon={CheckCircle2} title="Nothing to approve" /> : <ul className="px-2 pb-2 text-sm">{pendingApprovals.map((a: any) => <li key={a.id}><Link href={`/approvals?open=${a.id}`} className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-surface-2/70">
        <span className="min-w-0 flex-1 truncate">{a.title}</span>{a.amount !== null && <span className="shrink-0 text-xs tabular-nums text-muted">{formatAed(a.amount)}</span>}</Link></li>)}</ul>}</Card> : null,
  }
  const visible = layout.items.filter(i => !i.hidden && W[i.key])
  const shown = new Set(visible.map(i => i.key))
  const SPAN: Partial<Record<WidgetKey, string>> = {
    trend: shown.has('quick') ? 'lg:col-span-8' : 'lg:col-span-12', quick: shown.has('trend') ? 'lg:col-span-4' : 'lg:col-span-12',
    activity: shown.has('projects') ? 'lg:col-span-6' : 'lg:col-span-12', projects: shown.has('activity') ? 'lg:col-span-6' : 'lg:col-span-12',
  }
  const PHONE_HIDDEN = new Set<WidgetKey>(['banner', 'finance', 'calendar', 'trend', 'inbox'])
  const col = (k: 'top' | 'left' | 'right') => visible.filter(i => i.col === k).map(i => <div key={i.key} className={cn('min-w-0', k === 'left' && cn('col-span-12', SPAN[i.key] ?? 'lg:col-span-12'), PHONE_HIDDEN.has(i.key) && 'max-sm:hidden')}>{W[i.key]}</div>)

  const dateShort = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: tz }).format(new Date())
  // phones: one composed summary instead of six separate boxes. A navy money card (sales this month, trend, receivables,
  // pending quotes) and one strip of counts with hairline dividers; every figure still opens the list behind it.
  const mobile = <section aria-label="Today" className="mb-5 sm:hidden">
    <p className="text-[13.5px] font-medium text-muted">{greeting(tz)}{firstName ? ',' : ''}</p>
    <h1 className="mt-0.5 text-[24px] font-bold leading-tight tracking-[-0.025em]">{c.profile.full_name || greeting(tz)}</h1>
    <p className="mt-1 text-[13px] text-muted">{dateShort}</p>
    {sk && trend && <div className="mt-4 space-y-3">
      <div className="relative overflow-hidden rounded-2xl bg-[linear-gradient(140deg,hsl(var(--sb))_0%,hsl(223_55%_19%)_60%,hsl(217_65%_30%)_100%)] text-white shadow-[0_14px_30px_-16px_hsl(var(--sb)/.9)]">
        <span aria-hidden className="pointer-events-none absolute -end-10 -top-12 h-40 w-40 rounded-full bg-[radial-gradient(closest-side,hsl(var(--sb-accent)/.35),transparent)]" />
        <Link href="/reports?period=month" className="relative flex items-end justify-between gap-3 px-4 pb-3.5 pt-4 active:opacity-90">
          <span className="min-w-0"><span className="block text-[12.5px] font-medium text-white/70">Sales this month</span>
            <span className="mt-0.5 block text-[26px] font-semibold tabular-nums leading-tight tracking-[-0.03em]">{formatAed(salesNet)}</span>
            {trend.change.sales !== null && <span className={cn('mt-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-semibold tabular-nums', trend.change.sales >= 0 ? 'bg-emerald-400/15 text-emerald-300' : 'bg-rose-400/15 text-rose-300')}>{trend.change.sales >= 0 ? '↑' : '↓'} {Math.abs(trend.change.sales)}%<span className="font-normal text-white/60">vs last month</span></span>}</span>
          <MiniBars values={months8.map(m => m.sales)} className="bg-white" /></Link>
        <div className="relative grid grid-cols-2 border-t border-white/10">
          <Link href="/invoices?tab=receivables" className="min-w-0 px-4 py-3 active:bg-white/5"><span className="flex items-center gap-1.5 text-[12px] text-white/65"><Wallet size={13} aria-hidden />Receivables</span><span className="mt-0.5 block truncate text-[16px] font-semibold tabular-nums">{formatAed(sk.outstanding)}</span></Link>
          <Link href="/invoices?tab=quotation" className="min-w-0 border-s border-white/10 px-4 py-3 active:bg-white/5"><span className="flex items-center gap-1.5 text-[12px] text-white/65"><FileText size={13} aria-hidden />Pending quotes</span><span className="mt-0.5 block truncate text-[16px] font-semibold tabular-nums">{formatAed(sk.pipeline)}</span></Link>
        </div>
      </div>
      <div className="grid grid-cols-3 divide-x divide-border/80 overflow-hidden rounded-2xl border border-border/80 bg-surface shadow-card rtl:divide-x-reverse">{[
        ['Quotations', sk.pipelineCount, '/invoices?tab=quotation', ScrollText, 'text-emerald-600 dark:text-emerald-300'],
        ['Unpaid invoices', sk.openCount, '/invoices?tab=invoice', Receipt, 'text-blue-600 dark:text-blue-300'],
        ['Projects', activeCount?.count ?? 0, '/projects', HardHat, 'text-orange-600 dark:text-orange-300'],
      ].map(([l, v, h, I, t]: any) => <Link key={l} href={h} className="flex min-w-0 flex-col gap-1 px-3 py-3 active:bg-surface-2/70">
        <span className={cn('flex items-center gap-1.5 truncate text-[11.5px] font-medium text-muted')}><I size={14} className={t} aria-hidden /><span className="truncate">{l}</span></span>
        <span className="text-[20px] font-semibold tabular-nums leading-none tracking-[-0.02em]">{v}</span></Link>)}</div>
    </div>}
  </section>

  return <>
    {mobile}
    <div className="mb-6 hidden flex-wrap items-center justify-between gap-x-4 gap-y-3 sm:flex">
      <div className="min-w-0"><h1 className="text-[24px] font-bold leading-tight tracking-[-0.025em] sm:text-[26px]">{greeting(tz)}{firstName ? `, ${firstName}` : ''}</h1>
        <p className="mt-1 text-sm text-muted"><span className="sr-only">Dashboard · {c.company.name} · </span>Here’s your business overview for today.</p></div>
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="hidden items-center gap-3 rounded-xl border border-border bg-surface px-3.5 py-2 shadow-card md:flex">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary-soft text-primary" aria-hidden><CalendarDays size={17} /></span>
          <span className="leading-tight"><span className="block text-[13.5px] font-semibold">{date}</span><span className="block text-xs text-muted">{time} · {place}</span></span></div>
        <DashboardCustomize layout={layout} available={(Object.keys(W) as WidgetKey[]).filter(k => k === 'mytasks' || (k === 'approvals' ? c.can('approvals.decide') || c.can('sales.approve') : !!W[k]))} />
        <QuickActions label="Create new" can={can} /></div>
    </div>

    {isNew && <Card className="mb-5 p-5"><h2 className="text-[15px] font-semibold">Set up Averiqo</h2><p className="mt-0.5 text-sm text-muted">Four steps to a useful dashboard. Each one fills part of this page.</p>
      <ol className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">{[['Add company documents', '/documents', 'Trade licence, VAT certificate, tenancy'], ['Add employees', '/employees', 'Passports, visas, Emirates IDs'], ['Create a quotation', '/invoices', 'Your letterhead, stamp and terms'], ['Set up reminders', '/reminders', 'Recipients and WhatsApp opt-in']].map(([t, h, s], i) =>
        <li key={h}><Link href={h} className="flex h-full gap-3 rounded-xl border border-border p-3.5 transition-colors hover:border-border-strong hover:bg-surface-2/50"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary-soft text-xs font-semibold text-primary">{i + 1}</span><span><span className="block font-medium">{t}</span><span className="mt-0.5 block text-xs text-muted">{s}</span></span></Link></li>)}</ol></Card>}

    <div className="grid grid-cols-1 gap-5 2xl:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-rows-[auto_1fr]">
      <div className="min-w-0 2xl:col-start-1 2xl:row-start-1">{col('top')}</div>
      <div className="grid min-w-0 grid-cols-1 content-start items-start gap-5 md:grid-cols-2 xl:grid-cols-3 2xl:col-start-2 2xl:row-span-2 2xl:row-start-1 2xl:grid-cols-1">{col('right')}</div>
      <div className="grid min-w-0 grid-cols-12 content-start items-stretch gap-5 self-start 2xl:col-start-1 2xl:row-start-2">{col('left')}</div>
    </div>
  </>
}

/** Latest sales documents: number (with issue date), customer, project or subject, the relevant date, amount, status. */
function DocTable({ rows, dateCol, date, empty }: { rows: any[]; dateCol: string; date: (r: any) => string | null; empty: string }) {
  if (!rows.length) return <EmptyState title={empty} />
  return <TableWrap><thead><tr><Th>No.</Th><Th>Customer</Th><Th>Project / subject</Th><Th>Date</Th><Th>{dateCol}</Th><Th className="text-right">Amount (AED)</Th><Th>Status</Th></tr></thead>
    <tbody className="divide-y divide-border">{rows.map(r => <tr key={r.id}>
      <Td className="whitespace-nowrap"><Link href={`/invoices/${r.id}`} className="font-medium text-primary hover:underline">{r.number}</Link></Td>
      <Td className="max-w-[200px] truncate font-medium">{r.customer_name ?? '—'}</Td>
      <Td className="max-w-[200px] truncate text-muted">{r.project?.name ?? r.subject ?? r.site ?? '—'}</Td>
      <Td className="whitespace-nowrap tabular-nums text-muted">{formatShortDate(r.issue_date)}</Td>
      <Td className="whitespace-nowrap tabular-nums text-muted">{date(r) ? formatShortDate(date(r)!) : '—'}</Td>
      <Td className="text-right font-medium tabular-nums">{fmtMoney(r.total)}</Td>
      <Td badge><Badge tone={STATUS_TONE[r.status]}>{statusLabel(r.doc_type, r.status)}</Badge></Td></tr>)}</tbody></TableWrap>
}
