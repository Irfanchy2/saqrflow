import Link from 'next/link'
import { SalesDocBadge } from '@/components/sales/status-badges'
import { Banknote, Briefcase, CalendarDays, CheckCircle2, Clock, FileText, HardHat, Landmark, Receipt, ShieldCheck, Truck, Flag, Users, Wallet, ProjectDoc } from '@/components/icons'
import { getCtx } from '@/lib/auth'
import { Badge, Card, CardHeader, CardLink, EmptyState, Metrics, StatCard, Td, Th, TableWrap } from '@/components/ui/primitives'
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
import { ArrangeButton, DashboardBoard } from '@/components/dashboard/board'
import { normalizeLayout, type WidgetKey } from '@/lib/dashboard-widgets'
import { canDecide } from '@/lib/approvals'
import { buildTrend, greeting } from '@/lib/dashboard-trend'
import { TrendChart } from '@/components/dashboard/trend-chart'
import { CardTabs } from '@/components/dashboard/tabs'
import { QuickGrid } from '@/components/dashboard/quick-grid'
import { MiniCalendar } from '@/components/dashboard/mini-calendar'
import { TaskCheck } from '@/components/dashboard/task-check'
import { STATUS_TONE, statusLabel } from '@/lib/sales/docs'
import { fmtMoney } from '@/lib/sales/money'
import { onTimeRate, orderBook, salesFunnel } from '@/lib/dashboard-ops'
import { pctChange } from '@/lib/dashboard-trend'
import { OnTheFloor, OnTheRoad, RunningLow, SalesFunnel, TeamToday, TodayHero, type DayEvent } from '@/components/dashboard/ops-panels'

export const metadata = { title: 'Dashboard' }

/**
 * Dashboard hierarchy: 1) financial pulse (money owed, sales, collections, cheques) 2) what needs attention now
 * 3) operations (projects, compliance counts, inbox, activity). Every number is a link to the list it counts.
 */
export default async function Dashboard() {
  const c = await getCtx(); const sb = c.supabase; const head = { count: 'exact' as const, head: true }
  const canDocs = c.can('documents.view') || c.can('employees.view_sensitive'), canFin = c.can('finance.view')
  const in30 = addDays(c.today, 30), week = addDays(c.today, 7), tz = c.company.timezone || 'Asia/Dubai'
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
  // the operations panels (work orders on the floor, funnel, stock, the road, the team, cash on hand, today's timeline)
  const docsView = c.can('documents.view'), open3 = ['todo', 'in_progress', 'waiting']
  const ts = (d: string) => `${d}T00:00:00Z`, d14 = addDays(c.today, -14), d28 = addDays(c.today, -28), d90 = addDays(c.today, -90)
  const opsP = Promise.all([
    docsView ? sb.from('work_orders').select('id,number,title,status,target_date,priority,customer:customers(name),project:projects(name)', { count: 'exact' }).is('deleted_at', null).not('status', 'in', '(completed,cancelled)').order('target_date', { ascending: true, nullsFirst: false }).limit(6) : null,
    docsView ? sb.from('work_orders').select('target_date,completed_at').is('deleted_at', null).eq('status', 'completed').gte('completed_at', ts(d90)).limit(3000) : null,
    docsView ? sb.from('work_orders').select('id', head).is('deleted_at', null).eq('status', 'completed').gte('completed_at', ts(d14)) : null,
    docsView ? sb.from('work_orders').select('id', head).is('deleted_at', null).eq('status', 'completed').gte('completed_at', ts(d28)).lt('completed_at', ts(d14)) : null,
    docsView ? sb.from('work_orders').select('id,title').is('deleted_at', null).not('status', 'in', '(completed,cancelled)').eq('target_date', c.today).limit(6) : null,
    canFin && docsView ? sb.from('projects').select('id,contract_value').in('status', ['planning', 'active', 'on_hold']).not('contract_value', 'is', null).limit(3000) : null,
    // invoiced so far on those open projects, in the same round (no second trip after the projects come back)
    canFin && docsView ? sb.from('invoices').select('project_id,total,vat_amount,project:projects!inner(status)').eq('doc_type', 'invoice').not('status', 'in', '(draft,cancelled)').is('deleted_at', null).in('project.status', ['planning', 'active', 'on_hold']).limit(20000) : null,
    c.can('crm.view') ? sb.from('leads').select('stage,estimated_value').is('deleted_at', null).gte('created_at', ts(yearStart)).limit(5000) : null,
    docsView ? sb.from('stock_items').select('id,name,unit,on_hand,reorder_level,reorder_qty', { count: 'exact' }).eq('is_low', true).order('on_hand').limit(5) : null,
    docsView ? sb.from('stock_items').select('id', head).eq('active', true) : null,
    docsView ? sb.from('site_visits').select('id,number,location,scheduled_time,employee_id,employee:employees(full_name),customer:customers(name)').in('status', ['scheduled', 'rescheduled']).eq('scheduled_date', c.today).order('scheduled_time', { nullsFirst: false }).limit(8) : null,
    canFin ? sb.from('invoices').select('id,number,customer_name,site,issue_date').eq('doc_type', 'delivery_note').eq('status', 'sent').is('deleted_at', null).order('issue_date', { ascending: false }).limit(4) : null,
    canFin ? sb.from('bank_balances').select('id,name,account_display_name,account_type,balance').eq('active', true).order('balance', { ascending: false }) : null,
    c.can('employees.view_sensitive') ? sb.from('leave_records').select('employee_id').eq('status', 'approved').lte('start_date', c.today).gte('end_date', c.today).limit(500) : null,
    docsView ? sb.from('work_order_members').select('employee_id,employee:employees(full_name),wo:work_orders!inner(title,status,deleted_at)').in('wo.status', ['scheduled', 'in_fabrication', 'ready_for_site', 'installation', 'inspection']).is('wo.deleted_at', null).limit(300) : null,
    sb.from('tasks').select('id,title').eq('owner_id', c.userId).in('status', open3).is('deleted_at', null).eq('due_date', c.today).limit(5),
    canFin ? sb.from('invoices').select('id,number,customer_name').eq('doc_type', 'invoice').in('status', ['sent', 'partially_paid', 'overdue']).is('deleted_at', null).eq('due_date', c.today).limit(5) : null,
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
  // recent invoices show document status and payment status separately ("Sent | Unpaid")
  const invIds = (recentI?.data ?? []).map((r: any) => r.id)
  const { data: invSt } = invIds.length ? await sb.from('invoice_list').select('id,doc_status,payment_status').in('id', invIds) : { data: [] as any[] }
  const stOf = new Map((invSt ?? []).map((x: any) => [x.id, x]))
  const recentInv = (recentI?.data ?? []).map((r: any) => ({ ...r, ...stOf.get(r.id) }))
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
  const [woOpen, woDone90, wo14, woPrev14, woToday, openProjects, invoicedOnOpen, leadRows, lowRes, stockAny, visitRows, dnRows, accts, leaveRows, crew, tasksToday, invToday] = await opsP
  const book = openProjects ? orderBook((openProjects.data ?? []) as any, (invoicedOnOpen?.data ?? []) as any) : null
  const onTime = woDone90 ? onTimeRate((woDone90.data ?? []) as any, tz) : null
  const visits = (visitRows?.data ?? []) as any[]
  const events: DayEvent[] = [
    ...visits.map(v => ({ time: v.scheduled_time ? String(v.scheduled_time).slice(0, 5) : null, label: v.customer?.name ?? v.location ?? v.number, sub: v.employee?.full_name, href: `/site-visits?open=${v.id}`, kind: 'visit' as const })),
    ...(woToday?.data ?? []).map((w: any) => ({ time: null, label: w.title, href: `/work-orders?open=${w.id}`, kind: 'order' as const })),
    ...(tasksToday.data ?? []).map((t: any) => ({ time: null, label: t.title, href: `/tasks?view=mine&open=${t.id}`, kind: 'task' as const })),
    ...((cheques?.data ?? []) as any[]).filter(q => q.cheque_date === c.today).slice(0, 4).map(q => ({ time: null, label: `Cheque ${q.direction === 'incoming' ? 'in' : 'out'} ${formatAed(q.amount)}`, href: '/cheques', kind: 'cheque' as const })),
    ...(invToday?.data ?? []).map((i: any) => ({ time: null, label: `${i.number} due · ${i.customer_name ?? ''}`.trim(), href: `/invoices/${i.id}`, kind: 'invoice' as const })),
  ]
  const accounts = (accts?.data ?? []).map((a: any) => ({ id: a.id, label: [a.name, a.account_display_name].filter(Boolean).join(' · '), balance: Number(a.balance), type: a.account_type }))
  const cash = !accts ? null : accounts.length ? { total: accounts.reduce((s, a) => s + a.balance, 0), accounts } : c.can('cheques.manage') ? 'none' as const : null
  const leaveIds = new Set((leaveRows?.data ?? []).map((l: any) => l.employee_id)), crewRows = (crew?.data ?? []) as any[]
  const crewPeople = new Map<string, { id: string; name: string; what: string }>()
  for (const m of crewRows) if (m.employee?.full_name && !crewPeople.has(m.employee_id)) crewPeople.set(m.employee_id, { id: m.employee_id, name: m.employee.full_name, what: m.wo?.title ?? 'Work order' })
  for (const v of visits) if (v.employee_id && v.employee?.full_name && !crewPeople.has(v.employee_id)) crewPeople.set(v.employee_id, { id: v.employee_id, name: v.employee.full_name, what: `Site visit${v.scheduled_time ? ' ' + String(v.scheduled_time).slice(0, 5) : ''}` })
  const woTodayN = woToday?.data?.length ?? 0, visitN = visitsToday.count ?? 0
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
  const can = { sales: canFin && c.can('records.edit'), docs: c.can('documents.upload'), people: c.can('records.edit'), assets: c.can('records.edit') }
  const ALERT_ICON: Record<string, [typeof FileText, string]> = { document: [FileText, 'bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300'], cheque: [Landmark, 'bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300'], followup: [CalendarDays, 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300'], lead_followup: [CalendarDays, 'bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300'], task: [CheckCircle2, 'bg-teal-50 text-teal-600 dark:bg-teal-500/15 dark:text-teal-300'],
    invoice: [Receipt, 'bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300'], milestone: [Flag, 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300'], asset: [Truck, 'bg-orange-50 text-orange-600 dark:bg-orange-500/15 dark:text-orange-300'] }
  const alertIcon = (key: string) => { const t = key.split(':')[0]; return ALERT_ICON[t.startsWith('asset_') ? 'asset' : t] ?? [ShieldCheck, 'bg-surface-2 text-muted'] }
  const ACT: Record<string, [typeof FileText, string]> = { invoices: [Receipt, 'bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300'], payments: [Banknote, 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300'], projects: [ProjectDoc, 'bg-orange-50 text-orange-600 dark:bg-orange-500/15 dark:text-orange-300'], cheques: [Landmark, 'bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300'], documents: [FileText, 'bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300'],
    customers: [Users, 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300'], employees: [Users, 'bg-teal-50 text-teal-600 dark:bg-teal-500/15 dark:text-teal-300'],
    assets: [Truck, 'bg-orange-50 text-orange-600 dark:bg-orange-500/15 dark:text-orange-300'], project_expenses: [Wallet, 'bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300'] }
  const ago = (iso: string) => { const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000)); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : m < 2880 ? 'yesterday' : formatShortDate(iso.slice(0, 10)) }
  const tone = (st: string): 'green' | 'amber' | 'red' | 'blue' | 'neutral' => st === 'active' ? 'green' : st === 'on_hold' ? 'amber' : st === 'planning' ? 'blue' : 'neutral'

  const W: Partial<Record<WidgetKey, React.ReactNode>> = {
    finance: (sk && ageing && cs && trend) ? <section aria-label="Key figures" className="mb-5">
      <Metrics cols={4} phone="grid">
        <StatCard label="Revenue this month" value={formatAed(salesNet)} change={trend.change.sales} hint="Invoiced ex VAT, vs same days last month" bars={months8.map(m => m.sales)} href="/reports?period=month" icon={Receipt} index={0} />
        {docsView && <StatCard label="Work orders completed" value={wo14?.count ?? 0} change={pctChange(wo14?.count ?? 0, woPrev14?.count ?? 0)} hint="Last 14 days, vs the 14 before" href="/work-orders?status=completed" icon={HardHat} index={1} />}
        {book && <StatCard label="Open order book" value={formatAed(book.value)} hint={book.projects ? `Left to invoice on ${book.projects} project${book.projects === 1 ? '' : 's'}` : 'Contract values of open projects'} href="/projects" icon={Briefcase} index={2} />}
        {onTime && <StatCard label="On-time completion" value={onTime.pct === null ? '—' : `${onTime.pct}%`} tone={onTime.pct !== null && onTime.pct < 70 ? 'amber' : 'neutral'} hint={onTime.total ? `${onTime.onTime} of ${onTime.total} work orders by target · 90 days` : 'No completed work orders with a target yet'} href="/work-orders?status=completed" icon={Clock} index={3} />}
      </Metrics>
      <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1.5 rounded-2xl border border-white/70 bg-surface/75 px-5 py-2.5 text-[13px] text-muted shadow-card backdrop-blur-xl dark:border-white/[.06]">
        <Link href="/invoices?tab=receivables" className="hover:text-fg">Receivables <span className="font-semibold tabular-nums text-fg">{formatAed(sk.outstanding)}</span>{sk.overdueCount > 0 && <span className="font-medium text-danger"> · {formatAed(sk.overdue)} overdue</span>}</Link>
        <Link href="/invoices?tab=payments" className="hover:text-fg">Collected this month <span className="font-semibold tabular-nums text-fg">{formatAed(trend.mtd.collected)}</span></Link>
        <Link href="/invoices?tab=quotation" className="hover:text-fg">Open quotations <span className="font-semibold tabular-nums text-fg">{formatAed(sk.pipeline)}</span>{(followDue?.count ?? 0) > 0 ? <span className="font-medium text-warning"> · {followDue!.count} follow-up{followDue!.count === 1 ? '' : 's'} due</span> : ' · no follow-ups due'}</Link>
        <Link href="/cheques" className="hover:text-fg">Cheques this week <span className="font-semibold tabular-nums text-fg">In {formatAed(amt(weekIn))}</span> · <span className="font-semibold tabular-nums text-fg">Out {formatAed(amt(weekOut))}</span></Link>
        {expenses > 0 && <Link href="/expenses" className="hover:text-fg" title="Sales excluding VAT minus recorded expenses; labour and overheads count only if recorded">Recorded expenses this month <span className="font-semibold tabular-nums text-fg">{formatAed(expenses)}</span> · Estimated margin <span className="font-semibold tabular-nums text-fg">{formatAed(salesNet - expenses)}</span></Link>}
        {(dueSoon?.count ?? 0) > 0 && <Link href="/invoices?tab=invoice&status=sent" className="hover:text-fg"><span className="font-semibold tabular-nums text-fg">{dueSoon!.count}</span> invoice{dueSoon!.count === 1 ? '' : 's'} due in 7 days</Link>}
        {sk.winRate !== null && <span>Quotation win rate <span className="font-semibold tabular-nums text-fg">{sk.winRate}%</span></span>}
      </div>
    </section> : null,
    trend: trend ? <Card className="h-full"><TrendChart title="Year at a glance" months={trend.months} change={{ sales: trend.change.sales, collected: trend.change.collected }} action={<CardLink href="/reports">Reports</CardLink>} /></Card> : null,
    funnel: leadRows ? <SalesFunnel steps={salesFunnel((leadRows.data ?? []) as any)} /> : null,
    floor: woOpen ? <OnTheFloor rows={(woOpen.data ?? []) as any} total={woOpen.count ?? 0} today={c.today} /> : null,
    road: docsView ? <OnTheRoad visits={visits} deliveries={(dnRows?.data ?? []) as any} /> : null,
    lowstock: lowRes ? <RunningLow rows={(lowRes.data ?? []) as any} total={lowRes.count ?? 0} tracked={(stockAny?.count ?? 0) > 0} /> : null,
    team: emp ? <TeamToday active={emp.count ?? 0} onLeave={leaveIds.size} onSite={new Set(visits.map(v => v.employee_id).filter(Boolean)).size} onJobs={new Set(crewRows.map(m => m.employee_id)).size} people={[...crewPeople.values()]} /> : null,
    quick: <Card className="h-full"><CardHeader title="Quick actions" /><QuickGrid can={{ sales: can.sales, crm: c.can('crm.view') && c.can('records.edit'), docs: can.docs, people: can.people, projects: c.can('documents.view') && c.can('records.edit') }} /></Card>,
    recent: canFin && recentQ ? <Card><CardTabs id="recent" action={<CardLink href="/invoices">All documents</CardLink>} tabs={[
      { key: 'q', label: 'Recent quotations', panel: <DocTable rows={recentQ.data ?? []} dateCol="Valid until" date={(r: any) => r.valid_until} empty="No quotations yet" /> },
      { key: 'i', label: 'Recent invoices', panel: <DocTable rows={recentInv} dateCol="Due" date={(r: any) => r.due_date} empty="No invoices yet" /> },
      { key: 'p', label: 'Recent payments', panel: !(recentP?.data ?? []).length ? <EmptyState compact title="No payments yet" /> : <TableWrap><thead><tr><Th>Date</Th><Th>Received from</Th><Th>Against</Th><Th>Method</Th><Th className="text-right">Amount</Th></tr></thead>
        <tbody className="divide-y divide-border">{(recentP!.data ?? []).map((x: any) => <tr key={x.id}><Td className="whitespace-nowrap tabular-nums">{formatShortDate(x.paid_on)}</Td>
          <Td className="max-w-[240px] truncate font-medium">{x.invoice?.customer_name ?? x.customer?.name ?? '—'}</Td>
          <Td>{x.invoice ? <Link href={`/invoices/${x.invoice.id}`} className="font-medium text-primary hover:underline">{x.invoice.number}</Link> : x.customer ? <Link href={`/parties/${x.customer.id}`} className="text-muted hover:text-fg">On account</Link> : <span className="text-muted">On account</span>}</Td>
          <Td className="capitalize text-muted">{String(x.method ?? '—').replace(/_/g, ' ')}</Td>
          <Td className="text-right font-semibold tabular-nums text-success">{fmtMoney(x.amount)}</Td></tr>)}</tbody></TableWrap> },
      ...(activeProjects ? [{ key: 'pr', label: 'Ongoing projects', panel: !(activeProjects.data ?? []).length ? <EmptyState compact title="No open projects" /> : <TableWrap><thead><tr><Th>Project</Th><Th>Customer</Th><Th>Fabrication</Th><Th>Site</Th><Th>Status</Th></tr></thead>
        <tbody className="divide-y divide-border">{(activeProjects.data ?? []).map((p: any) => <tr key={p.id}><Td className="max-w-[260px] truncate font-medium"><Link href={`/projects/${p.id}`} className="hover:text-primary">{p.name}</Link></Td>
          <Td className="max-w-[200px] truncate text-muted">{p.customer?.name ?? '—'}</Td><Td className="tabular-nums">{p.fabrication_progress ?? 0}%</Td><Td className="tabular-nums">{p.site_progress ?? 0}%</Td>
          <Td badge><Badge tone={tone(p.status)}>{PROJECT_STATUS[p.status]?.label ?? p.status}</Badge></Td></tr>)}</tbody></TableWrap> }] : []),
      ...(recentE ? [{ key: 'e', label: 'Recent expenses', panel: !(recentE.data ?? []).length ? <EmptyState compact title="No expenses yet" /> : <TableWrap><thead><tr><Th>Date</Th><Th>Description</Th><Th>Project</Th><Th>Category</Th><Th className="text-right">Amount</Th></tr></thead>
        <tbody className="divide-y divide-border">{(recentE.data ?? []).map((x: any) => <tr key={x.id}><Td className="whitespace-nowrap tabular-nums">{formatShortDate(x.spent_on)}</Td>
          <Td className="max-w-[260px] truncate font-medium">{x.description}</Td><Td className="max-w-[200px] truncate">{x.project ? <Link href={`/projects/${x.project.id}`} className="text-muted hover:text-fg">{x.project.name}</Link> : '—'}</Td>
          <Td className="capitalize text-muted">{x.category}</Td><Td className="text-right tabular-nums">{fmtMoney(x.amount)}</Td></tr>)}</tbody></TableWrap> }] : []),
    ]} /></Card> : null,
    attention: <Card><CardHeader title="Needs attention" sub="Overdue or due within 30 days" action={c.can('reminders.create') ? <CardLink href="/reminders" /> : undefined} />
        {!alerts.length ? <EmptyState compact icon={CheckCircle2} title="Nothing is due" body="No documents, cheques, invoices or renewals fall due in the next 30 days." /> :
          <ul className="max-h-[440px] overflow-y-auto overscroll-contain px-2 pb-2">{alerts.slice(0, 20).map(a => { const [I, tint] = alertIcon(a.key); return <li key={a.key}><Link href={a.href} className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors hover:bg-surface-2/70">
            <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-lg', tint)} aria-hidden><I size={16} /></span>
            <span className="min-w-0 flex-1"><span className="line-clamp-2 font-medium leading-snug [overflow-wrap:anywhere]" title={a.text}>{a.text}</span><span className="block truncate text-xs text-muted">{a.sub}</span></span>
            <span className={cn('shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums', a.severity === 'critical' ? 'bg-danger/10 text-danger' : a.severity === 'warning' ? 'bg-warning/10 text-warning' : 'bg-surface-2 text-muted')}>{a.days < 0 ? `${-a.days}d late` : a.days === 0 ? 'Today' : `${a.days} days`}</span></Link></li> })}</ul>}</Card>,
    calendar: <Card className="hidden md:block"><MiniCalendar today={c.today} due={dueMap} /></Card>,
    operations: ops.length > 0 && <Card><CardHeader title="Operations" sub={opsNow.length ? 'Counts that need someone today' : undefined} />
          {!opsNow.length ? <p className="flex items-center gap-2 px-5 pb-4 text-sm text-muted"><CheckCircle2 size={15} className="text-success" aria-hidden />All clear: no tasks, follow-ups, renewals or cheques waiting.</p> :
          <ul className="px-2 pb-2">{opsNow.map(o => <li key={o.l}><Link href={o.href} className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm hover:bg-surface-2/70">
            <span className="min-w-0 truncate text-muted">{o.l}</span>
            <span className={cn('min-w-7 rounded-md px-1.5 text-center text-xs font-semibold leading-6 tabular-nums', o.bad ? 'bg-danger/10 text-danger' : o.warn ? 'bg-warning/10 text-warning' : 'bg-surface-2 text-fg')}>{o.v}</span></Link></li>)}</ul>}</Card> || null,
    inbox: (c.can('documents.upload') || c.can('employees.view_sensitive')) ? <SmartInboxPanel c={c} /> : null,
    projects: activeProjects && <Card className="h-full"><CardHeader title="Projects in progress" sub={`${activeCount?.count ?? 0} active`} action={<CardLink href="/projects" />} />
        {!(activeProjects.data ?? []).length ? <EmptyState compact icon={ProjectDoc} title="No open projects" body="Create a project to follow fabrication and site progress, costs and billing." /> :
          <ul className="px-2 pb-2">{(activeProjects.data ?? []).map((p: any) => { const pct = Math.round(((p.fabrication_progress ?? 0) + (p.site_progress ?? 0)) / 2); return <li key={p.id}><Link href={`/projects/${p.id}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 rounded-lg px-3 py-2.5 hover:bg-surface-2/70 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto]">
            <span className="min-w-0"><span className="block truncate text-sm font-medium">{p.name}</span><span className="block truncate text-xs text-muted">{p.customer?.name ?? 'No customer'}</span></span>
            <span className="col-span-2 flex items-center gap-2.5 sm:col-span-1" title={`Fabrication ${p.fabrication_progress ?? 0}% · Site ${p.site_progress ?? 0}%`}><span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2"><span className={cn('block h-full rounded-full', pct >= 75 ? 'bg-success' : pct >= 40 ? 'bg-primary' : 'bg-warning')} style={{ width: `${pct}%` }} /></span><span className="w-9 text-end text-xs font-medium tabular-nums">{pct}%</span></span>
            <span className="row-start-1 col-start-2 sm:col-start-3"><Badge tone={tone(p.status)}>{PROJECT_STATUS[p.status]?.label ?? p.status}</Badge></span></Link></li> })}</ul>}</Card> || null,
    activity: <Card className="h-full"><CardHeader title="Live activity" action={c.can('audit.view') ? <CardLink href="/audit">Audit log</CardLink> : undefined} />
        {activity ? ((activity.data?.length ?? 0) === 0 ? <EmptyState compact title="No activity yet" /> :
          <ul className="px-2 pb-2 text-sm">{activity.data!.map(a => { const [I, tint] = ACT[a.table_name] ?? [FileText, 'bg-surface-2 text-muted']; return <li key={a.id} className="flex items-center gap-3 rounded-lg px-3 py-2">
            <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-lg', tint)} aria-hidden><I size={15} /></span>
            <span className="min-w-0 flex-1 truncate"><span className="font-medium">{TABLE_LABEL[a.table_name] ?? a.table_name.replace(/_/g, ' ')}</span> <span className="text-muted">{(ACTION_LABEL[a.action] ?? a.action).toLowerCase()} by {a.user_id ? who.get(a.user_id) ?? 'a former user' : 'the system'}</span></span>
            <time dateTime={a.created_at} title={new Date(a.created_at).toLocaleString('en-GB', { timeZone: c.company.timezone })} className="shrink-0 text-xs tabular-nums text-muted">{ago(a.created_at)}</time></li> })}</ul>)
          : <EmptyState compact title="Activity is visible to owners" body="Ask an owner for access to the audit trail." />}</Card>,
    mytasks: myTasks ? <Card><CardHeader title="My tasks" sub="Open, by due date" action={<CardLink href="/tasks?view=mine" />} />
      {!myTasks.length ? <EmptyState compact icon={CheckCircle2} title="No open tasks" /> : <ul className="px-2 pb-2 text-sm">{myTasks.map((t: any) => <li key={t.id} className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-surface-2/70">
        <TaskCheck id={t.id} title={t.title} />
        <Link href={`/tasks?view=mine&open=${t.id}`} className="-my-2 min-w-0 flex-1 py-2"><span className="block truncate font-medium">{t.title}</span>{t.project?.name && <span className="block truncate text-xs text-muted">{t.project.name}</span>}</Link>
        {t.due_date && <span className={cn('shrink-0 text-xs tabular-nums', t.due_date < c.today ? 'font-semibold text-danger' : t.due_date === c.today ? 'font-semibold text-warning' : 'text-muted')}>{t.due_date === c.today ? 'Today' : formatShortDate(t.due_date)}</span>}</li>)}</ul>}</Card> : null,
    approvals: pendingApprovals ? <Card><CardHeader title="Waiting for approval" action={<CardLink href="/approvals" />} />
      {!pendingApprovals.length ? <EmptyState compact icon={CheckCircle2} title="Nothing to approve" /> : <ul className="px-2 pb-2 text-sm">{pendingApprovals.map((a: any) => <li key={a.id}><Link href={`/approvals?open=${a.id}`} className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-surface-2/70">
        <span className="min-w-0 flex-1 truncate">{a.title}</span>{a.amount !== null && <span className="shrink-0 text-xs tabular-nums text-muted">{formatAed(a.amount)}</span>}</Link></li>)}</ul>}</Card> : null,
  }
  // the hero carries the page actions (Customize lists the widgets that have something to show, the hero included)
  const headerActions = <><ArrangeButton /><span className="contents max-sm:hidden"><DashboardCustomize layout={layout} available={['banner', ...(Object.keys(W) as WidgetKey[]).filter(k => k === 'mytasks' || (k === 'approvals' ? c.can('approvals.decide') || c.can('sales.approve') : !!W[k]))]} /></span>
    <QuickActions label="Create new" can={can} /></>
  W.banner = <TodayHero greet={`${greeting(tz)}${firstName ? `, ${firstName}` : ''}`} date={date} time={time} tz={tz} canEdit={c.can('settings.manage')} demo={!!c.company.is_demo} now={time} events={events} cash={cash}
      chip={[...(docsView ? [`${visitN} site visit${visitN === 1 ? '' : 's'}`] : []), ...(woTodayN ? [`${woTodayN} work order${woTodayN === 1 ? '' : 's'} due`] : [])]} actions={headerActions} />
  const visible = layout.items.filter(i => !i.hidden && W[i.key])
  const shown = new Set(visible.map(i => i.key))
  const PHONE_HIDDEN: WidgetKey[] = ['calendar', 'inbox']   // phones get the same dashboard; only the month grid and the inbox panel stay on bigger screens

  return <>
    {!shown.has('banner') && <div className="mb-6 hidden flex-wrap items-center justify-between gap-x-4 gap-y-3 sm:flex">
      <div className="min-w-0"><h1 className="text-[26px] font-semibold leading-tight tracking-[-0.03em]">{greeting(tz)}{firstName ? `, ${firstName}` : ''}</h1>
        <p className="mt-1 text-sm text-muted"><span className="sr-only">Dashboard · {c.company.name} · </span>{date}</p></div>
      <div className="flex flex-wrap items-center gap-2.5">{headerActions}</div>
    </div>}

    {isNew && <Card className="mb-5 p-5"><h2 className="text-[15px] font-semibold">Set up Averiqo</h2><p className="mt-0.5 text-sm text-muted">Four steps to a useful dashboard. Each one fills part of this page.</p>
      <ol className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">{[['Add company documents', '/documents', 'Trade licence, VAT certificate, tenancy'], ['Add employees', '/employees', 'Passports, visas, Emirates IDs'], ['Create a quotation', '/invoices', 'Your letterhead, stamp and terms'], ['Set up reminders', '/reminders', 'Recipients and WhatsApp opt-in']].map(([t, h, s], i) =>
        <li key={h}><Link href={h} className="flex h-full gap-3 rounded-xl border border-border p-3.5 transition-colors hover:border-border-strong hover:bg-surface-2/50"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary-soft text-xs font-semibold text-primary">{i + 1}</span><span><span className="block font-medium">{t}</span><span className="mt-0.5 block text-xs text-muted">{s}</span></span></Link></li>)}</ol></Card>}

    {/* the cards in the user's order; drag a card's grip (or Arrange on touch screens) to move it */}
    <DashboardBoard layout={layout} nodes={Object.fromEntries(visible.map(i => [i.key, W[i.key]]))} phoneHidden={PHONE_HIDDEN} />
  </>
}

/** Latest sales documents: number (with issue date), customer, project or subject, the relevant date, amount, status. */
function DocTable({ rows, dateCol, date, empty }: { rows: any[]; dateCol: string; date: (r: any) => string | null; empty: string }) {
  if (!rows.length) return <EmptyState compact title={empty} />
  return <TableWrap><thead><tr><Th>No.</Th><Th>Customer</Th><Th className="sm:max-lg:hidden">Project / subject</Th><Th className="sm:max-xl:hidden">Date</Th><Th>{dateCol}</Th><Th className="text-right">Amount (AED)</Th><Th>Status</Th></tr></thead>
    <tbody className="divide-y divide-border">{rows.map(r => <tr key={r.id}>
      <Td className="whitespace-nowrap"><Link href={`/invoices/${r.id}`} className="font-medium text-primary hover:underline">{r.number}</Link></Td>
      <Td className="max-w-[200px] truncate font-medium">{r.customer_name ?? '—'}</Td>
      <Td className="max-w-[200px] truncate text-muted sm:max-lg:hidden">{r.project?.name ?? r.subject ?? r.site ?? '—'}</Td>
      <Td className="whitespace-nowrap tabular-nums text-muted sm:max-xl:hidden">{formatShortDate(r.issue_date)}</Td>
      <Td className="whitespace-nowrap tabular-nums text-muted">{date(r) ? formatShortDate(date(r)!) : '—'}</Td>
      <Td className="text-right font-medium tabular-nums">{fmtMoney(r.total)}</Td>
      <Td badge><SalesDocBadge r={r} /></Td></tr>)}</tbody></TableWrap>
}
