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

/**
 * Repairs the usual OCR slips on receipt text before it is read: letters inside numbers (O→0, l/I/|→1, S→5, B→8),
 * "3.200.00" thousands dots, "160,00" decimal commas, broken labels (T0TAL, Sub-Tota1, V.A.T), Arabic labels
 * (الإجمالي, ضريبة القيمة المضافة, رقم الفاتورة…) and Arabic-Indic digits. Only obvious slips are changed.
 */
export function cleanOcrText(text: string): string {
  let t = text.replace(/\r/g, '').replace(/[\u0660-\u0669]/g, d => String(d.charCodeAt(0) - 0x0660)).replace(/[\u06F0-\u06F9]/g, d => String(d.charCodeAt(0) - 0x06F0))
  t = t.replace(/[‘’`´]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-')
  // letters read inside a number
  for (let i = 0; i < 2; i++) t = t.replace(/(\d)[oO](?=[\d.,])/g, '$10').replace(/(\d[.,])[oO](?=\d|\b)/g, '$10')
    .replace(/(\d)[lI|!](?=[\d.,])/g, '$11').replace(/([.,]\d)[lI|](?=\b)/g, '$11').replace(/(\d)S(?=\d)/g, '$15').replace(/(\d)B(?=\d)/g, '$18')
  t = t.replace(/\b(\d{1,3})\.(\d{3})\.(\d{2})\b/g, '$1,$2.$3')                 // 3.200.00 → 3,200.00
    .replace(/\b(\d{1,3}(?:\.\d{3})+),(\d{2})\b/g, (_, a: string, b: string) => `${a.replace(/\./g, ',')}.${b}`)   // 3.200,00 → 3,200.00
    .replace(/(^|[^\d,.])(\d{1,7}),(\d{2})(?![\d,])/gm, '$1$2.$3')             // 160,00 → 160.00
    .replace(/(\d)\s+\.\s*(\d{2})\b/g, '$1.$2')                                // 160 .00 → 160.00
  // labels
  t = t.replace(/\bT[0O]TA[L1I]\b/gi, 'TOTAL').replace(/\bTOTA[1I]\b/gi, 'TOTAL').replace(/\bSUB[\s-]*T[0O]TA[L1I]\b/gi, 'SUBTOTAL')
    .replace(/\bV\s*\.\s*A\s*\.\s*T\.?/gi, 'VAT').replace(/\bVAT\s*\(\s*5\s*%?\s*\)/gi, 'VAT 5%').replace(/\b(AE0|AEO|A\.E\.D\.?)\b/g, 'AED')
    .replace(/\bVAT\s*5\s*[5sS%]\s*(?=\d[\d,]*\.\d{2}\b)/g, 'VAT 5% ')                              // "VAT 55 160.00": the % read as 5
    .replace(/\b([A-Z]{3,})(LLC|L\.L\.C\.?)(?=\s|$)/gm, '$1 $2')                                     // "MATERIALSLLC" → "MATERIALS LLC"
    .replace(/\bT\s*R\s*N\b/g, 'TRN').replace(/\bInv\s*#/gi, 'Invoice No:').replace(/\bBill\s*#/gi, 'Bill No:').replace(/\bReceipt\s*#/gi, 'Receipt No:')
  // Arabic labels → the English words the reader looks for (kept next to the Arabic)
  const AR: [RegExp, string][] = [
    [/(المجموع الفرعي|الإجمالي قبل الضريبة|المبلغ قبل الضريبة)/g, '$1 Subtotal'],
    [/(الإجمالي شامل الضريبة|المبلغ الإجمالي|المجموع الكلي|الإجمالي|الاجمالي|المجموع)(?! Subtotal)(?! (?:الفرعي|قبل))/g, '$1 Total'],
    [/(ضريبة القيمة المضافة|القيمة المضافة|الضريبة)/g, '$1 VAT'],
    [/(رقم الفاتورة|فاتورة رقم)/g, '$1 Invoice No:'], [/(التاريخ|تاريخ الفاتورة)/g, '$1 Date:'], [/(الرقم الضريبي|رقم التسجيل الضريبي)/g, '$1 TRN:'],
    [/(فاتورة ضريبية)/g, '$1 TAX INVOICE'],
  ]
  for (const [re, rep] of AR) t = t.replace(re, rep)
  return t
}

/** Reads OCR text. `today` (company date) bounds the date: receipts are never in the future. */
export function readReceipt(rawText: string, today: string): ReceiptRead {
  const text = cleanOcrText(rawText)
  const t = text.replace(/\r/g, '').replace(/[ \t]+/g, ' ')
  const lines = t.split('\n').map(l => l.trim()).filter(Boolean)
  const base = parseReceipt(text, today)
  const out: ReceiptRead = { lines: [], confidence: {}, warnings: [] }

  // supplier: a company-looking line near the top, else the first plain line the simple reader picked
  const top = lines.slice(0, 8).find(l => COMPANY.test(l) && l.length <= 90 && !/\d[\d,]*\.\d{2}\b/.test(l) && !/^(tax\s*invoice|invoice|receipt|bill\s*to|customer|sold\s*to)/i.test(l))
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
 * Adds the AI reading to the rules reading. The AI only fills gaps or replaces values the rules were unsure of, and never
 * produces a 'high' value. With `image` the AI looked at the photo itself, so a value it read may be missing from the OCR
 * text: it is still accepted when it checks out (amounts that add up, a valid TRN, a real date not in the future), but marked
 * for review. Nothing here is saved: the person checks every field.
 */
export function mergeAi(rules: ReceiptRead, ai: Partial<ReceiptRead> | null, text: string, opts: { image?: boolean; today?: string } = {}): ReceiptRead {
  if (!ai) return rules
  const out: ReceiptRead = { ...rules, confidence: { ...rules.confidence }, warnings: [...rules.warnings], lines: rules.lines }
  const img = !!opts.image
  for (const k of ['supplier', 'trn', 'invoice_no'] as const) {
    let v = ai[k]; if (typeof v !== 'string' || !v.trim()) continue
    v = v.trim()
    if (k === 'trn') { v = v.replace(/[\s-]/g, ''); if (!/^100\d{12}$/.test(v)) continue }
    const seen = seenInText(text, v)
    if (!seen && !img) continue
    const conf: Conf = seen || k === 'trn' ? 'medium' : 'low'
    if (!out[k] || (out.confidence[k] === 'low' && out[k] !== v)) { out[k] = k === 'supplier' ? v.slice(0, 200) : v.slice(0, 60); out.confidence[k] = conf }
  }
  if (typeof ai.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ai.date) && !Number.isNaN(Date.parse(ai.date)) && (!opts.today || ai.date <= opts.today) && ai.date >= '2000-01-01') {
    if (!out.date) { out.date = ai.date; out.confidence.date = img ? 'medium' : 'low' }
    else if (out.confidence.date === 'low' && img && out.date !== ai.date) { out.date = ai.date; out.confidence.date = 'medium' }
  }
  const adds = (s?: number, v?: number, t?: number) => s !== undefined && v !== undefined && t !== undefined && Math.abs(s + v - t) <= 0.05
  const num = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n < 1e9
  const mine = adds(rules.subtotal, rules.vat, rules.total)
  const theirs = num(ai.subtotal) && num(ai.vat) && num(ai.total) && adds(ai.subtotal, ai.vat, ai.total) && (img || [ai.subtotal, ai.vat, ai.total].every(n => seenInText(text, n)))
  if (!mine && theirs) {
    out.subtotal = r2(ai.subtotal!); out.vat = r2(ai.vat!); out.total = r2(ai.total!)
    out.confidence.subtotal = out.confidence.vat = out.confidence.total = 'medium'
    out.vat_rate = out.subtotal > 0 ? Math.round((out.vat / out.subtotal) * 1000) / 10 : out.vat_rate
    out.warnings = out.warnings.filter(w => !/does not equal|worked out as 5%|No total/i.test(w))
  } else if (out.total === undefined && num(ai.total) && ai.total > 0 && (img || seenInText(text, ai.total)) && (ai.vat === null || ai.vat === undefined || ai.vat === 0)) {
    out.total = r2(ai.total); out.confidence.total = 'medium'                          // a plain receipt without VAT
    out.warnings = out.warnings.filter(w => !/No total/i.test(w))
  }
  const aiLines = (ai.lines ?? []).filter(l => l && typeof l.description === 'string' && l.description.trim() && num(l.amount) && l.amount > 0 && (img || seenInText(text, l.amount)))
  const aiSum = r2(aiLines.reduce((s, x) => s + x.amount, 0))
  const fits = out.subtotal !== undefined && Math.abs(aiSum - out.subtotal) <= 0.05
  if (aiLines.length && (!rules.lines.length || rules.confidence.lines === 'low') && (!img || fits || out.subtotal === undefined)) {
    out.lines = aiLines.slice(0, 100).map(l => ({ description: l.description.trim().slice(0, 300), quantity: num(l.quantity) && l.quantity > 0 ? l.quantity : null, unit_price: num(l.unit_price) ? r2(l.unit_price) : null, amount: r2(l.amount) }))
    out.confidence.lines = fits ? 'high' : 'medium'
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
export const RECEIPT_PROMPT = `You read UAE supplier receipts and tax invoices and return strict JSON. You get the OCR text, and sometimes the photo
itself: when the photo is given, read the values from the photo and use the OCR text only as a hint (it can contain misread characters).
Return:
- supplier: the SELLER's business name as printed at the top or on the stamp (not the customer / "bill to", not the cashier)
- trn: the SELLER's VAT TRN, 15 digits starting with 100, digits only (not the customer's TRN)
- invoice_no: the invoice / bill / receipt number exactly as printed (keep letters, dashes and slashes)
- date: the invoice date as YYYY-MM-DD; UAE dates are day first (03/04/2026 is 2026-04-03)
- subtotal: amount before VAT; vat: the VAT amount (5% standard rate in the UAE); total: the amount including VAT (grand total / net payable)
- lines: each item with description, quantity, unit price and line amount before VAT
Amounts are plain numbers without currency or thousands separators (1,250.50 → 1250.5). Ignore cash tendered, change and card slips.
Use null when a value is not on the receipt or cannot be read clearly. Never guess or calculate a value that is not printed.`
