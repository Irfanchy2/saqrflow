import 'server-only'
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import type { Table } from './sections'
import { fmtCell } from '@/lib/reports/format'

/**
 * Report PDF (A4 portrait, or landscape for wide tables): business name + report title + date range + generated time on
 * every page header, the software named once in the footer, tables with repeated column headers and a totals row.
 */
export async function renderReportPdf(o: { company: string; title: string; period: string; generated: string; tables: Table[] }) {
  const pdf = await PDFDocument.create()
  pdf.setTitle(`${o.title} report, ${o.period}`); pdf.setCreator('Averiqo'); pdf.setProducer('Averiqo')
  const font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const wide = o.tables.some(t => t.columns.length > 7)
  const [W, H] = wide ? [841.89, 595.28] : [595.28, 841.89], M = 36
  const ink = rgb(0.07, 0.08, 0.1), muted = rgb(0.4, 0.42, 0.46), rule = rgb(0.85, 0.86, 0.88), band = rgb(0.955, 0.96, 0.965)
  // Helvetica (WinAnsi) cannot draw Arabic: unsupported characters become "?" rather than breaking the export
  const safe = (f: PDFFont, s: string) => [...(s ?? '')].map(ch => { try { f.encodeText(ch); return ch } catch { return '?' } }).join('')
  const fit = (f: PDFFont, s: string, size: number, w: number) => { let t = safe(f, s); if (f.widthOfTextAtSize(t, size) <= w) return t; while (t.length > 1 && f.widthOfTextAtSize(t + '…', size) > w) t = t.slice(0, -1); return t + '…' }
  let page: PDFPage, y = 0, n = 0
  const newPage = () => {
    page = pdf.addPage([W, H]); n++; y = H - M
    page.drawText(fit(bold, o.company, 12, W - 2 * M), { x: M, y: y - 12, size: 12, font: bold, color: ink })
    page.drawText(fit(font, `${o.title} report · ${o.period}`, 9.5, W - 2 * M), { x: M, y: y - 26, size: 9.5, font, color: ink })
    page.drawText(fit(font, `Generated ${o.generated}`, 8, W - 2 * M), { x: M, y: y - 38, size: 8, font, color: muted })
    page.drawLine({ start: { x: M, y: y - 46 }, end: { x: W - M, y: y - 46 }, thickness: 0.6, color: rule })
    y -= 62
  }
  newPage()
  for (const t of o.tables) {
    const cols = t.columns, weights = cols.map((c, i) => (i === 0 ? 2.6 : c.money ? 1.4 : c.num || c.pct ? 1 : 1.6))
    const total = weights.reduce((a, b) => a + b, 0), widths = weights.map(w => (w / total) * (W - 2 * M))
    const rowH = 15, size = 8.5
    const row = (cells: string[], f: PDFFont, fill?: ReturnType<typeof rgb>) => {
      if (y - rowH < M + 24) { newPage(); header() }
      if (fill) page.drawRectangle({ x: M, y: y - rowH + 3, width: W - 2 * M, height: rowH, color: fill })
      let x = M
      cells.forEach((v, j) => { const w = widths[j], txt = fit(f, v, size, w - 8), right = cols[j].money || cols[j].num || cols[j].pct
        page.drawText(txt, { x: right ? x + w - 4 - f.widthOfTextAtSize(txt, size) : x + 4, y: y - 8, size, font: f, color: ink }); x += w })
      page.drawLine({ start: { x: M, y: y - rowH + 3 }, end: { x: W - M, y: y - rowH + 3 }, thickness: 0.4, color: rule })
      y -= rowH
    }
    const header = () => row(cols.map(c => c.label), bold, band)
    if (y - 60 < M) newPage()
    page!.drawText(fit(bold, t.title, 10.5, W - 2 * M), { x: M, y: y - 10, size: 10.5, font: bold, color: ink }); y -= 20
    if (cols.some(c => c.money)) { page!.drawText('Amounts in AED', { x: M, y: y - 6, size: 7.5, font, color: muted }); y -= 12 }
    header()
    if (!t.rows.length) row(['Nothing in this period', ...cols.slice(1).map(() => '')], font)
    for (const r of t.rows) row(r.map((v, j) => fmtCell(v, cols[j])), font)
    if (t.totals) row(t.totals.map((v, j) => fmtCell(v, cols[j])), bold, band)
    if (t.note) { const lines = [t.note]; for (const l of lines) { if (y - 12 < M + 24) newPage(); page!.drawText(fit(font, l, 7.5, W - 2 * M), { x: M, y: y - 9, size: 7.5, font, color: muted }); y -= 12 } }
    y -= 14
  }
  const pages = pdf.getPages()
  pages.forEach((p, i) => p.drawText(`Averiqo Reports · Page ${i + 1} of ${pages.length}`, { x: M, y: 20, size: 7.5, font, color: muted }))
  return pdf.save()
}
