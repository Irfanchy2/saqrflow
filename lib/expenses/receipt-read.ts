// Full receipt / supplier tax invoice reading for the expense form: supplier, TRN, invoice number, date, line items,
// subtotal, VAT and total, each with how sure we are, plus checks that the numbers add up. Everything here is a
// SUGGESTION: the person reviews every field before the expense is saved (nothing is saved from a scan on its own).
import { allDates } from '../inbox/rules'
import { parseReceipt } from './receipt'

export type Conf = 'high' | 'medium' | 'low'
export interface ReceiptLine { description: string; quantity: number | null; unit_price: number | null; amount: number }
export interface ReceiptRead {
  supplier?: string; trn?: string; invoice_no?: string; date?: string
  subtotal?: number; vat?: number; total?: number; vat_rate?: number
  lines: ReceiptLine[]
  confidence: Partial<Record<'supplier' | 'trn' | 'invoice_no' | 'date' | 'subtotal' | 'vat' | 'total' | 'lines', Conf>>
  warnings: string[]
}

const r2 = (n: number) => Math.round(n * 100) / 100
const money = (s: string) => Number(s.replace(/[,\s]/g, ''))
const AMT = String.raw`(?:AED|Dhs?\.?|د\.إ)?\s*([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)`
const lastOf = (t: string, label: string) => {
  const all = [...t.matchAll(new RegExp(label + String.raw`\s*[:\-]?\s*` + AMT, 'gi'))].map(m => money(m[1])).filter(n => Number.isFinite(n) && n >= 0 && n < 1e9)
  return all.length ? all[all.length - 1] : undefined
}
const SKIP_LINE = /(sub\s*-?\s*total|grand\s*total|^total|\btotal\b|vat|tax|discount|balance|amount\s*(due|paid|payable)|paid|change|cash|card|round|net\s*amount|invoice|receipt|date|trn|tel|phone|fax|p\.?\s*o\.?\s*box|www\.|@)/i
const COMPANY = /\b(l\.?\s?l\.?\s?c\.?|llc|est\.?|establishment|trading|fz[ce]|fzco|fz-llc|co\.|company|group|industries|enterprises|contracting|materials|services|hardware|steel|metal)\b/i

/** Reads OCR text. `today` (company date) bounds the date: receipts are never in the future. */
export function readReceipt(text: string, today: string): ReceiptRead {
  const t = text.replace(/\r/g, '').replace(/[ \t]+/g, ' ')
  const lines = t.split('\n').map(l => l.trim()).filter(Boolean)
  const base = parseReceipt(text, today)
  const out: ReceiptRead = { lines: [], confidence: {}, warnings: [] }

  // supplier: a company-looking line near the top, else the first plain line the simple reader picked
  const top = lines.slice(0, 8).find(l => COMPANY.test(l) && l.length <= 90 && !/^(tax\s*invoice|invoice|receipt|bill\s*to|customer|sold\s*to)/i.test(l))
  if (top) { out.supplier = top.replace(/\s{2,}/g, ' '); out.confidence.supplier = 'high' }
  else if (base.supplier) { out.supplier = base.supplier; out.confidence.supplier = 'low' }

  const trn = t.match(/\b(?:TRN|VAT\s*(?:reg(?:istration)?\.?\s*)?(?:no|number|#)\.?|tax\s*reg(?:istration)?\.?\s*(?:no|number)\.?)\s*[:\-#]?\s*(1\d{2}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4})\b/i)
  if (trn) { out.trn = trn[1].replace(/\D/g, ''); out.confidence.trn = out.trn.length === 15 ? 'high' : 'low' }

  const inv = t.match(/(?:tax\s*invoice|invoice|inv|receipt|bill|voucher|doc(?:ument)?|cash\s*memo)\s*(?:no\.?|number|num|#)\s*[:\-.]?\s*([A-Z0-9][A-Z0-9\-\/.]{0,30}[A-Z0-9])/i)
  if (inv) { out.invoice_no = inv[1]; out.confidence.invoice_no = 'high' }
  else if (base.reference) { out.invoice_no = base.reference; out.confidence.invoice_no = 'medium' }

  const dated = t.match(/(?:invoice\s*date|date\s*of\s*(?:issue|supply)|^date|\bdate)\s*[:\-]?\s*([^\n]{6,24})/im)
  const labelled = dated ? allDates(dated[1]).map(d => d.iso).find(d => d <= today && d >= '2000-01-01') : undefined
  if (labelled) { out.date = labelled; out.confidence.date = 'high' }
  else if (base.date) { out.date = base.date; out.confidence.date = 'medium' }
  if (out.date && out.date < addYears(today, -2)) out.warnings.push('The receipt date is more than two years ago. Check the date.')

  // amounts: labelled figures first
  const subtotal = lastOf(t, String.raw`(?:sub\s*-?\s*total|taxable\s*(?:amount|value)|amount\s*(?:before|excl(?:uding)?\.?|exclusive\s*of)\s*vat|total\s*(?:excl(?:uding)?\.?|before)\s*vat|net\s*total)`)
  const vatLine = t.match(new RegExp(String.raw`(?:vat|tax)\s*(?:@\s*)?\(?\s*(\d{1,2}(?:\.\d+)?)\s*%\s*\)?\s*[:\-]?\s*` + AMT, 'i'))
  let vat = vatLine ? money(vatLine[2]) : lastOf(t, String.raw`(?:vat|tax)\s*(?:amount|total)?`)
  const rate = vatLine ? Number(vatLine[1]) : undefined
  const total = lastOf(t, String.raw`(?:grand\s*total|total\s*(?:amount|due|payable)?\s*(?:incl(?:uding|\.)?\s*vat)?|amount\s*(?:due|payable)|net\s*amount|balance\s*due|total\s*incl(?:uding|\.)?\s*vat)`)
    ?? base.amount
  if (vat !== undefined && total !== undefined && vat >= total) vat = undefined
  let sub = subtotal
  if (total !== undefined) { out.total = r2(total); out.confidence.total = /total|amount\s*due/i.test(t) ? 'high' : 'low' }
  if (vat !== undefined) { out.vat = r2(vat); out.confidence.vat = 'high' }
  if (sub !== undefined) { out.subtotal = r2(sub); out.confidence.subtotal = 'high' }
  // derive the missing one of the three from the other two
  if (out.subtotal === undefined && out.total !== undefined && out.vat !== undefined) { out.subtotal = r2(out.total - out.vat); out.confidence.subtotal = 'medium' }
  if (out.vat === undefined && out.total !== undefined && out.subtotal !== undefined && out.total >= out.subtotal) { out.vat = r2(out.total - out.subtotal); out.confidence.vat = 'medium' }
  if (out.total === undefined && out.subtotal !== undefined && out.vat !== undefined) { out.total = r2(out.subtotal + out.vat); out.confidence.total = 'medium' }
  if (out.vat === undefined && out.total !== undefined && out.subtotal === undefined && /\bvat\b|tax\s*invoice/i.test(t)) {
    out.vat = r2(out.total - out.total / 1.05); out.subtotal = r2(out.total - out.vat); out.confidence.vat = 'low'; out.confidence.subtotal = 'low'
    out.warnings.push('No VAT line was found: VAT was worked out as 5% included in the total. Check it against the receipt.')
  }
  sub = out.subtotal
  if (sub !== undefined && out.vat !== undefined) {
    out.vat_rate = rate ?? (sub > 0 ? Math.round((out.vat / sub) * 1000) / 10 : undefined)
    if (out.total !== undefined && Math.abs(sub + out.vat - out.total) > 0.05) out.warnings.push(`Subtotal ${sub.toFixed(2)} + VAT ${out.vat.toFixed(2)} does not equal the total ${out.total.toFixed(2)}. Check the amounts.`)
    if (sub > 0 && out.vat > 0 && Math.abs(out.vat - sub * 0.05) > Math.max(0.05, sub * 0.002)) out.warnings.push(`VAT is ${(out.vat / sub * 100).toFixed(2)}% of the subtotal, not the UAE standard 5%. Check the VAT.`)
  }

  // line items: a description followed by numbers, the last being the line amount
  for (const l of lines) {
    if (SKIP_LINE.test(l) || l.length > 140) continue
    // "Grinder disc 20 x 4.50 = 90.00" / "Item 3 @ 12.00 36.00" / "Item 40 pcs 80.00 3,200.00" / "Item 3,200.00"
    const m = l.match(/^(?:\d{1,3}[.)]\s+)?(.*?[A-Za-z؀-ۿ].*?)\s+(\d+(?:\.\d+)?)\s*[x×@]\s*([0-9][0-9,]*(?:\.\d{1,2})?)\s*=?\s*([0-9][0-9,]*\.\d{2})$/i)
      ?? l.match(/^(?:\d{1,3}[.)]\s+)?(.*?[A-Za-z؀-ۿ].*?)\s+(?:(\d+(?:\.\d+)?)\s*(?:pcs|nos|no|kg|mtr|m|ltr|l|box|set|sheet|bag|roll|ea)?\s+)?(?:@?\s*([0-9][0-9,]*\.\d{2})\s+)?([0-9][0-9,]*\.\d{2})$/i)
    if (!m) continue
    const amount = money(m[4]), qty = m[2] ? Number(m[2]) : null, unit = m[3] ? money(m[3]) : null
    if (!(amount > 0) || m[1].trim().length < 3) continue
    out.lines.push({ description: m[1].trim().replace(/[\s=:-]+$/, '').replace(/\s{2,}/g, ' ').slice(0, 300), quantity: qty, unit_price: unit ?? (qty ? r2(amount / qty) : null), amount: r2(amount) })
  }
  if (out.lines.length) {
    const sum = r2(out.lines.reduce((s, x) => s + x.amount, 0))
    out.confidence.lines = sub !== undefined && Math.abs(sum - sub) <= 0.05 ? 'high' : 'low'
    if (sub !== undefined && Math.abs(sum - sub) > 0.05 && out.lines.length > 1) out.warnings.push(`The line items add up to ${sum.toFixed(2)}, the subtotal is ${sub.toFixed(2)}. Some lines may be missing or misread.`)
  }
  if (out.trn && out.trn.length !== 15) out.warnings.push('The supplier TRN should have 15 digits. Check it.')
  return out
}

function addYears(iso: string, n: number) { const [y, m, d] = iso.split('-'); return `${Number(y) + n}-${m}-${d}` }

/** True when a value suggested by an AI model actually appears on the receipt text (numbers compared digit by digit). */
export function seenInText(text: string, v: string | number | undefined | null): boolean {
  if (v === undefined || v === null || v === '') return false
  if (typeof v === 'number') {
    const digits = text.replace(/,/g, '')
    return [v.toFixed(2), String(v), v.toFixed(2).replace(/\.00$/, '')].some(s => new RegExp(String.raw`(^|[^0-9.])` + s.replace('.', String.raw`\.`) + String.raw`(?![0-9])`).test(digits))
  }
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9؀-ۿ]/g, '')
  const n = norm(v); return n.length >= 3 && norm(text).includes(n)
}

/**
 * Combines the local reading with an AI model's reading. The AI fills gaps and adds line items, but a value it gives
 * is only used when it can be found on the receipt; the three amounts are taken as a set that adds up.
 */
export function mergeAi(rules: ReceiptRead, ai: Partial<ReceiptRead> | null, text: string): ReceiptRead {
  if (!ai) return rules
  const out: ReceiptRead = { ...rules, confidence: { ...rules.confidence }, warnings: [...rules.warnings], lines: rules.lines }
  for (const k of ['supplier', 'trn', 'invoice_no'] as const) {
    const v = ai[k]; if (typeof v !== 'string' || !v.trim()) continue
    if (!out[k] && seenInText(text, v)) { out[k] = v.trim(); out.confidence[k] = 'medium' }
    else if (out[k] && out.confidence[k] === 'low' && seenInText(text, v)) { out[k] = v.trim(); out.confidence[k] = 'medium' }
  }
  if (!out.date && typeof ai.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ai.date)) { out.date = ai.date; out.confidence.date = 'low' }
  const adds = (s?: number, v?: number, t?: number) => s !== undefined && v !== undefined && t !== undefined && Math.abs(s + v - t) <= 0.05
  const mine = adds(rules.subtotal, rules.vat, rules.total)
  const theirs = [ai.subtotal, ai.vat, ai.total].every(n => typeof n === 'number' && seenInText(text, n)) && adds(ai.subtotal, ai.vat, ai.total)
  if (!mine && theirs) {
    out.subtotal = r2(ai.subtotal!); out.vat = r2(ai.vat!); out.total = r2(ai.total!)
    out.confidence.subtotal = out.confidence.vat = out.confidence.total = 'medium'
    out.vat_rate = out.subtotal > 0 ? Math.round((out.vat / out.subtotal) * 1000) / 10 : out.vat_rate
    out.warnings = out.warnings.filter(w => !/does not equal|worked out as 5%/.test(w))
  }
  const aiLines = (ai.lines ?? []).filter(l => l && typeof l.description === 'string' && typeof l.amount === 'number' && l.amount > 0 && seenInText(text, l.amount))
  if (aiLines.length && (!rules.lines.length || rules.confidence.lines === 'low')) {
    out.lines = aiLines.slice(0, 100).map(l => ({ description: l.description.slice(0, 300), quantity: typeof l.quantity === 'number' && l.quantity > 0 ? l.quantity : null, unit_price: typeof l.unit_price === 'number' ? r2(l.unit_price) : null, amount: r2(l.amount) }))
    const sum = r2(out.lines.reduce((s, x) => s + x.amount, 0))
    out.confidence.lines = out.subtotal !== undefined && Math.abs(sum - out.subtotal) <= 0.05 ? 'high' : 'medium'
    out.warnings = out.warnings.filter(w => !/line items add up/.test(w))
  }
  return out
}

/** JSON schema (Gemini responseSchema subset) for the AI reading of a receipt. */
export const RECEIPT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    supplier: { type: 'STRING', nullable: true }, trn: { type: 'STRING', nullable: true }, invoice_no: { type: 'STRING', nullable: true },
    date: { type: 'STRING', nullable: true, description: 'YYYY-MM-DD' },
    subtotal: { type: 'NUMBER', nullable: true }, vat: { type: 'NUMBER', nullable: true }, total: { type: 'NUMBER', nullable: true },
    lines: { type: 'ARRAY', items: { type: 'OBJECT', properties: { description: { type: 'STRING' }, quantity: { type: 'NUMBER', nullable: true }, unit_price: { type: 'NUMBER', nullable: true }, amount: { type: 'NUMBER' } }, required: ['description', 'amount'] } },
  },
  required: ['lines'],
}
export const RECEIPT_PROMPT = `You read UAE supplier receipts and tax invoices from OCR text and return strict JSON.
Return the supplier (seller) name, the supplier TRN (15 digits), the invoice or receipt number, the invoice date as YYYY-MM-DD,
the subtotal before VAT, the VAT amount, the total including VAT, and the line items (description, quantity, unit price, line amount before VAT).
Copy numbers exactly as printed. Use null when a value is not on the receipt. Never guess.`
