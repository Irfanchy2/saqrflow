import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft, CalendarClock, CalendarPlus, CheckSquare, Mail, MapPin, MessageCircle, Pencil, Phone, Plus, ScrollText, Trash2, UserCheck } from 'lucide-react'
import { getCtx } from '@/lib/auth'
import { Badge, Card, CardHeader, EmptyState, Field, Input, Select, Textarea } from '@/components/ui/primitives'
import { DialogButton } from '@/components/ui/dialog'
import { ActionButton, ActionForm } from '@/components/ui/action-form'
import { LeadFields, TaskFields, VisitFields } from '@/components/crm/fields'
import { NewSalesButtons } from '@/components/sales/new-buttons'
import { addLeadActivity, convertLeadToCustomer, updateLead } from '@/app/actions/crm'
import { createSiteVisit, createTask } from '@/app/actions/operations'
import { trashRecord } from '@/app/actions/trash'
import { ACTIVITY_KINDS, LEAD_SOURCES, LEAD_STAGES, LOST_REASONS, STAGE, TASK_STATUS, VISIT_STATUS, followupState, leadProbability, type LeadStage } from '@/lib/crm'
import { STATUS_TONE, statusLabel } from '@/lib/sales/docs'
import { formatAed, formatShortDate } from '@/lib/time'
import { waLink } from '@/lib/phone'
import { cn } from '@/lib/utils'
import { RecordActivity } from '@/components/record-activity'
import { CustomFieldsCard } from '@/components/custom-fields-card'

export const metadata = { title: 'Lead' }

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const c = await getCtx(); if (!c.can('crm.view')) redirect('/')
  const { data: l } = await c.supabase.from('leads').select('*').eq('id', id).maybeSingle()
  if (!l) notFound()
  const edit = c.can('records.edit'), fin = c.can('finance.view')
  const [{ data: acts }, { data: users }, { data: quotes }, { data: visits }, { data: tasks }, { data: employees }, { data: customer }] = await Promise.all([
    c.supabase.from('lead_activities').select('id,kind,body,from_stage,to_stage,user_id,created_at').eq('lead_id', id).order('created_at', { ascending: false }).limit(200),
    c.supabase.from('profiles').select('id,full_name').eq('is_active', true).order('full_name'),
    fin ? c.supabase.from('invoices').select('id,number,doc_type,status,total,issue_date').eq('lead_id', id).order('created_at', { ascending: false }) : Promise.resolve({ data: [] as any[] }),
    c.supabase.from('site_visits').select('id,number,scheduled_date,scheduled_time,status,location').eq('lead_id', id).order('scheduled_date', { ascending: false }),
    c.supabase.from('tasks').select('id,title,status,due_date').eq('related_type', 'lead').eq('related_id', id).order('due_date', { nullsFirst: false }),
    edit ? c.supabase.from('employees').select('id,full_name').neq('status', 'archived').order('full_name').limit(1000) : Promise.resolve({ data: [] as any[] }),
    l.customer_id ? c.supabase.from('customers').select('id,name').eq('id', l.customer_id).maybeSingle() : Promise.resolve({ data: null }),
  ])
  const names = new Map((users ?? []).map((u: any) => [u.id, u.full_name as string]))
  const userOpts = (users ?? []).map((u: any) => ({ id: u.id, name: u.full_name }))
  const empOpts = (employees ?? []).map((e: any) => ({ id: e.id, name: e.full_name }))
  const st = STAGE[l.stage as LeadStage], f = followupState(l, c.today)
  const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { timeZone: c.company.timezone, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  const steps = LEAD_STAGES.filter(s => !['lost', 'on_hold', 'follow_up'].includes(s.key))
  const at = steps.findIndex(s => s.key === l.stage)
  const wa = waLink(l.whatsapp ?? l.phone)
  const facts: [string, React.ReactNode][] = [
    ['Contact', l.contact_person], ['Phone', l.phone && <a href={`tel:${l.phone.replace(/[^\d+]/g, '')}`} className="hover:text-primary">{l.phone}</a>],
    ['Email', l.email && <a href={`mailto:${l.email}`} className="break-all hover:text-primary">{l.email}</a>], ['Location', l.location], ['Address', l.address], ['TRN', l.trn && <span className="font-mono">{l.trn}</span>],
    ['Source', LEAD_SOURCES[l.source] ?? l.source], ['Service', l.service],
    ['Estimated value', l.estimated_value == null ? null : formatAed(l.estimated_value)], ['Win probability', `${leadProbability(l)}%${l.probability == null ? ' (stage default)' : ''}`],
    ['Expected closing', l.expected_close && formatShortDate(l.expected_close)], ['Salesperson', names.get(l.salesperson_id)],
    ['Customer', customer ? <Link href={`/parties/${customer.id}`} className="text-primary hover:underline">{customer.name}</Link> : null],
    ['Created', when(l.created_at)],
  ]

  return <>
    <Link href="/leads" className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg"><ArrowLeft size={14} />Leads</Link>
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold tracking-tight">{l.company_name}</h1><Badge tone={st?.tone}>{st?.label}</Badge></div>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
          <span className="font-mono">{l.number}</span>
          {l.service && <span>{l.service}</span>}
          {l.location && <span className="inline-flex items-center gap-1"><MapPin size={13} aria-hidden />{l.location}</span>}
          {l.next_followup && f !== 'none' && <span className={cn('inline-flex items-center gap-1', f === 'overdue' ? 'font-medium text-danger' : f === 'today' ? 'font-medium text-warning' : '')}><CalendarClock size={13} aria-hidden />Follow up {f === 'overdue' ? `overdue (${formatShortDate(l.next_followup)})` : f === 'today' ? 'today' : formatShortDate(l.next_followup)}</span>}
        </div>
        {l.stage === 'lost' && <p className="mt-2 text-sm text-muted">Lost: {LOST_REASONS[l.lost_reason] ?? 'no reason'}{l.lost_note ? `. ${l.lost_note}` : ''}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        {l.phone && <a href={`tel:${l.phone.replace(/[^\d+]/g, '')}`} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm hover:bg-surface-2"><Phone size={14} />Call</a>}
        {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm hover:bg-surface-2"><MessageCircle size={14} />WhatsApp</a>}
        {l.email && <a href={`mailto:${l.email}`} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm hover:bg-surface-2"><Mail size={14} />Email</a>}
        {edit && <DialogButton wide variant="secondary" label="Edit" title="Edit lead" icon={<Pencil size={14} />}><ActionForm action={updateLead.bind(null, id)} resetOnSuccess={false}><LeadFields l={l} users={userOpts} /></ActionForm></DialogButton>}
        {edit && !l.customer_id && <ActionButton size="md" action={convertLeadToCustomer.bind(null, id)}><UserCheck size={14} />Convert to customer</ActionButton>}
        {edit && fin && <NewSalesButtons leadId={id} only={['quotation']} variant="primary" />}
        {c.can('records.delete') && <ActionButton variant="ghost" size="md" action={trashRecord.bind(null, 'lead', id)} confirm={`Move lead “${l.company_name}” to the trash? It can be restored.`}><Trash2 size={14} />Delete</ActionButton>}
      </div>
    </div>

    {!['lost', 'on_hold'].includes(l.stage) && <ol aria-label="Pipeline progress" className="mb-5 flex overflow-x-auto rounded-lg border border-border bg-surface text-xs">
      {steps.map((s, i) => <li key={s.key} aria-current={s.key === l.stage ? 'step' : undefined} className={cn('flex min-w-[110px] flex-1 items-center gap-1.5 border-e border-border px-3 py-2 last:border-e-0',
        i < at || l.stage === 'won' ? 'text-success' : s.key === l.stage ? 'bg-primary-soft font-medium text-primary' : 'text-muted')}>
        <span className={cn('grid h-4 w-4 shrink-0 place-items-center rounded-full border text-[9px] tabular-nums', i < at || l.stage === 'won' ? 'border-success bg-success/10' : s.key === l.stage ? 'border-primary' : 'border-border')}>{i + 1}</span><span className="truncate">{s.label}</span></li>)}
    </ol>}

    <div className="grid gap-5 xl:grid-cols-3 [&>*]:min-w-0">
      <div className="space-y-5 xl:col-span-2">
        <Card><CardHeader title="Activity" sub="Calls, WhatsApp, meetings, stage changes and quotations, newest first" />
          {edit && <ActionForm action={addLeadActivity.bind(null, id)} submit="Add to history" className="flex flex-col gap-3 border-b border-border p-4" variant="secondary">
            <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
              <Field label="Type"><Select name="kind" defaultValue="call"><option value="call">Call</option><option value="whatsapp">WhatsApp</option><option value="email">Email</option><option value="meeting">Meeting</option><option value="note">Note</option></Select></Field>
              <Field label="What happened *"><Textarea name="body" rows={2} maxLength={2000} required placeholder="e.g. Customer wants a revised price with powder coating" /></Field>
            </div>
            <Field label="Next follow-up" hint="Sets the reminder date on the lead"><Input name="next_followup" type="date" min={c.today} className="sm:w-48" /></Field>
          </ActionForm>}
          {!(acts ?? []).length ? <p className="px-4 py-6 text-sm text-muted">No activity yet.</p>
            : <ol className="divide-y divide-border text-sm">{(acts ?? []).map((a: any) => <li key={a.id} className="flex gap-3 px-4 py-3">
              <Badge tone={a.kind === 'stage' ? 'blue' : a.kind === 'converted' ? 'green' : 'neutral'} className="mt-0.5 h-fit shrink-0">{ACTIVITY_KINDS[a.kind] ?? a.kind}</Badge>
              <div className="min-w-0 flex-1">
                <p className="whitespace-pre-line break-words">{a.kind === 'stage' ? <>Moved from <b className="font-medium">{STAGE[a.from_stage as LeadStage]?.label ?? a.from_stage}</b> to <b className="font-medium">{STAGE[a.to_stage as LeadStage]?.label ?? a.to_stage}</b></> : a.body}</p>
                <p className="mt-0.5 text-xs text-muted">{names.get(a.user_id) ?? 'System'} · {when(a.created_at)}</p></div></li>)}</ol>}
        </Card>
        {l.notes && <Card><CardHeader title="Notes" /><p className="whitespace-pre-line px-4 py-3 text-sm">{l.notes}</p></Card>}
      </div>

      <div className="space-y-5">
        <Card><CardHeader title="Details" />
          <dl className="divide-y divide-border text-sm">{facts.filter(([, v]) => v != null && v !== '').map(([k, v]) => <div key={k} className="grid grid-cols-[120px_1fr] gap-3 px-4 py-2"><dt className="text-muted">{k}</dt><dd className="min-w-0 break-words">{v}</dd></div>)}</dl></Card>

        {fin && <Card><CardHeader title="Quotations" action={edit ? <NewSalesButtons leadId={id} only={['quotation']} size="sm" variant="secondary" /> : null} />
          {!(quotes ?? []).length ? <p className="px-4 py-4 text-sm text-muted">No quotation yet. “New quotation” copies the customer, contact and site from this lead.</p>
            : <ul className="divide-y divide-border text-sm">{(quotes ?? []).map((q: any) => <li key={q.id}><Link href={`/invoices/${q.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2/60"><ScrollText size={14} className="shrink-0 text-muted" aria-hidden />
              <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{q.number}</span><span className="tabular-nums text-muted">{formatAed(q.total)}</span><Badge tone={STATUS_TONE[q.status]}>{statusLabel(q.doc_type, q.status)}</Badge></Link></li>)}</ul>}</Card>}

        <Card><CardHeader title="Site visits" action={edit ? <DialogButton wide size="sm" variant="secondary" label="Schedule" title="Schedule site visit" icon={<CalendarPlus size={14} />}><ActionForm action={createSiteVisit} submit="Schedule visit" idempotent>
          <VisitFields v={{ scheduled_date: c.today, location: l.location, contact_person: l.contact_person, contact_phone: l.phone }} leads={[]} customers={[]} projects={[]} employees={empOpts} fixed={{ lead_id: id, ...(l.customer_id ? { customer_id: l.customer_id } : {}) }} /></ActionForm></DialogButton> : null} />
          {!(visits ?? []).length ? <p className="px-4 py-4 text-sm text-muted">No visits scheduled.</p>
            : <ul className="divide-y divide-border text-sm">{(visits ?? []).map((v: any) => <li key={v.id}><Link href={`/site-visits/${v.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2/60">
              <span className="min-w-0 flex-1"><span className="block font-mono text-[13px]">{v.number}</span><span className="block text-xs text-muted">{formatShortDate(v.scheduled_date)}{v.scheduled_time ? ` ${v.scheduled_time.slice(0, 5)}` : ''}</span></span><Badge tone={VISIT_STATUS[v.status]?.tone}>{VISIT_STATUS[v.status]?.label}</Badge></Link></li>)}</ul>}</Card>

        <Card><CardHeader title="Tasks" action={edit ? <DialogButton wide size="sm" variant="secondary" label="Add" title="Add task for this lead" icon={<Plus size={14} />}><ActionForm action={createTask} submit="Add task" idempotent>
          <TaskFields users={userOpts} employees={empOpts} projects={[]} fixed={{ related_type: 'lead', related_id: id, project_id: undefined }} t={{ title: `Follow up ${l.company_name}`.slice(0, 200), due_date: l.next_followup ?? c.today }} /></ActionForm></DialogButton> : null} />
          {!(tasks ?? []).length ? <p className="px-4 py-4 text-sm text-muted">No tasks.</p>
            : <ul className="divide-y divide-border text-sm">{(tasks ?? []).map((t: any) => <li key={t.id}><Link href={`/tasks?open=${t.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2/60"><CheckSquare size={14} className="shrink-0 text-muted" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{t.title}</span>{t.due_date && <span className="text-xs tabular-nums text-muted">{formatShortDate(t.due_date)}</span>}<Badge tone={TASK_STATUS[t.status]?.tone}>{TASK_STATUS[t.status]?.label}</Badge></Link></li>)}</ul>}</Card>
      </div>
    </div>
    <div className="mt-5 grid gap-5 xl:grid-cols-2 [&>*]:min-w-0"><CustomFieldsCard c={c} entity="lead" recordId={id} customStatusId={l.custom_status_id} /><RecordActivity c={c} table="leads" id={id} /></div>
  </>
}
