// Money maths for sales documents. All arithmetic is done in integer fils (1/100 AED) with BigInt, so totals never drift
// (no 1249.999999). The same functions run in the editor, on the server (stored totals), in the paper and in the PDF,
// so every screen shows the same numbers. Lines are rounded to fils first, then summed (UAE invoice convention).
export type VatCategory = 'standard' | 'zero' | 'exempt' | 'out_of_scope'
export const VAT_CATEGORIES: Record<VatCategory, string> = { standard: 'Standard rate', zero: 'Zero-rated (0%)', exempt: 'Exempt', out_of_scope: 'Out of scope / no VAT' }
export type DiscountType = 'amount' | 'percent'

const big = (n: number | string | null | undefined, scale: number) => BigInt(Math.round((Number(n) || 0) * scale))
/** a·b / c rounded half-up, for non-negative integers */
const mulDiv = (a: bigint, b: bigint, c: bigint) => (a * b * 2n + c) / (2n * c)
const aed = (fils: bigint) => Number(fils) / 100

/** Rounds an AED amount to 2 decimals (half-up, float-safe). */
export const r2 = (n: number) => Math.sign(n) * aed(BigInt(Math.round(Math.abs(n) * 100 + 1e-7)))

export interface LineInput { quantity: number | string; unit_price: number | string; discount_pct?: number | string | null; vat_category?: string | null }
const lineFils = (l: LineInput) => {
  const gross = mulDiv(big(l.quantity, 1000), big(l.unit_price, 100), 1000n)          // qty (3 dp) × rate (fils)
  const disc = mulDiv(gross, big(Math.min(100, Math.max(0, Number(l.discount_pct) || 0)), 100), 10000n)
  return gross - disc
}
const catOf = (l: LineInput): VatCategory => (l.vat_category && l.vat_category in VAT_CATEGORIES ? l.vat_category as VatCategory : 'standard')
/** Line amount after any line discount, before VAT. */
export const lineAmount = (l: LineInput) => aed(lineFils(l))
/** VAT on one line (0 for zero-rated / exempt / out-of-scope lines). */
export const lineVat = (l: LineInput, rate: number) => (catOf(l) === 'standard' ? aed(mulDiv(lineFils(l), big(rate, 100), 10000n)) : 0)

export interface Totals { subtotal: number; discount: number; taxable: number; vat: number; total: number; standardBase: number; zeroBase: number; exemptBase: number }
/**
 * @param discount  AED amount, or { type: 'percent', value: 10 } for 10 %
 * @param applyVat  false for quotations that only *note* VAT (the original Al Saqr template)
 * The document discount is spread across lines in proportion to their value, so VAT is charged on the discounted standard-rated amount.
 */
export function computeTotals(lines: LineInput[], vatRate: number, discount: number | { type: DiscountType; value: number | string } = 0, applyVat = true): Totals {
  const nets = lines.map(l => ({ fils: lineFils(l), cat: catOf(l) }))
  const subtotal = nets.reduce((s, x) => s + x.fils, 0n)
  const d = typeof discount === 'object' && discount
    ? (discount.type === 'percent' ? mulDiv(subtotal, big(Math.min(100, Math.max(0, Number(discount.value) || 0)), 100), 10000n) : big(Math.max(0, Number(discount.value) || 0), 100))
    : big(Math.max(0, Number(discount) || 0), 100)
  const disc = d > subtotal ? subtotal : d
  const base = (cat: VatCategory) => { const b = nets.filter(x => x.cat === cat).reduce((s, x) => s + x.fils, 0n); return subtotal ? b - mulDiv(disc, b, subtotal) : 0n }
  const std = base('standard')
  const vat = applyVat ? mulDiv(std, big(vatRate, 100), 10000n) : 0n
  const taxable = subtotal - disc
  return { subtotal: aed(subtotal), discount: aed(disc), taxable: aed(taxable), vat: aed(vat), total: aed(taxable + vat), standardBase: aed(std), zeroBase: aed(base('zero')), exemptBase: aed(base('exempt') + base('out_of_scope')) }
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
