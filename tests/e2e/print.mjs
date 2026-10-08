// Print / PDF / layout QA: real Chromium print engine (page.pdf = "Save as PDF"), A4, multi-page, long text, seal & signature,
// colours, AS numbering, alignment, sidebar, Vehicles & Assets, responsive widths, editor typing speed. Run via scripts/e2e.sh
import { chromium } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import pg from 'pg'

const BASE = process.env.E2E_BASE
const OUT = 'tests/e2e/shots/print'; fs.mkdirSync(OUT, { recursive: true })
const results = []
const ok = (cond, msg) => { results.push([!!cond, msg]); console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`) }
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
const exe = fs.readdirSync('/opt/pw-browsers').filter(d => d.startsWith('chromium-')).map(d => `/opt/pw-browsers/${d}/chrome-linux/chrome`).find(p => fs.existsSync(p))
const browser = await chromium.launch({ executablePath: exe })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const p = await ctx.newPage()
p.on('pageerror', e => ok(false, `JS error on ${p.url()}: ${e.message}`)); p.on('dialog', d => d.accept())
const settle = async (ms = 600) => { await p.waitForLoadState('networkidle').catch(() => {}); await p.waitForTimeout(ms) }
const dlg = () => p.locator('dialog[open]')
const pdfPages = f => Number(/Pages:\s+(\d+)/.exec(execFileSync('pdfinfo', [f]).toString())?.[1] ?? 0)
const png = (f, name) => { try { execFileSync('pdftoppm', ['-png', '-r', '50', f, `${OUT}/${name}`]) } catch {} }
const REF = '/tmp/claude-0/ref'   // the company's real letterhead / stamp / signature (local only, never committed)
const img = (f, fallback) => fs.existsSync(`${REF}/${f}`) ? { name: f, mimeType: f.endsWith('.png') ? 'image/png' : 'image/jpeg', buffer: fs.readFileSync(`${REF}/${f}`) } : fallback
const PNG1 = { name: 'x.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64') }

try {
  console.log('\n[P0] Setup + branding')
  await p.goto(`${BASE}/signup`); await p.getByLabel('Work email').fill('print-owner@alsaqr.test'); await p.getByLabel('Password').fill('correct-horse-battery'); await p.getByRole('button', { name: 'Create account' }).click()
  await p.waitForURL('**/onboarding'); await p.getByLabel('Company name').fill('Al Saqr Al Ahmar Welding & Blacksmith LLC'); await p.getByLabel('Your full name').fill('Print Owner'); await p.getByRole('button', { name: 'Create company' }).click(); await p.waitForURL(`${BASE}/`)
  const co = (await one(`select p.company_id from profiles p join auth.users u on u.id=p.id where u.email='print-owner@alsaqr.test'`)).company_id
  await p.goto(`${BASE}/settings`); await settle()
  for (const [label, file] of [['Letterhead (quotation & delivery note) image', img('img1.png', PNG1)], ['Footer image', img('img3.jpg', PNG1)], ['Company stamp image', img('img4.png', PNG1)], ['Authorised signature image', img('img5.png', PNG1)]]) {
    const f = p.getByLabel(label); await f.setInputFiles(file); await f.locator('xpath=ancestor::form').getByRole('button', { name: 'Upload' }).click(); await settle(800)
  }
  await p.getByLabel('Seal size (px)').fill('150'); await p.getByLabel('Signature width (px)').fill('170'); await p.getByRole('button', { name: 'Save document settings' }).click(); await settle()
  ok((await one(`select value from app_settings where company_id=$1 and key='branding.seal_size'`, [co]))?.value === 150, 'seal / signature size settings saved')

  console.log('\n[P1] AS numbering')
  const yr = new Date().getFullYear()
  ok((await p.locator('#numbering').innerText()).includes(`AS0025180/${yr}`), `Settings → Document numbering previews AS0025180/${yr}`)
  await p.goto(`${BASE}/invoices`); await p.getByRole('button', { name: 'New quotation' }).first().click(); await p.waitForURL(/\/invoices\/[0-9a-f-]{36}$/); await settle()
  const qid = p.url().split('/').pop()
  const n1 = (await one(`select number from invoices where id=$1`, [qid])).number
  ok(n1 === `AS0025180/${yr}`, `new quotation numbered ${n1}`)
  await p.goto(`${BASE}/invoices`); await p.getByRole('button', { name: 'New quotation' }).first().click(); await p.waitForURL(u => /\/invoices\/[0-9a-f-]{36}$/.test(u.href) && !u.href.endsWith(qid)); await settle()
  const n2 = (await one(`select number from invoices where id=$1`, [p.url().split('/').pop()])).number
  ok(n2 === `AS0025181/${yr}` && !/QTN/.test(n1 + n2), `next quotation ${n2} (no QTN/… format)`)

  console.log('\n[P2] Editor: alignment, address, live preview')
  await p.goto(`${BASE}/invoices/${qid}`); await settle()
  await ctx.addCookies([{ name: 'sf-locale', value: 'ar', url: BASE }]); await p.reload(); await settle()
  ok(await p.evaluate(() => document.documentElement.dir) === 'rtl', 'Arabic UI → page is RTL')
  const name = p.getByLabel('Company name'); await name.fill('ABC Contracting LLC')
  const dir = await name.evaluate(el => getComputedStyle(el).direction)
  ok(dir === 'ltr', `English customer name stays left-to-right inside the RTL page (computed direction: ${dir})`)
  await name.fill('شركة الصقر للمقاولات')
  ok(await name.evaluate(el => getComputedStyle(el).direction) === 'rtl', 'Arabic customer name aligns right automatically')
  await ctx.addCookies([{ name: 'sf-locale', value: 'en', url: BASE }]); await p.reload(); await settle()
  await p.getByLabel('Company name').fill('ABC Contracting LLC')
  const ADDR = 'Office 1204, Al Saqr Business Tower\nSheikh Zayed Road, Plot 345-678\nAl Barsha Heights (Tecom)\nP.O. Box 123456\nDubai\nUnited Arab Emirates'
  await p.getByLabel('Address').fill(ADDR)
  await p.getByLabel('Line 1 description').fill('Supply, fabrication and installation of mild steel staircase with handrail, primer and two coats of enamel paint, including all fixing accessories and site clean-up')
  await p.getByLabel('Rate (AED)').fill('25000')
  await p.waitForTimeout(400)
  const dd = await p.locator('.sales-paper .paper-pair', { hasText: 'Address:' }).locator('dd').innerText()
  ok(dd.split('\n').length >= 6 && dd.includes('Sheikh Zayed Road'), 'address keeps its line breaks in the preview (no merged words)')
  const t0 = Date.now(); await p.getByLabel('Line 1 description').pressSequentially(' — extra words typed quickly to measure input latency', { delay: 0 }); const typing = Date.now() - t0
  ok(typing < 4000, `typing 55 characters in the editor takes ${typing} ms (preview renders deferred)`)
  await p.keyboard.press('Control+s'); await settle(1200)
  ok((await one(`select customer_address from invoices where id=$1`, [qid])).customer_address === ADDR, 'address saved with its line breaks')

  console.log('\n[P3] Print / PDF scenarios (Chromium print engine, A4 portrait)')
  const cid = (await one(`insert into customers(company_id,name,address,trn,phone,email,contact_person) values ($1,'Gulf Steel Structures LLC','Warehouse 7, ICAD 2, Musaffah, Abu Dhabi','100123456700003','+971 50 123 4567','buyer@gulfsteel.ae','Mr. Rashid') returning id`, [co])).id
  const LONGWORD = 'ThisIsAnExtremelyLongUnbrokenWordThatWouldNormallyPushTheTableOutsideThePrintablePageAreaUnlessItWrapsCorrectly'.repeat(2)
  const URL = 'https://www.example-supplier-catalogue.ae/products/steel-sections/rhs-100x50x3mm/specification-sheet-v2.pdf?download=true&ref=AS0025180'
  const term = i => `Clause ${i}: The client shall provide clear access to site, temporary power, water and a secure storage area for materials throughout the installation period; any delay caused by others is excluded from the programme.`
  const mk = async (label, o) => {
    const { id } = await one(`insert into invoices(company_id,doc_type,number,status,issue_date,valid_until,customer_id,customer_name,customer_address,attention,site,subject,intro,closing,vat_rate,terms,payment_terms,total,subtotal)
      values ($1,'quotation',$2,'draft',current_date,current_date+30,$3,$4,$5,'Mr. Rashid',$6,$7,$8,$9,5,$10,$11,0,0) returning id`,
      [co, `AS00${label}/${yr}`, cid, o.customer ?? 'Gulf Steel Structures LLC', o.address ?? 'Warehouse 7, ICAD 2, Musaffah, Abu Dhabi', 'Villa 22, Fujairah', 'Steel works', 'Dear Sir/Mam,\nThank You so much for kind enquiry, please see our best offer for the requested work',
        'NB. Vat 5% Will Be Applied on Above Quote\nWe Hope Above Meets your Approval And look Forward to Receive Your Order/Comments in Return.', o.terms ?? ['Quote validity: - 30 Days'], ['60% Advance Payment', '30% Materials on site', '10% after completion of works']])
    for (const [i, it] of o.items.entries()) await db.query(`insert into invoice_items(company_id,invoice_id,position,description,materials,quantity,unit,unit_price) values ($1,$2,$3,$4,$5,$6,$7,$8)`, [co, id, i, it.d, it.m ?? null, it.q ?? 1, it.u ?? 'Nos', it.p ?? 1000])
    return id
  }
  const item = i => ({ d: `Fabrication and installation of steel item ${i + 1} as per approved shop drawing`, q: (i % 4) + 1, u: i % 3 ? 'Nos' : 'Sq.Mtr', p: 1250 + i * 10 })
  const cases = [
    ['T1-one-item', { items: [item(0)] }],
    ['T2-ten-items', { items: Array.from({ length: 10 }, (_, i) => item(i)) }],
    ['T3-long-description', { items: [{ d: `Supply and installation of ${LONGWORD} including ${URL} and all accessories.\nSecond paragraph of the description with more scope details, finishes and exclusions that runs over several lines.`, m: `MS hollow section ${LONGWORD}`, q: 1, p: 25000 }, item(1)] }],
    ['T4-long-address', { items: [item(0)], customer: 'Al Saqr Al Ahmar International General Contracting & Steel Fabrication Company LLC (Branch 2)', address: 'Office 1204, Al Saqr Business Tower, 12th Floor\nSheikh Zayed Road, Plot 345-678\nAl Barsha Heights (Tecom)\nP.O. Box 123456\nDubai\nUnited Arab Emirates' }],
    ['T5-long-terms', { items: [item(0), item(1)], terms: Array.from({ length: 14 }, (_, i) => term(i + 1)) }],
    ['T6-two-pages', { items: Array.from({ length: 24 }, (_, i) => item(i)) }],
  ]
  await p.emulateMedia({ media: 'print' })
  // print layout happens against the 210mm page box, so measure with a page-sized viewport
  const pr = await ctx.newPage(); await pr.emulateMedia({ media: 'print' }); await pr.setViewportSize({ width: 794, height: 1123 })
  for (const [label, o] of cases) {
    const id = await mk(label, o)
    await pr.goto(`${BASE}/print/sales/${id}`); await pr.waitForLoadState('networkidle'); await pr.waitForTimeout(300)
    const m = await pr.evaluate(() => {
      const paper = document.querySelector('.sales-paper'), r = paper.getBoundingClientRect()
      let over = 0, worst = ''
      for (const el of paper.querySelectorAll('*')) { const b = el.getBoundingClientRect(); if (b.width && b.right > r.right + 0.5) { over++; worst ||= el.className || el.tagName } }
      const tbl = paper.querySelector('.paper-items').getBoundingClientRect(), tdW = paper.querySelector('.paper-frame').getBoundingClientRect().width
      const seal = paper.querySelector('img[alt="Company seal"]')?.getBoundingClientRect(), sig = paper.querySelector('img[alt="Authorised signature"]')?.getBoundingClientRect()
      const box = getComputedStyle(paper.querySelector('.paper-box'))
      return { w: r.width, over, worst, table: Math.round(tbl.width), frame: Math.round(tdW), seal: seal && Math.round(seal.width), sig: sig && Math.round(sig.width), adjust: getComputedStyle(paper).printColorAdjust || getComputedStyle(paper).webkitPrintColorAdjust, boxBg: box.backgroundColor }
    })
    const f = `${OUT}/${label}.pdf`
    await pr.pdf({ path: f, preferCSSPageSize: true, printBackground: true })
    const pages = pdfPages(f); png(f, label)
    ok(Math.abs(m.w - 793.7) < 1.5 && m.over === 0 && Math.abs(m.table - m.frame) <= 1, `${label}: A4 width ${m.w.toFixed(1)}px, nothing outside the page (${m.over}${m.worst ? ' ' + m.worst : ''}), table fills width (${m.table}/${m.frame})`)
    ok(pages >= 1 && (label === 'T6-two-pages' ? pages >= 2 : label === 'T5-long-terms' ? pages <= 3 : /T2|T3/.test(label) ? pages <= 2 : pages === 1), `${label}: Save-as-PDF → ${pages} page(s)`)
    if (label === 'T1-one-item') ok(m.seal === 150 && m.sig === 170 && m.adjust === 'exact' && m.boxBg !== 'rgba(0, 0, 0, 0)', `seal ${m.seal}px / signature ${m.sig}px as configured; print-color-adjust: ${m.adjust}; shaded boxes print (${m.boxBg})`)
    const api = await ctx.request.get(`${BASE}/api/sales/${id}/pdf`); const fa = `${OUT}/${label}-download.pdf`; fs.writeFileSync(fa, await api.body())
    ok(api.ok() && pdfPages(fa) >= 1, `${label}: “PDF” download button → ${pdfPages(fa)} page(s)`); png(fa, `${label}-download`)
  }
  const two = `${OUT}/T6-two-pages.pdf`
  const txt = execFileSync('pdftotext', ['-layout', two, '-']).toString().split('\f')
  ok(txt.length >= 2 && txt[1].includes('DESCRIPTION') && txt[1].includes('QTY'), 'page 2 repeats the items table header')
  // the footer is an image: every page must carry it (pdfimages lists images per page)
  // header + footer are images: every page must carry at least both (pdfimages lists image draws per page)
  const perPage = {}; for (const l of execFileSync('pdfimages', ['-list', two]).toString().split('\n').slice(2)) { const pg = l.trim().split(/\s+/)[0]; if (pg) perPage[pg] = (perPage[pg] ?? 0) + 1 }
  const nPages = pdfPages(two), framed = Array.from({ length: nPages }, (_, i) => perPage[i + 1] ?? 0)
  ok(!fs.existsSync(`${REF}/img3.jpg`) || framed.every(n => n >= 2), `letterhead + footer printed on every page (images per page: ${framed.join(', ')})`)
  const rows24 = new Set(txt.join('\n').match(/steel item \d+/g) ?? []).size
  ok(rows24 === 24, `no item row lost or split across pages (${rows24}/24 rows intact)`)
  await pr.close(); await p.emulateMedia({ media: 'screen' })

  console.log('\n[P4] Sidebar')
  await p.goto(`${BASE}/invoices/${qid}`); await settle()
  const mainW = async () => p.locator('main').evaluate(el => el.getBoundingClientRect().width)
  const before = await mainW()
  await p.getByRole('button', { name: 'Collapse sidebar' }).click(); await p.waitForTimeout(400)
  const asideW = await p.locator('aside[data-collapsed]').evaluate(el => el.getBoundingClientRect().width)
  ok(asideW <= 61, `collapsed sidebar is an icon rail (${asideW}px)`)
  ok(await mainW() > before + 150, `workspace expands (${Math.round(before)} → ${Math.round(await mainW())} px)`)
  await p.locator('aside[data-collapsed] a[href="/assets"]').hover(); await p.waitForTimeout(200)
  ok((await p.getByRole('tooltip').innerText().catch(() => '')).includes('Vehicles & Assets'), 'tooltip shows the menu label on hover')
  await p.reload(); await settle()
  ok(await p.locator('aside[data-collapsed]').getAttribute('data-collapsed') === 'true', 'collapsed state persists after reload (no flash)')
  await p.getByRole('button', { name: 'Expand sidebar' }).click(); await p.waitForTimeout(300)
  ok(!(await p.locator('aside').first().innerText()).includes('SOON') || !(await p.locator('aside[data-collapsed]').innerText()).match(/Vehicles & Assets\s*SOON/i), 'Vehicles & Assets no longer marked “Soon”')

  console.log('\n[P5] Vehicles & Assets')
  const emp = (await one(`insert into employees(company_id,employee_no,full_name) values ($1,'EMP-010','Imran Driver') returning id`, [co])).id
  await p.goto(`${BASE}/assets`); await settle()
  await p.getByRole('button', { name: 'Add vehicle' }).first().click()
  await dlg().getByLabel('Vehicle name *').fill('Nissan Navara – workshop'); await dlg().getByLabel('Plate number').fill('K 45821'); await dlg().getByLabel('Plate emirate').selectOption('Dubai')
  await dlg().getByLabel('Vehicle type').selectOption('Pickup'); await dlg().getByLabel('Make').fill('Nissan'); await dlg().getByLabel('Model').fill('Navara'); await dlg().getByLabel('Year').fill('2022')
  await dlg().getByLabel('Registration expiry').fill(new Date(Date.now() + 20 * 864e5).toISOString().slice(0, 10)); await dlg().getByLabel('Insurance company').fill('Orient Insurance')
  await dlg().getByLabel('Insurance expiry').fill(new Date(Date.now() + 200 * 864e5).toISOString().slice(0, 10)); await dlg().getByLabel('Assigned driver').selectOption(emp)
  await dlg().getByRole('button', { name: 'Save vehicle' }).click(); await p.waitForURL(/\/assets\/[0-9a-f-]{36}$/); await settle()
  const vid = p.url().split('/').pop()
  ok((await p.locator('main').innerText()).includes('Mulkiya / registration') && (await p.locator('main').innerText()).includes('Imran Driver'), 'vehicle created: details, assigned employee, Mulkiya deadline shown')
  ok((await one(`select count(*)::int n from reminder_sources where source_id=$1`, [vid])).n === 2, 'Mulkiya + insurance expiry feed the reminder engine')
  await p.goto(`${BASE}/assets/${vid}?tab=documents`); await settle()
  await p.getByRole('button', { name: 'Upload' }).click(); await dlg().getByLabel('Document type').selectOption('inspection'); await dlg().getByLabel('Expiry date').fill(new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10))
  await dlg().locator('input[type=file]').setInputFiles({ name: 'inspection.pdf', mimeType: 'application/pdf', buffer: fs.readFileSync(`${OUT}/T1-one-item.pdf`) }); await dlg().getByRole('button', { name: 'Upload' }).click(); await settle(1200)
  ok((await one(`select count(*)::int n from documents where owner_type='asset' and owner_id=$1 and reminders_active and expiry_date is not null`, [vid])).n === 1, 'inspection document attached with its own expiry reminder')
  await p.getByRole('button', { name: 'Edit' }).click(); await dlg().getByLabel('Status').selectOption('in_maintenance'); await dlg().getByRole('button', { name: 'Save' }).click(); await settle()
  ok((await one(`select status from assets where id=$1`, [vid])).status === 'in_maintenance', 'edit works (status → In maintenance)')
  await p.goto(`${BASE}/assets?tab=assets`); await p.getByRole('button', { name: 'Add asset' }).first().click()
  await dlg().getByLabel('Asset name *').fill('Lincoln MIG welding machine'); await dlg().getByLabel('Category').fill('Welding Machine'); await dlg().getByLabel('Asset code').fill('AST-0001')
  await dlg().getByLabel('Serial number').fill('LN-889912'); await dlg().getByLabel('Purchase price (AED)').fill('18500'); await dlg().getByLabel('Current location').fill('Workshop – Musaffah')
  await dlg().getByLabel('Warranty expiry').fill(new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10))
  await dlg().getByRole('button', { name: 'Save asset' }).click(); await p.waitForURL(/\/assets\/[0-9a-f-]{36}$/); await settle()
  const aid = p.url().split('/').pop()
  await p.goto(`${BASE}/assets?tab=assets&q=LN-889912`); await settle()
  ok((await p.locator('main').innerText()).includes('Lincoln MIG welding machine'), 'search by serial number finds the asset')
  await p.goto(`${BASE}/assets?tab=vehicles&due=30`); await settle()
  ok((await p.locator('main').innerText()).includes('Nissan Navara'), 'filter “expiring within 30 days” lists the vehicle')
  await p.goto(`${BASE}/assets/${aid}`); await settle(); await p.getByRole('button', { name: 'Archive' }).click(); await settle(1000)
  ok((await one(`select archived_at is not null a from assets where id=$1`, [aid])).a && (await one(`select count(*)::int n from reminder_sources where source_id=$1`, [aid])).n === 0, 'archive keeps the record and stops its reminders')
  await p.getByRole('button', { name: 'Restore' }).click(); await settle(800)
  ok((await one(`select archived_at is null a from assets where id=$1`, [aid])).a, 'restore works')
  await p.goto(`${BASE}/`); await settle()
  ok(/Warranty: Lincoln MIG welding machine expires in \d+ days/.test(await p.locator('main').innerText()), 'dashboard priority alerts include asset deadlines')

  console.log('\n[P6] Responsive (screen) — print stays A4')
  for (const [w, h] of [[1920, 1080], [1440, 900], [1366, 768], [820, 1180], [390, 844]]) {
    const r = await browser.newContext({ viewport: { width: w, height: h }, storageState: await ctx.storageState() }); const rp = await r.newPage()
    for (const path of [`/invoices/${qid}`, '/assets', '/invoices']) {
      await rp.goto(`${BASE}${path}`); await rp.waitForLoadState('networkidle')
      const sw = await rp.evaluate(() => document.documentElement.scrollWidth)
      ok(sw <= w + 1, `${w}px ${path}: no horizontal page scroll (${sw}px)`)
    }
    await rp.goto(`${BASE}/invoices/${qid}`); await rp.waitForLoadState('networkidle'); await rp.waitForTimeout(400)
    await rp.screenshot({ path: `${OUT}/editor-${w}.png` }); await r.close()
  }
} catch (e) { ok(false, `aborted: ${e.stack || e}`) }
finally {
  await browser.close(); await db.end()
  const failed = results.filter(r => !r[0]).length
  console.log(`\nPrint/layout e2e: ${results.length - failed}/${results.length} passed`)
  process.exit(failed ? 1 : 0)
}
