import Link from 'next/link'
import { ArrowRight, CheckCircle2, HardHat } from 'lucide-react'
import { getCtx } from '@/lib/auth'
import { Card, CardHeader, EmptyState, PageHeader } from '@/components/ui/primitives'
import { buildAlerts } from '@/lib/dashboard'
import { summarizeCheques } from '@/lib/cheques'
import { addDays, formatAed } from '@/lib/time'
import { cn } from '@/lib/utils'
import { SmartInboxPanel } from '@/components/inbox/smart-center'
import { Progress } from '@/components/projects/project-fields'
import { loadSalesKpis } from '@/lib/sales/kpis'
import { AGE_BUCKETS, receivablesAgeing } from '@/lib/sales/summary'
import { PROJECT_STATUS } from '@/lib/projects'
import { ACTION_LABEL, TABLE_LABEL } from '@/lib/audit'
import { QuickActions } from '@/components/layout/quick-actions'

export const metadata = { title: 'Dashboard' }

/**
 * Dashboard hierarchy: 1) financial pulse (money owed, sales, collections, cheques) 2) what needs attention now
 * 3) operations (projects, compliance counts, inbox, activity). Every number is a link to the list it counts.
 */
export default async function Dashboard() {
  const c = await getCtx(); const sb = c.supabase; const head = { count: 'exact' as const, head: true }
  const canDocs = c.can('documents.view') || c.can('employees.view_sensitive'), canFin = c.can('finance.view')
  const in30 = addDays(c.today, 30), month = c.today.slice(0, 7) + '-01', week = addDays(c.today, 7)

  const [sources, cheques, activity, salesData, monthInv, monthExp, dueSoon, followDue, activeProjects, activeCount, exp30, expired, visas, vehicles, emp, docsAny, people] = await Promise.all([
    sb.from('reminder_sources').select('source_type,source_id,title,subject,owner_type,due_date,amount,direction,link').lte('due_date', in30).order('due_date').limit(60),
    canFin ? sb.from('cheques').select('direction,status,amount,cheque_date').in('status', ['received', 'issued', 'scheduled', 'deposited', 'presented']).limit(5000) : null,
    c.can('audit.view') ? sb.from('audit_logs').select('id,action,table_name,created_at,user_id,record_id').in('table_name', ['invoices', 'payments', 'customers', 'projects', 'cheques', 'documents', 'employees', 'assets', 'project_expenses']).order('created_at', { ascending: false }).limit(8) : null,
    canFin ? loadSalesKpis(c) : null,
    canFin ? sb.from('invoices').select('total,vat_amount').eq('doc_type', 'invoice').not('status', 'in', '(draft,cancelled)').gte('issue_date', month).lte('issue_date', c.today).limit(5000) : null,
    canFin ? sb.from('project_expenses').select('amount').gte('spent_on', month).lte('spent_on', c.today).limit(10000) : null,
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
  const alerts = buildAlerts((sources.data ?? []) as any, c.today)
  const salesNet = (monthInv?.data ?? []).reduce((s, r) => s + Number(r.total) - Number(r.vat_amount), 0)
  const expenses = (monthExp?.data ?? []).reduce((s, r) => s + Number(r.amount), 0)
  const who = new Map((people?.data ?? []).map(p => [p.id, p.full_name]))
  const sk = salesData?.kpis ?? null
  const cs = cheques ? summarizeCheques((cheques.data ?? []) as any, c.today) : null
  const ageing = salesData ? receivablesAgeing(salesData.openRows, c.today) : null
  const weekIn = cs?.dueThisWeek.filter(x => x.direction === 'incoming') ?? [], weekOut = cs?.dueThisWeek.filter(x => x.direction === 'outgoing') ?? []
  const amt = (xs: { amount: number | string }[]) => xs.reduce((a, x) => a + Number(x.amount), 0)
  const isNew = (docsAny?.count ?? 0) + (emp?.count ?? 0) + (cheques?.data?.length ?? 0) + (sk?.openCount ?? 0) + (sk?.pipelineCount ?? 0) === 0
  const date = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: c.company.timezone }).format(new Date())

  // operations / compliance counts: one compact list, zero values stay quiet
  // field operations: my open tasks due today / overdue, lead follow-ups due, visits today
  const head1 = { count: 'exact' as const, head: true }
  const [myDue, leadDue, visitsToday] = await Promise.all([
    c.supabase.from('tasks').select('id', head1).eq('owner_id', c.userId).in('status', ['todo', 'in_progress', 'waiting']).lte('due_date', c.today),
    c.can('crm.view') ? c.supabase.from('leads').select('id', head1).lte('next_followup', c.today).not('stage', 'in', '(won,lost,on_hold)') : Promise.resolve({ count: undefined }),
    c.can('documents.view') ? c.supabase.from('site_visits').select('id', head1).in('status', ['scheduled', 'rescheduled']).eq('scheduled_date', c.today) : Promise.resolve({ count: undefined }),
  ])
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

  return <>
    <PageHeader title="Dashboard" sub={`${c.company.name} · ${date}`} actions={<QuickActions can={{ sales: canFin && c.can('records.edit'), docs: c.can('documents.upload'), people: c.can('records.edit'), assets: c.can('records.edit') }} />} />

    {isNew && <Card className="mb-5 p-5"><h2 className="text-sm font-semibold">Set up Averiqo</h2><p className="mt-0.5 text-sm text-muted">Four steps to a useful dashboard. Each one fills part of this page.</p>
      <ol className="mt-4 grid gap-px overflow-hidden rounded-md border border-border bg-border text-sm sm:grid-cols-2 lg:grid-cols-4">{[['Add company documents', '/documents', 'Trade licence, VAT certificate, tenancy'], ['Add employees', '/employees', 'Passports, visas, Emirates IDs'], ['Create a quotation', '/invoices', 'Your letterhead, stamp and terms'], ['Set up reminders', '/reminders', 'Recipients and WhatsApp opt-in']].map(([t, h, s], i) =>
        <li key={h} className="bg-surface"><Link href={h} className="block h-full p-3 hover:bg-surface-2/60"><div className="font-medium"><span className="me-1.5 tabular-nums text-muted">{i + 1}.</span>{t}</div><div className="mt-0.5 text-xs text-muted">{s}</div></Link></li>)}</ol></Card>}

    {/* 1. financial pulse */}
    {sk && ageing && cs && <Card className="mb-5 grid grid-cols-1 overflow-hidden lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
      <Link href="/invoices?tab=receivables" className="group block border-b border-border p-5 hover:bg-surface-2/30 lg:border-b-0 lg:border-e">
        <div className="flex items-center justify-between text-xs font-medium text-muted"><span>Outstanding receivables</span><ArrowRight size={14} className="opacity-0 transition-opacity group-hover:opacity-100 rtl:rotate-180" aria-hidden /></div>
        <div className="mt-1.5 text-[28px] font-semibold leading-none tracking-[-0.02em] tabular-nums">{formatAed(sk.outstanding)}</div>
        <div className="mt-2 text-sm text-muted">{sk.openCount} open invoice{sk.openCount === 1 ? '' : 's'}{sk.overdueCount > 0 && <> · <span className="font-medium text-danger">{formatAed(sk.overdue)} overdue</span> on {sk.overdueCount}</>}</div>
        {ageing.grand > 0 && <div className="mt-5">
          <div className="flex h-2 gap-px overflow-hidden rounded-sm" role="img" aria-label={`Ageing: ${AGE_BUCKETS.map((b, i) => `${b} ${formatAed(ageing.totals[i])}`).join(', ')}`}>
            {ageing.totals.map((v, i) => v > 0 && <span key={i} style={{ flexGrow: v }} className={['bg-primary/70', 'bg-warning/60', 'bg-warning', 'bg-danger/70', 'bg-danger'][i]} />)}</div>
          <dl className="mt-3 grid grid-cols-5 gap-2 text-xs">{AGE_BUCKETS.map((b, i) => <div key={b} className="min-w-0"><dt className="truncate text-muted">{i === 0 ? 'Not due' : `${b} days`}</dt><dd className={cn('mt-0.5 truncate font-medium tabular-nums', i >= 3 && ageing.totals[i] > 0 && 'text-danger')}>{ageing.totals[i] ? formatAed(ageing.totals[i]).replace('AED ', '') : '0'}</dd></div>)}</dl>
        </div>}
      </Link>
      <div className="grid grid-cols-2 [&>a]:border-border [&>a:nth-child(odd)]:border-e [&>a:nth-child(-n+2)]:border-b">
        {[{ l: 'Sales this month', v: formatAed(salesNet), h: 'Invoiced, excluding VAT', href: '/reports?period=month' },
          { l: 'Collected this month', v: formatAed(sk.collectedThisMonth), h: `Invoiced ${formatAed(sk.invoicedThisMonth)} incl. VAT`, href: '/invoices?tab=payments' },
          { l: 'Open quotations', v: formatAed(sk.pipeline), h: `${sk.pipelineCount} open${sk.winRate !== null ? ` · ${sk.winRate}% accepted` : ''}`, href: '/invoices?tab=quotation' },
          { l: 'Cheques this week', v: formatAed(amt(weekIn) - amt(weekOut)), h: `In ${formatAed(amt(weekIn))} · Out ${formatAed(amt(weekOut))}`, href: '/cheques' }].map(x =>
          <Link key={x.l} href={x.href} className="block min-w-0 px-5 py-4 hover:bg-surface-2/30"><div className="text-xs font-medium text-muted">{x.l}</div>
            <div className="mt-1 truncate text-lg font-semibold tabular-nums tracking-[-0.01em]">{x.v}</div><div className="truncate text-xs text-muted" title={x.h}>{x.h}</div></Link>)}
      </div>
    </Card>}
    {sk && expenses > 0 && <p className="-mt-3 mb-5 text-xs text-muted">Recorded expenses this month: <Link href="/expenses" className="font-medium text-fg tabular-nums hover:text-primary">{formatAed(expenses)}</Link>. Estimated margin {formatAed(salesNet - expenses)} (sales ex VAT minus recorded expenses; labour and overheads are only included if recorded).</p>}

    {/* 2. what needs attention */}
    <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] [&>*]:min-w-0">
      <Card><CardHeader title="Needs attention" sub="Overdue or due within 30 days" action={c.can('reminders.create') ? <Link href="/reminders" className="text-xs font-medium text-primary hover:underline">All reminders</Link> : undefined} />
        {!alerts.length ? <EmptyState icon={CheckCircle2} title="Nothing is due" body="No documents, cheques, invoices or renewals fall due in the next 30 days." /> :
          <ul className="max-h-[440px] divide-y divide-border overflow-y-auto">{alerts.slice(0, 20).map(a => <li key={a.key}><Link href={a.href} className="group flex items-start gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-surface-2/50">
            <span className={cn('mt-0.5 w-[72px] shrink-0 text-xs font-medium tabular-nums', a.severity === 'critical' ? 'text-danger' : a.severity === 'warning' ? 'text-warning' : 'text-muted')}>{a.days < 0 ? `${-a.days}d late` : a.days === 0 ? 'Today' : `In ${a.days}d`}</span>
            <span className="min-w-0 flex-1"><span className="block truncate font-medium" title={a.text}>{a.text}</span><span className="block truncate text-xs text-muted">{a.sub}</span></span></Link></li>)}</ul>}</Card>
      <div className="flex min-w-0 flex-col gap-5">
        {ops.length > 0 && <Card><CardHeader title="Operations" />
          <ul className="divide-y divide-border">{ops.map(o => <li key={o.l}><Link href={o.href} className="flex items-center justify-between gap-3 px-4 py-2 text-sm hover:bg-surface-2/50">
            <span className="min-w-0 truncate text-muted">{o.l}</span>
            <span className={cn('font-semibold tabular-nums', !o.v ? 'text-muted/60' : o.bad ? 'text-danger' : o.warn ? 'text-warning' : 'text-fg')}>{o.v}</span></Link></li>)}</ul></Card>}
        {(c.can('documents.upload') || c.can('employees.view_sensitive')) && <SmartInboxPanel c={c} />}
      </div>
    </div>

    {/* 3. operations detail */}
    <div className="mt-5 grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] [&>*]:min-w-0">
      {activeProjects && <Card><CardHeader title="Projects in progress" sub={`${activeCount?.count ?? 0} active`} action={<Link href="/projects" className="text-xs font-medium text-primary hover:underline">All projects</Link>} />
        {!(activeProjects.data ?? []).length ? <EmptyState icon={HardHat} title="No open projects" body="Create a project to follow fabrication and site progress, costs and billing." /> :
          <ul className="divide-y divide-border">{(activeProjects.data ?? []).map((p: any) => <li key={p.id}><Link href={`/projects/${p.id}`} className="grid gap-2 px-4 py-3 hover:bg-surface-2/50 sm:grid-cols-[minmax(0,1fr)_130px_130px] sm:items-center">
            <span className="min-w-0"><span className="block truncate text-sm font-medium">{p.name}</span><span className="block truncate text-xs text-muted">{p.customer?.name ?? 'No customer'} · {PROJECT_STATUS[p.status]?.label}</span></span>
            <Progress label="Fabrication" value={p.fabrication_progress} /><Progress label="Site" value={p.site_progress} tone="bg-success" /></Link></li>)}</ul>}</Card>}
      <Card><CardHeader title="Recent activity" action={c.can('audit.view') ? <Link href="/audit" className="text-xs font-medium text-primary hover:underline">Audit log</Link> : undefined} />
        {activity ? ((activity.data?.length ?? 0) === 0 ? <EmptyState title="No activity yet" /> :
          <ul className="divide-y divide-border text-sm">{activity.data!.map(a => <li key={a.id} className="flex items-baseline justify-between gap-3 px-4 py-2.5">
            <span className="min-w-0 truncate"><span className="font-medium">{TABLE_LABEL[a.table_name] ?? a.table_name.replace(/_/g, ' ')}</span> <span className="text-muted">{(ACTION_LABEL[a.action] ?? a.action).toLowerCase()} by {a.user_id ? who.get(a.user_id) ?? 'a former user' : 'the system'}</span></span>
            <time className="shrink-0 text-xs tabular-nums text-muted">{new Date(a.created_at).toLocaleString('en-GB', { timeZone: c.company.timezone, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</time></li>)}</ul>)
          : <EmptyState title="Activity is visible to owners" body="Ask an owner for access to the audit trail." />}</Card>
    </div>
  </>
}
