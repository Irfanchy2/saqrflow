// Customer statement: from Sales & invoices pick one customer (GTSC) and choose "Unpaid invoices only" or the full
// statement of account; print view and PDF; period filter; links from Receivables, the customer ledger, the customer page
// and a tax invoice; phone layout. Real Next build + PostgREST.
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import pg from 'pg'
import { execFileSync } from 'node:child_process'

const BASE = process.env.E2E_BASE
const OUT = 'tests/e2e/shots/statement'; fs.mkdirSync(OUT, { recursive: true })
const results = []
const ok = (cond, msg) => { results.push([!!cond, msg]); console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`) }
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
const exe = fs.readdirSync('/opt/pw-browsers').filter(d => d.startsWith('chromium-')).map(d => `/opt/pw-browsers/${d}/chrome-linux/chrome`).find(p => fs.existsSync(p))
const browser = await chromium.launch({ executablePath: exe })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true }); const p = await ctx.newPage()
const jsErrors = []; const watch = pg_ => { pg_.on('pageerror', e => jsErrors.push(`${pg_.url()}: ${e.message}`)); return pg_ }; watch(p)
const settle = async (pg_ = p, ms = 400) => { await pg_.waitForLoadState('networkidle').catch(() => {}); await pg_.waitForTimeout(ms) }
const day = n => { const x = new Date(Date.now() + 4 * 3600e3); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const EMAIL = `stmt-${Date.now()}@alsaqr.test`
const dlg = () => p.locator('dialog[open]')
const pdfText = async url => { const r = await ctx.request.get(BASE + url); const f = `${OUT}/${Math.random().toString(36).slice(2)}.pdf`; fs.writeFileSync(f, await r.body()); return { text: execFileSync('pdftotext', ['-layout', f, '-']).toString(), disp: r.headers()['content-disposition'] ?? '', type: r.headers()['content-type'] } }
const openStatement = async () => { const [pop] = await Promise.all([ctx.waitForEvent('page'), dlg().getByRole('button', { name: 'View & print' }).click()]); watch(pop); await settle(pop, 600); return pop }

try {
  console.log('\n[0] Setup: GTSC with a paid, a part-paid, an overdue and a not-yet-due invoice; another customer')
  await p.goto(`${BASE}/signup`); await p.getByLabel('Work email').fill(EMAIL); await p.getByLabel('Password').fill('correct-horse-battery'); await p.getByRole('button', { name: 'Create account' }).click()
  await p.waitForURL('**/onboarding'); await p.getByLabel('Company name').fill('Al Saqr Statement Test'); await p.getByLabel('Your full name').fill('Stmt Owner'); await p.getByRole('button', { name: 'Create company' }).click(); await p.waitForURL(`${BASE}/`)
  const co = (await one(`select p.company_id from profiles p join auth.users u on u.id=p.id where u.email=$1`, [EMAIL])).company_id
  const gtsc = (await one(`insert into customers(company_id,name,phone,address) values ($1,'Gulf Technical Safety Training Centre-GTSC','04 555 0001','Musaffah, Abu Dhabi') returning id`, [co])).id
  const other = (await one(`insert into customers(company_id,name) values ($1,'Falcon Towers LLC') returning id`, [co])).id
  const inv = async (number, cust, name, total, issue, due, lpo = null) => {
    const id = (await one(`insert into invoices(company_id,doc_type,number,customer_id,customer_name,total,status,issue_date,due_date,lpo_ref) values ($1,'invoice',$2,$3,$4,$5,'sent',$6,$7,$8) returning id`, [co, number, cust, name, total, issue, due, lpo])).id
    await db.query(`insert into invoice_items(company_id,invoice_id,position,description,quantity,unit_price) values ($1,$2,1,'Steel works',1,$3)`, [co, id, Math.round(total / 1.05 * 100) / 100])
    return id
  }
  const s1 = await inv('INV-S1', gtsc, 'GTSC', 10500, day(-90), day(-60))
  const s2 = await inv('INV-S2', gtsc, 'GTSC', 4200, day(-50), day(-20), 'LPO-4471')
  const s3 = await inv('INV-S3', gtsc, 'GTSC', 2100, day(-100), day(-70))
  const s4 = await inv('INV-S4', gtsc, 'GTSC', 1050, day(-5), day(25))
  await inv('INV-F1', other, 'Falcon Towers LLC', 3150, day(-30), day(0))
  await db.query(`insert into payments(company_id,invoice_id,customer_id,amount,paid_on,method,reference) values ($1,$2,$3,10500,$4,'bank_transfer','TT-S1'),($1,$5,$3,1000,$6,'cheque','CHQ-S2')`, [co, s1, gtsc, day(-58), s2, day(-10)])
  const before = await one(`select (select count(*) from invoices where company_id=$1)::int i, (select count(*) from payments where company_id=$1)::int p, (select sum(total) from invoices where company_id=$1)::float t`, [co])
  ok((await one(`select status from invoices where id=$1`, [s1])).status === 'paid', 'seeded: INV-S1 paid, S2 part-paid, S3 overdue, S4 not yet due')

  console.log('\n[1] Sales & invoices → Customer statement')
  await p.goto(`${BASE}/invoices?tab=invoice`); await settle()
  const btn = p.getByRole('button', { name: 'Customer statement' })
  ok(await btn.isVisible(), '“Customer statement” button on Sales & invoices')
  await btn.click(); await p.waitForTimeout(400)
  ok(await dlg().getByRole('radio', { name: /Unpaid invoices only/ }).isChecked(), '“Unpaid invoices only” is the default')
  await dlg().getByRole('button', { name: 'View & print' }).click()
  ok((await dlg().innerText()).includes('Choose a customer first'), 'asks for a customer before opening')
  await dlg().getByRole('searchbox', { name: 'Search customer' }).fill('gtsc')
  const opts = dlg().getByRole('option')
  ok(await opts.count() === 1 && (await opts.first().innerText()).includes('GTSC'), 'search finds GTSC by its short name (only that customer)')
  await opts.first().click()
  ok((await dlg().locator('[data-statement-customer]').innerText()).includes('Gulf Technical Safety Training Centre-GTSC'), 'GTSC chosen')
  await p.screenshot({ path: `${OUT}/picker.png` })

  console.log('\n[2] Unpaid invoices only')
  let pop = await openStatement()
  const unpaid = pop.locator('[data-doc="statement-unpaid"]'), ut = await unpaid.innerText()
  ok(await unpaid.count() === 1 && ut.includes('STATEMENT OF UNPAID INVOICES') && ut.includes('Gulf Technical Safety Training Centre-GTSC'), 'opens the statement of unpaid invoices for GTSC')
  ok(['INV-S2', 'INV-S3', 'INV-S4'].every(n => ut.includes(n)) && !ut.includes('INV-S1') && !ut.includes('INV-F1'), 'only GTSC’s unpaid invoices (not the paid one, not another customer)')
  ok(ut.includes('LPO-4471') && ut.includes('1,000.00') && ut.includes('3,200.00'), 'part-paid invoice shows LPO, paid 1,000.00 and balance 3,200.00')
  ok(/Total due:\s*AED 6,350\.00/.test(ut) && (await pop.locator('[data-unpaid-ageing]').count()) === 1, 'total due AED 6,350.00 with an ageing summary')
  ok(new URL(pop.url()).searchParams.get('type') === 'unpaid', 'link carries the choice (type=unpaid)')
  await unpaid.screenshot({ path: `${OUT}/unpaid.png` }); await pop.close()

  console.log('\n[3] Full statement of account')
  await dlg().getByRole('radio', { name: /Full statement of account/ }).check()
  pop = await openStatement()
  const ft = await pop.locator('[data-doc="statement"]').innerText()
  ok(ft.includes('STATEMENT OF ACCOUNT') && ['INV-S1', 'INV-S2', 'INV-S3', 'INV-S4', 'TT-S1'].every(n => ft.includes(n)), 'full statement: every invoice and payment')
  await pop.close()

  console.log('\n[4] PDF')
  await dlg().getByRole('radio', { name: /Unpaid invoices only/ }).check()
  const [dl] = await Promise.all([p.waitForEvent('download'), dlg().getByRole('button', { name: 'Download PDF' }).click()])
  ok(/^Unpaid_Statement_/.test(dl.suggestedFilename()), `Download PDF gives the unpaid statement (${dl.suggestedFilename()})`)
  const pu = await pdfText(`/api/statements/${gtsc}?type=unpaid`)
  ok(pu.type === 'application/pdf' && pu.text.includes('STATEMENT OF UNPAID INVOICES') && ['INV-S2', 'INV-S3', 'INV-S4', '6,350.00'].every(n => pu.text.includes(n)) && !/\bINV-S1\b/.test(pu.text), 'PDF: unpaid invoices only, total 6,350.00')
  const pf = await pdfText(`/api/statements/${gtsc}`)
  ok(pf.text.includes('STATEMENT OF ACCOUNT') && pf.text.includes('INV-S1'), 'PDF: full statement unchanged')

  console.log('\n[5] Period')
  await dlg().getByLabel('From').fill(day(-60)); await dlg().getByLabel('To').fill(day(-10))
  pop = await openStatement()
  const pt = await pop.locator('[data-doc="statement-unpaid"]').innerText()
  ok(pt.includes('INV-S2') && !pt.includes('INV-S3') && !pt.includes('INV-S4'), 'with dates: only unpaid invoices issued in that period')
  await pop.close()
  await dlg().getByLabel('From').fill(day(-1)); await dlg().getByLabel('To').fill(day(-60)); await dlg().getByRole('button', { name: 'View & print' }).click()
  ok((await dlg().innerText()).includes('“From” date is after the “To” date'), 'reversed dates are refused')
  await p.keyboard.press('Escape')

  console.log('\n[6] Other places')
  await p.goto(`${BASE}/invoices?tab=receivables`); await settle()
  ok(await p.locator(`[data-unpaid-statement="${gtsc}"]`).getAttribute('href') === `/print/statement/${gtsc}?type=unpaid`, 'Receivables: a Statement link on the GTSC row')
  await p.goto(`${BASE}/parties/${gtsc}/ledger`); await settle()
  await p.locator('[data-statement-type]').selectOption('unpaid'); await p.getByRole('button', { name: 'Apply' }).click(); await settle()
  ok((await p.getByRole('link', { name: 'Print unpaid statement' }).getAttribute('href')).includes('type=unpaid') && (await p.getByRole('link', { name: 'Unpaid statement PDF' }).getAttribute('href')).includes('type=unpaid'), 'customer ledger: Statement type “Unpaid invoices only” drives print and PDF')
  await p.goto(`${BASE}/parties/${gtsc}`); await settle()
  await p.getByRole('button', { name: 'Statement', exact: true }).click(); await p.waitForTimeout(300)
  ok((await dlg().locator('[data-statement-customer]').innerText()).includes('GTSC') && await dlg().getByRole('button', { name: 'Change' }).count() === 0, 'customer page: Statement with the customer already chosen')
  await p.keyboard.press('Escape')
  await p.goto(`${BASE}/invoices/${s2}`); await settle(p, 800)
  const links = p.locator('[data-invoice-statement]')
  ok(await links.isVisible() && await links.getByRole('link', { name: 'Unpaid invoices' }).getAttribute('href') === `/print/statement/${gtsc}?type=unpaid`, 'tax invoice page: unpaid / full statement links for its customer')

  console.log('\n[7] Phone')
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, storageState: await ctx.storageState() }); const mp = watch(await m.newPage())
  await mp.goto(`${BASE}/invoices?tab=invoice`); await settle(mp)
  await mp.getByRole('button', { name: 'Customer statement' }).click(); await mp.waitForTimeout(500)
  await mp.locator('dialog[open]').getByRole('searchbox', { name: 'Search customer' }).fill('GTSC'); await mp.locator('dialog[open]').getByRole('option').first().tap()
  ok(await mp.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1) && await mp.locator('dialog[open]').getByRole('button', { name: 'View & print' }).isVisible(), 'phone: the statement picker fits and is usable')
  await mp.screenshot({ path: `${OUT}/phone-picker.png` }); await m.close()

  const after = await one(`select (select count(*) from invoices where company_id=$1)::int i, (select count(*) from payments where company_id=$1)::int p, (select sum(total) from invoices where company_id=$1)::float t`, [co])
  ok(JSON.stringify(after) === JSON.stringify(before), 'making statements changes no invoice or payment')
} catch (e) {
  ok(false, `aborted: ${e.message.split('\n').slice(0, 8).join(' | ')}`); await p.screenshot({ path: `${OUT}/abort.png`, fullPage: true }).catch(() => {})
}
for (const e of jsErrors) ok(false, `JS error ${e}`)
const failed = results.filter(r => !r[0]).length
console.log(`\ncustomer statement: ${results.length - failed}/${results.length} passed`)
await browser.close(); await db.end()
process.exit(failed ? 1 : 0)
