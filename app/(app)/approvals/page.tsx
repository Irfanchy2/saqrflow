import Link from 'next/link'
import { CheckCircle2, Plus, X } from 'lucide-react'
import { getCtx } from '@/lib/auth'
import { PAGE_SIZE, flat, pageOf, sanitizeQ } from '@/lib/queries'
import { Badge, Card, CardHeader, EmptyState, Field, Input, LinkButton, Metrics, PageHeader, Pagination, Select, StatCard, Textarea } from '@/components/ui/primitives'
import { DialogButton } from '@/components/ui/dialog'
import { ActionButton, ActionForm } from '@/components/ui/action-form'
import { cancelApprovalRequest, createApprovalRequest, decideApprovalRequest } from '@/app/actions/approvals'
import { APPROVAL_STATUS, APPROVAL_TYPES, APPROVAL_TYPE_LABEL, approvalLink, canDecide } from '@/lib/approvals'
import { formatAed } from '@/lib/time'
import { cn } from '@/lib/utils'
import { SavedViews } from '@/components/saved-views'

export const metadata = { title: 'Approvals' }
const TABS = [['pending', 'Waiting for a decision'], ['mine', 'My requests'], ['decided', 'Decided']] as const

/** One inbox for every approval: quotations, purchase orders, expenses, outgoing cheques and free-form requests. */
export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await getCtx(); const sp = await flat(searchParams)
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : 'pending'
  const page = pageOf(sp.page), term = sanitizeQ(sp.q), type = (APPROVAL_TYPES as readonly string[]).includes(sp.type ?? '') ? sp.type : undefined
  const head = { count: 'exact' as const, head: true }
  let q = c.supabase.from('approval_requests').select('*', { count: 'exact' })
  if (tab === 'pending') q = q.eq('status', 'pending')
  else if (tab === 'mine') q = q.eq('requested_by', c.userId)
  else q = q.neq('status', 'pending')
  if (type) q = q.eq('entity_type', type)
  if (term) q = q.ilike('title', `%${term}%`)
  const [{ data: rows, count }, pending, mine, approved30, people, focusRes] = await Promise.all([
    q.order('requested_at', { ascending: tab === 'pending' }).range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1),
    c.supabase.from('approval_requests').select('id', head).eq('status', 'pending'),
    c.supabase.from('approval_requests').select('id', head).eq('status', 'pending').eq('requested_by', c.userId),
    c.supabase.from('approval_requests').select('id', head).eq('status', 'approved').gte('decided_at', new Date(Date.now() - 30 * 864e5).toISOString()),
    c.supabase.from('profiles').select('id,full_name'),
    sp.open && /^[0-9a-f-]{36}$/.test(sp.open) ? c.supabase.from('approval_requests').select('*').eq('id', sp.open).maybeSingle() : Promise.resolve({ data: null }),
  ])
  const who = new Map((people.data ?? []).map(p => [p.id, p.full_name as string]))
  const focus: any = focusRes.data
  // reference text for expense / cheque links (opens the list filtered to that record)
  const refs = new Map<string, string>()
  const ids = (t: string) => [...(rows ?? []), ...(focus ? [focus] : [])].filter((r: any) => r.entity_type === t && r.entity_id).map((r: any) => r.entity_id)
  const [exp, chq] = await Promise.all([
    ids('expense').length ? c.supabase.from('project_expenses').select('id,description').in('id', ids('expense')) : Promise.resolve({ data: [] as any[] }),
    ids('cheque').length ? c.supabase.from('cheques').select('id,cheque_no').in('id', ids('cheque')) : Promise.resolve({ data: [] as any[] }),
  ])
  for (const e of exp.data ?? []) refs.set(e.id, e.description)
  for (const x of chq.data ?? []) refs.set(x.id, x.cheque_no)
  const qs = (x: Record<string, string>) => `/approvals?${new URLSearchParams({ ...Object.fromEntries(Object.entries(sp).filter(([k, v]) => v && !['page', 'open'].includes(k))) as Record<string, string>, ...x })}`
  const fmt = (d: string) => new Date(d).toLocaleString('en-GB', { timeZone: c.company.timezone, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
  const add = c.can('records.edit') ? <DialogButton label="New request" title="New approval request" icon={<Plus size={15} />} openParam="approval">
    <ActionForm action={createApprovalRequest} submit="Send for approval" idempotent>
      <Field label="What needs approval? *"><Input name="title" required minLength={3} maxLength={200} placeholder="e.g. Buy 2 welding machines for Villa 214" /></Field>
      <Field label="Amount (AED)" hint="optional"><Input name="amount" type="number" min={0} step="0.01" /></Field>
      <Field label="Details"><Textarea name="details" rows={4} maxLength={4000} placeholder="Why it is needed, supplier, deadline…" /></Field>
    </ActionForm></DialogButton> : undefined

  return <>
    <PageHeader title="Approvals" sub="Quotations, purchase orders, expenses, outgoing cheques and other requests waiting for a manager. Every decision is recorded in the audit log." actions={<><SavedViews page="/approvals" />{add}</>} />
    <Metrics className="mb-5" cols={3}>
      <StatCard label="Waiting for a decision" value={pending.count ?? 0} tone={pending.count ? 'amber' : 'neutral'} href="/approvals?tab=pending" />
      <StatCard label="My open requests" value={mine.count ?? 0} href="/approvals?tab=mine" />
      <StatCard label="Approved in 30 days" value={approved30.count ?? 0} href="/approvals?tab=decided" />
    </Metrics>

    {focus && <Card className="mb-5"><CardHeader title={focus.title} sub={`${APPROVAL_TYPE_LABEL[focus.entity_type as keyof typeof APPROVAL_TYPE_LABEL]} · requested by ${who.get(focus.requested_by) ?? 'a former user'} · ${fmt(focus.requested_at)}`}
      action={<Link href={qs({})} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-fg"><X size={16} /></Link>} />
      <div className="space-y-3 p-4 text-sm">
        <div className="flex flex-wrap items-center gap-2"><Badge tone={APPROVAL_STATUS[focus.status]?.tone}>{APPROVAL_STATUS[focus.status]?.label}</Badge>
          {focus.amount !== null && <span className="font-medium tabular-nums">{formatAed(focus.amount)}</span>}
          {approvalLink(focus.entity_type, focus.entity_id, refs.get(focus.entity_id)) && <Link href={approvalLink(focus.entity_type, focus.entity_id, refs.get(focus.entity_id))!} className="text-primary hover:underline">Open the {APPROVAL_TYPE_LABEL[focus.entity_type as keyof typeof APPROVAL_TYPE_LABEL].toLowerCase()}</Link>}</div>
        {focus.details && <p className="whitespace-pre-line break-words">{focus.details}</p>}
        {focus.status !== 'pending' && <p className="text-muted">{APPROVAL_STATUS[focus.status]?.label} by {who.get(focus.decided_by) ?? '—'}{focus.decided_at ? ` · ${fmt(focus.decided_at)}` : ''}{focus.decision_note ? `: “${focus.decision_note}”` : ''}</p>}
        {focus.status === 'pending' && canDecide(focus.entity_type, c.can) && <ActionForm action={decideApprovalRequest.bind(null, focus.id)} submit="Save decision">
          <div className="grid gap-3 sm:grid-cols-[220px_minmax(0,1fr)]"><Field label="Decision"><Select name="decision" defaultValue="approved"><option value="approved">Approve</option><option value="changes_requested">Request changes</option><option value="rejected">Reject</option></Select></Field>
            <Field label="Note" hint="required unless approving"><Input name="note" maxLength={2000} /></Field></div></ActionForm>}
        {focus.status === 'pending' && (focus.requested_by === c.userId || c.can('approvals.decide')) && <ActionButton variant="ghost" action={cancelApprovalRequest.bind(null, focus.id)} confirm="Cancel this approval request?">Cancel request</ActionButton>}
      </div></Card>}

    <nav aria-label="Approval views" className="mb-4 flex gap-1 overflow-x-auto border-b border-border">{TABS.map(([k, l]) => <Link key={k} href={qs({ tab: k })} aria-current={tab === k ? 'page' : undefined}
      className={cn('-mb-px shrink-0 border-b-2 px-3 py-2 text-sm transition-colors', tab === k ? 'border-primary font-medium text-fg' : 'border-transparent text-muted hover:text-fg')}>{l}</Link>)}</nav>
    <Card>
      <form className="flex flex-wrap gap-2 border-b border-border p-3"><input type="hidden" name="tab" value={tab} />
        <input name="q" type="search" defaultValue={sp.q} aria-label="Search requests" placeholder="Search requests…" className="h-9 min-w-48 flex-1 rounded-md border border-border bg-surface px-3 text-sm" />
        <select name="type" defaultValue={type ?? ''} aria-label="Type" className="h-9 rounded-md border border-border bg-surface px-3 text-sm"><option value="">All types</option>{APPROVAL_TYPES.map(t => <option key={t} value={t}>{APPROVAL_TYPE_LABEL[t]}</option>)}</select>
        <button className="h-9 cursor-pointer rounded-md border border-border bg-surface px-3 text-sm">Filter</button>{(term || type) && <LinkButton href={`/approvals?tab=${tab}`} variant="ghost">Clear</LinkButton>}</form>
      {!rows?.length ? <EmptyState icon={CheckCircle2} title={tab === 'pending' ? 'Nothing is waiting for approval' : 'No requests here'} body={tab === 'pending' ? 'Requests appear here when a quotation is sent for approval, or when an expense, cheque or purchase order needs one under Settings → Approvals.' : undefined} />
        : <ul className="divide-y divide-border">{rows.map((r: any) => <li key={r.id}><Link href={qs({ open: r.id })} scroll={false} className={cn('flex items-center gap-3 px-4 py-3 text-sm hover:bg-surface-2/50', sp.open === r.id && 'bg-primary-soft/40')}>
          <span className="min-w-0 flex-1"><span className="block truncate font-medium">{r.title}</span>
            <span className="block truncate text-xs text-muted">{APPROVAL_TYPE_LABEL[r.entity_type as keyof typeof APPROVAL_TYPE_LABEL]} · {who.get(r.requested_by) ?? 'a former user'} · {fmt(r.requested_at)}</span></span>
          {r.amount !== null && <span className="hidden shrink-0 tabular-nums sm:inline">{formatAed(r.amount)}</span>}
          <Badge tone={APPROVAL_STATUS[r.status]?.tone} className="shrink-0">{APPROVAL_STATUS[r.status]?.label}</Badge></Link></li>)}</ul>}
      <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} params={sp} base="/approvals" />
    </Card>
  </>
}
