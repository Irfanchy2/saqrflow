import 'server-only'
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib'
import { amountInWords, computeTotals, fmtMoney, lineAmount, lineVat, VAT_CATEGORIES, type VatCategory } from './money'
import { DOC_META, isTaxDoc } from './docs'
import { docDiscount, vatOn, type PaperDoc, type PaperItem } from '@/components/sales/paper'
import type { BrandKind } from './data'
import { resolveTemplate, templateKind, type TemplateKind } from './template'
import { parseRich, type Run } from './rich'

/** A4 PDF in the Al Saqr template layout. Arabic text in images (letterhead/stamp) is preserved; typed text uses Helvetica. */
export async function renderSalesPdf(doc: PaperDoc, items: PaperItem[], opts: {
  companyName: string; images: Partial<Record<BrandKind, { bytes: Uint8Array; png: boolean }>>; showHeaderFooter: boolean; showStamp: boolean; bankDetails?: string | null; paid?: number
  companyTrn?: string | null; sealSize?: number; signatureWidth?: number; signAlign?: 'left' | 'center' | 'right'; signSpacing?: number
  signatoryName?: string | null; signatoryTitle?: string | null; brandColor?: string | null; companyAddress?: string | null; companyPhone?: string | null; companyEmail?: string | null; companyWebsite?: string | null
  templates?: Partial<Record<TemplateKind, unknown>>
}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(`${DOC_META[doc.doc_type].label} ${doc.number}`); pdf.setCreator('Averiqo'); pdf.setProducer('Averiqo')
  const font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold), italic = await pdf.embedFont(StandardFonts.HelveticaBoldOblique)
  const oblique = await pdf.embedFont(StandardFonts.HelveticaOblique)
  const img: Partial<Record<BrandKind, PDFImage>> = {}
  for (const [k, v] of Object.entries(opts.images)) { try { img[k as BrandKind] = v!.png ? await pdf.embedPng(v!.bytes) : await pdf.embedJpg(v!.bytes) } catch { /* unsupported image → skipped */ } }

  const W = 595.28, H = 841.89, M = 28, CW = W - 2 * M
  const isInv = isTaxDoc(doc.doc_type), isCn = doc.doc_type === 'credit_note', isDn = doc.doc_type === 'delivery_note', isQtn = doc.doc_type === 'quotation'
  const qVat = isQtn && doc.apply_vat === true
  const tp = resolveTemplate(doc.doc_type, opts.templates?.[templateKind(doc.doc_type) as TemplateKind]), f = tp.fields
  const hex = opts.brandColor && /^#[0-9a-f]{6}$/i.test(opts.brandColor) ? opts.brandColor : null
  const accent = hex ? rgb(parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255) : null
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

  // rich text ("Materials to be used"): styled runs wrapped word by word; lists indent with a hanging bullet / number
  type Seg = { t: string; f: PDFFont; u?: boolean }
  type RLine = { x: number; segs: Seg[]; marker?: string }
  const fontOf = (r: Run) => (r.b ? (r.i ? italic : bold) : r.i ? oblique : font)
  const flowRuns = (rs: Run[], size: number, width: number): Seg[][] => {
    const toks: Seg[] = []
    for (const r of rs) for (const t of r.text.split(/(\s+)/)) if (t) toks.push({ t: /^\s+$/.test(t) ? ' ' : safe(fontOf(r), t), f: fontOf(r), u: r.u })
    const lines: Seg[][] = []; let line: Seg[] = [], w = 0
    const tw = (x: Seg) => x.f.widthOfTextAtSize(x.t, size)
    for (const tok of toks) {
      if (tok.t === ' ') { if (line.length) { line.push(tok); w += tw(tok) } continue }
      let word = tok
      while (tw(word) > width) {                                          // a word longer than the cell is broken
        if (line.length) { lines.push(line); line = []; w = 0 }
        let i = word.t.length; while (i > 1 && word.f.widthOfTextAtSize(word.t.slice(0, i), size) > width) i--
        lines.push([{ ...word, t: word.t.slice(0, i) }]); word = { ...word, t: word.t.slice(i) }
      }
      if (w + tw(word) > width && line.length) { while (line.length && line[line.length - 1].t === ' ') line.pop(); lines.push(line); line = []; w = 0 }
      line.push(word); w += tw(word)
    }
    while (line.length && line[line.length - 1].t === ' ') line.pop()
    lines.push(line)
    return lines
  }
  const richLines = (src: string, label: string, size: number, width: number): RLine[] => {
    const out: RLine[] = [], blocks = parseRich(src)
    const lab: Run = { text: label + ' ', b: true }
    if (blocks[0] && blocks[0].kind !== 'p') out.push({ x: 0, segs: [{ t: label, f: bold }] })
    blocks.forEach((bl, bi) => {
      if (bl.kind === 'p') { flowRuns(bi === 0 ? [lab, ...bl.runs] : bl.runs, size, width).forEach(segs => out.push({ x: 0, segs })); return }
      const ind = bl.kind === 'ol' ? 13 : 9
      bl.items.forEach((it, j) => flowRuns(it, size, width - ind).forEach((segs, k) => out.push({ x: ind, segs, marker: k ? undefined : bl.kind === 'ol' ? `${bl.start + j}.` : '\u2022' })))
    })
    return out
  }
  const drawRich = (ls: RLine[], x0: number, y0: number, size: number, lh: number) => ls.forEach((l, i) => {
    const yy = y0 - i * lh
    if (l.marker) page.drawText(safe(font, l.marker), { x: x0 + l.x - font.widthOfTextAtSize(safe(font, l.marker), size) - 3, y: yy, size, font, color: black })
    let x = x0 + l.x
    for (const sg of l.segs) {
      const w = sg.f.widthOfTextAtSize(sg.t, size)
      if (sg.t !== ' ' || l.segs.length > 1) page.drawText(sg.t, { x, y: yy, size, font: sg.f, color: black })
      if (sg.u) page.drawLine({ start: { x, y: yy - 1.4 }, end: { x: x + w, y: yy - 1.4 }, thickness: 0.5, color: black })
      x += w
    }
  })

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
    else {
      // text letterhead (same content as the on-screen fallback): logo, company name, contact line, TRN
      if (img.logo) y -= drawImage(img.logo, M, y, CW, 50) + 4
      center(opts.companyName, W / 2, y - 14, 15, bold); y -= 20
      const contact = [opts.companyAddress, opts.companyPhone && `Tel: ${opts.companyPhone}`, opts.companyEmail, opts.companyWebsite].filter(Boolean).join('  ·  ')
      for (const l of contact ? wrap(contact, font, 8.5, CW) : []) { center(l, W / 2, y - 8, 8.5); y -= 11 }
      page.drawLine({ start: { x: M, y: y - 4 }, end: { x: W - M, y: y - 4 }, thickness: 1.2, color: accent ?? black }); y -= 12
    }
  }
  const title = tp.title || DOC_META[doc.doc_type].paperTitle
  center(title, W / 2, y - 12, isInv ? 14 : 13, bold)
  if (isInv) { const tw = bold.widthOfTextAtSize(title, 14); page.drawLine({ start: { x: W / 2 - tw / 2, y: y - 14 }, end: { x: W / 2 + tw / 2, y: y - 14 }, thickness: 0.8 }) }
  y -= 24
  if (isInv && opts.companyTrn) { center(`TRN: ${opts.companyTrn}`, W / 2, y - 4, 9, bold); y -= 12 }
  if (isCn && doc.against_number) { center(`Against Tax Invoice ${doc.against_number}`, W / 2, y - 4, 9, bold); y -= 12 }

  // party + reference boxes
  const dash = (s?: string | null) => (s && s.trim() ? s : '-')
  const fd = (d?: string | null) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : '-')
  const row = (on: unknown, k: string, v: string): [string, string][] => (on ? [[k, v]] : [])
  const left: [string, string][] = [...row(f.attention, 'Attention:', dash(doc.attention)), ['Company Name:', dash(doc.customer_name)],
    ...row(f.customer_trn, 'TRN:', dash(doc.customer_trn)), ...row(f.phone && doc.customer_phone, 'Tel:', doc.customer_phone ?? ''), ...row(f.email && doc.customer_email, 'Email:', doc.customer_email ?? ''),
    ['Address:', dash(doc.customer_address)], ...row(f.site && doc.site, isDn ? 'Delivery to:' : 'Site:', doc.site ?? ''), ...row(f.project && doc.project_name, 'Project:', doc.project_name ?? '')]
  const rightRows: [string, string][] = [[isDn ? 'Delivery No.' : isCn ? 'Credit Note No.' : isInv ? 'Invoice No.' : 'Ref No.', `${dash(doc.number)}${doc.revision ? ` Rev.${doc.revision}` : ''}`], ['Date:', fd(doc.issue_date)],
    ...row(f.lpo, 'L.P.O:', dash(doc.lpo_ref)), ...row(f.del_no && !isCn, 'DEL NO:', dash(doc.del_no)), ...row(f.reference && doc.reference, 'Your Ref:', doc.reference ?? ''),
    ...row(f.due_date && doc.due_date, 'Due:', fd(doc.due_date)), ...row(f.valid_until && doc.valid_until, 'Valid till:', fd(doc.valid_until))]
  const lw = CW - 160, lab = 82, fs = 9.5, lh = 13
  const leftLines = left.map(([k, v]) => [k, wrap(v, font, fs, lw - lab - 16)] as const)
  const rightLines = rightRows.map(([k, v]) => [k, wrap(v, font, fs, CW - lw - 10 - 78)] as const)
  const leftH = leftLines.reduce((s, [, ls]) => s + ls.length * lh, 0) + 12, rightH = rightLines.reduce((s, [, ls]) => s + ls.length * lh, 0) + 12, boxH = Math.max(leftH, rightH)
  rect(M, y - boxH, lw, boxH, boxBg); rect(M + lw + 10, y - boxH, CW - lw - 10, boxH, boxBg)
  let ly = y - 15
  for (const [k, ls] of leftLines) { text(k, M + 8, ly, fs, bold); ls.forEach((l, i) => text(l, M + 8 + lab, ly - i * lh, fs)); ly -= ls.length * lh }
  let ry = y - 15
  for (const [k, ls] of rightLines) { text(k, M + lw + 18, ry, fs, bold); ls.forEach((l, i) => text(l, M + lw + 18 + 62, ry - i * lh, fs)); ry -= ls.length * lh }
  y -= boxH + 10

  if (isQtn && doc.intro) for (const l of wrap(doc.intro, font, 9.5, CW)) { text(l, M, y - 9, 9.5); y -= 12 }
  if (doc.subject) { text('Subject:', M, y - 9, 9.5, bold); text(doc.subject, M + 44, y - 9, 9.5); y -= 13 }
  if (tp.scopeHeading) { text(tp.scopeHeading, M, y - 10, 10, bold); y -= 14 }

  // items table
  const cols: { h: string; w: number; a: 'c' | 'l' | 'r' }[] = isInv
    ? [{ h: 'SR NO', w: 30, a: 'c' }, { h: tp.labels.description, w: CW - 30 - 38 - 62 - 70 - 58 - 80, a: 'l' }, { h: tp.labels.qty, w: 38, a: 'c' }, { h: tp.labels.rate, w: 62, a: 'r' }, { h: tp.labels.total, w: 70, a: 'r' }, { h: `VAT ${doc.vat_rate}%`, w: 58, a: 'r' }, { h: 'Amount With Vat', w: 80, a: 'r' }]
    : [{ h: 'SR NO', w: 34, a: 'c' }, { h: tp.labels.description, w: CW - 34 - 46 - 80 - 80, a: 'l' }, { h: tp.labels.qty, w: 46, a: 'c' }, { h: tp.labels.rate, w: 80, a: 'c' }, { h: tp.labels.total, w: 80, a: 'c' }]
  const tableHeader = () => {
    const hh = 26; let x = M
    for (const c of cols) {
      rect(x, y - hh, c.w, hh, accent ?? undefined); const ls = wrap(c.h, bold, 8, c.w - 6)
      ls.forEach((l, i) => { const sx = safe(bold, l); page.drawText(sx, { x: x + c.w / 2 - bold.widthOfTextAtSize(sx, 8) / 2, y: y - 11 - i * 9 + (ls.length - 1) * 4, size: 8, font: bold, color: accent ? rgb(1, 1, 1) : black }) }); x += c.w
    }
    y -= hh
  }
  tableHeader()
  const rows = items.length ? items : [{ description: '', quantity: 1, unit_price: 0 }]
  rows.forEach((it, idx) => {
    const desc = wrap(it.description || '-', font, 9, cols[1].w - 8)
    const note = !isDn && (Number(it.discount_pct) > 0 || (it.vat_category && it.vat_category !== 'standard'))
      ? [Number(it.discount_pct) > 0 ? `Less ${Number(it.discount_pct)}% discount` : '', it.vat_category && it.vat_category !== 'standard' ? VAT_CATEGORIES[it.vat_category as VatCategory] : ''].filter(Boolean).join(' · ') : ''
    const mat = it.materials ? richLines(it.materials, 'Materials to be used:', 8.5, cols[1].w - 8) : []
    const notes = note ? wrap(note, font, 8, cols[1].w - 8) : []
    // the description cell as a list of lines; a row taller than the space left continues on the next page (never off the page)
    const cell: { h: number; draw: (x: number, yy: number) => void }[] = [
      ...desc.map(l => ({ h: 11, draw: (x: number, yy: number) => text(l, x, yy, 9) })),
      ...mat.map(l => ({ h: 10.5, draw: (x: number, yy: number) => drawRich([l], x, yy - 0.5, 8.5, 10.5) })),
      ...notes.map(l => ({ h: 10, draw: (x: number, yy: number) => text(l, x, yy, 8, font, grey) })),
    ]
    const full = Math.max(22, cell.reduce((a, l) => a + l.h, 0) + 10), pageBody = H - M - bottom - 26 - 12
    if (y - full < bottom + 40 && full <= pageBody) { newPage(); tableHeader() }
    const amt = lineAmount(it), vat = lineVat(it, doc.vat_rate)
    const qty = `${Number(it.quantity || 0)}${it.unit && it.unit !== 'Nos' ? ' ' + it.unit : ''}`
    const vals = isInv ? [String(idx + 1).padStart(2, '0'), '', qty, Number(it.unit_price) ? fmtMoney(it.unit_price) : '-', fmtMoney(amt), fmtMoney(vat), fmtMoney(amt + vat)]
      : [String(idx + 1).padStart(2, '0'), '', qty, isDn ? '' : Number(it.unit_price) ? fmtMoney(it.unit_price) : '-', isDn ? '' : fmtMoney(amt)]
    if (full > pageBody && y - bottom < 120) { newPage(); tableHeader() }   // a long row starts with real room, not one line at the foot of a page
    let rest = cell, first = true
    while (first || rest.length) {
      if (!first) { newPage(); tableHeader() }
      let take = rest.length, acc = rest.reduce((a, l) => a + l.h, 0)
      if (acc + 10 > y - bottom - 10) { take = 0; acc = 0; while (take < rest.length && acc + rest[take].h + 10 <= y - bottom - 10) acc += rest[take++].h; take = Math.max(1, take) ; acc = rest.slice(0, take).reduce((a, l) => a + l.h, 0) }
      const part = rest.slice(0, take), rh = Math.max(first ? 22 : 16, acc + 10)
      let x = M
      cols.forEach((c, ci) => {
        rect(x, y - rh, c.w, rh, isDn && ci >= 3 ? hatch : undefined)
        if (ci === 1) { let yy = y - 13; for (const l of part) { l.draw(x + 4, yy); yy -= l.h } }
        else if (!first) { /* values only on the row's first page */ }
        else if (ci === 2 && it.unit && it.unit !== 'Nos' && font.widthOfTextAtSize(safe(font, qty), 9) > c.w - 4) {
          center(String(Number(it.quantity || 0)), x + c.w / 2, y - Math.min(rh, 40) / 2 + 2, 9); center(it.unit, x + c.w / 2, y - Math.min(rh, 40) / 2 - 8, 7)
        }
        else if (vals[ci]) { const yy = y - Math.min(rh, full) / 2 - 3; c.a === 'c' ? center(vals[ci], x + c.w / 2, yy, 9, ci === 0 || ci === 6 ? bold : font) : right(vals[ci], x + c.w - 4, yy, 9, ci === 6 ? bold : font) }
        x += c.w
      })
      y -= rh; rest = rest.slice(take); first = false
    }
  })
  const t = computeTotals(items, doc.vat_rate, docDiscount(doc), vatOn(doc))
  const adv = Number(doc.advance_applied) || 0, paidShown = (opts.paid ?? 0) + (isInv && doc.advance_pending ? adv : 0)
  if (isQtn && doc.show_total !== false) {
    const small = (label: string, v: string) => { const ls = wrap(label, font, 8.5, cols[3].w - 6), rh = Math.max(18, ls.length * 10 + 8); if (y - rh < bottom) newPage(); let x = M; cols.forEach((c, ci) => { rect(x, y - rh, c.w, rh); if (ci === 3) ls.forEach((l, i) => center(l, x + c.w / 2, y - 12 - i * 10, 8.5)); if (ci === 4) center(v, x + c.w / 2, y - rh / 2 - 3, 9); x += c.w }); y -= rh }
    if (t.discount > 0 || qVat) small('Subtotal', fmtMoney(t.subtotal))
    if (t.discount > 0) small(`Discount${doc.discount_type === 'percent' ? ` ${Number(doc.discount_value)}%` : ''}`, `- ${fmtMoney(t.discount)}`)
    if (qVat) small(`VAT ${doc.vat_rate}%`, fmtMoney(t.vat))
    const rh = 28; if (y - rh < bottom) newPage(); let x = M
    cols.forEach((c, ci) => { rect(x, y - rh, c.w, rh); if (ci === 3) { center(qVat ? 'Grand' : 'Total', x + c.w / 2, y - 11, 9, bold); center(qVat ? 'Total' : 'Amount', x + c.w / 2, y - 22, 9, bold) } if (ci === 4) center(fmtMoney(qVat ? t.total : t.taxable), x + c.w / 2, y - 17, 9.5, bold); x += c.w })
    y -= rh
    if (adv > 0) {
      small('Less: Advance received', `- ${fmtMoney(adv)}`)
      const bh = 20; if (y - bh < bottom) newPage(); let bx = M
      cols.forEach((c, ci) => { rect(bx, y - bh, c.w, bh); if (ci === 3) center('Balance', bx + c.w / 2, y - 13, 9, bold); if (ci === 4) center(fmtMoney((qVat ? t.total : t.taxable) - adv), bx + c.w / 2, y - 13, 9.5, bold); bx += c.w })
      y -= bh
    }
  }
  if (isInv) {
    const rh = 22; let x = M
    const gw = cols[0].w + cols[1].w
    if (t.discount > 0) {
      rect(x, y - 18, gw, 18); center(`Less discount${doc.discount_type === 'percent' ? ` ${Number(doc.discount_value)}%` : ''} (VAT on the discounted amount)`, x + gw / 2, y - 12, 8.5)
      let dx = x + gw; cols.slice(2).forEach((c, i) => { rect(dx, y - 18, c.w, 18); if (i === 2) right(`- ${fmtMoney(t.discount)}`, dx + c.w - 4, y - 12, 9); dx += c.w }); y -= 18
    }
    rect(x, y - rh, gw, rh); center('Grand Total', x + gw / 2, y - 14, 9.5, bold); x += gw
    const tv = ['', '', fmtMoney(t.taxable), fmtMoney(t.vat), fmtMoney(t.total)]
    cols.slice(2).forEach((c, i) => { rect(x, y - rh, c.w, rh); if (tv[i]) right(tv[i], x + c.w - 4, y - 14, 9.5, bold); x += c.w })
    y -= rh
    if (t.zeroBase > 0 || t.exemptBase > 0) { rect(M, y - 16, CW, 16); text(`VAT summary: standard-rated ${fmtMoney(t.standardBase)}${t.zeroBase ? ` · zero-rated ${fmtMoney(t.zeroBase)}` : ''}${t.exemptBase ? ` · exempt / out of scope ${fmtMoney(t.exemptBase)}` : ''}`, M + 4, y - 11, 8); y -= 16 }
    if (isCn && tp.showWords) { y -= 4; for (const l of wrap(`Amount in Words: - ${amountInWords(t.total).replace(/^UAE Dirhams /, '')}`, bold, 10, CW)) { text(l, M, y - 10, 10, bold); y -= 13 }; y -= 6 }
  }
  if (isInv && !isCn) {
    if (y - 46 < bottom) newPage()
    const pw = 100, vw = 80, ww = CW - pw - vw, paid = paidShown
    rect(M, y - 44, ww, 44); const words = tp.showWords ? wrap(`Amount in Words: - ${amountInWords(t.total).replace(/^UAE Dirhams /, '')}`, bold, 10, ww - 12) : []
    words.slice(0, 3).forEach((l, i) => text(l, M + 6, y - 16 - i * 12 + (words.length > 2 ? 6 : 0), 10, bold))
    rect(M + ww, y - 22, pw, 22); if (adv > 0) { center('Paid Amount', M + ww + pw / 2, y - 11, 10, bold); center(`incl. advance ${fmtMoney(adv)}`, M + ww + pw / 2, y - 19, 6.5) } else center('Paid Amount', M + ww + pw / 2, y - 15, 10, bold); rect(M + ww + pw, y - 22, vw, 22); right(fmtMoney(paid), M + CW - 4, y - 15, 10, bold)
    rect(M + ww, y - 44, pw, 22); center('Total Balance', M + ww + pw / 2, y - 37, 10, bold); rect(M + ww + pw, y - 44, vw, 22); right(fmtMoney(t.total - paid), M + CW - 4, y - 37, 10, bold)
    y -= 56
  }

  // closing / terms / bank / signatures
  const ensure = (h: number) => { if (y - h < bottom) newPage() }
  if (isQtn && doc.closing) { y -= 6; doc.closing.split('\n').forEach((l, i) => { for (const w of wrap(l, i === 0 ? bold : font, 9.5, CW)) { ensure(12); text(w, M, y - 9, 9.5, i === 0 ? bold : font); y -= 12 } }) }
  // seal + signature sit beside the terms (as on screen); sizes come from Settings (px at 96 dpi → pt × 0.75)
  const showSign = opts.showStamp && tp.showSignature && !!(img.stamp || img.signature || opts.signatoryName)
  const sealPt = (opts.sealSize ?? 140) * 0.75, sigWPt = (opts.signatureWidth ?? 160) * 0.75, sigHPt = sigWPt * 0.75
  const overlap = img.stamp && img.signature ? sealPt * 0.18 : 0
  const signW0 = showSign ? (img.stamp ? sealPt : 0) + (img.signature ? sigWPt - overlap : 0) : 0
  const nameH = opts.signatoryName ? (opts.signatoryTitle ? 24 : 13) : 0
  const signW = Math.max(signW0, opts.signatoryName ? Math.max(bold.widthOfTextAtSize(safe(bold, opts.signatoryName), 9), font.widthOfTextAtSize(safe(font, opts.signatoryTitle ?? ''), 8.5)) + 4 : 0)
  const signH = showSign ? Math.max(img.stamp ? sealPt : 0, img.signature ? sigHPt : 0) + (opts.signSpacing ?? 8) * 0.75 + nameH : 0
  if (showSign && y - signH - 10 < bottom) newPage()                      // the block never splits: move it (and what follows) to a new page
  const signPage = page, sigTop = y - (opts.signSpacing ?? 8) * 0.75 - 4
  const signLeft = opts.signAlign === 'left'
  const tx = showSign && signLeft ? M + signW + 12 : M, tw0 = showSign ? CW - signW - 12 : CW
  const list = (titleS: string, arr: string[]) => {
    if (!arr.length) return; ensure(30); y -= 8; const hx = showSign && page === signPage && y > sigTop - signH - 4 ? tx : M; text(titleS, hx, y - 11, 11.5, bold); const tw = bold.widthOfTextAtSize(titleS, 11.5); page.drawLine({ start: { x: hx, y: y - 13 }, end: { x: hx + tw, y: y - 13 }, thickness: 0.7 }); y -= 18
    // lines beside the seal block are narrower; below it (or on later pages) they use the full width — like the screen float
    const beside = () => showSign && page === signPage && y > sigTop - signH - 4
    arr.forEach((a, i) => {
      const x = beside() ? tx : M, w = beside() ? tw0 : CW
      const ls = wrap(a, font, 10, w - 18)
      if (ls.length * 13 < 200) ensure(ls.length * 13)                    // keep a clause together when it fits on a page
      ls.forEach((l, j) => { ensure(13); if (j === 0) text(`${i + 1}.`, x, y - 9, 10); text(l, x + 18, y - 9, 10); y -= 13 })
    })
  }
  if (isQtn) { list('Terms and Conditions: -', doc.terms); list('Payment Terms: -', doc.payment_terms) }
  if (tp.showBank && opts.bankDetails) { ensure(30); text('Bank Details: -', M, y - 10, 10.5, bold); y -= 15; for (const l of wrap(opts.bankDetails, font, 9, CW)) { ensure(12); text(l, M, y - 8, 9); y -= 11.5 } }
  if (isInv) {
    if (doc.payment_terms.length) { y -= 4; for (const l of wrap(`Payment terms: ${doc.payment_terms.join(' · ')}`, font, 9, CW)) { ensure(12); text(l, M, y - 8, 9); y -= 11.5 } }
    if (tp.showComputerLine) { ensure(20); y -= 8; center('This is a computer-generated report.', W / 2, y - 8, 9, italic); y -= 14 }
  }
  if (tp.footerNote) { y -= 6; for (const l of wrap(tp.footerNote, font, 9.5, CW)) { ensure(12); text(l, M, y - 9, 9.5); y -= 12 } }
  if (isDn && adv > 0) { ensure(16); y -= 6; text('Advance received for this project:', M, y - 9, 9.5, bold); text(`AED ${fmtMoney(adv)}`, M + bold.widthOfTextAtSize('Advance received for this project:', 9.5) + 5, y - 9, 9.5); y -= 13 }
  if (isDn) {
    ensure(70); y -= 34
    text('Delivered By:', M, y, 10, font, red); page.drawLine({ start: { x: M + 68, y: y - 2 }, end: { x: M + 210, y: y - 2 }, thickness: 0.7, color: red }); if (doc.vehicle_no) text(`Vehicle: ${doc.vehicle_no}`, M + 218, y, 9)
    y -= 30; text('Received By:', M, y, 10, font, red); page.drawLine({ start: { x: M + 68, y: y - 2 }, end: { x: M + 210, y: y - 2 }, thickness: 0.7, color: red }); if (doc.receiver_name) text(doc.receiver_name, M + 218, y, 9)
  }
  if (showSign) {
    const x0 = signLeft ? M : W - M - signW, cur = page
    page = signPage
    if (img.stamp) drawImage(img.stamp, x0, sigTop, sealPt, sealPt)
    if (img.signature) drawImage(img.signature, x0 + (img.stamp ? sealPt - overlap : 0), sigTop - Math.max(0, (sealPt - sigHPt) / 2), sigWPt, sigHPt)
    if (opts.signatoryName) {
      const ny = sigTop - Math.max(img.stamp ? sealPt : 0, img.signature ? sigHPt : 0) - 10
      center(opts.signatoryName, x0 + signW / 2, ny, 9, bold); if (opts.signatoryTitle) center(opts.signatoryTitle, x0 + signW / 2, ny - 11, 8.5)
    }
    page = cur
  }
  drawFooter()
  const pages = pdf.getPages()
  if (pages.length > 1) pages.forEach((p, i) => p.drawText(`Page ${i + 1} of ${pages.length}`, { x: W - M - 60, y: 14, size: 7.5, font, color: grey }))
  return pdf.save()
}
