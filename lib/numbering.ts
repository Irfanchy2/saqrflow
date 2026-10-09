// Document number formats (pure, unit-tested). The database (next_document_number) is the only place numbers are issued.
export interface NumberFormat { prefix: string; number_separator?: string | null; fixed_digits: string; seq_pad: number; year_separator: string; include_year?: boolean | null; year_format?: 'yyyy' | 'yy' | string | null }
export const NUMBER_FORMAT_COLS = 'prefix,number_separator,fixed_digits,seq_pad,year_separator,include_year,year_format'
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** Same output as the database's format_document_number_v2, e.g. AS + "-" + 002600 + "/" + 2026 → AS-002600/2026. Used for previews only. */
export function formatNumber(fmt: NumberFormat, seq: number, year: number) {
  const y = fmt.include_year === false ? '' : fmt.year_separator + (fmt.year_format === 'yy' ? String(year % 100).padStart(2, '0') : String(year))
  return `${fmt.prefix}${fmt.number_separator ?? ''}${fmt.fixed_digits}${String(seq).padStart(fmt.seq_pad, '0')}${y}`
}
/** True when `number` was produced by `fmt` (any sequence, any year), e.g. AS0025180/2026 for AS + 00 + seq + "/" + year. */
export function matchesFormat(number: string, fmt: NumberFormat) {
  const year = fmt.include_year === false ? '' : `${esc(fmt.year_separator)}\\d{${fmt.year_format === 'yy' ? 2 : 4}}`
  return new RegExp(`^${esc(fmt.prefix)}${esc(fmt.number_separator ?? '')}${esc(fmt.fixed_digits)}\\d{${Math.max(1, fmt.seq_pad)},}${year}$`).test(number)
}
