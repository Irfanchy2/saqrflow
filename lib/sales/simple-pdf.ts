import 'server-only'
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage } from 'pdf-lib'
import type { BrandKind } from './data'

// One-page A4 documents with the company letterhead: payment receipt and salary payslip (same look as statements).
export interface SimplePdf {
  title: string; companyName: string; images: Partial<Record<BrandKind, { bytes: Uint8Array; png: boolean }>>; showHeaderFooter: boolean
  companyTrn?: string | null; companyAddress?: string | null; companyPhone?: string | null; companyEmail?: string | null
  left: [string, string][]; right: [string, string][]
  table?: { cols: { h: string; w: number; right?: boolean }[]; rows: string[][]; total?: [string, string] }
  words?: string; note?: string; signLine?: string
}

export async function renderSimplePdf(o: SimplePdf): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(o.title); pdf.setCreator('Averiqo'); pdf.setProducer('Averiqo')
  const font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const img: Partial<Record<BrandKind, PDFImage>> = {}
  for (const [k, v] of Object.entries(o.images)) { try { img[k as BrandKind] = v!.png ? await pdf.embedPng(v!.bytes) : await pdf.embedJpg(v!.bytes) } catch { /* skip */ } }
  const W = 595.28, H = 841.89, M = 28, CW = W - 2 * M, black = rgb(0, 0, 0), boxBg = rgb(0.953, 0.941, 0.918), grey = rgb(0.4, 0.4, 0.4)
  const page = pdf.addPage([W, H]); let y = H - M
  const safe = (f: PDFFont, s: string) => [...(s ?? '')].map(ch => { try { f.encodeText(ch); return ch } catch { return '?' } }).join('')
  const text = (s: string, x: number, yy: number, size = 9.5, f: PDFFont = font, color = black) => page.drawText(safe(f, s), { x, y: yy, size, font: f, color })
  const right = (s: string, xr: number, yy: number, size = 9.5, f: PDFFont = font) => text(s, xr - f.widthOfTextAtSize(safe(f, s), size), yy, size, f)
  const center = (s: string, xc: number, yy: number, size = 9.5, f: PDFFont = font) => text(s, xc - f.widthOfTextAtSize(safe(f, s), size) / 2, yy, size, f)
  const rect = (x: number, yy: number, w: number, h: number, fill?: ReturnType<typeof rgb>) => page.drawRectangle({ x, y: yy, width: w, height: h, color: fill, borderColor: black, borderWidth: 0.75 })
  const wrap = (s: string, f: PDFFont, size: number, width: number) => { const out: string[] = []; for (const para of (s || '').split(/\r?\n/).map(x => safe(f, x))) { let line = ''; for (const w of para.split(/\s+/)) { const t = line ? `${line} ${w}` : w; if (f.widthOfTextAtSize(t, size) <= width) line = t; else { if (line) out.push(line); line = w } } out.push(line) } return out }
  const image = (im: PDFImage, x: number, yy: number, maxW: number, maxH: number) => { const s = Math.min(maxW / im.width, maxH / im.height); page.drawImage(im, { x: x + (maxW - im.width * s) / 2, y: yy - im.height * s, width: im.width * s, height: im.height * s }); return im.height * s }

  if (o.showHeaderFooter) {
    if (img.header) y -= image(img.header, M, y, CW, 82) + 8
    else {
      center(o.companyName, W / 2, y - 14, 15, bold); y -= 22
      const c = [o.companyAddress, o.companyPhone && `Tel: ${o.companyPhone}`, o.companyEmail].filter(Boolean).join('  ·  ')
      if (c) { center(c, W / 2, y - 6, 8.5); y -= 12 }
      page.drawLine({ start: { x: M, y: y - 4 }, end: { x: W - M, y: y - 4 }, thickness: 1.2, color: black }); y -= 12
    }
  }
  center(o.title.toUpperCase(), W / 2, y - 12, 13, bold); y -= 22
  if (o.companyTrn) { center(`TRN: ${o.companyTrn}`, W / 2, y - 4, 9, bold); y -= 12 }

  const lw = CW - 190, lines = o.left.map(([k, v]) => [k, wrap(v, font, 9.5, lw - 100)] as const)
  const bh = Math.max(lines.reduce((s, [, ls]) => s + ls.length * 13, 0), o.right.length * 13) + 14
  rect(M, y - bh, lw, bh, boxBg); rect(M + lw + 10, y - bh, CW - lw - 10, bh, boxBg)
  let ly = y - 15; for (const [k, ls] of lines) { text(k, M + 8, ly, 9.5, bold); ls.forEach((x, i) => text(x, M + 96, ly - i * 13)); ly -= ls.length * 13 }
  o.right.forEach(([k, v], i) => { text(k, M + lw + 18, y - 15 - i * 13, 9.5, bold); text(v, M + lw + 80, y - 15 - i * 13) })
  y -= bh + 16

  if (o.table) {
    const t = o.table, scale = CW / t.cols.reduce((a, c) => a + c.w, 0), cols = t.cols.map(c => ({ ...c, w: c.w * scale }))
    let x = M; for (const c of cols) { rect(x, y - 20, c.w, 20); center(c.h, x + c.w / 2, y - 13.5, 9, bold); x += c.w } y -= 20
    for (const r of t.rows) { x = M; cols.forEach((c, i) => { rect(x, y - 20, c.w, 20); c.right ? right(r[i] ?? '', x + c.w - 6, y - 13.5) : text(r[i] ?? '', x + 6, y - 13.5); x += c.w }); y -= 20 }
    if (t.total) { const lw2 = cols.slice(0, -1).reduce((a, c) => a + c.w, 0); rect(M, y - 22, lw2, 22); right(t.total[0], M + lw2 - 6, y - 14.5, 10, bold); rect(M + lw2, y - 22, cols[cols.length - 1].w, 22); right(t.total[1], M + CW - 6, y - 14.5, 10, bold); y -= 22 }
    y -= 12
  }
  if (o.words) { for (const l of wrap(o.words, bold, 10, CW)) { text(l, M, y - 10, 10, bold); y -= 14 } y -= 6 }
  if (o.note) { for (const l of wrap(o.note, font, 9.5, CW)) { text(l, M, y - 9, 9.5); y -= 13 } y -= 6 }
  if (o.signLine) { y -= 40; page.drawLine({ start: { x: W - M - 180, y }, end: { x: W - M, y }, thickness: 0.7, color: black }); center(o.signLine, W - M - 90, y - 12, 9) }
  text('This is a computer-generated document.', M, 40, 8, font, grey)
  if (o.showHeaderFooter && img.footer) image(img.footer, M, 72, CW, 52)
  return pdf.save()
}
