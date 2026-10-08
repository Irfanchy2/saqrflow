import Link from 'next/link'
import { redirect } from 'next/navigation'
import { BarChart3, Columns3, List, Plus, Target } from 'lucide-react'
import { getCtx } from '@/lib/auth'
import { PAGE_SIZE, flat, pageOf, sanitizeQ } from '@/lib/queries'
import { Badge, Card, CardHeader, EmptyState, LinkButton, Metrics, PageHeader, Pagination, StatCard, Td, Th, TableWrap } from '@/components/ui/primitives'
import { DialogButton } from '@/components/ui/dialog'
import { ActionForm } from '@/components/ui/action-form'
import { LeadFields } from '@/components/crm/fields'
import { PipelineBoard, type BoardLead } from '@/components/crm/pipeline'
import { createLead } from '@/app/actions/crm'
import { LEAD_SOURCES, LEAD_STAGES, LOST_REASONS, STAGE, followupState, pipelineSummary, sourceAnalytics, type LeadStage } from '@/lib/crm'
import { addDays, formatAed, formatShortDate } from '@/lib/time'
import { cn } from '@/lib/utils'

export const metadata = { title: 'Leads & Pipeline' }
const VIEWS = [['pipeline', 'Pipeline', Columns3], ['list', 'List', List], ['sources', 'Sources & win rate', BarChart3]] as const

export default async function LeadsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await getCtx(); if (!c.can('crm.view')) redirect('/')
  const sp = await flat(searchParams)
  const view = VIEWS.some(([k]) => k === sp.view) ? sp.view! : 'pipeline'
  const edit = c.can('records.edit'), term = sanitizeQ(sp.q), page = pageOf(sp.page)
  const since = addDays(c.today, -Math.min(730, Math.max(7, Number(sp.days) || 365)))

  const filter = <T,>(q: T): T => {
    let x: any = q
    if (term) x = x.or(`company_name.ilike.%${term}%,contact_person.ilike.%${term}%,phone.ilike.%${term}%,number.ilike.%${term}%,service.ilike.%${term}%,location.ilike.%${term}%`)
    if (sp.source && sp.source in LEAD_SOURCES) x = x.eq('source', sp.source)
    if (sp.owner === 'me') x = x.eq('salesperson_id', c.userId); else if (sp.owner && /^[0-9a-f-]{36}$/.test(sp.owner)) x = x.eq('salesperson_id', sp.owner)
    if (sp.due === '1') x = x.lte('next_followup', c.today).not('stage', 'in', '(won,lost,on_hold)')
    return x
  }
  const cols = 'id,number,company_name,contact_person,phone,service,source,estimated_value,probability,stage,next_followup,expected_close,created_at,salesperson_id,lost_reason'
  // the board and the analytics read every open lead plus the decided ones in the period (bounded); the list is paged in SQL
  const [{ data: openL }, { data: closedL }, { data: users }, listRes] = await Promise.all([
    filter(c.supabase.from('leads').select(cols)).not('stage', 'in', '(won,lost,on_hold)').order('updated_at', { ascending: false }).limit(1000),
    filter(c.supabase.from('leads').select(cols)).in('stage', ['won', 'lost', 'on_hold']).gte('created_at', since).order('updated_at', { ascending: false }).limit(1000),
    c.supabase.from('profiles').select('id,full_name').eq('is_active', true).order('full_name'),
    view === 'list' ? (() => { let q = filter(c.supabase.from('leads').select(cols, { count: 'exact' })); if (sp.stage && sp.stage in STAGE) q = q.eq('stage', sp.stage)
      return q.order(sp.sort === 'value' ? 'estimated_value' : sp.sort === 'followup' ? 'next_followup' : 'created_at', { ascending: sp.sort === 'followup', nullsFirst: false }).range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1) })() : Promise.resolve({ data: null, count: 0 }),
  ])
  const leads: any[] = [...(openL ?? []), ...(closedL ?? [])]
  const names = new Map<string, string>((users ?? []).map((u: any) => [u.id, u.full_name as string]))
  const sum = pipelineSummary(leads), src = sourceAnalytics(leads.filter((l: any) => l.created_at >= since))
  const due = leads.filter((l: any) => ['overdue', 'today'].includes(followupState(l, c.today))).length
  const lostCount: Record<string, number> = {}
  for (const l of leads as any[]) if (l.stage === 'lost' && l.lost_reason) lostCount[l.lost_reason] = (lostCount[l.lost_reason] ?? 0) + 1
  const lostBy = Object.entries(lostCount).sort((a, b) => b[1] - a[1])
  const board: BoardLead[] = leads.map((l: any) => ({ id: l.id, number: l.number, company_name: l.company_name, contact_person: l.contact_person, phone: l.phone, service: l.service, estimated_value: l.estimated_value == null ? null : Number(l.estimated_value), stage: l.stage, next_followup: l.next_followup, salesperson: l.salesperson_id ? (names.get(l.salesperson_id)?.split(' ')[0] ?? null) : null }))
  const userOpts = (users ?? []).map((u: any) => ({ id: u.id, name: u.full_name }))
  const filtered = !!(term || sp.source || sp.owner || sp.due || sp.stage)
  const cls = 'h-9 rounded-md border border-border bg-surface px-3 text-sm hover:border-border-strong'
  const add = <DialogButton wide label="New lead" title="New lead" icon={<Plus size={15} />} openParam="lead"><ActionForm action={createLead} submit="Save lead" idempotent><LeadFields users={userOpts} /></ActionForm></DialogButton>
  const qs = (o: Record<string, string>) => `/leads?${new URLSearchParams({ ...Object.fromEntries(Object.entries(sp).filter(([k, v]) => v && k !== 'page')) as Record<string, string>, ...o })}`
  const maxLeads = Math.max(1, ...src.map(s => s.leads))

  return <>
    <PageHeader title="Leads & Pipeline" sub="Every enquiry from first call to won job. Follow-ups remind you automatically." actions={edit ? add : undefined} />
    <Metrics className="mb-5" cols={5}>
      <StatCard label="Open leads" value={sum.open} hint={sum.unvalued ? `${sum.unvalued} without an estimated value` : undefined} />
      <StatCard label="Pipeline value" value={formatAed(sum.value)} hint="Open leads, excl. VAT" />
      <StatCard label="Weighted pipeline" value={formatAed(sum.weighted)} hint="Value × win probability" />
      <StatCard label="Follow-ups due" value={due} tone={due ? 'red' : 'neutral'} hint="Today or overdue" href={qs({ view: 'list', due: '1' })} />
      <StatCard label="Win rate" value={sum.winRate == null ? 'No decided leads' : `${sum.winRate}%`} hint={`${sum.won} won · ${sum.lost} lost`} />
    </Metrics>
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-border">
      <nav aria-label="Lead views" className="flex gap-1 overflow-x-auto">{VIEWS.map(([k, l, I]) => <Link key={k} href={qs({ view: k })} aria-current={view === k ? 'page' : undefined}
        className={cn('-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors', view === k ? 'border-primary font-medium text-fg' : 'border-transparent text-muted hover:text-fg')}><I size={14} aria-hidden />{l}</Link>)}</nav>
      <form className="mb-2 flex flex-wrap gap-2"><input type="hidden" name="view" value={view} />
        <input name="q" type="search" defaultValue={sp.q} aria-label="Search leads" placeholder="Search name, phone, service…" className={`${cls} w-56`} />
        <select name="source" defaultValue={sp.source ?? ''} aria-label="Source" className={cls}><option value="">All sources</option>{Object.entries(LEAD_SOURCES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select name="owner" defaultValue={sp.owner ?? ''} aria-label="Salesperson" className={cls}><option value="">Everyone</option><option value="me">My leads</option>{userOpts.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
        {view === 'list' && <select name="stage" defaultValue={sp.stage ?? ''} aria-label="Stage" className={cls}><option value="">Any stage</option>{LEAD_STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}</select>}
        {view === 'sources' && <select name="days" defaultValue={sp.days ?? '365'} aria-label="Period" className={cls}><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="365">Last 12 months</option><option value="730">Last 2 years</option></select>}
        <button className={`${cls} cursor-pointer`}>Filter</button>{filtered && <LinkButton href={`/leads?view=${view}`} variant="ghost">Clear</LinkButton>}</form>
    </div>

    {view === 'pipeline' && (!leads.length ? <Card><EmptyState icon={Target} title={filtered ? 'No leads match these filters' : 'No leads yet'} body={filtered ? 'Try a different search.' : 'Add the next enquiry that comes in by phone, WhatsApp or the website. It appears here as a card you can drag through the stages.'} action={!filtered && edit ? add : undefined} /></Card>
      : <PipelineBoard leads={board} today={c.today} canEdit={edit} />)}

    {view === 'list' && <Card>
      {!listRes.data?.length ? <EmptyState icon={Target} title={filtered ? 'No leads match these filters' : 'No leads yet'} action={!filtered && edit ? add : undefined} />
        : <TableWrap><thead><tr><Th>Lead</Th><Th>Contact</Th><Th>Service</Th><Th>Source</Th><Th className="text-end"><Link href={qs({ sort: 'value' })} className="hover:text-fg">Value</Link></Th><Th>Stage</Th><Th><Link href={qs({ sort: 'followup' })} className="hover:text-fg">Next follow-up</Link></Th><Th>Salesperson</Th></tr></thead>
          <tbody className="divide-y divide-border">{listRes.data.map((l: any) => { const f = followupState(l, c.today); return <tr key={l.id} className="hover:bg-surface-2/40">
            <Td className="max-w-[240px]"><Link href={`/leads/${l.id}`} className="block truncate font-medium hover:text-primary">{l.company_name}</Link><div className="font-mono text-xs text-muted">{l.number}</div></Td>
            <Td className="text-muted">{l.contact_person ?? '—'}{l.phone && <div className="text-xs">{l.phone}</div>}</Td>
            <Td className="max-w-[200px] truncate text-muted" title={l.service ?? undefined}>{l.service ?? '—'}</Td>
            <Td className="text-muted">{LEAD_SOURCES[l.source] ?? l.source}</Td>
            <Td className="text-end tabular-nums">{l.estimated_value == null ? <span className="text-muted/60">Not set</span> : formatAed(l.estimated_value)}</Td>
            <Td><Badge tone={STAGE[l.stage as LeadStage]?.tone}>{STAGE[l.stage as LeadStage]?.label ?? l.stage}</Badge>{l.stage === 'lost' && l.lost_reason && <div className="text-xs text-muted">{LOST_REASONS[l.lost_reason]}</div>}</Td>
            <Td className={cn('whitespace-nowrap tabular-nums', f === 'overdue' ? 'font-medium text-danger' : f === 'today' ? 'font-medium text-warning' : 'text-muted')}>{l.next_followup && f !== 'none' ? formatShortDate(l.next_followup) : '—'}</Td>
            <Td className="text-muted">{names.get(l.salesperson_id) ?? '—'}</Td></tr> })}</tbody></TableWrap>}
      <Pagination page={page} pageSize={PAGE_SIZE} total={listRes.count ?? 0} params={sp} base="/leads" />
    </Card>}

    {view === 'sources' && <div className="grid gap-5 xl:grid-cols-3 [&>*]:min-w-0">
      <Card className="xl:col-span-2"><CardHeader title="Lead sources" sub="Leads created in the period. Conversion = won ÷ (won + lost); open leads are not counted as lost" />
        {!src.length ? <p className="px-4 py-6 text-sm text-muted">No leads in this period.</p>
          : <TableWrap><thead><tr><Th>Source</Th><Th>Leads</Th><Th className="text-end">Open</Th><Th className="text-end">Won</Th><Th className="text-end">Lost</Th><Th className="text-end">Conversion</Th><Th className="text-end">Won value</Th><Th className="text-end">Open pipeline</Th></tr></thead>
            <tbody className="divide-y divide-border">{src.map(s => <tr key={s.source}>
              <Td className="font-medium"><Link href={qs({ view: 'list', source: s.source })} className="hover:text-primary">{LEAD_SOURCES[s.source] ?? s.source}</Link></Td>
              <Td><div className="flex items-center gap-2"><span className="w-6 text-end tabular-nums">{s.leads}</span><span aria-hidden className="h-1.5 rounded-full bg-primary/70" style={{ width: `${Math.max(4, (s.leads / maxLeads) * 120)}px` }} /></div></Td>
              <Td className="text-end tabular-nums">{s.open}</Td><Td className="text-end tabular-nums">{s.won}</Td><Td className="text-end tabular-nums">{s.lost}</Td>
              <Td className="text-end tabular-nums">{s.conversion == null ? <span className="text-muted/60">Not decided</span> : `${s.conversion}%`}</Td>
              <Td className="text-end tabular-nums">{formatAed(s.wonValue)}</Td><Td className="text-end tabular-nums">{formatAed(s.pipeline)}</Td></tr>)}</tbody></TableWrap>}
      </Card>
      <Card><CardHeader title="Why leads were lost" sub="From the reason chosen when a lead is marked lost" />
        {!lostBy.length ? <p className="px-4 py-6 text-sm text-muted">No lost leads with a reason yet.</p>
          : <ul className="divide-y divide-border text-sm">{lostBy.map(([k, n]) => <li key={k} className="flex items-center justify-between px-4 py-2.5"><span>{LOST_REASONS[k] ?? k}</span><span className="tabular-nums text-muted">{n}</span></li>)}</ul>}
      </Card>
    </div>}
  </>
}
