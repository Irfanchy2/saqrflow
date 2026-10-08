// Document number formats (pure, unit-tested). The database (next_document_number) is the only place numbers are issued.
export interface NumberFormat { prefix: string; fixed_digits: string; seq_pad: number; year_separator: string; include_year?: boolean | null }
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** True when `number` was produced by `fmt` (any sequence, any year), e.g. AS0025180/2026 for AS + 00 + seq + "/" + year. */
export function matchesFormat(number: string, fmt: NumberFormat) {
  const year = fmt.include_year === false ? '' : `${esc(fmt.year_separator)}\\d{4}`
  return new RegExp(`^${esc(fmt.prefix)}${esc(fmt.fixed_digits)}\\d{${Math.max(1, fmt.seq_pad)},}${year}$`).test(number)
}
