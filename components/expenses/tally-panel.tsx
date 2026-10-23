import Link from 'next/link'
import { AlertTriangle, CheckCircle2, Download, FileText, Info, ShieldCheck } from '@/components/icons'
import { Badge, Card, Field, Input, LinkButton, Metrics, Select, StatCard, Td, Th, TableWrap } from '@/components/ui/primitives'
import { ActionButton, ActionForm } from '@/components/ui/action-form'
import { DialogButton } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/primitives'
import { CreateTallyExport } from '@/components/expenses/tally-actions'
import { markVerified, releaseTallyExport, saveTallySettings, setTallyValidated } from '@/app/actions/expenses'
import { CATEGORY_LABELS, METHOD_LABELS, TALLY_VERSIONS, checkExport, type TallySettings } from '@/lib/expenses/tally'
import type { ExportExpense } from '@/lib/expenses/tally'
import type { ExportFilters } from '@/lib/expenses/export-data'
import { fmtMoney } from '@/lib/sales/money'
import { formatAed } from '@/lib/time'
import { cn } from '@/lib/utils'

type Batch = { id: string; ref: string; created_at: string; expense_count: number; total: number; vat_total: number; tally_version: string | null; released_at: string | null; release_reason: string | null; creator?: { full_name: string } | null }
type Bank = { id: string; label: string }

/**
 * Tally export: filters, the validation report (every missing ledger mapping is named before a file can be made), the
 * ledger mapping, and the history of exports with their references. Compatibility is stated plainly: the file passes
 * Averiqo's structural checks, and is called tested with a Tally version only after someone records a test import.
 */
export function TallyPanel({ rows, settings, batches, banks, suppliers, filters, canEdit }: {
  rows: ExportExpense[]; settings: TallySettings; batches: Batch[]; banks: Bank[]; suppliers: { id: string; name: string }[]; filters: ExportFilters; canEdit: boolean
}) {
  const rep = checkExport(rows, settings)
  const unverified = rep.excluded.filter(x => x.reason === 'Not verified yet').map(x => x.row.id)
  const q = new URLSearchParams(Object.entries({ tab: 'tally', ...filters }).filter(([, v]) => v) as [string, string][]).toString()
  const review = (fmt: string) => `/api/expenses/tally/review?${q}&format=${fmt}`
  const cls = 'h-10 rounded-lg border border-border bg-surface px-3 text-sm'
  const plain: Record<string, string | undefined> = { from: filters.from, to: filters.to, supplier: filters.supplier, category: filters.category }
  const tested = settings.validated_version === settings.tally_version
  return <div className="grid gap-5">
    <Card className={cn('flex flex-wrap items-start gap-3 p-4', tested ? 'border-success/30' : 'border-warning/40')} data-tally-status>
      {tested ? <CheckCircle2 size={20} className="mt-0.5 text-success" aria-hidden /> : <Info size={20} className="mt-0.5 text-warning" aria-hidden />}
      <div className="min-w-0 flex-1 text-[14px]">
        {tested ? <p><b className="font-semibold">Test import confirmed with {settings.validated_version}</b>{settings.validated_at && <> on {settings.validated_at.slice(0, 10)}</>}. Keep checking the first import after any Tally upgrade.</p>
          : <p><b className="font-semibold">Not yet tested with your Tally.</b> Files use Tally&apos;s XML import format (Import Data → Vouchers) and pass Averiqo&apos;s own checks: well-formed XML, every voucher balanced, ledger names and dates present. Before importing real data, import one file into a backup copy of your company in {settings.tally_version} (Gateway of Tally → Import → Vouchers), check the vouchers, then record it here.</p>}
      </div>
      {canEdit && <ActionButton action={setTallyValidated.bind(null, !tested)} variant={tested ? 'ghost' : 'secondary'} confirm={tested ? undefined : `Confirm that a test import of an Averiqo file into ${settings.tally_version} worked and the vouchers were correct?`}>{tested ? 'Clear test record' : `A test import into ${settings.tally_version} worked`}</ActionButton>}
    </Card>

    <Card>
      <form className="flex flex-wrap items-end gap-2 border-b border-border p-3"><input type="hidden" name="tab" value="tally" />
        <Field label="From"><input type="date" name="from" defaultValue={filters.from} className={cls} /></Field>
        <Field label="To"><input type="date" name="to" defaultValue={filters.to} className={cls} /></Field>
        <Field label="Supplier"><select name="supplier" defaultValue={filters.supplier ?? ''} className={cls}><option value="">All suppliers</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="Category"><select name="category" defaultValue={filters.category ?? ''} className={cls}><option value="">All categories</option>{Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Export status"><select name="status" defaultValue={filters.status ?? 'ready'} className={cls}><option value="ready">Not exported yet</option><option value="exported">Already exported</option><option value="all">All</option></select></Field>
        <button className="h-10 cursor-pointer rounded-lg border border-border px-4 text-sm font-medium hover:bg-surface-2">Apply</button>
      </form>
      <div className="p-4">
        <Metrics cols={4}>
          <StatCard label="Ready to export" value={rep.totals.count} icon={FileText} tone="blue" />
          <StatCard label="Amount excl. VAT" value={formatAed(rep.totals.amount)} />
          <StatCard label="Input VAT" value={formatAed(rep.totals.vat)} />
          <StatCard label="Total" value={formatAed(rep.totals.total)} hint={rep.excluded.length ? `${rep.excluded.length} not included (see below)` : undefined} />
        </Metrics>

        <section aria-label="Validation report" className="mt-5 space-y-2" data-validation>
          <h3 className="text-[15px] font-semibold">Validation report</h3>
          {!rep.errors.length && !rep.warnings.length && rep.totals.count > 0 && <p className="flex items-center gap-2 rounded-lg bg-success/10 px-3 py-2 text-[14px] text-success"><CheckCircle2 size={16} aria-hidden />Every expense has its ledgers mapped. Ready to create the file.</p>}
          {rep.errors.map(i => <div key={i.key} className="flex items-start gap-2 rounded-lg bg-danger/10 px-3 py-2 text-[14px] text-danger" data-issue="error">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden /><div><b className="font-semibold">{i.message}</b> ({i.count} expense{i.count === 1 ? '' : 's'}). {i.fix}</div></div>)}
          {rep.warnings.map(i => <div key={i.key} className="flex items-start gap-2 rounded-lg bg-warning/10 px-3 py-2 text-[14px] text-warning" data-issue="warning">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden /><div><b className="font-semibold">{i.message}</b> ({i.count}). {i.fix}</div></div>)}
          {rep.info.map(m => <p key={m} className="flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2 text-[13.5px] text-muted"><Info size={15} className="mt-0.5 shrink-0" aria-hidden />{m}</p>)}
          {rep.excluded.length > 0 && <div className="rounded-lg bg-surface-2 px-3 py-2 text-[13.5px]">
            <b className="font-semibold">Not included:</b> {Object.entries(rep.excluded.reduce<Record<string, number>>((m, x) => { m[x.reason] = (m[x.reason] ?? 0) + 1; return m }, {})).map(([r, n]) => `${n} ${r.toLowerCase()}`).join(' · ')}
            {unverified.length > 0 && canEdit && <div className="mt-2 flex flex-wrap items-center gap-2 text-muted">These were saved before checking was recorded. <Link href="/expenses?check=no" className="text-primary hover:underline">Review them</Link>
              <ActionButton action={markVerified.bind(null, unverified)} confirm={`Confirm you have checked these ${unverified.length} expenses against their receipts?`}>I have checked these {unverified.length}</ActionButton></div>}
          </div>}
        </section>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <CreateTallyExport filters={plain} disabled={!!rep.errors.length || filters.status === 'exported'} count={rep.totals.count} />
          <LinkButton href={review('xlsx')} variant="secondary"><Download size={14} />Review in Excel</LinkButton>
          <LinkButton href={review('csv')} variant="ghost"><Download size={14} />CSV</LinkButton>
          <span className="text-[12.5px] text-muted">The Excel review has the expenses, every ledger line (debit / credit) and this report. It does not mark anything as exported.</span>
        </div>
      </div>
    </Card>

    <Card className="p-4">
      <details open={rep.errors.some(e => !['amount', 'vatbig', 'nosupplier'].includes(e.key)) || !settings.vat_ledger}>
        <summary className="cursor-pointer text-[15px] font-semibold">Ledger mapping <span className="text-[13px] font-normal text-muted">· which Tally ledger each expense posts to</span></summary>
        {canEdit ? <ActionForm action={saveTallySettings} submit="Save mapping" resetOnSuccess={false} className="mt-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Tally company name" hint="Exactly as in Tally; empty = the open company"><Input name="tally_company" defaultValue={settings.tally_company ?? ''} maxLength={200} /></Field>
            <Field label="Tally version"><Select name="tally_version" defaultValue={settings.tally_version}>{TALLY_VERSIONS.map(v => <option key={v} value={v}>{v}</option>)}</Select></Field>
            <Field label="Paid supplier bills" hint="How bills already paid are booked"><Select name="paid_mode" defaultValue={settings.paid_mode}><option value="payment">One Payment voucher</option><option value="purchase_and_payment">Purchase + Payment (supplier ledger shows both)</option></Select></Field>
            <Field label="Input VAT ledger" hint='e.g. "Input VAT 5%" (Duties & Taxes, type VAT)'><Input name="vat_ledger" defaultValue={settings.vat_ledger ?? ''} maxLength={200} /></Field>
          </div>
          <h4 className="mt-5 text-[13px] font-semibold text-muted">Expense ledgers by category</h4>
          <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{Object.entries(CATEGORY_LABELS).map(([k, l]) => <Field key={k} label={l}><Input name={`cat_${k}`} defaultValue={settings.category_ledgers[k] ?? ''} maxLength={200} placeholder={k === 'material' ? 'Purchase - Materials' : `${l} Expenses`} /></Field>)}</div>
          <h4 className="mt-5 text-[13px] font-semibold text-muted">Paid with (when no account is chosen on the expense)</h4>
          <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{Object.entries(METHOD_LABELS).filter(([k]) => k !== 'credit').map(([k, l]) => <Field key={k} label={l}><Input name={`pay_${k}`} defaultValue={settings.payment_ledgers[k] ?? ''} maxLength={200} placeholder={k === 'cash' ? 'Cash' : k === 'card' ? 'Company Card' : 'Bank ledger'} /></Field>)}</div>
          {banks.length > 0 && <><h4 className="mt-5 text-[13px] font-semibold text-muted">Your accounts → Tally bank / cash ledgers</h4>
            <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{banks.map(b => <Field key={b.id} label={b.label}><Input name={`bank_${b.id}`} defaultValue={settings.bank_ledgers[b.id] ?? ''} maxLength={200} /></Field>)}</div></>}
          <p className="mt-4 text-[12.5px] text-muted">Unpaid bills post to the supplier&apos;s ledger: set it on each supplier (Suppliers tab), otherwise the supplier&apos;s name is used. Ledger names must match Tally exactly, including spaces.</p>
        </ActionForm> : <p className="mt-3 text-sm text-muted">Only finance staff who can export data can change the mapping.</p>}
      </details>
    </Card>

    <Card>
      <h3 className="border-b border-border px-4 py-3 text-[15px] font-semibold">Export history</h3>
      {!batches.length ? <p className="px-4 py-6 text-sm text-muted">No exports yet. Each file gets a reference (EXP-year-number) and its expenses are locked until the export is undone.</p>
        : <TableWrap><thead className="bg-surface-2/50"><tr><Th>Reference</Th><Th>Created</Th><Th className="text-right">Expenses</Th><Th className="text-right">Total</Th><Th>Status</Th><Th /></tr></thead>
          <tbody className="divide-y divide-border">{batches.map(b => <tr key={b.id} data-batch={b.ref}>
            <Td className="font-mono text-[13px] font-medium">{b.ref}</Td>
            <Td className="text-muted">{b.created_at.slice(0, 16).replace('T', ' ')}{b.creator?.full_name && <> · {b.creator.full_name}</>}<div className="text-xs">{b.tally_version}</div></Td>
            <Td className="text-right tabular-nums">{b.expense_count}</Td><Td className="text-right tabular-nums">{fmtMoney(b.total)}</Td>
            <Td>{b.released_at ? <span title={b.release_reason ?? ''}><Badge tone="neutral">Undone</Badge><div className="mt-0.5 max-w-[220px] truncate text-xs text-muted">{b.release_reason}</div></span> : <Badge tone="green"><ShieldCheck size={12} aria-hidden />Exported · locked</Badge>}</Td>
            <Td className="text-right"><div className="flex justify-end gap-1">
              <LinkButton href={`/api/expenses/tally/${b.id}`} variant="ghost" size="sm"><Download size={13} />XML</LinkButton>
              {!b.released_at && canEdit && <DialogButton size="sm" variant="ghost" label="Undo" title={`Undo export ${b.ref}`}>
                <ActionForm action={releaseTallyExport.bind(null, b.id)} submit="Undo export" variant="danger">
                  <p className="mb-3 text-sm text-muted">Its {b.expense_count} expenses are unlocked so they can be corrected and exported again. If the file was already imported, delete those vouchers in Tally, or re-import the new file: the same voucher ids update the vouchers instead of adding them twice.</p>
                  <Field label="Reason *"><Textarea name="reason" rows={2} required minLength={3} maxLength={500} placeholder="e.g. Imported into the wrong Tally company" /></Field>
                </ActionForm></DialogButton>}</div></Td></tr>)}</tbody></TableWrap>}
    </Card>
  </div>
}
