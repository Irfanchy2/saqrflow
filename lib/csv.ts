/** RFC-4180 CSV with spreadsheet-formula-injection protection (cells starting = + - @ TAB CR get a leading apostrophe). */
export function csvCell(v: unknown): string {
  let s = v == null ? '' : String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
export const toCsv = (headers: string[], rows: unknown[][]) => '﻿' + [headers, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n')
