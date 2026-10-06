// Pulls the usual fields off a supplier receipt / tax invoice text. Only suggestions — the user confirms before saving.
import { allDates } from '../inbox/rules'

export interface ReceiptGuess { supplier?: string; date?: string; amount?: number; vat?: number; reference?: string; trn?: string }
const num = (s: string) => Number(s.replace(/[,\s]/g, '').replace(/^(AED|DHS?)/i, ''))
const AMT = String.raw`(?:AED|Dhs?\.?|د\.إ)?\s*([0-9]{1,3}(?:[,\s][0-9]{3})*(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)`

export function parseReceipt(text: string, today: string): ReceiptGuess {
  const t = text.replace(/\r/g, ''), lines = t.split('\n').map(l => l.trim()).filter(Boolean)
  const g: ReceiptGuess = {}
  // total: the last "total / grand total / amount due / net amount" figure; fallback = largest amount on the page
  const totals = [...t.matchAll(new RegExp(String.raw`(?:grand\s*total|total\s*(?:amount|due|incl\.?\s*vat|payable)?|amount\s*(?:due|payable)|net\s*amount|balance\s*due)\s*[:\-]?\s*` + AMT, 'gi'))].map(m => num(m[1])).filter(n => n > 0 && n < 1e8)
  if (totals.length) g.amount = Math.max(...totals.slice(-3))
  else { const all = [...t.matchAll(/(?:AED|Dhs?)\s*([0-9][0-9,]*\.[0-9]{2})|([0-9][0-9,]*\.[0-9]{2})\s*(?:AED|Dhs?)/gi)].map(m => num(m[1] ?? m[2])).filter(n => n > 0 && n < 1e8); if (all.length) g.amount = Math.max(...all) }
  const vat = [...t.matchAll(new RegExp(String.raw`(?:vat|tax)\s*(?:@?\s*5\s*%|amount|\(5%\))?\s*[:\-]?\s*` + AMT, 'gi'))].map(m => num(m[1])).filter(n => n > 0 && (!g.amount || n < g.amount))
  if (vat.length) g.vat = vat[vat.length - 1]
  else if (g.amount && /vat|tax invoice/i.test(t)) g.vat = Math.round((g.amount - g.amount / 1.05) * 100) / 100   // VAT-inclusive 5 % receipt
  const dates = allDates(t).map(d => d.iso).filter(d => d <= today && d >= '2000-01-01')
  if (dates.length) g.date = dates[0]
  const ref = t.match(/(?:invoice|inv|receipt|bill|voucher)\s*(?:no\.?|number|#)\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-\/]{1,30})/i)
  if (ref) g.reference = ref[1]
  const trn = t.match(/\b(?:TRN|VAT\s*(?:reg(?:istration)?\.?)?\s*no\.?)\s*[:\-]?\s*(1\d{14})\b/i)
  if (trn) g.trn = trn[1]
  // supplier: first line with letters that is not a document-type heading
  const sup = lines.find(l => /[A-Za-z؀-ۿ]{3}/.test(l) && !/^(tax\s*invoice|invoice|receipt|cash\s*memo|bill|date|trn|tel|phone|p\.?o\.?\s*box|www\.|email)/i.test(l) && l.length <= 80)
  if (sup) g.supplier = sup.replace(/\s{2,}/g, ' ')
  return g
}
