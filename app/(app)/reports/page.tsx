import Link from 'next/link'
import { redirect } from 'next/navigation'
import { BarChart3, Download, FileText } from 'lucide-react'
import { getCtx } from '@/lib/auth'
import { flat } from '@/lib/queries'
import { Card, CardHeader, EmptyState, LinkButton, Metrics, PageHeader, StatCard } from '@/components/ui/primitives'
import { PrintButton } from '@/components/print-button'
import { AgeingBars, StackBars, TimeBars } from '@/components/charts'
import { ReportTable } from '@/components/reports/report-table'
import { allowedSections, loadReport } from '@/lib/reports/load'
import { PERIODS } from '@/lib/reports/period'
import { SECTIONS, conversionRate, projectProfit, sectionTables, type SectionKey } from '@/lib/reports/sections'
import { formatAed, formatShortDate } from '@/lib/time'
import { cn } from '@/lib/utils'

export const metadata = { title: 'Reports & Analytics' }
const monthLabel = (ym: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'short' }).format(new Date(ym + '-01T00:00:00Z'))

export default async function Reports({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await getCtx(); const sp = await flat(searchParams)
  const allowed = allowedSections(c)
  if (!c.can('finance.view') && !c.can('documents.view') && !c.can('employees.view')) redirect('/')
  const section = (allowed.includes(sp.section as SectionKey) ? sp.section : 'overview') as SectionKey
  const { period, data: s } = await loadReport(c, sp)
  const fin = c.can('finance.view')
  const qs = (extra: Record<string, string | undefined>) => new URLSearchParams(Object.entries({ section, period: period.key, ...(period.key === 'custom' ? { from: period.from, to: period.to } : {}), ...extra }).filter(([, v]) => v) as [string, string][]).toString()
  const range = `from=${period.from}&to=${period.to}`
  const exportQs = qs({ section: undefined })
  const tables = section === 'overview' ? [] : sectionTables(section, s, c.today)
  const generated = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: c.company.timezone }).format(new Date())
  const title = SECTIONS.find(([k]) => k === section)![1]

  // ── shared numbers ──
  const sales = s.sales, rv = s.receivables, q = s.quotations, pr = s.projects, ch = s.cheques, d = s.documents ?? {}, rs = s.resources ?? {}
  const projRows = ((pr?.rows ?? []) as any[]).filter(p => p.status !== 'completed')
  const projValue = projRows.reduce((a, p) => a + Number(p.value ?? 0), 0), projExp = projRows.reduce((a, p) => a + Number(p.expenses ?? 0), 0)
  const docSum = (f: string, groups = ['company', 'employee', 'vehicle', 'asset']) => groups.reduce((a, g) => a + Number(d[g]?.[f] ?? 0), 0)
  const conv = conversionRate(q)
  const monthly = ((s.monthly ?? []) as any[]).map(m => ({ label: monthLabel(m.month), invoiced: Number(m.net), received: Number(m.received) }))
  const docMonthly = ((s.doc_monthly ?? []) as any[]).map(m => ({ label: monthLabel(m.month), company: m.company, employee: m.employee, resource: m.resource }))
  const noData = !Number(sales?.count) && !Number(rv?.count) && !Number(q?.count) && !docSum('total') && !Number(rs.vehicles) && !Number(rs.assets) && !Number(pr?.active)

  return <>
    {/* print header: business + report + range + generated, with the software named once */}
    <div className="print-only mb-4 border-b border-border pb-3">
      <div className="text-base font-semibold">{c.company.name}</div>
      <div className="text-sm">{title} report · {period.label}</div>
      <div className="text-xs text-muted">Generated {generated} · Averiqo Reports</div>
    </div>
    <PageHeader title="Reports & Analytics" sub={`${period.label}. Figures come from your records; nothing is estimated unless marked.`}
      actions={<div className="no-print flex flex-wrap gap-2">{c.can('data.export') && section !== 'overview' && <>
        <LinkButton variant="ghost" href={`/api/reports/${section}?${exportQs}&format=csv`}><Download size={15} />CSV</LinkButton>
        <LinkButton variant="ghost" href={`/api/reports/${section}?${exportQs}&format=xlsx`}><Download size={15} />Excel</LinkButton>
        <LinkButton variant="secondary" href={`/api/reports/${section}?${exportQs}&format=pdf`} target="_blank"><FileText size={15} />PDF</LinkButton></>}
        <PrintButton /></div>} />

    <div className="no-print mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
      <nav aria-label="Report period" className="inline-flex flex-wrap rounded-md border border-border bg-surface p-0.5 text-sm">
        {PERIODS.filter(([k]) => k !== 'custom').map(([k, l]) => <Link key={k} href={`/reports?${new URLSearchParams({ section, period: k })}`} aria-current={period.key === k ? 'true' : undefined}
          className={cn('rounded-[5px] px-2.5 py-1 transition-colors', period.key === k ? 'bg-surface-2 font-medium text-fg ring-1 ring-inset ring-border' : 'text-muted hover:text-fg')}>{l}</Link>)}</nav>
      <form className="flex flex-wrap items-center gap-1.5 text-sm" aria-label="Custom date range"><input type="hidden" name="section" value={section} /><input type="hidden" name="period" value="custom" />
        <input type="date" name="from" defaultValue={period.from} aria-label="From" className="h-8 rounded-md border border-border bg-surface px-2 text-sm" /><span className="text-muted">to</span>
        <input type="date" name="to" defaultValue={period.to} aria-label="To" className="h-8 rounded-md border border-border bg-surface px-2 text-sm" />
        <button className="h-8 cursor-pointer rounded-md border border-border px-2.5 hover:bg-surface-2">Apply</button></form>
    </div>
    <nav aria-label="Report sections" className="no-print mb-5 flex gap-1 overflow-x-auto border-b border-border">{SECTIONS.filter(([k]) => allowed.includes(k)).map(([k, l]) =>
      <Link key={k} href={`/reports?${qs({ section: k })}`} aria-current={section === k ? 'page' : undefined}
        className={cn('-mb-px shrink-0 border-b-2 px-3 py-2 text-sm transition-colors', section === k ? 'border-primary font-medium text-fg' : 'border-transparent text-muted hover:text-fg')}>{l}</Link>)}</nav>

    {noData && section === 'overview' ? <Card><EmptyState icon={BarChart3} title="No records to report on yet" body="Reports fill in as you issue invoices, record payments, add documents, vehicles and projects. Nothing here is sample data." /></Card> : <>

    {section === 'overview' && <div className="space-y-5">
      {fin && sales && <Metrics cols={6}>
        <StatCard label="Total sales (excl. VAT)" value={formatAed(sales.net)} hint={`${sales.count} invoice${sales.count === 1 ? '' : 's'} issued`} href={`/invoices?tab=invoice&issued=1&${range}`} />
        <StatCard label="Payments received" value={formatAed(s.received)} href="/invoices?tab=payments" />
        <StatCard label="Outstanding receivables" value={formatAed(rv?.total ?? 0)} hint={`${rv?.count ?? 0} open invoices`} href={`/reports?${qs({ section: 'receivables' })}`} />
        <StatCard label="Overdue invoices" value={rv?.overdue_count ?? 0} hint={formatAed(rv?.overdue ?? 0)} tone={rv?.overdue_count ? 'red' : 'neutral'} href="/invoices?tab=invoice&due=overdue" />
        <StatCard label="Quotation value" value={formatAed(q?.value ?? 0)} hint={`${q?.count ?? 0} quotations`} href={`/invoices?tab=quotation&${range}`} />
        <StatCard label="Quotation conversion" value={conv == null ? 'No decisions yet' : `${conv}%`} hint={q?.decided ? `${q.won} of ${q.decided} decided` : 'Accepted ÷ decided'} href={`/invoices?tab=quotation&won=1&${range}`} />
      </Metrics>}
      <Metrics cols={fin ? 4 : 4}>
        {fin && pr && <StatCard label="Active projects" value={pr.active} hint={projValue ? `Contract value ${formatAed(projValue)}` : undefined} href="/projects?status=active" />}
        {fin && pr && <StatCard label="Project expenses recorded" value={formatAed(projExp)} hint="Open projects" href={`/reports?${qs({ section: 'projects' })}`} />}
        {fin && ch && <StatCard label="Cheques due this week" value={ch.week_n} hint={`Net ${formatAed(ch.week)}`} href="/cheques" />}
        <StatCard label="Documents expiring in 30 days" value={docSum('d30')} hint={`${docSum('expired')} already expired`} tone={docSum('expired') ? 'red' : 'neutral'} href="/vault?status=expiring30" />
        <StatCard label="Employee documents expiring" value={Number(d.employee?.d30 ?? 0)} hint="Within 30 days" href="/vault?owner=employee&status=expiring30" />
        <StatCard label="Vehicle renewals due" value={Number(rs.reg_due ?? 0) + Number(rs.ins_due ?? 0) + Number(rs.insp_due ?? 0)} hint="Registration, insurance, inspection in 30 days" href="/assets?tab=vehicles&due=30" />
        <StatCard label="Asset maintenance due" value={Number(rs.a_service_due ?? 0) + Number(rs.v_service_due ?? 0)} hint="Within 30 days" href="/assets?due=30" />
        {fin && rv && <StatCard label="Average invoice" value={formatAed(sales?.avg ?? 0)} hint="Issued in this period" href={`/invoices?tab=invoice&issued=1&${range}`} />}
      </Metrics>
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2 [&>*]:min-w-0">
        {fin && <Card><CardHeader title="Invoiced vs received" sub="Last 12 months, excluding VAT. Table in Sales." /><div className="p-4"><TimeBars label="Invoiced versus received per month" data={monthly} series={[{ key: 'invoiced', name: 'Invoiced', slot: 1 }, { key: 'received', name: 'Received', slot: 2 }]} /></div></Card>}
        <Card><CardHeader title="Upcoming document expiries" sub="Next 6 months, by group. Table in Documents & staff." /><div className="p-4"><StackBars label="Document expiries per month by group" data={docMonthly} series={[{ key: 'company', name: 'Company', slot: 1 }, { key: 'employee', name: 'Employees', slot: 2 }, { key: 'resource', name: 'Vehicles & assets', slot: 3 }]} /></div></Card>
      </div>
    </div>}

    {section === 'sales' && sales && <div className="space-y-5">
      <Metrics cols={5}>
        <StatCard label="Sales excl. VAT" value={formatAed(sales.net)} href={`/invoices?tab=invoice&issued=1&${range}`} />
        <StatCard label="VAT invoiced" value={formatAed(sales.vat)} />
        <StatCard label="Invoices issued" value={sales.count} href={`/invoices?tab=invoice&issued=1&${range}`} />
        <StatCard label="Average invoice (incl. VAT)" value={formatAed(sales.avg)} />
        <StatCard label="Credit notes" value={formatAed(s.credited)} href={`/invoices?tab=credit_note&${range}`} />
      </Metrics>
      <Card><CardHeader title="Monthly sales" sub="Invoiced excl. VAT against money received, last 12 months" /><div className="p-4"><TimeBars label="Invoiced versus received per month" data={monthly} series={[{ key: 'invoiced', name: 'Invoiced', slot: 1 }, { key: 'received', name: 'Received', slot: 2 }]} /></div></Card>
    </div>}

    {section === 'quotations' && q && <div className="space-y-5">
      <Metrics cols={6}>
        <StatCard label="Quotations" value={q.count} href={`/invoices?tab=quotation&${range}`} />
        <StatCard label="Quoted value" value={formatAed(q.value)} />
        <StatCard label="Accepted value" value={formatAed(q.won_value)} href={`/invoices?tab=quotation&won=1&${range}`} />
        <StatCard label="Conversion rate" value={conv == null ? 'No decisions yet' : `${conv}%`} hint={`${q.won} accepted of ${q.decided} decided`} />
        <StatCard label="Average quotation" value={formatAed(q.avg)} />
        <StatCard label="Still open" value={['draft', 'sent', 'viewed', 'follow_up'].reduce((a, k) => a + Number(q.by_status?.[k]?.n ?? 0), 0)} href="/invoices?tab=quotation" />
      </Metrics>
      <Card><CardHeader title="Quotations per month" sub="Issued and accepted, last 12 months" /><div className="p-4"><TimeBars money={false} label="Quotations issued and accepted per month" data={((s.quote_monthly ?? []) as any[]).map(m => ({ label: monthLabel(m.month), issued: m.count, accepted: m.won }))} series={[{ key: 'issued', name: 'Issued', slot: 1 }, { key: 'accepted', name: 'Accepted', slot: 2 }]} /></div></Card>
    </div>}

    {section === 'receivables' && rv && <div className="space-y-5">
      <Metrics cols={4}>
        <StatCard label="Total outstanding" value={formatAed(rv.total)} hint={`${rv.count} open invoices`} href="/invoices?tab=invoice&due=open" />
        <StatCard label="Overdue" value={formatAed(rv.overdue)} hint={`${rv.overdue_count} invoices`} tone={rv.overdue_count ? 'red' : 'neutral'} href="/invoices?tab=invoice&due=overdue" />
        <StatCard label="Over 90 days" value={formatAed(rv.over90)} tone={Number(rv.over90) ? 'red' : 'neutral'} />
        <StatCard label="Not yet due" value={formatAed(rv.current)} />
      </Metrics>
      <Card><CardHeader title="Outstanding by age" sub={`As of ${formatShortDate(c.today)}, by days past the due date`} /><div className="p-4"><AgeingBars data={[['Not yet due', rv.current], ['1-30 days', rv.d30], ['31-60 days', rv.d60], ['61-90 days', rv.d90], ['Over 90 days', rv.over90]].map(([label, value]) => ({ label: label as string, value: Number(value) }))} /></div></Card>
    </div>}

    {section === 'projects' && pr && <Metrics className="mb-5" cols={4}>
      <StatCard label="Active projects" value={pr.active} href="/projects?status=active" />
      <StatCard label="Completed" value={pr.completed} hint={`${pr.completed_in_period} in this period`} href="/projects?status=completed" />
      <StatCard label="Invoiced (all projects)" value={formatAed((pr.rows ?? []).reduce((a: number, p: any) => a + Number(p.invoiced), 0))} hint="Excluding VAT" />
      <StatCard label="Projects with incomplete cost data" value={(pr.rows ?? []).filter((p: any) => !projectProfit(p).complete).length} hint="No labour or material costs recorded" />
    </Metrics>}

    {section === 'compliance' && <Metrics className="mb-5" cols={4}>
      <StatCard label="Expired" value={docSum('expired')} tone={docSum('expired') ? 'red' : 'neutral'} href="/vault?status=expired" />
      <StatCard label="Expiring in 7 days" value={docSum('d7')} href="/vault?status=expiring7" />
      <StatCard label="Expiring in 30 days" value={docSum('d30')} href="/vault?status=expiring30" />
      <StatCard label="Renewal in progress" value={docSum('renewal')} href="/vault?status=renewal" />
    </Metrics>}

    {section === 'cheques' && ch && <Metrics className="mb-5" cols={4}>
      <StatCard label="Incoming, open" value={formatAed(ch.in_open)} hint={`${ch.in_open_n} cheques`} href="/cheques?direction=incoming" />
      <StatCard label="Outgoing, open" value={formatAed(ch.out_open)} hint={`${ch.out_open_n} cheques`} href="/cheques?direction=outgoing" />
      <StatCard label="Awaiting clearance" value={ch.awaiting_n} hint={formatAed(ch.awaiting)} href="/cheques?status=deposited" />
      <StatCard label="Returned in this period" value={ch.returned_n} tone={ch.returned_n ? 'red' : 'neutral'} href="/cheques?status=returned" />
    </Metrics>}

    {tables.length > 0 && <div className="mt-5 space-y-5">{tables.map(t => <ReportTable key={t.title} t={t} />)}</div>}
    </>}
    <p className="mt-6 text-xs text-muted">Generated {generated}. Figures follow your permissions: sections you cannot see are left out, not shown as zero.</p>
  </>
}
