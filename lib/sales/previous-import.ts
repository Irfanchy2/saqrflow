// Excel / CSV upload of previous invoices (pure, unit-tested): finds the columns by their names, reads each row and
// says exactly what is wrong with a row before anything is saved.
import { normHeader, parseAmount, parseDate } from '../import-spec'

export const PREVIOUS_COLUMNS = [
  { key: 'customer', label: 'Customer', required: true, aliases: ['customer', 'customer name', 'client', 'client name', 'company', 'party'] },
  { key: 'number', label: 'Invoice number', required: true, aliases: ['invoice number', 'invoice no', 'inv no', 'invoice', 'number', 'no', 'bill no', 'tax invoice no'] },
  { key: 'issue_date', label: 'Invoice date', required: true, aliases: ['invoice date', 'date', 'inv date', 'bill date'] },
  { key: 'due_date', label: 'Due date', aliases: ['due date', 'due', 'payment due'] },
  { key: 'lpo_ref', label: 'LPO / reference', aliases: ['lpo', 'lpo no', 'lpo number', 'po', 'po number', 'reference', 'ref'] },
  { key: 'description', label: 'Description', aliases: ['description', 'details', 'project', 'work', 'subject', 'remarks'] },
  { key: 'amount', label: 'Amount incl. VAT', required: true, aliases: ['amount incl vat', 'total incl vat', 'total', 'amount', 'invoice amount', 'grand total', 'value'] },
  { key: 'vat_rate', label: 'VAT %', aliases: ['vat', 'vat rate', 'vat percent', 'tax rate'] },
  { key: 'paid', label: 'Already paid', aliases: ['paid', 'paid amount', 'amount paid', 'received', 'amount received'] },
] as const
export type PrevKey = (typeof PREVIOUS_COLUMNS)[number]['key']

/** Column index per field, -1 when not found. Exact names first, then names that contain one another. */
export function detectColumns(headers: string[]): Record<PrevKey, number> {
  const hs = headers.map(normHeader), used = new Set<number>(), out = {} as Record<PrevKey, number>
  for (const pass of ['exact', 'contains'] as const)
    for (const f of PREVIOUS_COLUMNS) {
      if (out[f.key] !== undefined && out[f.key] >= 0) continue
      const names = [normHeader(f.label), ...f.aliases.map(normHeader)]
      const i = hs.findIndex((h, j) => !used.has(j) && !!h && (pass === 'exact' ? names.includes(h) : names.some(n => n.length > 3 && (h.includes(n) || (n.includes(h) && h.length > 3)))))
      if (i >= 0) { out[f.key] = i; used.add(i) } else if (pass === 'contains') out[f.key] = out[f.key] ?? -1
    }
  return out
}

export interface PrevRow { line: number; customer: string; number: string; issue_date: string; due_date?: string; lpo_ref?: string; description?: string; amount: number; vat_rate: number; paid: number }

/** One data row → a previous invoice, or the reason it cannot be used. `line` is the Excel row number. */
export function readPreviousRow(row: string[], cols: Record<PrevKey, number>, line: number): PrevRow | { line: number; error: string } {
  const get = (k: PrevKey) => (cols[k] >= 0 ? String(row[cols[k]] ?? '').trim() : '')
  const fail = (error: string) => ({ line, error })
  const customer = get('customer').replace(/\s+/g, ' '), number = get('number')
  if (!customer) return fail('Customer is empty')
  if (!number) return fail('Invoice number is empty')
  if (number.length > 60) return fail('Invoice number is longer than 60 characters')
  const issue = parseDate(get('issue_date')); if (!issue || issue === 'bad') return fail(`Invoice date “${get('issue_date')}” must be a date (DD/MM/YYYY or YYYY-MM-DD)`)
  const due = parseDate(get('due_date')); if (due === 'bad') return fail(`Due date “${get('due_date')}” must be a date`)
  const amount = parseAmount(get('amount')); if (amount === null || Number.isNaN(amount) || amount <= 0) return fail(`Amount “${get('amount')}” must be a number above 0`)
  const vatTxt = get('vat_rate').replace('%', '').trim(), vat = vatTxt ? Number(vatTxt) : 5
  if (!Number.isFinite(vat) || vat < 0 || vat > 100) return fail(`VAT % “${get('vat_rate')}” must be a number such as 5 or 0`)
  const paid = parseAmount(get('paid')) ?? 0; if (Number.isNaN(paid) || paid < 0) return fail(`Paid “${get('paid')}” must be a number`)
  if (paid > amount + 0.005) return fail(`Paid (${paid}) is more than the amount (${amount})`)
  if (due && due < issue) return fail('The due date is before the invoice date')
  return { line, customer, number, issue_date: issue, due_date: due ?? undefined, lpo_ref: get('lpo_ref').slice(0, 80) || undefined, description: get('description').slice(0, 500) || undefined, amount, vat_rate: vat, paid }
}

export const customerKey = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/** Header row of the downloadable template (and an example row). */
export const TEMPLATE_CSV = 'Customer,Invoice number,Invoice date,Due date,LPO / reference,Description,Amount incl. VAT,VAT %,Already paid\r\n'
  + 'Gulf Technical Safety Training Centre-GTSC,ASR-2024-0153,15/03/2024,14/04/2024,LPO-4471,Steel staircase,10500,5,0\r\n'
