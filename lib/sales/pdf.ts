import 'server-only'
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib'
import { amountInWords, computeTotals, fmtMoney, lineAmount, lineVat } from './money'
import { DOC_META } from './docs'
import type { PaperDoc, PaperItem } from '@/components/sales/paper'
import type { BrandKind } from './data'

/** A4 PDF in the Al Saqr template layout. Arabic text in images (letterhead/stamp) is preserved; typed text uses Helvetica. */
export async function renderSalesPdf(doc: PaperDoc, items: PaperItem[], opts: {
  companyName: string; images: Partial<Record<BrandKind, { bytes: Uint8Array; png: boolean }>>; showHeaderFooter: boolean; showStamp: boolean; bankDetails?: string | null; paid?: number
}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(`${DOC_META[doc.doc_type].label} ${doc.number}`); pdf.setCreator('SaqrFlow'); pdf.setProducer('SaqrFlow')
  const font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold), italic = await pdf.embedFont(StandardFonts.HelveticaBoldOblique)
  const img: Partial<Record<BrandKind, PDFImage>> = {}
  for (const [k, v] of Object.entries(opts.images)) { try { img[k as BrandKind] = v!.png ? await pdf.embedPng(v!.bytes) : await pdf.embedJpg(v!.bytes) } catch { /* unsupported image → skipped */ } }

  const W = 595.28, H = 841.89, M = 28, CW = W - 2 * M
  const isInv = doc.doc_type === 'invoice', isDn = doc.doc_type === 'delivery_note', isQtn = doc.doc_type === 'quotation'
  const black = rgb(0, 0, 0), grey = rgb(0.45, 0.45, 0.45), boxBg = rgb(0.953, 0.941, 0.918), red = rgb(0.72, 0.11, 0.11), hatch = rgb(0.95, 0.93, 0.89)
  const footer = opts.showHeaderFooter ? img.footer : undefined
  const bottom = footer ? 80 : 36
  // Helvetica (WinAnsi) can't encode e.g. Arabic — replace unsupported characters instead of failing.
  const safe = (f: PDFFont, s: string) => [...(s ?? '')].map(ch => { try { f.encodeText(ch); return ch } catch { return '?' } }).join('')
  const wrap = (s: string, f: PDFFont, size: number, width: number): string[] => {
    const out: string[] = []
    for (const para of (s || '').split(/\r?\n/).map(x => safe(f, x))) {
      let line = ''
      for (const word of para.split(/\s+/)) {
        const t = line ? `${line} ${word}` : word
        if (f.widthOfTextAtSize(t, size) <= width) { line = t; continue }
        if (line) out.push(line)
        let w = word; while (f.widthOfTextAtSize(w, size) > width) { let i = w.length; while (i > 1 && f.widthOfTextAtSize(w.slice(0, i), size) > width) i--; out.push(w.slice(0, i)); w = w.slice(i) }
        line = w
      }
      out.push(line)
    }
    return out
  }

  let page: PDFPage = pdf.addPage([W, H]), y = H - M
  const text = (s: string, x: number, yy: number, size = 10, f: PDFFont = font, color = black) => page.drawText(safe(f, s), { x, y: yy, size, font: f, color })
  const right = (s: string, xr: number, yy: number, size = 10, f: PDFFont = font) => text(s, xr - f.widthOfTextAtSize(safe(f, s), size), yy, size, f)
  const center = (s: string, xc: number, yy: number, size = 10, f: PDFFont = font) => text(s, xc - f.widthOfTextAtSize(safe(f, s), size) / 2, yy, size, f)
  const rect = (x: number, yy: number, w: number, h: number, fill?: ReturnType<typeof rgb>, border = true) => page.drawRectangle({ x, y: yy, width: w, height: h, color: fill, borderColor: border ? black : undefined, borderWidth: border ? 0.75 : 0 })
  const drawImage = (im: PDFImage, x: number, yy: number, maxW: number, maxH: number, align: 'center' | 'left' = 'center') => {
    const s = Math.min(maxW / im.width, maxH / im.height); const w = im.width * s, h = im.height * s
    page.drawImage(im, { x: align === 'center' ? x + (maxW - w) / 2 : x, y: yy - h, width: w, height: h }); return h
  }
  const drawFooter = () => { if (footer) drawImage(footer, M, 72, CW, 52) }
  const newPage = () => { drawFooter(); page = pdf.addPage([W, H]); y = H - M }

  // letterhead + title
  const header = (isInv && img.header_invoice) || img.header
  if (opts.showHeaderFooter) {
    if (header) y -= drawImage(header, M, y, CW, 82) + 8
    else { center(opts.companyName, W / 2, y - 14, 15, bold); y -= 30 }
  }
  const title = DOC_META[doc.doc_type].paperTitle
  center(title, W / 2, y - 12, isInv ? 14 : 13, bold)
  if (isInv) { const tw = bold.widthOfTextAtSize(title, 14); page.drawLine({ start: { x: W / 2 - tw / 2, y: y - 14 }, end: { x: W / 2 + tw / 2, y: y - 14 }, thickness: 0.8 }) }
  y -= 24

  // party + reference boxes
  const dash = (s?: string | null) => (s && s.trim() ? s : '-')
  const fd = (d?: string | null) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : '-')
  const left: [string, string][] = [...(isQtn ? [['Attention:', dash(doc.attention)] as [string, string]] : []), ['Company Name:', dash(doc.customer_name)],
    ...(!isQtn ? [['TRN:', dash(doc.customer_trn)] as [string, string]] : []), ...(!isQtn && doc.customer_phone ? [['Tel:', doc.customer_phone] as [string, string]] : []),
    ['Address:', dash(doc.customer_address)], ...(doc.site ? [[isDn ? 'Delivery to:' : 'Site:', doc.site] as [string, string]] : [])]
  const rightRows: [string, string][] = [[isDn ? 'Delivery No.' : isInv ? 'Invoice No.' : 'No.', dash(doc.number)], ['Date:', fd(doc.issue_date)],
    ...(!isQtn ? [['L.P.O:', dash(doc.lpo_ref)] as [string, string]] : []), ...(isInv ? [['DEL NO:', dash(doc.del_no)] as [string, string]] : []),
    ...(isInv && doc.reference ? [['REF:', doc.reference] as [string, string]] : []), ...(isInv && doc.due_date ? [['Due:', fd(doc.due_date)] as [string, string]] : []),
    ...(isQtn && doc.valid_until ? [['Valid till:', fd(doc.valid_until)] as [string, string]] : [])]
  const lw = CW - 160, lab = 82, fs = 9.5, lh = 13
  const leftLines = left.map(([k, v]) => [k, wrap(v, font, fs, lw - lab - 16)] as const)
  const leftH = leftLines.reduce((s, [, ls]) => s + ls.length * lh, 0) + 12, rightH = rightRows.length * lh + 12, boxH = Math.max(leftH, rightH)
  rect(M, y - boxH, lw, boxH, boxBg); rect(M + lw + 10, y - boxH, CW - lw - 10, boxH, boxBg)
  let ly = y - 15
  for (const [k, ls] of leftLines) { text(k, M + 8, ly, fs, bold); ls.forEach((l, i) => text(l, M + 8 + lab, ly - i * lh, fs)); ly -= ls.length * lh }
  let ry = y - 15
  for (const [k, v] of rightRows) { text(k, M + lw + 18, ry, fs, bold); text(v, M + lw + 18 + 62, ry, fs); ry -= lh }
  y -= boxH + 10

  if (isQtn && doc.intro) for (const l of wrap(doc.intro, font, 9.5, CW)) { text(l, M, y - 9, 9.5); y -= 12 }
  if (doc.subject) { text('Subject:', M, y - 9, 9.5, bold); text(doc.subject, M + 44, y - 9, 9.5); y -= 13 }
  if (!isInv) { text('The scope of works:-', M, y - 10, 10, bold); y -= 14 }

  // items table
  const cols: { h: string; w: number; a: 'c' | 'l' | 'r' }[] = isInv
    ? [{ h: 'SR NO', w: 30, a: 'c' }, { h: 'DESCRIPTION', w: CW - 30 - 38 - 62 - 70 - 58 - 80, a: 'l' }, { h: 'QTY.', w: 38, a: 'c' }, { h: 'Rate', w: 62, a: 'r' }, { h: 'Amount', w: 70, a: 'r' }, { h: `VAT ${doc.vat_rate}%`, w: 58, a: 'r' }, { h: 'Amount With Vat', w: 80, a: 'r' }]
    : [{ h: 'SR NO', w: 34, a: 'c' }, { h: 'DESCRIPTION', w: CW - 34 - 46 - 80 - 80, a: 'l' }, { h: 'QTY.', w: 46, a: 'c' }, { h: 'Unit price (dhs)', w: 80, a: 'c' }, { h: 'Total Price (dhs)', w: 80, a: 'c' }]
  const tableHeader = () => {
    const hh = 26; let x = M
    for (const c of cols) { rect(x, y - hh, c.w, hh); const ls = wrap(c.h, bold, 8, c.w - 6); ls.forEach((l, i) => center(l, x + c.w / 2, y - 11 - i * 9 + (ls.length - 1) * 4, 8, bold)); x += c.w }
    y -= hh
  }
  tableHeader()
  const rows = items.length ? items : [{ description: '', quantity: 1, unit_price: 0 }]
  rows.forEach((it, idx) => {
    const desc = wrap(it.description || '-', font, 9, cols[1].w - 8)
    const mat = it.materials ? wrap(`Materials to be used: ${it.materials}`, font, 8, cols[1].w - 8) : []
    const rh = Math.max(22, (desc.length * 11) + (mat.length * 10) + 10)
    if (y - rh < bottom + 40) { newPage(); tableHeader() }
    const amt = lineAmount(it), vat = lineVat(it, doc.vat_rate)
    const qty = `${Number(it.quantity || 0)}${it.unit && it.unit !== 'Nos' ? ' ' + it.unit : ''}`
    const vals = isInv ? [String(idx + 1).padStart(2, '0'), '', qty, Number(it.unit_price) ? fmtMoney(it.unit_price) : '-', fmtMoney(amt), fmtMoney(vat), fmtMoney(amt + vat)]
      : [String(idx + 1).padStart(2, '0'), '', qty, isDn ? '' : Number(it.unit_price) ? fmtMoney(it.unit_price) : '-', isDn ? '' : fmtMoney(amt)]
    let x = M
    cols.forEach((c, ci) => {
      rect(x, y - rh, c.w, rh, isDn && ci >= 3 ? hatch : undefined)
      if (ci === 1) { desc.forEach((l, i) => text(l, x + 4, y - 13 - i * 11, 9)); mat.forEach((l, i) => text(l, x + 4, y - 13 - desc.length * 11 - i * 10, 8, font, grey)) }
      else if (ci === 2 && it.unit && it.unit !== 'Nos' && font.widthOfTextAtSize(safe(font, qty), 9) > c.w - 4) {
        center(String(Number(it.quantity || 0)), x + c.w / 2, y - rh / 2 + 2, 9); center(it.unit, x + c.w / 2, y - rh / 2 - 8, 7)
      }
      else if (vals[ci]) { const yy = y - rh / 2 - 3; c.a === 'c' ? center(vals[ci], x + c.w / 2, yy, 9, ci === 0 || ci === 6 ? bold : font) : right(vals[ci], x + c.w - 4, yy, 9, ci === 6 ? bold : font) }
      x += c.w
    })
    y -= rh
  })
  const t = computeTotals(items, doc.vat_rate, doc.discount ?? 0, isInv)
  if (isQtn && doc.show_total !== false) {
    const rh = 28; let x = M
    cols.forEach((c, ci) => { rect(x, y - rh, c.w, rh); if (ci === 3) { center('Total', x + c.w / 2, y - 11, 9, bold); center('Amount', x + c.w / 2, y - 22, 9, bold) } if (ci === 4) center(fmtMoney(t.taxable), x + c.w / 2, y - 17, 9.5, bold); x += c.w })
    y -= rh
  }
  if (isInv) {
    const rh = 22; let x = M
    const gw = cols[0].w + cols[1].w
    rect(x, y - rh, gw, rh); center(`Grand Total${t.discount ? ` (after discount ${fmtMoney(t.discount)})` : ''}`, x + gw / 2, y - 14, 9.5, bold); x += gw
    const tv = ['', '', fmtMoney(t.taxable), fmtMoney(t.vat), fmtMoney(t.total)]
    cols.slice(2).forEach((c, i) => { rect(x, y - rh, c.w, rh); if (tv[i]) right(tv[i], x + c.w - 4, y - 14, 9.5, bold); x += c.w })
    y -= rh
    if (y - 46 < bottom) newPage()
    const pw = 100, vw = 80, ww = CW - pw - vw, paid = opts.paid ?? 0
    rect(M, y - 44, ww, 44); const words = wrap(`Amount in Words: - ${amountInWords(t.total).replace(/^UAE Dirhams /, '')}`, bold, 10, ww - 12)
    words.slice(0, 3).forEach((l, i) => text(l, M + 6, y - 16 - i * 12 + (words.length > 2 ? 6 : 0), 10, bold))
    rect(M + ww, y - 22, pw, 22); center('Paid Amount', M + ww + pw / 2, y - 15, 10, bold); rect(M + ww + pw, y - 22, vw, 22); right(fmtMoney(paid), M + CW - 4, y - 15, 10, bold)
    rect(M + ww, y - 44, pw, 22); center('Total Balance', M + ww + pw / 2, y - 37, 10, bold); rect(M + ww + pw, y - 44, vw, 22); right(fmtMoney(t.total - paid), M + CW - 4, y - 37, 10, bold)
    y -= 56
  }

  // closing / terms / bank / signatures
  const ensure = (h: number) => { if (y - h < bottom) newPage() }
  if (isQtn && doc.closing) { y -= 6; doc.closing.split('\n').forEach((l, i) => { for (const w of wrap(l, i === 0 ? bold : font, 9.5, CW)) { ensure(12); text(w, M, y - 9, 9.5, i === 0 ? bold : font); y -= 12 } }) }
  const sigTop = y - 8
  const list = (titleS: string, arr: string[]) => {
    if (!arr.length) return; ensure(30); y -= 8; text(titleS, M, y - 11, 11.5, bold); const tw = bold.widthOfTextAtSize(titleS, 11.5); page.drawLine({ start: { x: M, y: y - 13 }, end: { x: M + tw, y: y - 13 }, thickness: 0.7 }); y -= 18
    arr.forEach((a, i) => { for (const l of wrap(`${i + 1}. ${a}`, font, 10, CW - 200)) { ensure(13); text(l, M, y - 9, 10); y -= 13 } })
  }
  if (isQtn) { list('Terms and Conditions: -', doc.terms); list('Payment Terms: -', doc.payment_terms) }
  if (isInv) {
    if (opts.bankDetails) { ensure(30); text('Bank Details: -', M, y - 10, 10.5, bold); y -= 15; for (const l of wrap(opts.bankDetails, font, 9, CW)) { ensure(12); text(l, M, y - 8, 9); y -= 11.5 } }
    if (doc.payment_terms.length) { y -= 4; for (const l of wrap(`Payment terms: ${doc.payment_terms.join(' · ')}`, font, 9, CW)) { ensure(12); text(l, M, y - 8, 9); y -= 11.5 } }
    ensure(20); y -= 8; center('This is a computer-generated report.', W / 2, y - 8, 9, italic); text('', 0, 0); y -= 14
  }
  if (isDn) {
    ensure(70); y -= 34
    text('Delivered By:', M, y, 10, font, red); page.drawLine({ start: { x: M + 68, y: y - 2 }, end: { x: M + 210, y: y - 2 }, thickness: 0.7, color: red }); if (doc.vehicle_no) text(`Vehicle: ${doc.vehicle_no}`, M + 218, y, 9)
    y -= 30; text('Received By:', M, y, 10, font, red); page.drawLine({ start: { x: M + 68, y: y - 2 }, end: { x: M + 210, y: y - 2 }, thickness: 0.7, color: red }); if (doc.receiver_name) text(doc.receiver_name, M + 218, y, 9)
  }
  if (opts.showStamp && !isInv && (img.stamp || img.signature)) {
    const top = Math.max(sigTop, bottom + 80)
    if (img.stamp) drawImage(img.stamp, W - M - 190, top, 70, 70)
    if (img.signature) drawImage(img.signature, W - M - 110, top, 110, 70)
  }
  drawFooter()
  const pages = pdf.getPages()
  if (pages.length > 1) pages.forEach((p, i) => p.drawText(`Page ${i + 1} of ${pages.length}`, { x: W - M - 60, y: 14, size: 7.5, font, color: grey }))
  return pdf.save()
}
