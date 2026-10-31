import Link from 'next/link'
import type { Ctx } from '@/lib/auth'
import { Badge, EmptyState, Field, Input, Money, Select, Textarea } from '@/components/ui/primitives'
import { ActionForm } from '@/components/ui/action-form'
import { FilterTabs } from '@/components/ui/mobile'
import { AccountSelect } from '@/components/banking/account-select'
import { AlertTriangle, CheckCircle2, FileText, History, Receipt, X } from '@/components/icons'
import { decideClaim } from '@/app/actions/claims'
import { CLAIM_STATUS } from '@/lib/me'
import { EXPENSE_CATS } from '@/lib/projects'
import { findDuplicate, normName, normRef } from '@/lib/expenses/suppliers'
import { ClaimsQueue, type QueueRow } from './claims-queue'
import { formatShortDate } from '@/lib/time'
import { FUNDED_ADMIN, defaultSettlement } from '@/lib/petty-math'

const FILTERS = [['pending', 'Waiting'], ['correction_requested', 'Sent back'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['withdrawn', 'Withdrawn'], ['all', 'All']] as const
const PAID: Record<string, string> = { cash: 'Cash', card: 'Card', bank_transfer: 'Bank transfer', other: 'Other' }
const EVENT: Record<string, string> = { submitted: 'Submitted', edited: 'Edited', resubmitted: 'Corrected and resubmitted', withdrawn: 'Withdrawn', approved: 'Approved', rejected: 'Rejected', correction_requested: 'Correction requested' }
const UUID = /^[0-9a-f-]{36}$/i

/**
 * Admin approval queue for employee expense claims (Expenses → Employee claims). Pending claims never appear in the
 * expense list, totals or Tally export; approving one adds it there once, linked to the employee and the receipt.
 */
export async function ClaimsPanel({ c, sp, projects }: { c: Ctx; sp: Record<string, string | undefined>; projects: { id: string; name: string }[] }) {
  const canDecide = c.can('expenses.approve') || c.can('approvals.decide')
  const status = FILTERS.some(([k]) => k === sp.status) ? sp.status! : 'pending'
  const cols = 'id,employee_id,spent_on,category,supplier_name,supplier_trn,reference,description,amount,vat_amount,paid_with,card:company_cards(label,last4),project_id,project:projects(name),quantity,items,notes,status,source,funded_by,receipt_document_id,decision_note,decided_at,expense_id,created_at,employee:employees(full_name,employee_no,user_id)'
  let q = c.supabase.from('expense_claims').select(cols)
  if (status !== 'all') q = q.eq('status', status)
  const [{ data: rows }, { data: counts }, focusRes] = await Promise.all([
    q.order('created_at', { ascending: status === 'pending' }).limit(300),
    c.supabase.from('expense_claims').select('status').limit(20000),
    sp.open && UUID.test(sp.open) ? c.supabase.from('expense_claims').select(cols).eq('id', sp.open).maybeSingle() : Promise.resolve({ data: null }),
  ])
  const n = (k: string) => (k === 'all' ? counts ?? [] : (counts ?? []).filter(r => r.status === k)).length
  const f: any = focusRes.data
  const [events, doc, dupExpense, dupClaims] = f ? await Promise.all([
    c.supabase.from('expense_claim_events').select('id,kind,note,actor_name,created_at').eq('claim_id', f.id).order('created_at').then(r => r.data ?? []),
    f.receipt_document_id ? c.supabase.from('documents').select('id,version:document_versions!documents_current_version_fk(mime_type,file_name)').eq('id', f.receipt_document_id).maybeSingle().then(r => r.data as any) : null,
    f.status === 'pending' ? findDuplicate(c, { supplierId: null, supplierName: f.supplier_name, reference: f.reference }) : null,
    f.reference && normRef(f.reference) ? c.supabase.from('expense_claims').select('id,spent_on,status,reference,employee:employees(full_name)').not('reference', 'is', null).neq('id', f.id).not('status', 'in', '(withdrawn,rejected)').limit(5000)
      .then(r => (r.data ?? []).filter(x => normRef(x.reference ?? '') === normRef(f.reference)).slice(0, 5)) : [],
  ]) : [[], null, null, []]
  const own = f?.employee?.user_id === c.userId
  // petty cash / own money: the employee's petty cash balance and, once approved, how much of the claim is settled
  const funded = f && (f.funded_by === 'petty_cash' || f.funded_by === 'personal')
  const [pettyBal, settle] = funded ? await Promise.all([
    c.supabase.rpc('petty_wallet_balance', { p_employee: f.employee_id }).then(r => Number(r.data ?? 0)),
    f.status === 'approved' ? c.supabase.from('expense_claim_settlement').select('from_petty_cash,to_reimburse,unsettled').eq('claim_id', f.id).maybeSingle().then(r => r.data) : null,
  ]) : [0, null]
  const fTotal = f ? Number(f.amount) + Number(f.vat_amount) : 0
  const plan = f ? defaultSettlement(f.funded_by, fTotal, pettyBal) : null
  const base = (x: Record<string, string>) => `/expenses?${new URLSearchParams({ tab: 'claims', ...(status !== 'pending' ? { status } : {}), ...x })}`
  const tz = c.company.timezone
  // Waiting tab: possible duplicates (same supplier and receipt number as a saved expense or another live claim), worked out
  // for the whole list in two queries; they are flagged and left out of "Select all"
  const waiting = status === 'pending' && canDecide && (rows ?? []).length > 0
  const key = (name: string | null, ref: string | null) => (ref && normRef(ref) ? `${normName(name ?? '')}|${normRef(ref)}` : '')
  const [expKeys, claimKeys] = waiting ? await Promise.all([
    c.supabase.from('project_expenses').select('supplier_name,reference').not('reference', 'is', null).limit(5000).then(r => new Set((r.data ?? []).map(x => key(x.supplier_name, x.reference)).filter(Boolean))),
    c.supabase.from('expense_claims').select('id,supplier_name,reference').not('reference', 'is', null).not('status', 'in', '(withdrawn,rejected)').limit(5000).then(r => (r.data ?? []).map(x => ({ id: x.id, k: key(x.supplier_name, x.reference) })).filter(x => x.k)),
  ]) : [new Set<string>(), [] as { id: string; k: string }[]]
  const queue: QueueRow[] = (rows ?? []).map((r: any) => {
    const k = key(r.supplier_name, r.reference)
    return { id: r.id, href: base({ open: r.id }), title: `${r.employee?.full_name ?? 'Employee'} · ${r.supplier_name ?? r.description}`,
      sub: `${formatShortDate(r.spent_on)} · ${EXPENSE_CATS[r.category] ?? r.category}${r.reference ? ` · ${r.reference}` : ''}${r.source === 'scan' ? ' · scanned' : ''}${r.receipt_document_id ? '' : ' · no receipt'}${r.funded_by === 'petty_cash' ? ' · petty cash' : r.funded_by === 'personal' ? ' · own money' : ''}`,
      total: Number(r.amount) + Number(r.vat_amount), scanned: r.source === 'scan', active: sp.open === r.id,
      status: { label: CLAIM_STATUS[r.status]?.label ?? r.status, tone: CLAIM_STATUS[r.status]?.tone }, own: r.employee?.user_id === c.userId,
      dup: !!k && r.status === 'pending' && (expKeys.has(k) || claimKeys.some(x => x.k === k && x.id !== r.id)) }
  })

  return <>
    {f && <section className="border-b border-border bg-surface-2/30 p-4 sm:p-5" data-claim-detail={f.id}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0"><p className="text-[13px] text-muted">{f.employee?.full_name ?? 'Employee'}{f.employee?.employee_no ? ` · ${f.employee.employee_no}` : ''} · sent {formatShortDate(f.created_at.slice(0, 10))}</p>
          <h2 className="mt-0.5 text-[18px] font-semibold tracking-[-0.02em] [overflow-wrap:anywhere]">{f.supplier_name ? `${f.supplier_name}: ` : ''}{f.description}</h2></div>
        <div className="flex items-center gap-2"><Badge tone={CLAIM_STATUS[f.status]?.tone}>{CLAIM_STATUS[f.status]?.label}</Badge>
          <Link href={base({})} scroll={false} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg"><X size={16} /></Link></div>
      </div>
      <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
        <div className="space-y-4 min-w-0">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-[14px] sm:grid-cols-3">
            {([['Total', <Money key="t" value={Number(f.amount) + Number(f.vat_amount)} className="font-semibold" />], ['Excl. VAT', <Money key="a" value={f.amount} />], ['VAT', <Money key="v" value={f.vat_amount} />],
              ['Date', formatShortDate(f.spent_on)], ['Category', EXPENSE_CATS[f.category] ?? f.category], ['Paid with', `${PAID[f.paid_with] ?? f.paid_with}${f.card ? ` · ${f.card.label} ••${f.card.last4}` : ''}`],
              ['Paid from', f.funded_by ? FUNDED_ADMIN[f.funded_by] : 'Not stated (earlier claim)'], ...(funded ? [['Petty cash held', <Money key="p" value={pettyBal} />] as [string, React.ReactNode]] : []),
              ['Project', f.project?.name ?? '—'], ['Receipt no.', f.reference ?? '—'], ['Supplier TRN', f.supplier_trn ?? '—'], ['Entered', f.source === 'scan' ? 'Scanned receipt' : 'By hand']] as [string, React.ReactNode][]).map(([k, v]) =>
              <div key={k} className="min-w-0"><dt className="text-[12px] text-muted">{k}</dt><dd className="mt-0.5 font-medium [overflow-wrap:anywhere]">{v}</dd></div>)}
          </dl>
          {Array.isArray(f.items) && f.items.length > 0 && <ul className="space-y-1 rounded-xl border border-border bg-surface p-3 text-[13.5px]">{f.items.map((l: any, i: number) => <li key={i} className="flex justify-between gap-3"><span className="min-w-0 [overflow-wrap:anywhere]">{l.description}{l.quantity ? ` × ${l.quantity}` : ''}</span><Money value={l.amount} /></li>)}</ul>}
          {f.notes && <p className="rounded-xl bg-surface px-3 py-2 text-[13.5px] text-muted [overflow-wrap:anywhere]">“{f.notes}”</p>}
          {(dupExpense || (dupClaims as any[]).length > 0) && <div className="flex items-start gap-2 rounded-xl bg-danger/[.07] px-3.5 py-2.5 text-[13.5px] text-danger" role="alert" data-claim-duplicate>
            <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden /><span>Possible duplicate: {dupExpense ? <>receipt {dupExpense.reference} from {dupExpense.supplier_name} is already in expenses ({formatShortDate(dupExpense.spent_on)}, <Money value={dupExpense.amount + dupExpense.vat_amount} />).</> : null}
              {(dupClaims as any[]).map(d => <span key={d.id} className="block">Also claimed by {d.employee?.full_name ?? 'an employee'} ({formatShortDate(d.spent_on)}, {CLAIM_STATUS[d.status]?.label.toLowerCase()}).</span>)}</span></div>}
          {f.receipt_document_id ? <div className="flex flex-wrap items-start gap-3">
            {doc?.version?.mime_type?.startsWith('image/') && /* eslint-disable-next-line @next/next/no-img-element */
              <a href={`/api/documents/${f.receipt_document_id}/download?mode=preview`} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-xl border border-border bg-surface"><img src={`/api/documents/${f.receipt_document_id}/download?mode=preview`} alt="Receipt" className="max-h-72 w-auto max-w-full object-contain" /></a>}
            <a href={`/api/documents/${f.receipt_document_id}/download?mode=preview`} target="_blank" rel="noopener noreferrer" data-claim-receipt className="inline-flex h-10 items-center gap-2 rounded-full border border-border bg-surface px-4 text-[13.5px] font-medium shadow-key hover:bg-surface-2"><FileText size={15} aria-hidden />Open receipt</a></div>
            : <p className="text-[13.5px] text-warning">No receipt attached.</p>}
          {f.decision_note && f.status !== 'pending' && <p className="text-[13.5px]"><b className="font-semibold">Decision note:</b> {f.decision_note}</p>}
          {settle && <p className="text-[13.5px]" data-claim-settlement>Settled: <Money value={settle.from_petty_cash} /> from petty cash{Number(settle.to_reimburse) > 0 && <>, <Money value={settle.to_reimburse} /> owed back to the employee</>}{Number(settle.unsettled) > 0 && <span className="text-warning">; <Money value={settle.unsettled} /> still to settle (<Link href={`/expenses/petty-cash/${f.employee_id}`} className="underline-offset-2 hover:underline">wallet</Link>)</span>}.</p>}
          {f.expense_id && <p className="flex items-center gap-1.5 text-[13.5px] text-success"><CheckCircle2 size={15} aria-hidden />In expenses since {f.decided_at ? formatShortDate(f.decided_at.slice(0, 10)) : '—'}. <Link href={`/expenses?q=${encodeURIComponent(f.reference ?? f.description)}`} className="font-medium underline-offset-2 hover:underline">Find it</Link></p>}
          <ol className="space-y-2 border-t border-border pt-3 text-[13px]" aria-label="History">{(events as any[]).map(ev => <li key={ev.id} className="flex gap-2"><History size={14} className="mt-0.5 shrink-0 text-muted" aria-hidden />
            <span><span className="font-medium">{EVENT[ev.kind] ?? ev.kind}</span><span className="text-muted"> · {ev.actor_name ?? 'System'} · {new Date(ev.created_at).toLocaleString('en-GB', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' })}</span>{ev.note && <span className="block [overflow-wrap:anywhere]">{ev.note}</span>}</span></li>)}</ol>
        </div>
        {f.status === 'pending' && canDecide && !own && <div className="rounded-2xl border border-border bg-surface p-4 shadow-card" data-claim-decide>
          <h3 className="mb-3 text-[15px] font-semibold">Decision</h3>
          <ActionForm action={decideClaim.bind(null, f.id)} submit="Save decision" resetOnSuccess={false}>
            <div className="grid gap-3.5">
              <fieldset><legend className="mb-1.5 text-[13px] font-medium">What do you decide?</legend>
                <div className="grid gap-1.5">{([['approved', 'Approve: add to expenses'], ['correction_requested', 'Send back for a correction'], ['rejected', 'Reject']] as const).map(([k, l], i) =>
                  <label key={k} className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-border px-3 py-2.5 text-[14px] has-[:checked]:border-primary has-[:checked]:bg-primary-soft">
                    <input type="radio" name="decision" value={k} defaultChecked={i === 0} className="h-4 w-4 accent-[hsl(var(--primary))]" />{l}</label>)}</div></fieldset>
              <Field label="Note to the employee" hint="Required when sending back or rejecting"><Textarea name="note" rows={2} maxLength={2000} /></Field>
              <Field label="Category"><Select name="category" defaultValue={f.category}>{Object.entries(EXPENSE_CATS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
              <Field label="Project" hint={f.project_id ? 'The employee chose this project; change it if needed' : 'When approving'}><Select name="project_id" defaultValue={f.project_id ?? ''}><option value="">— General / no project —</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
              {f.funded_by === 'petty_cash' && plan ? <div className="grid gap-3 rounded-xl bg-surface-2/60 p-3" data-claim-settle>
                <p className="text-[13px]">Paid from company petty cash. The employee holds <b className="font-semibold">AED {pettyBal.toFixed(2)}</b>. No company account moves again: the cash left when the petty cash was issued.</p>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="From petty cash (AED)"><Input name="petty" type="number" step="0.01" min="0" max={Math.min(fTotal, pettyBal)} defaultValue={plan.petty.toFixed(2)} /></Field>
                  <Field label="Employee paid (AED)" hint="Only if confirmed"><Input name="personal" type="number" step="0.01" min="0" max={fTotal} placeholder="0.00" /></Field></div>
                {plan.awaiting > 0 && <p className="text-[12.5px] text-warning">AED {plan.awaiting.toFixed(2)} more than the employee holds: it waits for settlement unless you confirm the employee paid it with their own money.</p>}</div>
                : f.funded_by === 'personal' ? <div className="grid gap-2 rounded-xl bg-surface-2/60 p-3" data-claim-settle>
                  <p className="text-[13px]">Paid with the employee&apos;s own money: approving records AED {fTotal.toFixed(2)} owed back to them (not from their petty cash).</p>
                  <AccountSelect name="paid_from_bank_id" label="Pay back now from (optional)" value={null} /></div>
                : <AccountSelect name="paid_from_bank_id" label={f.funded_by === 'company' ? 'Paid from' : 'Paid back from'} />}
            </div>
          </ActionForm></div>}
        {f.status === 'pending' && own && <p className="text-[13.5px] text-muted">This is your own expense: another approver decides it.</p>}
      </div>
    </section>}

    <FilterTabs label="Claim status" className="px-3" tabs={FILTERS.map(([k, l]) => ({ href: `/expenses?tab=claims${k === 'pending' ? '' : `&status=${k}`}`, label: l, active: status === k, count: n(k) }))} />
    {!rows?.length ? <EmptyState icon={Receipt} title={status === 'pending' ? 'No employee expenses waiting' : 'Nothing here'} body={status === 'pending' ? 'Employees send expenses from their portal (Scan receipt). They appear here for approval, and only enter your expenses once approved.' : undefined} />
      : <ClaimsQueue rows={queue} selectable={waiting} />}
  </>
}
