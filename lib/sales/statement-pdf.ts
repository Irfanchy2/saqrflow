import 'server-only'
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib'
import { fmtMoney } from './money'
import type { Ledger } from '../ledger'
import type { BrandKind } from './data'
import type { StatementCustomer } from '@/components/sales/statement'
import type { StatementType } from '../statement-params'
import { unpaidStatement } from './unpaid-statement'

const fd = (iso?: string | null) => (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '-')

/** A4 statement of account (same content and order as the on-screen / print statement). */
export async function renderStatementPdf(cu: StatementCustomer, l: Ledger, o: {
  companyName: string; images: Partial<Record<BrandKind, { bytes: Uint8Array; png: boolean }>>; showHeaderFooter: boolean; companyTrn?: string | null; bankDetails?: string | null
  from?: string; to?: string; today: string; companyAddress?: string | null; companyPhone?: string | null; companyEmail?: string | null
  /** full statement of account (default) or only the unpaid invoices */
  type?: StatementType; project?: string; projectName?: string | null
}): Promise<Uint8Array> {
  const unpaid = o.type === 'unpaid'
  const pdf = await PDFDocument.create()
  pdf.setTitle(`${unpaid ? 'Statement of unpaid invoices' : 'Statement of account'}: ${cu.name}`); pdf.setCreator('Averiqo'); pdf.setProducer('Averiqo')
  const font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold), it = await pdf.embedFont(StandardFonts.HelveticaOblique)
  const img: Partial<Record<BrandKind, PDFImage>> = {}
  for (const [k, v] of Object.entries(o.images)) { try { img[k as BrandKind] = v!.png ? await pdf.embedPng(v!.bytes) : await pdf.embedJpg(v!.bytes) } catch { /* skip */ } }
  const W = 595.28, H = 841.89, M = 28, CW = W - 2 * M, black = rgb(0, 0, 0), boxBg = rgb(0.953, 0.941, 0.918)
  const footer = o.showHeaderFooter ? img.footer : undefined, bottom = footer ? 80 : 36
  const safe = (f: PDFFont, s: string) => [...(s ?? '')].map(ch => { try { f.encodeText(ch); return ch } catch { return '?' } }).join('')
  const wrap = (s: string, f: PDFFont, size: number, width: number) => {
    const out: string[] = []
    for (const para of (s || '').split(/\r?\n/).map(x => safe(f, x))) { let line = ''; for (const w of para.split(/\s+/)) { const t = line ? `${line} ${w}` : w; if (f.widthOfTextAtSize(t, size) <= width) line = t; else { if (line) out.push(line); line = w } } out.push(line) }
    return out
  }
  let page: PDFPage = pdf.addPage([W, H]), y = H - M
  const text = (s: string, x: number, yy: number, size = 9, f: PDFFont = font) => page.drawText(safe(f, s), { x, y: yy, size, font: f, color: black })
  const right = (s: string, xr: number, yy: number, size = 9, f: PDFFont = font) => text(s, xr - f.widthOfTextAtSize(safe(f, s), size), yy, size, f)
  const center = (s: string, xc: number, yy: number, size = 9, f: PDFFont = font) => text(s, xc - f.widthOfTextAtSize(safe(f, s), size) / 2, yy, size, f)
  const rect = (x: number, yy: number, w: number, h: number, fill?: ReturnType<typeof rgb>) => page.drawRectangle({ x, y: yy, width: w, height: h, color: fill, borderColor: black, borderWidth: 0.75 })
  const image = (im: PDFImage, x: number, yy: number, maxW: number, maxH: number) => { const s = Math.min(maxW / im.width, maxH / im.height); page.drawImage(im, { x: x + (maxW - im.width * s) / 2, y: yy - im.height * s, width: im.width * s, height: im.height * s }); return im.height * s }
  const drawFooter = () => { if (footer) image(footer, M, 72, CW, 52) }
  const newPage = () => { drawFooter(); page = pdf.addPage([W, H]); y = H - M }

  if (o.showHeaderFooter) {
    if (img.header) y -= image(img.header, M, y, CW, 82) + 8
    else { center(o.companyName, W / 2, y - 14, 15, bold); y -= 22; const c = [o.companyAddress, o.companyPhone && `Tel: ${o.companyPhone}`, o.companyEmail].filter(Boolean).join('  ·  '); if (c) { center(c, W / 2, y - 6, 8.5); y -= 14 } }
  }
  center(unpaid ? 'STATEMENT OF UNPAID INVOICES' : 'STATEMENT OF ACCOUNT', W / 2, y - 12, 13, bold); y -= 22
  if (o.companyTrn) { center(`TRN: ${o.companyTrn}`, W / 2, y - 4, 9, bold); y -= 12 }
  const left = [['Customer:', cu.name], ...(cu.contact_person ? [['Attention:', cu.contact_person]] : []), ...(cu.trn ? [['TRN:', cu.trn]] : []), ...(cu.address ? [['Address:', cu.address]] : []), ...(cu.phone ? [['Tel:', cu.phone]] : []), ...(cu.email ? [['Email:', cu.email]] : [])]
  const u = unpaid ? unpaidStatement(l, { from: o.from, to: o.to, project: o.project }, o.today) : null
  const rightRows = u ? [['Date:', fd(o.today)], ...(o.from || o.to ? [['Invoices:', `${o.from ? fd(o.from) : 'Start'} - ${fd(o.to ?? o.today)}`]] : []), ...(o.projectName ? [['Project:', o.projectName]] : []),
    ['Unpaid:', `${u.rows.length} invoice${u.rows.length === 1 ? '' : 's'}`], ['Balance due:', `AED ${fmtMoney(u.netDue ?? u.totals.balance)}`]]
    : [['Date:', fd(o.today)], ['Period:', `${o.from ? fd(o.from) : 'Start'} - ${fd(o.to ?? o.today)}`], ['Opening:', fmtMoney(l.opening)], ['Closing:', `AED ${fmtMoney(l.closing)}`]]
  const lw = CW - 170, lines = left.map(([k, v]) => [k, wrap(v, font, 9, lw - 90)] as const)
  const bh = Math.max(lines.reduce((s, [, ls]) => s + ls.length * 12, 0), rightRows.length * 12) + 12
  rect(M, y - bh, lw, bh, boxBg); rect(M + lw + 10, y - bh, CW - lw - 10, bh, boxBg)
  let ly = y - 14; for (const [k, ls] of lines) { text(k, M + 8, ly, 9, bold); ls.forEach((x, i) => text(x, M + 82, ly - i * 12)); ly -= ls.length * 12 }
  rightRows.forEach(([k, v], i) => { text(k, M + lw + 18, y - 14 - i * 12, 9, bold); text(v, M + lw + 70, y - 14 - i * 12) })
  y -= bh + 12

  if (u) {
    // unpaid invoices only: SR, invoice, date, LPO / ref, due, amount, paid, balance, days late; then ageing and the total due
    const uc = [{ h: 'SR', w: 24 }, { h: 'Invoice No.', w: 82 }, { h: 'Date', w: 56 }, { h: 'LPO / Ref.', w: CW - 24 - 82 - 56 - 56 - 68 - 62 - 70 - 40 }, { h: 'Due date', w: 56 }, { h: 'Amount', w: 68 }, { h: 'Paid', w: 62 }, { h: 'Balance', w: 70 }, { h: 'Days late', w: 40 }]
    const uh = () => { let x = M; for (const c of uc) { rect(x, y - 18, c.w, 18); center(c.h, x + c.w / 2, y - 12, 8, bold); x += c.w }; y -= 18 }
    const urow = (vals: string[], b = false) => {
      const ref = wrap(vals[3], font, 8, uc[3].w - 6), rh = Math.max(16, ref.length * 10 + 6)
      if (y - rh < bottom + 20) { newPage(); uh() }
      let x = M
      uc.forEach((c, i) => { rect(x, y - rh, c.w, rh); const v = vals[i]
        if (i === 3) ref.forEach((d, j) => center(d, x + c.w / 2, y - 11 - j * 10, 8))
        else if (v) (i >= 5 && i <= 7 ? right(v, x + c.w - 4, y - rh / 2 - 3, 8.5, b || i === 7 ? bold : font) : center(v, x + c.w / 2, y - rh / 2 - 3, 8.5, b ? bold : font))
        x += c.w })
      y -= rh
    }
    if (!u.rows.length) { center(`No unpaid invoices${o.from || o.to || o.project ? ' for this selection' : ''}. Thank you.`, W / 2, y - 20, 11, bold); y -= 40 }
    else {
      uh()
      u.rows.forEach((i, k) => urow([String(k + 1).padStart(2, '0'), i.number, fd(i.issue_date), i.lpo_ref || i.reference || '-', fd(i.due_date), fmtMoney(i.total), i.paid ? fmtMoney(i.paid) : '-', fmtMoney(i.balance), i.daysOverdue ? String(i.daysOverdue) : '-']))
      urow(['', '', '', 'Total', '', fmtMoney(u.totals.amount), fmtMoney(u.totals.paid), fmtMoney(u.totals.balance), ''], true)
      y -= 10
      if (y - 40 < bottom) newPage()
      const aw = CW / (u.ageing.length + 1); let x = M
      for (const a of [...u.ageing, { label: 'Total', amount: u.totals.balance }]) { rect(x, y - 16, aw, 16, boxBg); center(a.label, x + aw / 2, y - 11, 8, bold); rect(x, y - 32, aw, 16); center(a.amount ? fmtMoney(a.amount) : '-', x + aw / 2, y - 27, 8.5, a.label === 'Total' ? bold : font); x += aw }
      y -= 42
    }
    const lines: [string, string][] = []
    if (u.unapplied !== null) lines.push(['Unpaid invoices:', `AED ${fmtMoney(u.totals.balance)}`], [u.unapplied < 0 ? 'Less: paid on account:' : 'Opening balance:', `${u.unapplied < 0 ? '- ' : ''}AED ${fmtMoney(Math.abs(u.unapplied))}`])
    lines.push(['Total due:', `AED ${fmtMoney(u.netDue ?? u.totals.balance)}`])
    const th = lines.length * 13 + 6
    if (y - th - 8 < bottom) newPage()
    rect(W - M - 220, y - th, 220, th, boxBg)
    lines.forEach(([k, v], i) => { const last = i === lines.length - 1; text(k, W - M - 212, y - 13 - i * 13, 9.5, bold); right(v, W - M - 8, y - 13 - i * 13, 9.5, last ? bold : font) })
    y -= th + 12
    if (o.bankDetails) { text('Bank Details: -', M, y - 8, 10, bold); y -= 13; for (const b of wrap(o.bankDetails, font, 8.5, CW)) { if (y - 12 < bottom) newPage(); text(b, M, y - 8, 8.5); y -= 11 } }
    if (y - 20 < bottom) newPage()
    center('Kindly arrange payment of the balance above. Please inform us of any difference within 15 days. This is a computer-generated statement.', W / 2, y - 12, 8, it)
    drawFooter()
    const pg = pdf.getPages(); if (pg.length > 1) pg.forEach((p, i) => p.drawText(`Page ${i + 1} of ${pg.length}`, { x: W - M - 60, y: 14, size: 7.5, font }))
    return pdf.save()
  }

  const cols = [{ h: 'Date', w: 60 }, { h: 'Reference', w: 80 }, { h: 'Description', w: CW - 60 - 80 - 72 - 72 - 78 }, { h: 'Debit', w: 72 }, { h: 'Credit', w: 72 }, { h: 'Balance', w: 78 }]
  const head = () => { let x = M; for (const c of cols) { rect(x, y - 18, c.w, 18); center(c.h, x + c.w / 2, y - 12, 8.5, bold); x += c.w }; y -= 18 }
  head()
  const row = (vals: string[], b = false) => {
    const desc = wrap(vals[2], font, 8.5, cols[2].w - 8), rh = Math.max(16, desc.length * 10.5 + 6)
    if (y - rh < bottom + 20) { newPage(); head() }
    let x = M
    cols.forEach((c, i) => { rect(x, y - rh, c.w, rh); if (i === 2) desc.forEach((d, j) => text(d, x + 4, y - 11 - j * 10.5, 8.5, b ? bold : font)); else if (i >= 3) { if (vals[i]) right(vals[i], x + c.w - 4, y - rh / 2 - 3, 8.5, b || i === 5 ? bold : font) } else if (vals[i]) center(vals[i], x + c.w / 2, y - rh / 2 - 3, 8.5, b ? bold : font); x += c.w })
    y -= rh
  }
  for (const e of l.entries) row([fd(e.date), e.ref || '-', e.description, e.debit ? fmtMoney(e.debit) : '', e.credit ? fmtMoney(e.credit) : '', fmtMoney(e.balance)])
  row(['', '', 'Totals for the period', fmtMoney(l.totalDebit), fmtMoney(l.totalCredit), fmtMoney(l.closing)], true)
  y -= 10
  const open = l.invoices.filter(i => i.balance > 0.004)
  if (open.length) {
    if (y - 50 < bottom) newPage()
    text('Open invoices', M, y - 10, 10.5, bold); y -= 16
    const oc = [{ h: 'Invoice', w: 100 }, { h: 'Date', w: 70 }, { h: 'Due', w: 70 }, { h: 'Amount', w: 95 }, { h: 'Balance', w: 95 }, { h: 'Days overdue', w: CW - 430 }]
    const oh = () => { let x = M; for (const c of oc) { rect(x, y - 16, c.w, 16); center(c.h, x + c.w / 2, y - 11, 8.5, bold); x += c.w }; y -= 16 }
    oh()
    for (const i of open) { if (y - 16 < bottom + 20) { newPage(); oh() } let x = M; [i.number, fd(i.issue_date), fd(i.due_date), fmtMoney(i.total), fmtMoney(i.balance), i.daysOverdue ? String(i.daysOverdue) : '-'].forEach((v, k) => { rect(x, y - 16, oc[k].w, 16); k >= 3 && k <= 4 ? right(v, x + oc[k].w - 4, y - 11, 8.5, k === 4 ? bold : font) : center(v, x + oc[k].w / 2, y - 11, 8.5); x += oc[k].w }); y -= 16 }
    y -= 8
  }
  if (y - 40 < bottom) newPage()
  rect(W - M - 200, y - 32, 200, 32, boxBg); text('Total due:', W - M - 192, y - 13, 9.5, bold); right(`AED ${fmtMoney(l.outstanding)}`, W - M - 8, y - 13, 9.5, bold)
  text('Overdue:', W - M - 192, y - 26, 9.5, bold); right(`AED ${fmtMoney(l.overdue)}`, W - M - 8, y - 26, 9.5); y -= 44
  if (o.bankDetails) { text('Bank Details: -', M, y - 8, 10, bold); y -= 13; for (const b of wrap(o.bankDetails, font, 8.5, CW)) { if (y - 12 < bottom) newPage(); text(b, M, y - 8, 8.5); y -= 11 } }
  if (y - 20 < bottom) newPage()
  center('Please review this statement and inform us of any difference within 15 days. This is a computer-generated statement.', W / 2, y - 12, 8, it)
  drawFooter()
  const pages = pdf.getPages(); if (pages.length > 1) pages.forEach((p, i) => p.drawText(`Page ${i + 1} of ${pages.length}`, { x: W - M - 60, y: 14, size: 7.5, font }))
  return pdf.save()
}
