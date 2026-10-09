import Link from 'next/link'
import { BadgeCheck, CheckCircle2, FileWarning, HardHat, Landmark, ListTodo, Receipt, Target } from 'lucide-react'
import { getCtx } from '@/lib/auth'
import { loadBrief } from '@/lib/brief'
import { Badge, Card, CardHeader, Metrics, PageHeader, StatCard } from '@/components/ui/primitives'
import { formatAed, formatShortDate } from '@/lib/time'
import { APPROVAL_TYPE_LABEL } from '@/lib/approvals'
import { cn } from '@/lib/utils'

export const metadata = { title: 'Daily Brief' }

/** Today in one page: cheques, overdue invoices, expiring documents, tasks, project alerts and approvals. */
export default async function BriefPage() {
  const c = await getCtx(); const b = await loadBrief(c)
  const date = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: c.company.timezone }).format(new Date())
  const overdueTotal = (b.invoices ?? []).reduce((s, r) => s + r.balance, 0)
  const docsLate = (b.documents ?? []).filter(d => d.days < 0).length
  const none = <p className="px-4 py-4 text-sm text-muted">Nothing here today.</p>
  const Row = ({ href, title, sub, right, bad }: { href: string; title: string; sub?: string; right?: React.ReactNode; bad?: boolean }) => <li><Link href={href} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-surface-2/50">
    <span className="min-w-0 flex-1"><span className="block truncate font-medium">{title}</span>{sub && <span className={cn('block truncate text-xs', bad ? 'text-danger' : 'text-muted')}>{sub}</span>}</span>{right}</Link></li>

  return <>
    <PageHeader title="Daily Brief" sub={`${c.company.name} · ${date}`} />
    <Metrics className="mb-5">
      {b.cheques && <StatCard label="Cheques due in 7 days" value={b.cheques.due.length} hint={b.cheques.overdue.length ? `${b.cheques.overdue.length} past date, not banked` : undefined} tone={b.cheques.overdue.length ? 'red' : 'neutral'} href="/cheques?view=list" />}
      {b.invoices && <StatCard label="Overdue invoices" value={b.invoices.length} hint={b.invoices.length ? formatAed(overdueTotal) : undefined} tone={b.invoices.length ? 'red' : 'neutral'} href="/invoices?tab=receivables" />}
      {b.documents && <StatCard label="Expiring in 30 days" value={b.documents.length} hint={docsLate ? `${docsLate} already expired` : undefined} tone={docsLate ? 'red' : b.documents.length ? 'amber' : 'neutral'} href="/vault?status=expiring30" />}
      <StatCard label="My tasks due" value={b.tasks.mine.length} tone={b.tasks.mine.length ? 'amber' : 'neutral'} href="/tasks?view=mine" />
      {b.approvals && <StatCard label="Waiting for my approval" value={b.approvals.length} tone={b.approvals.length ? 'amber' : 'neutral'} href="/approvals" />}
    </Metrics>

    <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2 [&>*]:min-w-0">
      {b.cheques && <Card><CardHeader title="Cheques" sub="Due in the next 7 days, and past date but not banked" action={<Landmark size={15} className="text-muted" aria-hidden />} />
        {!b.cheques.due.length && !b.cheques.overdue.length ? none : <ul className="divide-y divide-border">
          {[...b.cheques.overdue, ...b.cheques.due].slice(0, 15).map(x => <Row key={x.id} href={`/cheques?view=list&q=${encodeURIComponent(x.cheque_no)}`} title={`${x.direction === 'outgoing' ? 'Outgoing' : 'Incoming'} · ${x.party_name ?? 'No party'} · #${x.cheque_no}`}
            sub={x.cheque_date < c.today ? `Was due ${formatShortDate(x.cheque_date)} · not banked` : `Due ${formatShortDate(x.cheque_date)}`} bad={x.cheque_date < c.today} right={<span className="shrink-0 tabular-nums">{formatAed(x.amount)}</span>} />)}</ul>}</Card>}

      {b.invoices && <Card><CardHeader title="Overdue invoices" sub={b.invoices.length ? `${formatAed(overdueTotal)} past the due date` : 'Past the due date with a balance'} action={<Receipt size={15} className="text-muted" aria-hidden />} />
        {!b.invoices.length ? none : <ul className="divide-y divide-border">{b.invoices.slice(0, 15).map(r => <Row key={r.id} href={`/invoices/${r.id}`} title={`${r.number} · ${r.customer ?? 'No customer'}`} sub={`${r.days} day${r.days === 1 ? '' : 's'} overdue`} bad right={<span className="shrink-0 font-medium tabular-nums">{formatAed(r.balance)}</span>} />)}</ul>}</Card>}

      {b.documents && <Card><CardHeader title="Documents and renewals" sub="Expired, or expiring within 30 days" action={<FileWarning size={15} className="text-muted" aria-hidden />} />
        {!b.documents.length ? none : <ul className="divide-y divide-border">{b.documents.slice(0, 15).map(a => <Row key={a.key} href={a.href} title={a.text} sub={a.sub} bad={a.days < 0} />)}</ul>}</Card>}

      <Card><CardHeader title="My tasks" sub={b.tasks.teamOverdue ? `Due today or overdue · ${b.tasks.teamOverdue} overdue across the team` : 'Due today or overdue'} action={<ListTodo size={15} className="text-muted" aria-hidden />} />
        {!b.tasks.mine.length ? <p className="flex items-center gap-2 px-4 py-4 text-sm text-muted"><CheckCircle2 size={15} className="text-success" />You are up to date.</p>
          : <ul className="divide-y divide-border">{b.tasks.mine.map(t => <Row key={t.id} href={`/tasks?view=mine&open=${t.id}`} title={t.title} sub={t.due_date < c.today ? `Overdue since ${formatShortDate(t.due_date)}` : 'Due today'} bad={t.due_date < c.today} />)}</ul>}</Card>

      {b.projects && <Card><CardHeader title="Project alerts" sub="Past the planned completion, or costs above the contract value" action={<HardHat size={15} className="text-muted" aria-hidden />} />
        {!b.projects.length ? none : <ul className="divide-y divide-border">{b.projects.slice(0, 15).map((p, i) => <Row key={p.id + i} href={`/projects/${p.id}`} title={p.name} sub={p.reason} bad />)}</ul>}</Card>}

      {b.approvals && <Card><CardHeader title="Waiting for my approval" action={<BadgeCheck size={15} className="text-muted" aria-hidden />} />
        {!b.approvals.length ? none : <ul className="divide-y divide-border">{b.approvals.slice(0, 15).map(a => <Row key={a.id} href={`/approvals?open=${a.id}`} title={a.title} sub={APPROVAL_TYPE_LABEL[a.entity_type as keyof typeof APPROVAL_TYPE_LABEL]} right={a.amount !== null ? <span className="shrink-0 tabular-nums">{formatAed(a.amount)}</span> : undefined} />)}</ul>}</Card>}

      {b.followups !== null && b.followups > 0 && <Card><CardHeader title="Lead follow-ups" action={<Target size={15} className="text-muted" aria-hidden />} />
        <ul><Row href="/leads?view=list&due=1" title={`${b.followups} lead follow-up${b.followups === 1 ? '' : 's'} due today or earlier`} right={<Badge tone="amber">Open</Badge>} /></ul></Card>}
    </div>
  </>
}
