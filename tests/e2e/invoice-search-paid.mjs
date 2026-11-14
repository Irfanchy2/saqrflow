// Sales search + PAID stamp: search as you type on every sales tab (tax invoices, quotations, payments, receivables,
// follow-ups) by customer name, short name and number; a fully paid tax invoice carries a PAID stamp with the last
// payment date on screen, in the print view and in the PDF; partly paid / unpaid / credited invoices do not.
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import pg from 'pg'
import { execFileSync } from 'node:child_process'

const BASE = process.env.E2E_BASE
const OUT = 'tests/e2e/shots/invoice-search-paid'; fs.mkdirSync(OUT, { recursive: true })
const results = []
const ok = (cond, msg) => { results.push([!!cond, msg]); console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`) }
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
const exe = fs.readdirSync('/opt/pw-browsers').filter(d => d.startsWith('chromium-')).map(d => `/opt/pw-browsers/${d}/chrome-linux/chrome`).find(p => fs.existsSync(p))
const browser = await chromium.launch({ executablePath: exe })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const p = await ctx.newPage()
const jsErrors = []; p.on('pageerror', e => jsErrors.push(`${p.url()}: ${e.message}`))
const settle = async (ms = 500) => { await p.waitForLoadState('networkidle').catch(() => {}); await p.waitForTimeout(ms) }
const waitFor = async (fn, ms = 12000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn().catch(() => null); if (v) return v; await new Promise(r => setTimeout(r, 300)) } return null }
const day = n => { const x = new Date(Date.now() + 4 * 3600e3); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const EMAIL = `paid-${Date.now()}@alsaqr.test`
const body = () => p.locator('main').innerText()

try {
  console.log('\n[0] Setup')
  await p.goto(`${BASE}/signup`); await p.getByLabel('Work email').fill(EMAIL); await p.getByLabel('Password').fill('correct-horse-battery'); await p.getByRole('button', { name: 'Create account' }).click()
  await p.waitForURL('**/onboarding'); await p.getByLabel('Company name').fill('Al Saqr Paid Test'); await p.getByLabel('Your full name').fill('Paid Owner'); await p.getByRole('button', { name: 'Create company' }).click(); await p.waitForURL(`${BASE}/`)
  const co = (await one(`select p.company_id from profiles p join auth.users u on u.id=p.id where u.email=$1`, [EMAIL])).company_id
  const gtsc = (await one(`insert into customers(company_id,name,phone) values ($1,'Gulf Technical Safety Training Centre-GTSC','04 555 0001') returning id`, [co])).id
  const other = (await one(`insert into customers(company_id,name,phone) values ($1,'Falcon Towers LLC','04 555 0002') returning id`, [co])).id
  const inv = async (number, cust, name, total, status = 'sent') => {
    const id = (await one(`insert into invoices(company_id,doc_type,number,customer_id,customer_name,total,status,issue_date,due_date) values ($1,'invoice',$2,$3,$4,$5,$6,$7,$8) returning id`, [co, number, cust, name, total, status, day(-40), day(-10)])).id
    await db.query(`insert into invoice_items(company_id,invoice_id,position,description,quantity,unit_price) values ($1,$2,1,'Steel works',1,$3)`, [co, id, Math.round(total / 1.05 * 100) / 100])
    return id
  }
  const paidInv = await inv('INV-G1', gtsc, 'GTSC', 10500)
  const partInv = await inv('INV-G2', gtsc, 'Gulf Technical Safety Training Centre-GTSC', 4200)
  const otherInv = await inv('INV-F1', other, 'Falcon Towers LLC', 2100)
  await db.query(`insert into payments(company_id,invoice_id,amount,paid_on,method,reference) values ($1,$2,6000,$3,'bank_transfer','TT-GTSC-1'),($1,$2,4500,$4,'cheque','CHQ-778')`, [co, paidInv, day(-20), day(-3)])
  await db.query(`insert into payments(company_id,invoice_id,amount,paid_on,method,reference) values ($1,$2,1000,$3,'cash','RCPT-9')`, [co, partInv, day(-5)])
  const qt = (await one(`insert into invoices(company_id,doc_type,number,customer_id,customer_name,total,status,issue_date,valid_until) values ($1,'quotation','AS-G9/2026',$2,'GTSC',9000,'sent',$3,$4) returning id`, [co, gtsc, day(-2), day(28)])).id
  await db.query(`insert into sales_followups(company_id,invoice_id,due_date,note) values ($1,$2,$3,'Call GTSC procurement')`, [co, qt, day(-1)]).catch(() => {})
  const st = await one(`select (select status from invoices where id=$1) a, (select status from invoices where id=$2) b`, [paidInv, partInv])
  ok(st.a === 'paid' && st.b === 'partially_paid', `seeded GTSC invoices: one fully paid (${st.a}), one partly paid (${st.b}), plus another customer`)

  console.log('\n[1] Search as you type: tax invoices')
  await p.goto(`${BASE}/invoices?tab=invoice`); await settle()
  const box = p.getByRole('searchbox', { name: 'Search tax invoices' })
  ok(await box.isVisible(), 'search box visible on the Tax invoices tab')
  await box.click(); await box.pressSequentially('GTSC', { delay: 60 })
  ok(await waitFor(async () => new URL(p.url()).searchParams.get('q') === 'GTSC'), 'results update without pressing Enter')
  await settle(600)
  let txt = await body()
  ok(txt.includes('INV-G1') && txt.includes('INV-G2') && !txt.includes('INV-F1'), 'GTSC finds both GTSC invoices (short name and full name), not the other customer')
  ok(await p.evaluate(() => document.activeElement?.getAttribute('name') === 'q'), 'the cursor stays in the search box')
  await box.fill(''); await box.pressSequentially('gulf tech', { delay: 40 }); await waitFor(async () => new URL(p.url()).searchParams.get('q') === 'gulf tech'); await settle(600)
  txt = await body(); ok(txt.includes('INV-G2') && !txt.includes('INV-F1'), 'search is not case-sensitive and matches part of the full name')
  await box.fill(''); await box.pressSequentially('INV-F1', { delay: 40 }); await waitFor(async () => new URL(p.url()).searchParams.get('q') === 'INV-F1'); await settle(600)
  txt = await body(); ok(txt.includes('INV-F1') && !txt.includes('INV-G1'), 'invoice number search')

  console.log('\n[2] Quotations, payments, receivables, follow-ups')
  await p.goto(`${BASE}/invoices?tab=quotation`); await settle()
  await p.getByRole('searchbox', { name: 'Search quotations' }).pressSequentially('GTSC', { delay: 40 }); await waitFor(async () => new URL(p.url()).searchParams.get('q') === 'GTSC'); await settle(600)
  ok((await body()).includes('AS-G9/2026'), 'quotations tab finds the GTSC quotation')
  await p.goto(`${BASE}/invoices?tab=payments`); await settle()
  const pbox = p.getByRole('searchbox', { name: 'Search payments' })
  ok(await pbox.isVisible(), 'Payments tab now has a search box')
  await pbox.pressSequentially('GTSC', { delay: 40 }); await waitFor(async () => new URL(p.url()).searchParams.get('q') === 'GTSC'); await settle(800)
  txt = await body(); ok(txt.includes('TT-GTSC-1') && txt.includes('CHQ-778') && txt.includes('RCPT-9'), 'payments search finds every payment against GTSC invoices')
  await pbox.fill(''); await pbox.pressSequentially('CHQ-778', { delay: 40 }); await waitFor(async () => new URL(p.url()).searchParams.get('q') === 'CHQ-778'); await settle(800)
  txt = await body(); ok(txt.includes('CHQ-778') && !txt.includes('TT-GTSC-1'), 'payments search by reference')
  await pbox.fill(''); await pbox.pressSequentially('nobody here', { delay: 30 }); await waitFor(async () => new URL(p.url()).searchParams.get('q') === 'nobody here'); await settle(800)
  ok((await body()).includes('No payments match'), 'no match says so')
  await p.goto(`${BASE}/invoices?tab=receivables`); await settle()
  const rbox = p.getByRole('searchbox', { name: 'Search receivables' })
  ok(await rbox.isVisible(), 'Receivables tab now has a search box')
  await rbox.pressSequentially('GTSC', { delay: 40 }); await waitFor(async () => new URL(p.url()).searchParams.get('q') === 'GTSC'); await settle(800)
  txt = await body(); ok(txt.includes('Gulf Technical Safety Training Centre-GTSC') && !txt.includes('Falcon Towers LLC'), 'receivables search shows only GTSC')
  await p.goto(`${BASE}/invoices?tab=followups&q=procurement`); await settle()
  ok(await p.getByRole('searchbox', { name: 'Search follow-ups' }).isVisible(), 'Follow-ups tab has a search box')

  console.log('\n[3] PAID stamp')
  await p.goto(`${BASE}/print/sales/${paidInv}`); await settle(800)
  const stamp = p.locator('[data-paid-stamp]')
  ok(await stamp.count() === 1 && (await stamp.innerText()).replace(/\s+/g, ' ').startsWith('PAID'), 'print view of the fully paid invoice shows the PAID stamp')
  const d3 = day(-3); ok((await stamp.innerText()).includes(`${d3.slice(8, 10)}.${d3.slice(5, 7)}.${d3.slice(0, 4)}`), 'stamp shows the last payment date')
  const red = await stamp.evaluate(e => getComputedStyle(e).color); ok(/rgb\(185, 28, 28\)/.test(red), `stamp is red (${red})`)
  const over = await p.evaluate(() => { const s = document.querySelector('[data-paid-stamp]').getBoundingClientRect(); const cells = [...document.querySelectorAll('.paper-paid-wrap td')].slice(1); return cells.some(c => { const r = c.getBoundingClientRect(); return !(s.right < r.left || s.left > r.right || s.bottom < r.top || s.top > r.bottom) }) })
  ok(over === false, 'stamp does not cover the Paid Amount / Total Balance figures')
  await p.locator('.sales-paper').screenshot({ path: `${OUT}/print-paid.png` })
  await p.emulateMedia({ media: 'print' }); ok(await stamp.isVisible(), 'stamp is kept when printing'); await p.emulateMedia({ media: 'screen' })
  await p.goto(`${BASE}/print/sales/${partInv}`); await settle(600)
  ok(await p.locator('[data-paid-stamp]').count() === 0, 'partly paid invoice: no stamp')
  await p.goto(`${BASE}/print/sales/${otherInv}`); await settle(600)
  ok(await p.locator('[data-paid-stamp]').count() === 0, 'unpaid invoice: no stamp')
  await p.goto(`${BASE}/invoices/${paidInv}`); await settle(1000)
  ok(await p.locator('[data-paid-stamp]').count() === 1, 'the invoice page preview shows the stamp too')

  const pdf = async id => { const r = await ctx.request.get(`${BASE}/api/sales/${id}/pdf`); const f = `${OUT}/${id}.pdf`; fs.writeFileSync(f, await r.body()); return execFileSync('pdftotext', ['-raw', f, '-']).toString() }
  const t1 = await pdf(paidInv), t2 = await pdf(partInv)
  ok(/\bPAID\b/.test(t1) && t1.includes(`${d3.slice(8, 10)}.${d3.slice(5, 7)}.${d3.slice(0, 4)}`), 'PDF of the paid invoice carries PAID and the payment date')
  ok(!/\bPAID\b/.test(t2), 'PDF of the partly paid invoice has no PAID stamp')
  execFileSync('pdftoppm', ['-png', '-r', '70', '-f', '1', '-l', '1', `${OUT}/${paidInv}.pdf`, `${OUT}/pdf-paid`])

  console.log('\n[4] Phone')
  const m = await browser.newContext({ viewport: { width: 375, height: 800 }, isMobile: true, hasTouch: true, storageState: await ctx.storageState() }); const mp = await m.newPage()
  await mp.goto(`${BASE}/invoices?tab=payments`); await mp.waitForLoadState('networkidle').catch(() => {})
  ok(await mp.getByRole('searchbox', { name: 'Search payments' }).isVisible() && await mp.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'search box visible on a phone, nothing off screen')
  await m.close()
} catch (e) {
  ok(false, `aborted: ${e.message.split('\n').slice(0, 10).join(' | ')}`); await p.screenshot({ path: `${OUT}/abort.png`, fullPage: true }).catch(() => {})
}
for (const e of jsErrors) ok(false, `JS error ${e}`)
const failed = results.filter(r => !r[0]).length
console.log(`\ninvoice search + paid stamp: ${results.length - failed}/${results.length} passed`)
await browser.close(); await db.end()
process.exit(failed ? 1 : 0)
