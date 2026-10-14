import Link from 'next/link'
import { ArrowRight, CheckCircle2, HardHat } from 'lucide-react'
import { getCtx } from '@/lib/auth'
import { Card, CardHeader, EmptyState } from '@/components/ui/primitives'
import { buildAlerts } from '@/lib/dashboard'
import { summarizeCheques } from '@/lib/cheques'
import { addDays, formatAed, formatShortDate } from '@/lib/time'
import { cn } from '@/lib/utils'
import { SmartInboxPanel } from '@/components/inbox/smart-center'
import { Progress } from '@/components/projects/project-fields'
import { loadSalesKpis } from '@/lib/sales/kpis'
import { AGE_BUCKETS, receivablesAgeing } from '@/lib/sales/summary'
import { PROJECT_STATUS } from '@/lib/projects'
import { ACTION_LABEL, TABLE_LABEL } from '@/lib/audit'
import { QuickActions } from '@/components/layout/quick-actions'
import { DashboardCustomize } from '@/components/dashboard-customize'
import { normalizeLayout, type WidgetKey } from '@/lib/dashboard-widgets'
import { canDecide } from '@/lib/approvals'
import { buildTrend, greeting } from '@/lib/dashboard-trend'
import { Spark } from '@/components/dashboard/spark'
import { TrendChart } from '@/components/dashboard/trend-chart'
import { CardTabs } from '@/components/dashboard/tabs'
import { Badge, Td, Th, TableWrap } from '@/components/ui/primitives'
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
  // per-user layout + the two optional widgets (only queried when shown)
  const prefs = await c.supabase.from('user_preferences').select('value').eq('user_id', c.userId).eq('key', 'dashboard.layout').maybeSingle()
  const layout = normalizeLayout(prefs.data?.value)
  const on = (k: WidgetKey) => layout.items.some(i => i.key === k && !i.hidden)
  const extras = Promise.all([
    on('mytasks') ? c.supabase.from('tasks').select('id,title,due_date').eq('owner_id', c.userId).in('status', ['todo', 'in_progress', 'waiting']).is('deleted_at', null).order('due_date', { nullsFirst: false }).limit(8) : null,
    on('approvals') ? c.supabase.from('approval_requests').select('id,title,amount,entity_type').eq('status', 'pending').order('requested_at').limit(20) : null,
  ])
  const [sources, cheques, activity, salesData, monthInv, monthExp, dueSoon, followDue, activeProjects, activeCount, exp30, expired, visas, vehicles, emp, docsAny, people] = await Promise.all([
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
  const [myTasksRes, apprRes] = await extras
  const [payYear, recentQ, recentI, recentP] = canFin ? await Promise.all([
    sb.from('payments').select('paid_on,amount').gte('paid_on', yearStart).lte('paid_on', c.today).limit(20000),
    on('recent') ? sb.from('invoices').select('id,number,customer_name,issue_date,valid_until,total,status,doc_type').eq('doc_type', 'quotation').is('deleted_at', null).order('created_at', { ascending: false }).limit(6) : null,
    on('recent') ? sb.from('invoices').select('id,number,customer_name,issue_date,due_date,total,status,doc_type').eq('doc_type', 'invoice').is('deleted_at', null).order('created_at', { ascending: false }).limit(6) : null,
    on('recent') ? sb.from('payments').select('id,amount,paid_on,method,reference,invoice:invoices(id,number,customer_name),customer:customers(id,name)').order('paid_on', { ascending: false }).order('created_at', { ascending: false }).limit(6) : null,
  ]) : [null, null, null, null]
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

  const W: Partial<Record<WidgetKey, React.ReactNode>> = {
    finance: (sk && ageing && cs && trend) ? <section aria-label="Financial pulse" className="mb-5 overflow-hidden rounded-lg border border-border bg-surface shadow-card">
      <div className="grid grid-cols-1 divide-y divide-border sm:grid-cols-2 sm:divide-y-0 xl:grid-cols-4 [&>*]:border-border sm:[&>*:nth-child(odd)]:border-e xl:[&>*]:border-e xl:[&>*:last-child]:border-e-0 sm:[&>*:nth-child(-n+2)]:border-b xl:[&>*:nth-child(-n+2)]:border-b-0">
        <Pulse href="/reports?period=month" label="Sales this month" value={formatAed(salesNet)} delta={trend.change.sales} note="excl. VAT · vs same days last month"
          spark={<Spark values={trend.months.map(m => m.sales)} label="Sales, last 12 months" />} />
        <Pulse href="/invoices?tab=receivables" label="Outstanding receivables" value={formatAed(sk.outstanding)}
          note={<>{sk.openCount} open invoice{sk.openCount === 1 ? '' : 's'}{sk.overdueCount > 0 && <> · <span className="font-medium text-danger">{formatAed(sk.overdue)} overdue</span></>}</>}
          foot={ageing.grand > 0 ? <div className="mt-3"><div className="flex h-1.5 gap-px overflow-hidden rounded-full bg-surface-2" role="img" aria-label={`Ageing: ${AGE_BUCKETS.map((b, i) => `${b} ${formatAed(ageing.totals[i])}`).join(', ')}`}>
            {ageing.totals.map((v, i) => v > 0 && <span key={i} style={{ flexGrow: v }} className={['bg-primary/70', 'bg-warning/60', 'bg-warning', 'bg-danger/70', 'bg-danger'][i]} />)}</div>
            <div className="mt-1.5 flex justify-between text-[11px] text-muted"><span>Not due</span><span>90+ days</span></div></div> : null} />
        <Pulse href="/invoices?tab=payments" label="Collected this month" value={formatAed(trend.mtd.collected)} delta={trend.change.collected} note={`Invoiced ${formatAed(sk.invoicedThisMonth)} incl. VAT`}
          spark={<Spark values={trend.months.map(m => m.collected)} className="text-success" label="Collections, last 12 months" />} />
        <Pulse href="/invoices?tab=quotation" label="Open quotations" value={formatAed(sk.pipeline)}
          note={<>{sk.pipelineCount} open{sk.winRate !== null ? ` · ${sk.winRate}% accepted` : ''} · {(followDue?.count ?? 0) > 0 ? <span className="font-medium text-warning">{followDue!.count} follow-up{followDue!.count === 1 ? '' : 's'} due</span> : 'no follow-ups due'}</>} />
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-border bg-surface-2/40 px-4 py-2 text-xs text-muted">
        <Link href="/cheques" className="hover:text-fg">Cheques this week <span className="font-medium tabular-nums text-fg">In {formatAed(amt(weekIn))}</span> · <span className="font-medium tabular-nums text-fg">Out {formatAed(amt(weekOut))}</span></Link>
        {expenses > 0 && <Link href="/expenses" className="hover:text-fg" title="Sales excluding VAT minus recorded expenses; labour and overheads count only if recorded">Recorded expenses this month <span className="font-medium tabular-nums text-fg">{formatAed(expenses)}</span> · Estimated margin <span className="font-medium tabular-nums text-fg">{formatAed(salesNet - expenses)}</span></Link>}
        {(dueSoon?.count ?? 0) > 0 && <Link href="/invoices?tab=invoice&status=sent" className="hover:text-fg"><span className="font-medium tabular-nums text-fg">{dueSoon!.count}</span> invoice{dueSoon!.count === 1 ? '' : 's'} due in 7 days</Link>}
      </div>
    </section> : null,
    trend: trend ? <Card><CardHeader title="Sales & collections" sub="Last 12 months. Hover a month for its value" action={<Link href="/reports" className="text-xs font-medium text-primary hover:underline">Reports</Link>} />
      <TrendChart months={trend.months} /></Card> : null,
    recent: canFin && recentQ ? <Card><CardTabs id="recent" action={<Link href="/invoices" className="text-xs font-medium text-primary hover:underline">All documents</Link>} tabs={[
      { key: 'q', label: 'Quotations', panel: <DocTable rows={recentQ.data ?? []} dateCol="Valid until" date={(r: any) => r.valid_until} empty="No quotations yet" /> },
      { key: 'i', label: 'Invoices', panel: <DocTable rows={recentI?.data ?? []} dateCol="Due" date={(r: any) => r.due_date} empty="No invoices yet" /> },
      { key: 'p', label: 'Payments', panel: !(recentP?.data ?? []).length ? <EmptyState title="No payments yet" /> : <TableWrap><thead><tr><Th>Date</Th><Th>Received from</Th><Th>Against</Th><Th className="text-right">Amount</Th></tr></thead>
        <tbody className="divide-y divide-border">{(recentP!.data ?? []).map((x: any) => <tr key={x.id}><Td className="whitespace-nowrap tabular-nums text-muted">{formatShortDate(x.paid_on)}</Td>
          <Td className="max-w-[240px] truncate font-medium">{x.invoice?.customer_name ?? x.customer?.name ?? '—'}</Td>
          <Td>{x.invoice ? <Link href={`/invoices/${x.invoice.id}`} className="font-mono text-[13px] text-primary hover:underline">{x.invoice.number}</Link> : x.customer ? <Link href={`/parties/${x.customer.id}`} className="text-muted hover:text-fg">On account</Link> : <span className="text-muted">On account</span>}</Td>
          <Td className="text-right font-medium tabular-nums text-success">{fmtMoney(x.amount)}</Td></tr>)}</tbody></TableWrap> },
    ]} /></Card> : null,
    attention: <Card><CardHeader title="Needs attention" sub="Overdue or due within 30 days" action={c.can('reminders.create') ? <Link href="/reminders" className="text-xs font-medium text-primary hover:underline">All reminders</Link> : undefined} />
        {!alerts.length ? <EmptyState icon={CheckCircle2} title="Nothing is due" body="No documents, cheques, invoices or renewals fall due in the next 30 days." /> :
          <ul className="max-h-[420px] divide-y divide-border overflow-y-auto overscroll-contain">{alerts.slice(0, 20).map(a => <li key={a.key}><Link href={a.href} className="group flex items-start gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-surface-2/50">
            <span className={cn('mt-0.5 w-[72px] shrink-0 text-xs font-medium tabular-nums', a.severity === 'critical' ? 'text-danger' : a.severity === 'warning' ? 'text-warning' : 'text-muted')}>{a.days < 0 ? `${-a.days}d late` : a.days === 0 ? 'Today' : `In ${a.days}d`}</span>
            <span className="min-w-0 flex-1"><span className="block truncate font-medium" title={a.text}>{a.text}</span><span className="block truncate text-xs text-muted">{a.sub}</span></span></Link></li>)}</ul>}</Card>,
    operations: ops.length > 0 && <Card><CardHeader title="Operations" sub={opsNow.length ? 'Counts that need someone today' : undefined} />
          {!opsNow.length ? <p className="flex items-center gap-2 px-4 py-4 text-sm text-muted"><CheckCircle2 size={15} className="text-success" aria-hidden />All clear: no tasks, follow-ups, renewals or cheques waiting.</p> :
          <ul className="divide-y divide-border">{opsNow.map(o => <li key={o.l}><Link href={o.href} className="flex items-center justify-between gap-3 px-4 py-2 text-sm hover:bg-surface-2/50">
            <span className="min-w-0 truncate text-muted">{o.l}</span>
            <span className={cn('font-semibold tabular-nums', !o.v ? 'text-muted/60' : o.bad ? 'text-danger' : o.warn ? 'text-warning' : 'text-fg')}>{o.v}</span></Link></li>)}</ul>}</Card> || null,
    inbox: (c.can('documents.upload') || c.can('employees.view_sensitive')) ? <SmartInboxPanel c={c} /> : null,
    projects: activeProjects && <Card><CardHeader title="Projects in progress" sub={`${activeCount?.count ?? 0} active`} action={<Link href="/projects" className="text-xs font-medium text-primary hover:underline">All projects</Link>} />
        {!(activeProjects.data ?? []).length ? <EmptyState icon={HardHat} title="No open projects" body="Create a project to follow fabrication and site progress, costs and billing." /> :
          <ul className="divide-y divide-border">{(activeProjects.data ?? []).map((p: any) => <li key={p.id}><Link href={`/projects/${p.id}`} className="grid gap-2 px-4 py-3 hover:bg-surface-2/50 sm:grid-cols-[minmax(0,1fr)_130px_130px] sm:items-center">
            <span className="min-w-0"><span className="block truncate text-sm font-medium">{p.name}</span><span className="block truncate text-xs text-muted">{p.customer?.name ?? 'No customer'} · {PROJECT_STATUS[p.status]?.label}</span></span>
            <Progress label="Fabrication" value={p.fabrication_progress} /><Progress label="Site" value={p.site_progress} tone="bg-success" /></Link></li>)}</ul>}</Card> || null,
    activity: <Card><CardHeader title="Recent activity" action={c.can('audit.view') ? <Link href="/audit" className="text-xs font-medium text-primary hover:underline">Audit log</Link> : undefined} />
        {activity ? ((activity.data?.length ?? 0) === 0 ? <EmptyState title="No activity yet" /> :
          <ul className="divide-y divide-border text-sm">{activity.data!.map(a => <li key={a.id} className="flex items-baseline justify-between gap-3 px-4 py-2.5">
            <span className="min-w-0 truncate"><span className="font-medium">{TABLE_LABEL[a.table_name] ?? a.table_name.replace(/_/g, ' ')}</span> <span className="text-muted">{(ACTION_LABEL[a.action] ?? a.action).toLowerCase()} by {a.user_id ? who.get(a.user_id) ?? 'a former user' : 'the system'}</span></span>
            <time className="shrink-0 text-xs tabular-nums text-muted">{new Date(a.created_at).toLocaleString('en-GB', { timeZone: c.company.timezone, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</time></li>)}</ul>)
          : <EmptyState title="Activity is visible to owners" body="Ask an owner for access to the audit trail." />}</Card>,
    mytasks: myTasks ? <Card><CardHeader title="My tasks" sub="Open, by due date" action={<Link href="/tasks?view=mine" className="text-xs font-medium text-primary hover:underline">All my tasks</Link>} />
      {!myTasks.length ? <EmptyState icon={CheckCircle2} title="No open tasks" /> : <ul className="divide-y divide-border text-sm">{myTasks.map((t: any) => <li key={t.id}><Link href={`/tasks?view=mine&open=${t.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2/50">
        <span className="min-w-0 flex-1 truncate">{t.title}</span>{t.due_date && <span className={cn('shrink-0 text-xs tabular-nums', t.due_date < c.today ? 'font-medium text-danger' : 'text-muted')}>{t.due_date === c.today ? 'Today' : formatShortDate(t.due_date)}</span>}</Link></li>)}</ul>}</Card> : null,
    approvals: pendingApprovals ? <Card><CardHeader title="Waiting for approval" action={<Link href="/approvals" className="text-xs font-medium text-primary hover:underline">Approvals</Link>} />
      {!pendingApprovals.length ? <EmptyState icon={CheckCircle2} title="Nothing to approve" /> : <ul className="divide-y divide-border text-sm">{pendingApprovals.map((a: any) => <li key={a.id}><Link href={`/approvals?open=${a.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2/50">
        <span className="min-w-0 flex-1 truncate">{a.title}</span>{a.amount !== null && <span className="shrink-0 text-xs tabular-nums text-muted">{formatAed(a.amount)}</span>}</Link></li>)}</ul>}</Card> : null,
  }
  const visible = layout.items.filter(i => !i.hidden && W[i.key])
  const col = (k: 'top' | 'left' | 'right') => visible.filter(i => i.col === k).map(i => <div key={i.key} className="min-w-0">{W[i.key]}</div>)

  return <>
    <div className="mb-6 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="min-w-0"><h1 className="text-[22px] font-semibold leading-tight tracking-[-0.022em]">{greeting(c.company.timezone || 'Asia/Dubai')}{firstName ? `, ${firstName}` : ''}</h1>
        <p className="mt-1 text-sm text-muted"><span className="sr-only">Dashboard · </span>{c.company.name} · {date}</p></div>
      <div className="flex flex-wrap items-center gap-2"><DashboardCustomize layout={layout} available={(Object.keys(W) as WidgetKey[]).filter(k => k === 'mytasks' || (k === 'approvals' ? c.can('approvals.decide') || c.can('sales.approve') : !!W[k]))} />
        <span className="sm:hidden"><QuickActions can={{ sales: canFin && c.can('records.edit'), docs: c.can('documents.upload'), people: c.can('records.edit'), assets: c.can('records.edit') }} /></span></div>
    </div>

    {isNew && <Card className="mb-5 p-5"><h2 className="text-sm font-semibold">Set up Averiqo</h2><p className="mt-0.5 text-sm text-muted">Four steps to a useful dashboard. Each one fills part of this page.</p>
      <ol className="mt-4 grid gap-px overflow-hidden rounded-md border border-border bg-border text-sm sm:grid-cols-2 lg:grid-cols-4">{[['Add company documents', '/documents', 'Trade licence, VAT certificate, tenancy'], ['Add employees', '/employees', 'Passports, visas, Emirates IDs'], ['Create a quotation', '/invoices', 'Your letterhead, stamp and terms'], ['Set up reminders', '/reminders', 'Recipients and WhatsApp opt-in']].map(([t, h, s], i) =>
        <li key={h} className="bg-surface"><Link href={h} className="block h-full p-3 hover:bg-surface-2/60"><div className="font-medium"><span className="me-1.5 tabular-nums text-muted">{i + 1}.</span>{t}</div><div className="mt-0.5 text-xs text-muted">{s}</div></Link></li>)}</ol></Card>}

    {col('top')}
    <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] [&>*]:min-w-0">
      <div className="flex min-w-0 flex-col gap-5">{col('left')}</div>
      <div className="flex min-w-0 flex-col gap-5">{col('right')}</div>
    </div>
  </>
}

/** One pulse metric: the number, how it moved, what it means; the whole cell opens the list behind it. */
function Pulse({ href, label, value, delta, note, spark, foot }: { href: string; label: string; value: string; delta?: number | null; note?: React.ReactNode; spark?: React.ReactNode; foot?: React.ReactNode }) {
  return <Link href={href} className="group block min-w-0 px-4 py-4 transition-colors hover:bg-surface-2/40 sm:px-5">
    <div className="flex items-start justify-between gap-2"><span className="text-[13px] font-medium text-muted">{label}</span>
      {spark ? <span className="-mt-1 shrink-0 opacity-90">{spark}</span> : <ArrowRight size={14} className="text-muted opacity-0 transition-opacity group-hover:opacity-100 rtl:rotate-180" aria-hidden />}</div>
    <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span className="text-[24px] font-semibold leading-tight tracking-[-0.025em] tabular-nums">{value}</span>
      {delta !== undefined && delta !== null && <span className={cn('inline-flex items-center gap-0.5 rounded px-1 text-xs font-medium tabular-nums', delta >= 0 ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger')} title="Month to date vs the same days last month">{delta >= 0 ? '↑' : '↓'} {Math.abs(delta)}%</span>}
    </div>
    {note && <div className="mt-1 truncate text-xs text-muted">{note}</div>}
    {foot}
  </Link>
}

function DocTable({ rows, dateCol, date, empty }: { rows: any[]; dateCol: string; date: (r: any) => string | null; empty: string }) {
  if (!rows.length) return <EmptyState title={empty} />
  return <TableWrap><thead><tr><Th>No.</Th><Th>Customer</Th><Th>{dateCol}</Th><Th className="text-right">Amount</Th><Th>Status</Th></tr></thead>
    <tbody className="divide-y divide-border">{rows.map(r => <tr key={r.id}>
      <Td className="whitespace-nowrap"><Link href={`/invoices/${r.id}`} className="font-mono text-[12.5px] text-primary hover:underline">{r.number}</Link><span className="block text-xs text-muted">{formatShortDate(r.issue_date)}</span></Td>
      <Td className="max-w-[220px] truncate font-medium">{r.customer_name ?? '—'}</Td>
      <Td className="whitespace-nowrap tabular-nums text-muted">{date(r) ? formatShortDate(date(r)!) : '—'}</Td>
      <Td className="text-right tabular-nums">{fmtMoney(r.total)}</Td>
      <Td><Badge tone={STATUS_TONE[r.status]}>{statusLabel(r.doc_type, r.status)}</Badge></Td></tr>)}</tbody></TableWrap>
}
