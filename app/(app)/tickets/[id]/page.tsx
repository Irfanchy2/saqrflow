import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, MapPin, Phone, ShieldCheck, ShieldOff } from 'lucide-react'
import { getCtx } from '@/lib/auth'
import { Badge, Card, CardHeader, Field, Select, Textarea } from '@/components/ui/primitives'
import { ActionButton, ActionForm } from '@/components/ui/action-form'
import { DialogButton } from '@/components/ui/dialog'
import { TicketFields } from '@/components/service/fields'
import { addTicketNote, setTicketStatus, updateTicket } from '@/app/actions/service'
import { trashRecord } from '@/app/actions/trash'
import { TICKET_CATEGORY, TICKET_PRIORITY, TICKET_SOURCE, TICKET_STATUS, ticketOverdue, warrantyState } from '@/lib/service'
import { formatShortDate } from '@/lib/time'
import { RecordActivity } from '@/components/record-activity'

export const metadata = { title: 'Service ticket' }
const KIND: Record<string, string> = { created: 'Opened', note: 'Note', status: 'Status', assigned: 'Assignment', customer: 'Customer contact' }

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const c = await getCtx()
  const { data: t } = await c.supabase.from('service_tickets').select('*, customer:customers(id,name,phone), project:projects(id,name,code), asset:assets(id,name,plate_or_serial), warranty:warranties(id,number,title,start_date,end_date,terms)').eq('id', id).maybeSingle()
  if (!t) notFound()
  const edit = c.can('records.edit'), mine = t.assigned_to === c.userId, canWork = edit || mine
  const [{ data: events }, { data: people }, lists] = await Promise.all([
    c.supabase.from('ticket_events').select('id,kind,body,user_id,created_at').eq('ticket_id', id).order('created_at', { ascending: false }).limit(200),
    c.supabase.from('profiles').select('id,full_name'),
    edit ? Promise.all([
      c.supabase.from('customers').select('id,name').order('name').limit(2000), c.supabase.from('projects').select('id,name,code').order('created_at', { ascending: false }).limit(500),
      c.supabase.from('assets').select('id,name,plate_or_serial').is('archived_at', null).order('name').limit(500), c.supabase.from('profiles').select('id,full_name').eq('is_active', true).order('full_name'),
      c.can('employees.view') ? c.supabase.from('employees').select('id,full_name').eq('status', 'active').order('full_name').limit(1000) : Promise.resolve({ data: [] as any[] }),
      c.supabase.from('warranties').select('id,number,title').order('end_date', { ascending: false }).limit(500),
    ]) : null,
  ])
  const who = new Map((people ?? []).map(p => [p.id, p.full_name as string]))
  const o = (rows: any[] | null | undefined, f: (r: any) => string) => (rows ?? []).map(r => ({ id: r.id, name: f(r) }))
  const st = TICKET_STATUS[t.status], od = ticketOverdue(t, c.today), w = t.warranty, ws = w ? warrantyState(w, c.today) : null
  const fmt = (d: string) => new Date(d).toLocaleString('en-GB', { timeZone: c.company.timezone, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

  return <>
    <Link href="/tickets" className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg"><ArrowLeft size={14} className="rtl:rotate-180" />Service & warranty</Link>
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2"><h1 className="text-lg font-semibold tracking-[-0.015em]">{t.number} · {t.title}</h1><Badge tone={od ? 'red' : st?.tone}>{od ? 'Overdue' : st?.label}</Badge>
          {t.priority !== 'normal' && <Badge tone={TICKET_PRIORITY[t.priority]?.tone}>{TICKET_PRIORITY[t.priority]?.label}</Badge>}</div>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
          <span>{TICKET_CATEGORY[t.category]} · via {TICKET_SOURCE[t.source]}</span>
          {t.customer && <Link href={`/parties/${t.customer.id}`} className="hover:text-primary">{t.customer.name}</Link>}
          {t.project && <Link href={`/projects/${t.project.id}`} className="hover:text-primary">{t.project.code ?? t.project.name}</Link>}
          {t.asset && <Link href={`/assets/${t.asset.id}`} className="hover:text-primary">{t.asset.name}</Link>}
          {t.due_date && <span className={od ? 'font-medium text-danger' : ''}>Due {formatShortDate(t.due_date)}</span>}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {edit && lists && <DialogButton wide variant="secondary" label="Edit" title={`Edit ${t.number}`}><ActionForm action={updateTicket.bind(null, id)} resetOnSuccess={false} submit="Save ticket">
          <TicketFields t={t} customers={o(lists[0].data, r => r.name)} projects={o(lists[1].data, r => r.code ? `${r.code} · ${r.name}` : r.name)} assets={o(lists[2].data, r => [r.name, r.plate_or_serial].filter(Boolean).join(' · '))}
            users={o(lists[3].data, r => r.full_name)} employees={o(lists[4].data, r => r.full_name)} warranties={o(lists[5].data, r => `${r.number} · ${r.title}`)} /></ActionForm></DialogButton>}
        {c.can('records.delete') && <ActionButton size="md" variant="ghost" action={trashRecord.bind(null, 'service_ticket', id)} confirm="Move this ticket to the trash?">Delete</ActionButton>}
      </div>
    </div>

    <div className="grid gap-5 xl:grid-cols-3 [&>*]:min-w-0">
      <div className="flex min-w-0 flex-col gap-5 xl:col-span-2">
        <Card><CardHeader title="Problem" />
          <div className="space-y-3 p-4 text-sm">
            <p className="whitespace-pre-line break-words">{t.description || 'No details recorded.'}</p>
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-muted">
              {(t.contact_name || t.contact_phone) && <span className="inline-flex items-center gap-1"><Phone size={13} aria-hidden />{[t.contact_name, t.contact_phone].filter(Boolean).join(' · ')}</span>}
              {t.site_location && <span className="inline-flex items-center gap-1"><MapPin size={13} aria-hidden />{t.site_location}</span>}
              {t.scheduled_date && <span>Visit {formatShortDate(t.scheduled_date)}</span>}
              {t.assigned_to && <span>Assigned to {who.get(t.assigned_to) ?? '—'}</span>}
            </div>
            {t.resolution && <div className="rounded-md bg-success/5 p-3"><div className="text-xs font-medium text-success">Resolution</div><p className="mt-1 whitespace-pre-line">{t.resolution}</p></div>}
          </div></Card>
        {canWork && <Card><CardHeader title="Update status" />
          <div className="p-4"><ActionForm action={setTicketStatus.bind(null, id)} submit="Update" resetOnSuccess={false}>
            <div className="grid gap-3 sm:grid-cols-[220px_minmax(0,1fr)]"><Field label="Status"><Select name="status" defaultValue={t.status}>{Object.entries(TICKET_STATUS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}</Select></Field>
              <Field label="Resolution" hint="required to resolve or close"><Textarea name="resolution" rows={2} maxLength={4000} defaultValue={t.resolution ?? ''} placeholder="What was done, parts used, follow-up needed" /></Field></div></ActionForm></div></Card>}
        <Card><CardHeader title="Timeline" sub="Notes, calls and status changes" />
          {canWork && <div className="border-b border-border p-4"><ActionForm draftKey={`ticket-note:${id}`} action={addTicketNote.bind(null, id)} submit="Add note">
            <Field label="Note"><Textarea name="body" rows={2} required maxLength={4000} /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="kind" value="customer" />This was a conversation with the customer</label></ActionForm></div>}
          {!(events ?? []).length ? <p className="px-4 py-4 text-sm text-muted">No entries yet.</p> :
            <ol className="relative ms-6 border-s border-border py-3 pe-4">{(events ?? []).map((e: any) => <li key={e.id} className="mb-4 ms-4 last:mb-0">
              <span className="absolute -start-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-primary/60 ring-4 ring-surface" />
              <time className="text-xs tabular-nums text-muted">{fmt(e.created_at)} · {KIND[e.kind] ?? e.kind} · {e.user_id ? who.get(e.user_id) ?? 'a former user' : 'Customer / system'}</time>
              <p className="whitespace-pre-line break-words text-sm">{e.body}</p></li>)}</ol>}</Card>
      </div>
      <div className="flex min-w-0 flex-col gap-5">
        <Card><CardHeader title="Warranty" action={w ? <ShieldCheck size={15} className="text-success" aria-hidden /> : <ShieldOff size={15} className="text-muted" aria-hidden />} />
          <div className="space-y-2 p-4 text-sm">{w ? <>
            <div className="flex items-center gap-2"><span className="font-medium">{w.number}</span><Badge tone={ws!.tone}>{ws!.label}</Badge></div>
            <p>{w.title}</p><p className="text-xs text-muted">{formatShortDate(w.start_date)} – {formatShortDate(w.end_date)}</p>
            {w.terms && <p className="whitespace-pre-line text-xs text-muted">{w.terms}</p>}
            <p className={t.under_warranty ? 'text-success' : 'text-warning'}>{t.under_warranty ? 'Covered: the ticket was opened within the warranty period.' : 'Opened outside the warranty period.'}</p>
          </> : <p className="text-muted">No warranty found for this customer or project. {t.chargeable ? 'Marked chargeable.' : ''}</p>}
            {t.chargeable && w && <p className="text-warning">Marked chargeable (not covered).</p>}</div></Card>
        <RecordActivity c={c} table="service_tickets" id={id} limit={15} />
      </div>
    </div>
  </>
}
