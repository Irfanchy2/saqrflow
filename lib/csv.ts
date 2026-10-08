/** RFC-4180 CSV with spreadsheet-formula-injection protection (cells starting = + - @ TAB CR get a leading apostrophe). */
export function csvCell(v: unknown): string {
  let s = v == null ? '' : String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
export const toCsv = (headers: string[], rows: unknown[][]) => '﻿' + [headers, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n')

/** RFC-4180 parser (quotes, escaped quotes, CRLF/LF, BOM). Returns rows of trimmed cells; blank rows dropped. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = '', q = false
  const s = text.replace(/^﻿/, '')
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (q) { if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++ } else q = false } else cell += ch; continue }
    if (ch === '"') q = true
    else if (ch === ',' || ch === ';' && !s.slice(0, 200).includes(',')) { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && s[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = '' }
    else cell += ch
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows.map(r => r.map(c => c.trim().replace(/^'(?=[=+\-@])/, ''))).filter(r => r.some(Boolean))
}
