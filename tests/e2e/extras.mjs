// Phase D2 e2e: AI business assistant (money owed, late projects, expiries incl. vehicles, cheques, tickets), template builder
// (live preview → print view + PDF follow it, reset), offline drafts (sales editor + forms, restore after going offline),
// service worker offline page, drafts wiped on sign-out, Ctrl+K live record results, wider global search, phone layout.
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import { inflateSync } from 'node:zlib'
import pg from 'pg'

const BASE = process.env.E2E_BASE
const OUT = 'tests/e2e/shots/extras'; fs.mkdirSync(OUT, { recursive: true })
const results = []
const ok = (cond, msg) => { results.push([!!cond, msg]); console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`) }
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
const exe = fs.readdirSync('/opt/pw-browsers').filter(d => d.startsWith('chromium-')).map(d => `/opt/pw-browsers/${d}/chrome-linux/chrome`).find(p => fs.existsSync(p))
const browser = await chromium.launch({ executablePath: exe })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const p = await ctx.newPage()
const jsErrors = []; p.on('pageerror', e => jsErrors.push(`${p.url()}: ${e.message}`)); p.on('dialog', d => d.accept())
const settle = async (pg_ = p, ms = 500) => { await pg_.waitForLoadState('networkidle').catch(() => {}); await pg_.waitForTimeout(ms) }
const main = () => p.locator('main').innerText()
const dlg = () => p.locator('dialog[open]')
const waitFor = async (fn, ms = 12000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn().catch(() => null); if (v) return v; await new Promise(r => setTimeout(r, 300)) } return null }
const day = n => { const x = new Date(Date.now() + 4 * 3600e3); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const pdfText = buf => { const s = buf.toString('latin1'), out = []; for (const m of s.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) { let t; try { t = inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1') } catch { t = m[1] } for (const h of t.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) out.push(Buffer.from(h[1], 'hex').toString('latin1')) } return out.join('\n') }
const drafts = pg_ => pg_.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('avq-draft:')))
const EMAIL = `extras-${Date.now()}@alsaqr.test`
const ask = async q => {
  await p.goto(`${BASE}/assistant?q=${encodeURIComponent(q)}`)
  return waitFor(async () => { const t = await main(); return /Understood by/.test(t) ? t : null })
}

try {
  console.log('\n[0] Setup')
  await p.goto(`${BASE}/signup`); await p.getByLabel('Work email').fill(EMAIL); await p.getByLabel('Password').fill('correct-horse-battery'); await p.getByRole('button', { name: 'Create account' }).click()
  await p.waitForURL('**/onboarding'); await p.getByLabel('Company name').fill('Al Saqr Extras Test'); await p.getByLabel('Your full name').fill('Extras Owner'); await p.getByRole('button', { name: 'Create company' }).click(); await p.waitForURL(`${BASE}/`)
  const co = (await one(`select p.company_id from profiles p join auth.users u on u.id=p.id where u.email=$1`, [EMAIL])).company_id
  const cust = (await one(`insert into customers(company_id,name,phone) values ($1,'Falcon Towers LLC','+971 50 777 8899') returning id`, [co])).id
  const inv = (await one(`insert into invoices(company_id,doc_type,number,customer_id,customer_name,total,status,issue_date,due_date) values ($1,'invoice','INV-9001',$2,'Falcon Towers LLC',25000,'sent',$3,$4) returning id`, [co, cust, day(-40), day(-10)])).id
  await db.query(`insert into payments(company_id,invoice_id,amount,paid_on) values ($1,$2,5000,$3)`, [co, inv, day(-5)])
  await db.query(`insert into invoices(company_id,doc_type,number,customer_name,total,status,issue_date,due_date) values ($1,'invoice','INV-9002','Desert Rose Villas',8000,'sent',$2,$3)`, [co, day(-2), day(28)])
  const proj = (await one(`insert into projects(company_id,name,code,customer_id,status,expected_completion,fabrication_progress) values ($1,'Falcon Towers canopy','PRJ-77',$2,'active',$3,60) returning id`, [co, cust, day(-3)])).id
  await db.query(`insert into assets(company_id,kind,name,plate_or_serial,registration_expiry) values ($1,'vehicle','Isuzu Truck','Dubai L 5521',$2)`, [co, day(10)])
  await db.query(`insert into cheques(company_id,cheque_no,direction,party_name,bank_name,amount,cheque_date,status) values ($1,'778899','incoming','Falcon Towers LLC','ENBD',12000,$2,'received')`, [co, day(3)])
  await db.query(`insert into service_tickets(company_id,number,title,customer_id,priority,due_date) values ($1,'ST-E-1','Gate motor not working',$2,'high',$3)`, [co, cust, day(-1)])
  await db.query(`insert into project_expenses(company_id,project_id,category,description,amount,spent_on,supplier_name) values ($1,$2,'material','Galvanised steel sheets for canopy',3400,$3,'Emirates Steel')`, [co, proj, day(-2)])
  ok(true, 'seeded receivables, a late project, a vehicle expiry, a cheque, a ticket and an expense')

  console.log('\n[1] AI business assistant (built-in rules, no AI key)')
  let t = await ask('Who owes us money?')
  ok(t?.includes('AED 28,000.00 outstanding on 2 invoices') && t.includes('INV-9001') && t.includes('Balance AED 20,000.00') && t.includes('10 days overdue'), 'who owes us money: total, balances after payments, days overdue')
  ok((await p.locator('[data-stats]').innerText()).includes('Overdue') && (await p.locator('[data-stats]').innerText()).includes('AED 20,000.00'), 'headline figures shown above the list')
  t = await ask('Show overdue invoices'); ok(t?.includes('INV-9001') && !t.includes('INV-9002'), 'overdue invoices: only the one past its due date')
  t = await ask('Which projects are late?'); ok(t?.includes('Falcon Towers canopy') && t.includes('late') && t.includes('fabrication 60%'), 'late projects with progress')
  t = await ask('What is expiring in the next 30 days?'); ok(t?.includes('Isuzu Truck') && t.includes('Mulkiya'), 'expiries include vehicle registration')
  t = await ask('Which cheques are due this week?'); ok(t?.includes('778899') && t.includes('To receive'), 'cheques due this week, split into receive / pay')
  t = await ask('Open service tickets'); ok(t?.includes('Gate motor not working') && t.includes('overdue'), 'open service tickets with overdue flag')
  await p.goto(`${BASE}/assistant`); await settle(); await p.getByRole('button', { name: 'Who owes us money?' }).click()
  ok(await waitFor(async () => (await main()).includes('outstanding on 2 invoices')), 'example chips run the question')

  console.log('\n[2] Template builder')
  const q = (await one(`insert into invoices(company_id,doc_type,number,customer_name,attention,customer_address,total,status,issue_date,valid_until,subject) values ($1,'quotation','AS-002600/2026','Falcon Towers LLC','Mr. Khalid','Business Bay, Dubai',0,'draft',$2,$3,'Canopy works') returning id`, [co, day(0), day(30)])).id
  await p.goto(`${BASE}/settings#builder`); await settle()
  const tb = p.locator('[data-template-builder]')
  await tb.getByLabel('Document title').fill('PROPOSAL'); await tb.getByLabel('Attention').uncheck(); await tb.getByLabel('Footer note').fill('Thank you for choosing Al Saqr')
  await tb.getByLabel('Description column').fill('ITEM DESCRIPTION')
  const prev = tb.locator('[aria-label="Live preview"]')
  ok(await waitFor(async () => { const x = await prev.innerText(); return x.includes('PROPOSAL') && x.includes('Thank you for choosing Al Saqr') && x.includes('ITEM DESCRIPTION') && !x.includes('Attention:') }), 'live preview follows every change')
  await tb.getByRole('button', { name: 'Save quotation template' }).click()
  ok(await waitFor(async () => (await tb.innerText()).includes('Quotation template saved')), 'template saved')
  const print = await ctx.newPage(); await print.goto(`${BASE}/print/sales/${q}`); await settle(print)
  const pt = await print.locator('body').innerText()
  ok(pt.includes('PROPOSAL') && pt.includes('Thank you for choosing Al Saqr') && pt.includes('ITEM DESCRIPTION') && !pt.includes('Attention:') && pt.includes('Falcon Towers LLC'), 'print view uses the template (company details unchanged)')
  const pdf = await p.request.get(`${BASE}/api/sales/${q}/pdf`); const ptxt = pdfText(Buffer.from(await pdf.body()))
  ok(pdf.ok() && ptxt.includes('PROPOSAL') && ptxt.includes('Thank you for choosing Al Saqr') && ptxt.includes('ITEM DESCRIPTION') && !ptxt.includes('Attention:'), 'PDF uses the same template')
  await tb.getByRole('tab', { name: 'Tax invoice' }).click()
  ok((await prev.innerText()).includes('Tax Invoice') && (await prev.innerText()).includes('Amount With Vat'), 'other document types keep the standard layout')
  await tb.getByRole('tab', { name: 'Quotation' }).click(); await tb.getByRole('button', { name: 'Standard layout' }).click(); await tb.getByRole('button', { name: 'Save quotation template' }).click(); await settle()
  await print.reload(); await settle(print)
  ok((await print.locator('body').innerText()).includes('QUOTATION') && (await print.locator('body').innerText()).includes('Attention:'), 'back to the standard layout after reset')
  await print.close()

  console.log('\n[3] Offline drafts')
  await p.goto(`${BASE}/invoices/${q}`); await settle()
  await ctx.setOffline(true)
  ok(await waitFor(async () => p.locator('[data-offline-banner]').isVisible()), 'offline banner appears')
  await p.getByLabel('Subject').fill('Canopy works, revised scope typed offline'); await p.waitForTimeout(5500)
  ok((await drafts(p)).includes(`avq-draft:sales:${q}`), 'unsaved editor changes kept on this device while offline')
  ok(!(await one(`select subject from invoices where id=$1`, [q])).subject.includes('offline'), 'nothing reached the server while offline')
  await ctx.setOffline(false)
  await p.goto(`${BASE}/tickets`); await settle()   // leave the editor (unsaved-changes prompt is accepted)
  await p.goto(`${BASE}/invoices/${q}`); await settle()
  const restoreBar = p.locator('[data-draft-restore]')
  ok(await restoreBar.isVisible() && (await restoreBar.innerText()).includes('Unsaved changes from this device'), 'reopening offers the device draft')
  await restoreBar.getByRole('button', { name: 'Restore' }).click()
  ok(await p.getByLabel('Subject').inputValue() === 'Canopy works, revised scope typed offline', 'draft restored into the editor')
  ok(await waitFor(async () => (await one(`select subject from invoices where id=$1`, [q])).subject.includes('typed offline'), 15000), 'autosave stores it once online')
  ok(await waitFor(async () => !(await drafts(p)).includes(`avq-draft:sales:${q}`)), 'device draft removed after it was saved')
  // a dialog form: type, close, come back
  await p.goto(`${BASE}/tickets?new=ticket`); await settle()
  await dlg().getByLabel('Issue *').fill('Water leak at canopy joint'); await p.waitForTimeout(700); await p.keyboard.press('Escape')
  await p.goto(`${BASE}/tickets?new=ticket`); await settle()
  ok(await dlg().getByLabel('Issue *').inputValue() === 'Water leak at canopy joint' && await dlg().locator('[data-draft-restored]').isVisible(), 'form draft restored when the form opens again')
  await dlg().getByRole('button', { name: 'Open ticket' }).click(); await p.waitForURL(/\/tickets\/[0-9a-f-]{36}$/); await settle()
  ok(!(await drafts(p)).includes('avq-draft:form:ticket:new'), 'form draft cleared once the ticket was saved')
  // service worker: pages open the offline screen without a connection
  await p.goto(`${BASE}/tickets`); await settle(p, 1500)
  ok(await waitFor(() => p.evaluate(() => !!navigator.serviceWorker?.controller)), 'service worker active')
  await ctx.setOffline(true); await p.goto(`${BASE}/projects`).catch(() => {}); await settle(p, 300)
  ok((await p.locator('body').innerText()).includes('You are offline'), 'offline page shown instead of a browser error')
  await ctx.setOffline(false)

  console.log('\n[4] Ctrl+K and global search')
  await p.goto(`${BASE}/`); await settle()
  await p.keyboard.press('Control+k'); await p.keyboard.type('Falcon')
  const pal = p.locator('dialog[aria-label="Command palette"]')
  ok(await waitFor(async () => { const x = await pal.innerText(); return x.includes('Falcon Towers LLC') && x.includes('INV-9001') && x.includes('Falcon Towers canopy') }), 'Ctrl+K shows matching customers, invoices and projects while typing')
  ok((await pal.innerText()).includes('Ask Averiqo AI'), 'Ctrl+K offers to ask the assistant')
  await pal.getByRole('option', { name: /PRJ-77 · Falcon Towers canopy/ }).click()
  await p.waitForURL(new RegExp(`/projects/${proj}$`)); ok(true, 'picking a record opens it')
  await p.goto(`${BASE}/search?q=${encodeURIComponent('Galvanised')}`); await settle()
  ok((await main()).includes('Expenses') && (await main()).includes('Galvanised steel sheets for canopy'), 'global search finds expenses')

  console.log('\n[5] Phone')
  const m = await browser.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true, storageState: await ctx.storageState() }); const mp = await m.newPage()
  for (const path of ['/assistant?q=Who%20owes%20us%20money%3F', '/settings#builder']) {
    await mp.goto(BASE + path); await mp.waitForLoadState('networkidle').catch(() => {}); await mp.waitForTimeout(1200)
    const clip = await mp.evaluate(() => { const main = document.querySelector('main'); const edge = Math.min(innerWidth, main.getBoundingClientRect().right) + 1
      const scroller = e => { for (let a = e.parentElement; a && a !== main; a = a.parentElement) { const o = getComputedStyle(a).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') return true } return false }
      return [...main.querySelectorAll('*')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > edge && !scroller(e) }).length })
    ok(clip === 0, `${path}: nothing cut off on a 360px phone (${clip})`)
  }
  await mp.goto(`${BASE}/assistant?q=Who%20owes%20us%20money%3F`); await mp.waitForTimeout(1500); await mp.screenshot({ path: `${OUT}/m-assistant.png`, fullPage: true }); await m.close()
  await p.goto(`${BASE}/settings#builder`); await settle(); await p.locator('#builder').screenshot({ path: `${OUT}/builder.png` })

  console.log('\n[6] Sign-out wipes device drafts')
  await p.goto(`${BASE}/tickets?new=ticket`); await settle(); await dlg().getByLabel('Issue *').fill('Draft that must not survive sign-out'); await p.waitForTimeout(700); await p.keyboard.press('Escape')
  ok((await drafts(p)).length > 0, 'a draft exists before signing out')
  await p.locator('form[data-signout] button >> visible=true').first().click(); await p.waitForURL(/\/login/); await settle()
  ok((await drafts(p)).length === 0, 'signing out removes every draft from this device')
} catch (e) {
  ok(false, `aborted: ${e.message.split('\n').slice(0, 12).join(' | ')}`); await p.screenshot({ path: `${OUT}/abort.png`, fullPage: true }).catch(() => {})
}
for (const e of jsErrors) ok(false, `JS error ${e}`)
const failed = results.filter(r => !r[0]).length
console.log(`\nExtras suite: ${results.length - failed}/${results.length} passed`)
await browser.close(); await db.end()
process.exit(failed ? 1 : 0)
