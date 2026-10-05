import Link from 'next/link'
import { AlertOctagon, AlertTriangle, BellRing, CalendarClock, CheckCircle2, FileText, Landmark, Users, Wallet, Activity, ArrowRight } from 'lucide-react'
import { getCtx } from '@/lib/auth'
import { Badge, Card, CardHeader, EmptyState, PageHeader, StatCard } from '@/components/ui/primitives'
import { ChequeChart, ExpiryChart } from '@/components/charts'
import { buildAlerts, monthBuckets } from '@/lib/dashboard'
import { summarizeCheques } from '@/lib/cheques'
import { addDays, formatAed } from '@/lib/time'
import { cn } from '@/lib/utils'
import { SmartDocumentCenter } from '@/components/inbox/smart-center'
import { Progress } from '@/components/projects/project-fields'
import { loadSalesKpis } from '@/lib/sales/kpis'
import { PROJECT_STATUS } from '@/lib/projects'
import { HardHat, Receipt, Target } from 'lucide-react'

export const metadata = { title: 'Overview' }

export default async function Dashboard() {
  const c = await getCtx(); const sb = c.supabase; const head = { count: 'exact' as const, head: true }
  const canDocs = c.can('documents.view') || c.can('employees.view_sensitive'), canFin = c.can('finance.view')
  const months = monthBuckets(c.today), last = addDays(months.at(-1)!.key + '-01', 31)

  const [emp, docs, exp30, expired, sources, docDates, cheques, activity, tasks] = await Promise.all([
    c.can('employees.view') ? sb.from('employees').select('id', head).eq('status', 'active') : null,
    canDocs ? sb.from('documents').select('id', head).is('deleted_at', null) : null,
    canDocs ? sb.from('documents').select('id', head).is('deleted_at', null).gte('expiry_date', c.today).lte('expiry_date', addDays(c.today, 30)) : null,
    canDocs ? sb.from('documents').select('id', head).is('deleted_at', null).lt('expiry_date', c.today) : null,
    sb.from('reminder_sources').select('source_type,source_id,title,subject,owner_type,due_date,amount,direction,link').lte('due_date', addDays(c.today, 30)).order('due_date').limit(60),
    canDocs ? sb.from('documents').select('expiry_date,owner_type').is('deleted_at', null).gte('expiry_date', c.today).lte('expiry_date', last).limit(5000) : null,
    canFin ? sb.from('cheques').select('direction,status,amount,cheque_date').limit(5000) : null,
    c.can('audit.view') ? sb.from('audit_logs').select('id,action,table_name,created_at,user_id,record_id').order('created_at', { ascending: false }).limit(10) : null,
    c.can('documents.view') ? sb.from('documents').select('id', head).is('deleted_at', null).eq('status', 'renewal_in_progress') : null,
  ])
  const alerts = buildAlerts((sources.data ?? []) as any, c.today)
  const [salesData, activeProjects] = await Promise.all([
    canFin ? loadSalesKpis(c) : null,
    c.can('documents.view') ? sb.from('projects').select('id,name,status,fabrication_progress,site_progress,customer:customers(name)').in('status', ['active', 'planning', 'on_hold']).order('updated_at', { ascending: false }).limit(5) : null,
  ])
  const sk = salesData?.kpis ?? null
  const cs = cheques ? summarizeCheques((cheques.data ?? []) as any, c.today) : null
  const expiryData = months.map(m => ({ month: m.label, employee: 0, company: 0 }))
  for (const d of docDates?.data ?? []) { const i = months.findIndex(m => m.key === d.expiry_date!.slice(0, 7)); if (i >= 0) expiryData[i][d.owner_type === 'employee' ? 'employee' : 'company']++ }
  const chequeData = months.map(m => ({ month: m.label, incoming: 0, outgoing: 0 }))
  for (const ch of cheques?.data ?? []) { if (['cleared', 'cancelled', 'returned'].includes(ch.status)) continue; const i = months.findIndex(m => m.key === ch.cheque_date.slice(0, 7)); if (i >= 0) chequeData[i][ch.direction as 'incoming' | 'outgoing'] += Number(ch.amount) }
  const hasData = (docs?.count ?? 0) + (emp?.count ?? 0) + (cheques?.data?.length ?? 0) > 0
  const nm = (c.profile.full_name || '').split(' ')[0]

  return <>
    <PageHeader title={`Welcome, ${nm}`} sub={`${c.company.name} · ${new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeZone: c.company.timezone }).format(new Date())}`} />
    {!hasData && <Card className="mb-5 border-primary/30 bg-primary-soft/40 p-5"><h2 className="font-semibold">Let’s get you set up</h2>
      <ol className="mt-2 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">{[['1. Add company documents', '/documents', 'Trade licence, VAT, tenancy…'], ['2. Add employees', '/employees', 'Passports, visas, Emirates IDs'], ['3. Add cheques', '/cheques', 'Incoming, outgoing, PDC'], ['4. Set up reminders', '/reminders', 'Recipients & WhatsApp opt-in']].map(([t, h, s]) =>
        <li key={h}><Link href={h} className="block rounded-md border border-border bg-surface p-3 hover:border-primary/40"><div className="font-medium">{t}</div><div className="text-xs text-muted">{s}</div></Link></li>)}</ol></Card>}

    <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {emp && <StatCard label="Active employees" value={emp.count ?? 0} icon={Users} href="/employees" />}
      {docs && <StatCard label="Documents stored" value={docs.count ?? 0} icon={FileText} href="/vault" />}
      {exp30 && <StatCard label="Expiring within 30 days" value={exp30.count ?? 0} icon={CalendarClock} tone={exp30.count ? 'amber' : 'neutral'} href="/documents?status=expiring30" />}
      {expired && <StatCard label="Already expired" value={expired.count ?? 0} icon={AlertOctagon} tone={expired.count ? 'red' : 'neutral'} href="/documents?status=expired" />}
      {cs && <StatCard label="Cheques due this week" value={cs.dueThisWeek.length} hint={formatAed(cs.dueThisWeek.reduce((a, x) => a + Number(x.amount), 0))} icon={Landmark} tone="blue" href="/cheques" />}
      {cs && <StatCard label="Cheques overdue" value={cs.overdue.length} hint="Cheque date passed, not banked" icon={AlertTriangle} tone={cs.overdue.length ? 'red' : 'neutral'} href="/cheques?view=list" />}
      {cs && <StatCard label="Awaiting clearance" value={cs.awaitingClearance.length} hint="Verify with your bank" icon={Wallet} href="/cheques?status=deposited" />}
      {tasks && <StatCard label="Renewals in progress" value={tasks.count ?? 0} icon={BellRing} href="/documents" />}
    </div>

    {(c.can('documents.upload') || c.can('employees.view_sensitive')) && <SmartDocumentCenter c={c} />}
    <div className="grid gap-5 lg:grid-cols-5 [&>*]:min-w-0">
      <Card className="lg:col-span-3"><CardHeader title="Priority alerts" sub="Overdue and due within 30 days — click to open the record" />
        {!alerts.length ? <EmptyState icon={CheckCircle2} title="Nothing needs attention" body="No documents, cheques or reminders are due in the next 30 days." /> :
          <ul className="max-h-[420px] divide-y divide-border overflow-y-auto">{alerts.slice(0, 20).map(a => <li key={a.key}><Link href={a.href} className="group flex items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-surface-2/60">
            <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', a.severity === 'critical' ? 'bg-danger' : a.severity === 'warning' ? 'bg-warning' : 'bg-primary')} />
            <span className="min-w-0 flex-1"><span className="block font-medium">{a.text}</span><span className="text-xs text-muted">{a.sub}</span></span>
            <ArrowRight size={14} className="shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100 rtl:rotate-180" /></Link></li>)}</ul>}</Card>
      <Card className="lg:col-span-2"><CardHeader title="Recent activity" />
        {activity ? ((activity.data?.length ?? 0) === 0 ? <EmptyState icon={Activity} title="No activity yet" /> :
          <ul className="divide-y divide-border text-sm">{activity.data!.map(a => <li key={a.id} className="flex items-center justify-between gap-2 px-4 py-2.5"><span className="truncate"><b className="capitalize">{a.action.toLowerCase()}</b> <span className="text-muted">{a.table_name.replace(/_/g, ' ')}</span></span><span className="shrink-0 text-xs text-muted">{a.created_at.slice(5, 16).replace('T', ' ')}</span></li>)}</ul>)
          : <EmptyState title="Activity log is restricted" body="Only owners can see the audit trail." />}</Card>
      {docDates && <Card className="lg:col-span-3"><CardHeader title="Document expiries — next 6 months" /><div className="p-4"><ExpiryChart data={expiryData} /></div></Card>}
      {cs && <Card className="lg:col-span-2"><CardHeader title="Cheque commitments — next 6 months" sub="Open cheques by cheque date" /><div className="p-4"><ChequeChart data={chequeData} /></div></Card>}
    </div>
    {(sk || activeProjects) && <div className="mt-5 grid gap-5 lg:grid-cols-5 [&>*]:min-w-0">
      {sk && <Card className="lg:col-span-2"><CardHeader title="Sales & receivables" action={<Link href="/invoices" className="text-xs text-primary hover:underline">Open sales</Link>} />
        <div className="grid grid-cols-2 gap-px bg-border">
          {[{ l: 'Outstanding', v: formatAed(sk.outstanding), h: `${sk.openCount} open invoices`, i: Wallet, href: '/invoices?tab=receivables' },
            { l: 'Overdue', v: formatAed(sk.overdue), h: `${sk.overdueCount} invoices`, i: AlertTriangle, href: '/invoices?tab=invoice&status=overdue', bad: sk.overdueCount > 0 },
            { l: 'Collected this month', v: formatAed(sk.collectedThisMonth), h: `Invoiced ${formatAed(sk.invoicedThisMonth)}`, i: Receipt, href: '/invoices?tab=payments' },
            { l: 'Open quotations', v: formatAed(sk.pipeline), h: sk.winRate !== null ? `${sk.winRate}% win rate` : `${sk.pipelineCount} open`, i: Target, href: '/invoices?tab=quotation' }].map(x =>
            <Link key={x.l} href={x.href} className="bg-surface p-4 transition-colors hover:bg-surface-2/60"><div className="flex items-center gap-1.5 text-xs text-muted"><x.i size={13} aria-hidden />{x.l}</div>
              <div className={cn('mt-1 text-lg font-semibold tabular-nums', x.bad && 'text-danger')}>{x.v}</div><div className="text-xs text-muted">{x.h}</div></Link>)}
        </div></Card>}
      {activeProjects && <Card className="lg:col-span-3"><CardHeader title="Active projects" action={<Link href="/projects" className="text-xs text-primary hover:underline">All projects</Link>} />
        {!(activeProjects.data ?? []).length ? <EmptyState icon={HardHat} title="No open projects" body="Create a project to track fabrication, site progress, costs and billing." /> :
          <ul className="divide-y divide-border">{(activeProjects.data ?? []).map((p: any) => <li key={p.id}><Link href={`/projects/${p.id}`} className="grid gap-2 px-4 py-3 hover:bg-surface-2/60 sm:grid-cols-[1fr_140px_140px] sm:items-center">
            <span className="min-w-0"><span className="block truncate text-sm font-medium">{p.name}</span><span className="text-xs text-muted">{p.customer?.name ?? '—'} · {PROJECT_STATUS[p.status]?.label}</span></span>
            <Progress label="Fabrication" value={p.fabrication_progress} /><Progress label="Site" value={p.site_progress} tone="bg-success" /></Link></li>)}</ul>}</Card>}
    </div>}</>
}
