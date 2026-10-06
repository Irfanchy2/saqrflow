import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AlertTriangle, Briefcase, HardHat, MapPin, Plus, Wallet } from 'lucide-react'
import { getCtx } from '@/lib/auth'
import { flat, sanitizeQ } from '@/lib/queries'
import { Badge, Card, EmptyState, PageHeader, StatCard } from '@/components/ui/primitives'
import { DialogButton } from '@/components/ui/dialog'
import { ActionForm } from '@/components/ui/action-form'
import { ProjectFields, Progress } from '@/components/projects/project-fields'
import { createProject } from '@/app/actions/projects'
import { PROJECT_STATUS, projectFinancials } from '@/lib/projects'
import { formatAed } from '@/lib/time'
import { cn } from '@/lib/utils'

export const metadata = { title: 'Projects' }

export default async function Projects({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await getCtx(); if (!c.can('documents.view')) redirect('/')
  const sp = await flat(searchParams), term = sanitizeQ(sp.q), fin = c.can('finance.view')
  const status = sp.status && sp.status in PROJECT_STATUS ? sp.status : sp.status === 'all' ? null : 'open'
  let q = c.supabase.from('projects').select('id,name,code,location,status,contract_value,start_date,expected_completion,fabrication_progress,site_progress,customer:customers(id,name)').order('created_at', { ascending: false }).limit(300)
  if (status === 'open') q = q.in('status', ['planning', 'active', 'on_hold']); else if (status) q = q.eq('status', status)
  if (term) q = q.or(`name.ilike.%${term}%,code.ilike.%${term}%,location.ilike.%${term}%`)
  // only the figures for the projects on screen (not every invoice / expense in the company)
  const [{ data: projects }, { data: customers }] = await Promise.all([q, c.supabase.from('customers').select('id,name').order('name').limit(1000)])
  const pids = (projects ?? []).map((p: any) => p.id)
  const [{ data: invs }, { data: exps }, { data: ms }] = pids.length ? await Promise.all([
    fin ? c.supabase.from('invoices').select('id,project_id,doc_type,status,total').in('project_id', pids).eq('doc_type', 'invoice') : Promise.resolve({ data: [] as any[] }),
    fin ? c.supabase.from('project_expenses').select('project_id,amount,category').in('project_id', pids) : Promise.resolve({ data: [] as any[] }),
    c.supabase.from('project_milestones').select('project_id,due_date,done,title').in('project_id', pids).eq('done', false).order('due_date'),
  ]) : [{ data: [] as any[] }, { data: [] as any[] }, { data: [] as any[] }]
  const invIds = (invs ?? []).map((i: any) => i.id)
  const { data: bals } = invIds.length ? await c.supabase.from('invoice_balances').select('id,paid').in('id', invIds.slice(0, 1000)) : { data: [] as any[] }
  const paid = new Map((bals ?? []).map((b: any) => [b.id, Number(b.paid)]))
  const finOf = (id: string, contract: number | null) => projectFinancials(contract, (invs ?? []).filter((i: any) => i.project_id === id).map((i: any) => ({ ...i, paid: paid.get(i.id) ?? 0 })), (exps ?? []).filter((e: any) => e.project_id === id))
  const rows = (projects ?? []).map((p: any) => ({ ...p, f: finOf(p.id, p.contract_value), next: (ms ?? []).find((m: any) => m.project_id === p.id) }))
  const active = rows.filter(r => r.status === 'active')
  const overdueMs = (ms ?? []).filter((m: any) => m.due_date < c.today).length
  const cls = 'h-9 rounded-md border border-border bg-surface px-3 text-sm'

  return <>
    <PageHeader title="Projects" sub="Fabrication & site progress, milestones, costs and billing for every job."
      actions={c.can('records.edit') ? <DialogButton wide openParam="project" label="New project" title="New project" icon={<Plus size={15} />}><ActionForm action={createProject} submit="Create project"><ProjectFields customers={customers ?? []} /></ActionForm></DialogButton> : null} />
    <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Active projects" value={active.length} hint={`${rows.length} shown`} icon={HardHat} tone="blue" />
      {fin && <StatCard label="Active contract value" value={formatAed(active.reduce((s, r) => s + Number(r.contract_value ?? 0), 0))} icon={Briefcase} />}
      {fin && <StatCard label="Outstanding on projects" value={formatAed(rows.reduce((s, r) => s + r.f.outstanding, 0))} icon={Wallet} tone="amber" href="/invoices?tab=receivables" />}
      <StatCard label="Overdue milestones" value={overdueMs} icon={AlertTriangle} tone={overdueMs ? 'red' : 'neutral'} href="/reminders" />
    </div>
    <form className="mb-4 flex flex-wrap gap-2"><input name="q" type="search" defaultValue={sp.q} aria-label="Search projects" placeholder="Search name, code, location…" className={`${cls} min-w-52 flex-1`} />
      <select name="status" defaultValue={sp.status ?? 'open'} aria-label="Status" className={cls}><option value="open">Open (planning, active, on hold)</option><option value="all">All</option>{Object.entries(PROJECT_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
      <button className="h-9 cursor-pointer rounded-md border border-border px-3 text-sm hover:bg-surface-2">Filter</button></form>
    {!rows.length ? <Card><EmptyState icon={HardHat} title={term ? 'No projects match' : 'No projects yet'} body="Create a project to track its progress, milestones, expenses, drawings, quotations and invoices in one place." /></Card>
      : <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">{rows.map(p => {
        const st = PROJECT_STATUS[p.status], late = p.next && p.next.due_date < c.today
        return <Link key={p.id} href={`/projects/${p.id}`} className="group">
          <Card className="flex h-full flex-col gap-3 p-4 transition-all group-hover:border-primary/40 group-hover:shadow-md">
            <div className="flex items-start gap-3"><div className="min-w-0 flex-1">
              <div className="text-xs text-muted">{p.code ?? 'Project'}{p.customer ? ` · ${p.customer.name}` : ''}</div>
              <h3 className="truncate font-semibold group-hover:text-primary">{p.name}</h3>
              {p.location && <div className="mt-0.5 flex items-center gap-1 text-xs text-muted"><MapPin size={12} aria-hidden />{p.location}</div>}</div>
              <Badge tone={st.tone}>{st.label}</Badge></div>
            <div className="grid gap-2"><Progress label="Fabrication" value={p.fabrication_progress} /><Progress label="Site installation" value={p.site_progress} tone="bg-success" /></div>
            {fin && <div className="grid grid-cols-3 gap-2 border-t border-border pt-3 text-xs">
              <div><div className="text-muted">Contract</div><div className="font-medium tabular-nums">{formatAed(p.f.contract)}</div></div>
              <div><div className="text-muted">Invoiced</div><div className="font-medium tabular-nums">{formatAed(p.f.invoiced)}</div></div>
              <div><div className="text-muted">Margin</div><div className={cn('font-medium tabular-nums', p.f.margin !== null && p.f.margin < 0 && 'text-danger')}>{p.f.margin === null ? '—' : `${p.f.margin}%`}</div></div></div>}
            {p.next && <div className={cn('mt-auto rounded-md px-2.5 py-1.5 text-xs', late ? 'bg-danger/10 text-danger' : 'bg-surface-2 text-muted')}>Next: {p.next.title} · {p.next.due_date}{late ? ' (overdue)' : ''}</div>}
          </Card></Link>
      })}</div>}
  </>
}
