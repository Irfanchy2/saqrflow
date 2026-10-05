// Money maths for sales documents. Amounts are AED with 2 decimals; rounding is done per line then summed
// (the way the original Al Saqr template and most UAE invoices present VAT).
export const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

export interface LineInput { quantity: number | string; unit_price: number | string }
export const lineAmount = (l: LineInput) => r2(Number(l.quantity || 0) * Number(l.unit_price || 0))
export const lineVat = (l: LineInput, rate: number) => r2(lineAmount(l) * rate / 100)

export interface Totals { subtotal: number; discount: number; taxable: number; vat: number; total: number }
export function computeTotals(lines: LineInput[], vatRate: number, discount = 0, applyVat = true): Totals {
  const subtotal = r2(lines.reduce((s, l) => s + lineAmount(l), 0))
  const d = r2(Math.min(Math.max(0, Number(discount) || 0), subtotal))
  const taxable = r2(subtotal - d)
  const vat = applyVat ? r2(taxable * vatRate / 100) : 0
  return { subtotal, discount: d, taxable, vat, total: r2(taxable + vat) }
}

export const fmtMoney = (n: number | string | null | undefined) =>
  new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n ?? 0))

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']
function below1000(n: number): string {
  const h = Math.floor(n / 100), rest = n % 100
  const parts: string[] = []
  if (h) parts.push(`${ONES[h]} Hundred`)
  if (rest) parts.push(rest < 20 ? ONES[rest] : `${TENS[Math.floor(rest / 10)]}${rest % 10 ? '-' + ONES[rest % 10] : ''}`)
  return parts.join(' ')
}
export function numberToWords(n: number): string {
  n = Math.floor(Math.abs(n))
  if (n === 0) return 'Zero'
  const scales: [number, string][] = [[1e9, 'Billion'], [1e6, 'Million'], [1e3, 'Thousand']]
  const out: string[] = []
  for (const [v, w] of scales) if (n >= v) { out.push(`${below1000(Math.floor(n / v))} ${w}`); n %= v }
  if (n) out.push(below1000(n))
  return out.join(' ')
}
/** "UAE Dirhams Twenty-Six Thousand Two Hundred Fifty and Fils Fifty Only" */
export function amountInWords(amount: number | string): string {
  const a = r2(Number(amount || 0))
  const dirhams = Math.floor(a), fils = Math.round((a - dirhams) * 100)
  return `UAE Dirhams ${numberToWords(dirhams)}${fils ? ` and Fils ${numberToWords(fils)}` : ''} Only`
}
