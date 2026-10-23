// Tally export for expenses: ledger mapping checks, the voucher XML (Tally "Import Data" envelope), a structural check
// of that XML, and review sheets (CSV / Excel). Pure functions: no database access, so every rule is unit-tested.
//
// Accounting (UAE, VAT recoverable as input tax):
//   paid expense      → Payment voucher:  Dr expense ledger (excl. VAT), Dr input VAT ledger, Cr cash / bank ledger (total)
//   unpaid (credit)   → Purchase voucher: Dr expense ledger (excl. VAT), Dr input VAT ledger, Cr supplier ledger (total)
//   "purchase and payment" mode, paid supplier bill → the Purchase voucher above + a Payment voucher Dr supplier, Cr cash/bank
// Tally amounts: debit lines are negative with ISDEEMEDPOSITIVE=Yes, credit lines positive with ISDEEMEDPOSITIVE=No; every
// voucher sums to zero. Each voucher carries a REMOTEID built from the expense id, so importing the same file twice
// updates the voucher in Tally instead of creating a second one.

export const CATEGORY_LABELS: Record<string, string> = { material: 'Materials', labour: 'Labour', transport: 'Transport', fuel: 'Fuel', equipment: 'Equipment', subcontract: 'Subcontract', accommodation: 'Accommodation', food: 'Food', maintenance: 'Maintenance', other: 'Other' }
export const METHOD_LABELS: Record<string, string> = { cash: 'Cash', bank_transfer: 'Bank transfer', cheque: 'Cheque', card: 'Card', credit: 'On credit', other: 'Other' }
export const TALLY_VERSIONS = ['TallyPrime', 'Tally.ERP 9'] as const

export interface TallySettings {
  tally_company: string | null
  tally_version: (typeof TALLY_VERSIONS)[number]
  paid_mode: 'payment' | 'purchase_and_payment'
  category_ledgers: Record<string, string>
  vat_ledger: string | null
  payment_ledgers: Record<string, string>
  bank_ledgers: Record<string, string>
  validated_version?: string | null
  validated_at?: string | null
}
export const DEFAULT_TALLY: TallySettings = { tally_company: null, tally_version: 'TallyPrime', paid_mode: 'payment', category_ledgers: {}, vat_ledger: null, payment_ledgers: {}, bank_ledgers: {} }

export interface ExportExpense {
  id: string; spent_on: string; category: string; description: string
  amount: number; vat_amount: number
  reference: string | null; supplier_name: string | null; supplier_ledger: string | null; supplier_trn: string | null
  payment_method: string | null; payment_status: 'paid' | 'unpaid'; paid_from_bank_id: string | null; bank_label?: string | null
  payment_ref?: string | null; project_name?: string | null
  verified_at: string | null; approval_status: string | null; export_batch_id: string | null
}
export interface Issue { key: string; message: string; fix: string; count: number; ids: string[] }
export interface ExportReport {
  ready: ExportExpense[]; excluded: { row: ExportExpense; reason: string }[]
  errors: Issue[]; warnings: Issue[]; info: string[]
  totals: { count: number; amount: number; vat: number; total: number }
}

const r2 = (n: number) => Math.round(n * 100) / 100
const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()
const add = (list: Issue[], key: string, message: string, fix: string, id: string) => {
  const hit = list.find(i => i.key === key)
  if (hit) { hit.count++; hit.ids.push(id) } else list.push({ key, message, fix, count: 1, ids: [id] })
}

/** The ledger an expense is paid from, or null when it is not mapped. */
export function payLedger(e: ExportExpense, s: TallySettings): string | null {
  if (e.paid_from_bank_id) return clean(s.bank_ledgers[e.paid_from_bank_id]) || null
  return clean(s.payment_ledgers[e.payment_method ?? 'cash']) || null
}
export const supplierLedger = (e: ExportExpense) => clean(e.supplier_ledger) || clean(e.supplier_name) || null

/** Which expenses can go to Tally and what must be fixed first. Nothing is exported while `errors` is not empty. */
export function checkExport(rows: ExportExpense[], s: TallySettings): ExportReport {
  const rep: ExportReport = { ready: [], excluded: [], errors: [], warnings: [], info: [], totals: { count: 0, amount: 0, vat: 0, total: 0 } }
  const seen = new Map<string, string>()
  let nameAsLedger = 0
  for (const e of rows) {
    if (e.export_batch_id) { rep.excluded.push({ row: e, reason: 'Already exported' }); continue }
    if (!e.verified_at) { rep.excluded.push({ row: e, reason: 'Not verified yet' }); continue }
    if (e.approval_status && e.approval_status !== 'approved') { rep.excluded.push({ row: e, reason: e.approval_status === 'pending' ? 'Waiting for approval' : 'Not approved' }); continue }
    rep.ready.push(e)
    const cat = CATEGORY_LABELS[e.category] ?? e.category
    if (!clean(s.category_ledgers[e.category])) add(rep.errors, `cat:${e.category}`, `No Tally ledger for the "${cat}" category`, `Set the expense ledger for ${cat} under Ledger mapping.`, e.id)
    if (e.vat_amount > 0 && !clean(s.vat_ledger)) add(rep.errors, 'vat', 'No input VAT ledger', 'Set the input VAT ledger (for example "Input VAT 5%") under Ledger mapping.', e.id)
    if (!(e.amount > 0)) add(rep.errors, 'amount', 'An expense has no amount', 'Open the expense and enter the amount.', e.id)
    if (e.vat_amount < 0 || e.vat_amount > e.amount) add(rep.errors, 'vatbig', 'VAT is negative or larger than the amount', 'Open the expense and correct the VAT.', e.id)
    const supplierNeeded = e.payment_status === 'unpaid' || (s.paid_mode === 'purchase_and_payment' && !!clean(e.supplier_name))
    if (e.payment_status === 'unpaid' && !supplierLedger(e)) add(rep.errors, 'nosupplier', 'An unpaid expense has no supplier', 'Unpaid expenses are booked against the supplier: choose the supplier on the expense.', e.id)
    if (e.payment_status === 'paid' && !payLedger(e, s)) {
      if (e.paid_from_bank_id) add(rep.errors, `bank:${e.paid_from_bank_id}`, `No Tally ledger for the account "${e.bank_label ?? 'paid from'}"`, 'Set the bank / cash ledger for this account under Ledger mapping.', e.id)
      else add(rep.errors, `pay:${e.payment_method ?? 'cash'}`, `No Tally ledger for payments by ${(METHOD_LABELS[e.payment_method ?? 'cash'] ?? e.payment_method ?? 'cash').toLowerCase()}`, 'Set the ledger for this payment method under Ledger mapping.', e.id)
    }
    if (supplierNeeded && supplierLedger(e) && !clean(e.supplier_ledger)) nameAsLedger++
    if (e.reference && e.supplier_name) {
      const k = `${clean(e.supplier_name).toLowerCase()}|${clean(e.reference).toLowerCase().replace(/\s/g, '')}`
      if (seen.has(k)) add(rep.warnings, `dup:${k}`, `Two expenses have the same supplier and invoice number (${e.supplier_name}, ${e.reference})`, 'Check that this is not the same bill entered twice.', e.id)
      else seen.set(k, e.id)
    }
    if (e.vat_amount === 0 && e.amount >= 1000) add(rep.warnings, 'novat', 'Expenses of AED 1,000 or more without VAT', 'Fine for exempt or zero-rated supplies; otherwise add the VAT so it can be recovered.', e.id)
    rep.totals.count++; rep.totals.amount += e.amount; rep.totals.vat += e.vat_amount
  }
  rep.totals = { count: rep.totals.count, amount: r2(rep.totals.amount), vat: r2(rep.totals.vat), total: r2(rep.totals.amount + rep.totals.vat) }
  if (nameAsLedger) rep.info.push(`${nameAsLedger} expense${nameAsLedger === 1 ? ' uses' : 's use'} the supplier's name as its Tally ledger. Make sure a ledger with exactly that name exists under Sundry Creditors, or set the ledger on the supplier.`)
  if (!clean(s.tally_company)) rep.info.push('No Tally company name is set: Tally imports into the company that is open.')
  return rep
}

export function xmlEscape(s: string): string {
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}
const amt = (n: number) => r2(n).toFixed(2)
const day = (iso: string) => iso.replace(/-/g, '')

type Line = { ledger: string; dr: number }   // dr > 0 debit, dr < 0 credit
function voucher(remote: string, type: 'Payment' | 'Purchase', date: string, party: string, ref: string | null, narration: string, lines: Line[]): string {
  const entries = lines.filter(l => Math.abs(l.dr) >= 0.005).map(l => `      <ALLLEDGERENTRIES.LIST>
       <LEDGERNAME>${xmlEscape(l.ledger)}</LEDGERNAME>
       <ISDEEMEDPOSITIVE>${l.dr > 0 ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE>
       <AMOUNT>${amt(-l.dr)}</AMOUNT>
      </ALLLEDGERENTRIES.LIST>`).join('\n')
  return `     <VOUCHER REMOTEID="${xmlEscape(remote)}" VCHTYPE="${type}" ACTION="Create" OBJVIEW="Accounting Voucher View">
      <DATE>${day(date)}</DATE>
      <VOUCHERTYPENAME>${type}</VOUCHERTYPENAME>${ref ? `\n      <REFERENCE>${xmlEscape(ref)}</REFERENCE>` : ''}
      <PARTYLEDGERNAME>${xmlEscape(party)}</PARTYLEDGERNAME>
      <PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>
      <ISINVOICE>No</ISINVOICE>
      <NARRATION>${xmlEscape(narration.slice(0, 900))}</NARRATION>
${entries}
     </VOUCHER>`
}

/** The vouchers for one expense, as ledger lines (also used by the review sheets). */
export function vouchersFor(e: ExportExpense, s: TallySettings): { remote: string; type: 'Payment' | 'Purchase'; party: string; lines: Line[] }[] {
  const exp = clean(s.category_ledgers[e.category]), vat = clean(s.vat_ledger), total = r2(e.amount + e.vat_amount)
  const dr: Line[] = [{ ledger: exp, dr: r2(e.amount) }, ...(e.vat_amount > 0 ? [{ ledger: vat, dr: r2(e.vat_amount) }] : [])]
  const sup = supplierLedger(e), pay = payLedger(e, s)
  if (e.payment_status === 'unpaid') return [{ remote: `averiqo-exp-${e.id}`, type: 'Purchase', party: sup!, lines: [...dr, { ledger: sup!, dr: -total }] }]
  if (s.paid_mode === 'purchase_and_payment' && sup) return [
    { remote: `averiqo-exp-${e.id}`, type: 'Purchase', party: sup, lines: [...dr, { ledger: sup, dr: -total }] },
    { remote: `averiqo-exp-${e.id}-pay`, type: 'Payment', party: pay!, lines: [{ ledger: sup, dr: total }, { ledger: pay!, dr: -total }] },
  ]
  return [{ remote: `averiqo-exp-${e.id}`, type: 'Payment', party: pay!, lines: [...dr, { ledger: pay!, dr: -total }] }]
}
const narrationOf = (e: ExportExpense) => [e.description, e.supplier_name && `Supplier: ${e.supplier_name}`, e.supplier_trn && `TRN ${e.supplier_trn}`, e.reference && `Invoice ${e.reference}`, e.payment_ref && `Payment ref ${e.payment_ref}`, e.project_name && `Project: ${e.project_name}`, 'From Averiqo'].filter(Boolean).join(' · ')

/** Tally XML (Import Data → Vouchers). Call only with rows from a report that has no errors. */
export function buildTallyXml(rows: ExportExpense[], s: TallySettings): string {
  const vouchers = rows.flatMap(e => vouchersFor(e, s).map(v => voucher(v.remote, v.type, e.spent_on, v.party, e.reference, narrationOf(e), v.lines)))
  const company = clean(s.tally_company)
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
 <HEADER>
  <TALLYREQUEST>Import Data</TALLYREQUEST>
 </HEADER>
 <BODY>
  <IMPORTDATA>
   <REQUESTDESC>
    <REPORTNAME>Vouchers</REPORTNAME>${company ? `\n    <STATICVARIABLES>\n     <SVCURRENTCOMPANY>${xmlEscape(company)}</SVCURRENTCOMPANY>\n    </STATICVARIABLES>` : ''}
   </REQUESTDESC>
   <REQUESTDATA>
    <TALLYMESSAGE xmlns:UDF="TallyUDF">
${vouchers.join('\n')}
    </TALLYMESSAGE>
   </REQUESTDATA>
  </IMPORTDATA>
 </BODY>
</ENVELOPE>
`
}

/**
 * Structural check of a generated file before it is handed out: well-formed XML, the Import Data envelope, and every
 * voucher with a date, a type, at least two ledger lines with names, debit/credit flags that match the signs, and
 * amounts that sum to zero. (This checks the file we produce; it is not a substitute for a test import into Tally.)
 */
export function checkTallyXml(xml: string): { ok: boolean; errors: string[]; vouchers: number; debit: number } {
  const errors: string[] = []
  const stack: string[] = []
  const body = xml.replace(/^<\?xml[^?]*\?>\s*/, '')
  for (const m of body.matchAll(/<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>|<|&(?!(?:amp|lt|gt|quot|apos);)/g)) {
    if (m[0] === '<') { errors.push('A stray "<" in the text'); break }
    if (m[0].startsWith('&')) { errors.push('A stray "&" in the text'); break }
    const [, close, name, , self] = m
    if (self) continue
    if (close) { const top = stack.pop(); if (top !== name) { errors.push(`Tag <${name}> closes <${top ?? 'nothing'}>`); break } }
    else stack.push(name)
  }
  if (!errors.length && stack.length) errors.push(`Unclosed tag <${stack[stack.length - 1]}>`)
  if (!/^<ENVELOPE>/.test(body.trim())) errors.push('The root element is not ENVELOPE')
  if (!/<TALLYREQUEST>Import Data<\/TALLYREQUEST>/.test(xml)) errors.push('TALLYREQUEST is not "Import Data"')
  if (!/<REPORTNAME>Vouchers<\/REPORTNAME>/.test(xml)) errors.push('REPORTNAME is not "Vouchers"')
  let n = 0, debit = 0
  for (const v of xml.matchAll(/<VOUCHER\b([^>]*)>([\s\S]*?)<\/VOUCHER>/g)) {
    n++
    const head = v[1], inner = v[2], at = `Voucher ${n}`
    if (!/REMOTEID="[^"]+"/.test(head)) errors.push(`${at}: no REMOTEID`)
    if (!/<DATE>\d{8}<\/DATE>/.test(inner)) errors.push(`${at}: the date is not YYYYMMDD`)
    if (!/<VOUCHERTYPENAME>(Payment|Purchase)<\/VOUCHERTYPENAME>/.test(inner)) errors.push(`${at}: unknown voucher type`)
    if (!/<PARTYLEDGERNAME>[^<]+<\/PARTYLEDGERNAME>/.test(inner)) errors.push(`${at}: no party ledger`)
    let sum = 0, lines = 0
    for (const l of inner.matchAll(/<ALLLEDGERENTRIES\.LIST>([\s\S]*?)<\/ALLLEDGERENTRIES\.LIST>/g)) {
      lines++
      const name = l[1].match(/<LEDGERNAME>([^<]*)<\/LEDGERNAME>/)?.[1]?.trim(), pos = l[1].match(/<ISDEEMEDPOSITIVE>(Yes|No)<\/ISDEEMEDPOSITIVE>/)?.[1], a = l[1].match(/<AMOUNT>(-?\d+\.\d{2})<\/AMOUNT>/)?.[1]
      if (!name) errors.push(`${at}: a ledger line has no ledger name`)
      if (!pos || !a) { errors.push(`${at}: a ledger line has no debit/credit flag or amount`); continue }
      const x = Number(a)
      if ((pos === 'Yes') !== (x < 0)) errors.push(`${at}: ${name}: the debit/credit flag does not match the amount's sign`)
      sum += x; if (x < 0) debit += -x
    }
    if (lines < 2) errors.push(`${at}: fewer than two ledger lines`)
    if (Math.abs(sum) > 0.004) errors.push(`${at}: debits and credits differ by ${sum.toFixed(2)}`)
  }
  if (!n) errors.push('No vouchers in the file')
  return { ok: !errors.length, errors, vouchers: n, debit: r2(debit) }
}

/** Review sheets: one row per expense, and one row per ledger line (as Tally will book it). */
export function reviewSheets(rep: ExportReport, s: TallySettings) {
  const status = (e: ExportExpense) => rep.errors.some(i => i.ids.includes(e.id)) ? 'Needs a ledger mapping' : rep.warnings.some(i => i.ids.includes(e.id)) ? 'Ready (check warning)' : 'Ready'
  const expenses = {
    name: 'Expenses',
    headers: ['Date', 'Supplier', 'Supplier TRN', 'Invoice no.', 'Description', 'Category', 'Amount excl. VAT', 'VAT', 'Total', 'Paid / unpaid', 'Payment method', 'Payment ref.', 'Project', 'Export status'],
    rows: [...rep.ready.map(e => [e.spent_on, e.supplier_name, e.supplier_trn, e.reference, e.description, CATEGORY_LABELS[e.category] ?? e.category, e.amount, e.vat_amount, r2(e.amount + e.vat_amount), e.payment_status === 'paid' ? 'Paid' : 'Unpaid', METHOD_LABELS[e.payment_method ?? ''] ?? e.payment_method, e.payment_ref, e.project_name, status(e)]),
      ...rep.excluded.map(({ row: e, reason }) => [e.spent_on, e.supplier_name, e.supplier_trn, e.reference, e.description, CATEGORY_LABELS[e.category] ?? e.category, e.amount, e.vat_amount, r2(e.amount + e.vat_amount), e.payment_status === 'paid' ? 'Paid' : 'Unpaid', METHOD_LABELS[e.payment_method ?? ''] ?? e.payment_method, e.payment_ref, e.project_name, `Not exported: ${reason}`])],
  }
  const lines: unknown[][] = []
  if (!rep.errors.length) for (const e of rep.ready) for (const v of vouchersFor(e, s)) for (const l of v.lines.filter(x => Math.abs(x.dr) >= 0.005))
    lines.push([e.spent_on, v.type, v.remote, e.reference, l.ledger, l.dr > 0 ? r2(l.dr) : null, l.dr < 0 ? r2(-l.dr) : null, e.description])
  const ledger = { name: 'Ledger lines', headers: ['Date', 'Voucher type', 'Voucher id (REMOTEID)', 'Reference', 'Ledger', 'Debit', 'Credit', 'Narration'], rows: lines }
  const validation = { name: 'Validation', headers: ['Level', 'Problem', 'How to fix', 'Expenses'], rows: [
    ...rep.errors.map(i => ['Must fix', i.message, i.fix, i.count]), ...rep.warnings.map(i => ['Check', i.message, i.fix, i.count]), ...rep.info.map(m => ['Note', m, '', '']),
    ...(rep.errors.length || rep.warnings.length || rep.info.length ? [] : [['OK', 'Every expense has its ledgers mapped', '', rep.totals.count]]),
  ] }
  return { expenses, ledger, validation }
}
