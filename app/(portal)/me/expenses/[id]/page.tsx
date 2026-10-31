import Link from 'next/link'
import { notFound } from 'next/navigation'
import { myProjects, getMe, CLAIM_STATUS } from '@/lib/me'
import { EXPENSE_CATS } from '@/lib/projects'
import { formatShortDate } from '@/lib/time'
import { cn } from '@/lib/utils'
import { Badge, Money } from '@/components/ui/primitives'
import { DialogButton } from '@/components/ui/dialog'
import { ActionButton, ActionForm } from '@/components/ui/action-form'
import { ArrowLeft, FileText, History, Pencil, Undo2 } from '@/components/icons'
import { ExpenseFields } from '@/components/expenses/expense-fields'
import { PortalCard } from '@/components/portal/stat'
import { updateClaim, withdrawClaim } from '@/app/actions/me'
import { claimSuppliers } from '@/lib/expenses/claim-suppliers'
import { cardName, companyCards } from '@/lib/cards'
import { FUNDED } from '@/lib/petty-math'

export const metadata = { title: 'Expense' }
const PAID: Record<string, string> = { cash: 'Cash', card: 'Card', bank_transfer: 'Bank transfer', other: 'Other' }
const EVENT: Record<string, string> = { submitted: 'Sent for approval', edited: 'Changed', resubmitted: 'Corrected and sent again', withdrawn: 'Withdrawn', approved: 'Approved', rejected: 'Rejected', correction_requested: 'Correction requested' }

/** One of the employee's own expense claims: what was sent, where it stands, its history; edit or withdraw while open. */
export default async function MyExpense({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const { c, emp } = await getMe()
  if (!emp) return null
  const { data: e } = await c.supabase.from('expense_claims').select('*').eq('id', id).eq('employee_id', emp.id).maybeSingle()
  if (!e) notFound()
  const [cards, projects, sups, { data: events }, { data: doc }, { data: pettyBal }] = await Promise.all([
    companyCards(c, true),
    myProjects(c),
    claimSuppliers(c, emp.id),
    c.supabase.from('expense_claim_events').select('id,kind,note,actor_name,created_at').eq('claim_id', id).order('created_at', { ascending: true }),
    e.receipt_document_id ? c.supabase.from('documents').select('id,current_version_id,version:document_versions!documents_current_version_fk(mime_type,file_name)').eq('id', e.receipt_document_id).maybeSingle() : Promise.resolve({ data: null }),
    c.supabase.rpc('petty_wallet_balance', { p_employee: emp.id }),
  ])
  const s = CLAIM_STATUS[e.status] ?? CLAIM_STATUS.pending
  const open = e.status === 'pending' || e.status === 'correction_requested'
  const ver = (doc as any)?.version as { mime_type: string; file_name: string } | null | undefined
  const tz = c.company.timezone
  const rows: [string, React.ReactNode][] = [
    ['Date', formatShortDate(e.spent_on)], ['Category', EXPENSE_CATS[e.category] ?? e.category], ['Supplier', e.supplier_name || '—'], ...(e.supplier_trn ? [['Supplier TRN', e.supplier_trn] as [string, string]] : []),
    ['Receipt no.', e.reference || '—'], ['Paid with', `${PAID[e.paid_with] ?? e.paid_with}${e.card_id && cards.find(k => k.id === e.card_id) ? ` · ${cardName(cards.find(k => k.id === e.card_id)!)}` : ''}`], ['Paid from', FUNDED.find(([k]) => k === e.funded_by)?.[1] ?? '—'], ['Amount excl. VAT', <Money key="a" value={e.amount} />], ['VAT', <Money key="v" value={e.vat_amount} />],
    ...(e.project_id ? [['Project', projects.find(p => p.id === e.project_id)?.name ?? '—'] as [string, string]] : []),
    ...(e.quantity ? [['Quantity', String(Number(e.quantity))] as [string, string]] : []),
  ]
  return <div className="space-y-4">
    <Link href="/me/expenses" className="inline-flex h-10 items-center gap-1.5 text-[14px] font-medium text-muted hover:text-fg"><ArrowLeft size={16} aria-hidden className="rtl:rotate-180" />My expenses</Link>

    <section className="rounded-2xl border border-border/80 bg-surface p-5 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0"><h1 className="text-[20px] font-semibold leading-snug tracking-[-0.02em] [overflow-wrap:anywhere]">{e.description}</h1>
          <p className="mt-0.5 text-[13px] text-muted">Sent {formatShortDate(e.created_at.slice(0, 10))}{e.source === 'scan' ? ' · from a scanned receipt' : ''}</p></div>
        <Badge tone={s.tone} className="text-[13px]">{s.label}</Badge>
      </div>
      <div className="mt-4 text-[30px] font-semibold tracking-[-0.03em]" data-claim-total><Money value={Number(e.amount) + Number(e.vat_amount)} /></div>
      {e.decision_note && <div className={cn('mt-4 rounded-xl px-4 py-3 text-[14px]', e.status === 'rejected' ? 'bg-danger/[.07] text-danger' : e.status === 'approved' ? 'bg-success/[.08] text-success' : 'bg-primary-soft text-primary')} data-decision-note>
        <b className="font-semibold">{e.status === 'rejected' ? 'Reason' : e.status === 'approved' ? 'Note from the approver' : 'What to correct'}:</b> {e.decision_note}</div>}
      {e.status === 'approved' && <p className="mt-3 text-[13px] text-muted">Approved {e.decided_at ? formatShortDate(e.decided_at.slice(0, 10)) : ''}. It is now in the company&apos;s expenses.</p>}
      {open && <div className="mt-5 flex flex-wrap gap-2">
        <DialogButton wide label={<><Pencil size={15} aria-hidden />{e.status === 'correction_requested' ? 'Correct and send again' : 'Edit'}</>} title={e.status === 'correction_requested' ? 'Correct and send again' : 'Edit expense'} variant={e.status === 'correction_requested' ? 'primary' : 'secondary'}>
          <ActionForm action={updateClaim.bind(null, id)} submit={e.status === 'correction_requested' ? 'Send for approval' : 'Save changes'} resetOnSuccess={false}>
            <ExpenseFields claim e={e} today={c.today} employees={[]} suppliers={sups} cards={cards.filter(k => k.active)} projects={projects} pettyBalance={Number(pettyBal ?? 0)} />
          </ActionForm>
        </DialogButton>
        <ActionButton action={withdrawClaim.bind(null, id)} size="md" variant="ghost" confirm="Withdraw this expense? It will not be sent for approval. You can add it again later."><Undo2 size={15} aria-hidden />Withdraw</ActionButton>
      </div>}
    </section>

    <PortalCard title="Details">
      <dl className="divide-y divide-border/70 px-4 pb-2 sm:px-5">{rows.map(([k, v]) => <div key={k} className="flex items-baseline justify-between gap-4 py-2.5 text-[14px]"><dt className="text-muted">{k}</dt><dd className="min-w-0 text-end font-medium [overflow-wrap:anywhere]">{v}</dd></div>)}</dl>
      {Array.isArray(e.items) && e.items.length > 0 && <div className="border-t border-border/70 px-4 py-3 sm:px-5"><p className="mb-2 text-[13px] font-medium text-muted">Items</p>
        <ul className="space-y-1.5 text-[14px]">{e.items.map((l: { description: string; quantity?: number | null; amount: number }, i: number) => <li key={i} className="flex justify-between gap-3"><span className="min-w-0 [overflow-wrap:anywhere]">{l.description}{l.quantity ? ` × ${l.quantity}` : ''}</span><Money value={l.amount} className="shrink-0" /></li>)}</ul></div>}
      {e.notes && <p className="border-t border-border/70 px-4 py-3 text-[14px] text-muted sm:px-5 [overflow-wrap:anywhere]">{e.notes}</p>}
    </PortalCard>

    <PortalCard title="Receipt">
      <div className="px-4 pb-4 sm:px-5">{e.receipt_document_id ? <>
        {ver?.mime_type?.startsWith('image/') && /* eslint-disable-next-line @next/next/no-img-element */
          <a href={`/api/documents/${e.receipt_document_id}/download?mode=preview`} target="_blank" rel="noopener noreferrer" className="mb-3 block overflow-hidden rounded-xl border border-border bg-surface-2"><img src={`/api/documents/${e.receipt_document_id}/download?mode=preview`} alt="Your receipt" className="max-h-80 w-full object-contain" /></a>}
        <a href={`/api/documents/${e.receipt_document_id}/download?mode=preview`} target="_blank" rel="noopener noreferrer" data-receipt-link className="inline-flex h-11 items-center gap-2 rounded-full border border-border bg-surface px-4 text-[14px] font-medium shadow-key hover:bg-surface-2"><FileText size={16} aria-hidden />Open receipt{ver?.file_name ? <span className="max-w-[160px] truncate text-muted">· {ver.file_name}</span> : null}</a></>
        : <p className="text-[14px] text-muted">No receipt attached.{open ? ' Use Edit to add a photo of it.' : ''}</p>}</div>
    </PortalCard>

    <PortalCard title="History">
      <ol className="space-y-3 px-4 pb-5 sm:px-5" data-claim-history>{(events ?? []).map(ev => <li key={ev.id} className="flex gap-3 text-[14px]">
        <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface-2 text-muted" aria-hidden><History size={14} /></span>
        <div className="min-w-0"><p className="font-medium">{EVENT[ev.kind] ?? ev.kind}<span className="font-normal text-muted"> · {ev.actor_name ?? 'System'}</span></p>
          <p className="text-[12.5px] text-muted">{new Date(ev.created_at).toLocaleString('en-GB', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' })}</p>
          {ev.note && <p className="mt-1 text-[13.5px] [overflow-wrap:anywhere]">{ev.note}</p>}</div></li>)}</ol>
    </PortalCard>
  </div>
}
