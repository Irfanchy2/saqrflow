// Free "Share via WhatsApp" for payslips, salary receipts and sales documents: the right employee and number, the right
// PDF (monthly payslip from the salary ledger), editable message, desktop (PDF download + wa.me chat) and phone (native
// share sheet with the PDF file), missing / invalid / duplicate numbers, saving a number only on request, the share log,
// balances untouched, sales sharing, the employee's own payslips and nothing public.
// Real Next build + PostgREST + Postgres RLS + Chromium. Run via scripts/e2e.sh
import { chromium } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import pg from 'pg'

const BASE = process.env.E2E_BASE
const OUT = 'tests/e2e/shots/share'; fs.mkdirSync(OUT, { recursive: true })
const results = []
const ok = (cond, msg) => { results.push([!!cond, msg]); console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`) }
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
const exe = fs.readdirSync('/opt/pw-browsers').filter(d => d.startsWith('chromium-')).map(d => `/opt/pw-browsers/${d}/chrome-linux/chrome`).find(p => fs.existsSync(p))
const browser = await chromium.launch({ executablePath: exe })
const jsErrors = []
const watch = page => { page.on('pageerror', e => jsErrors.push(`${page.url()}: ${e.message}`)); page.on('dialog', d => d.accept()); return page }
// window.open is recorded instead of opening WhatsApp
const spyOpen = () => { window.__opened = []; window.open = (u) => { window.__opened.push(String(u)); return null } }
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true }); await ctx.addInitScript(spyOpen)
const p = watch(await ctx.newPage())
const settle = async (page = p, ms = 500) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(ms) }
const sheet = (page = p) => page.locator('dialog[open] [data-share-sheet]')
const stamp = Date.now(), OWNER = `share-owner-${stamp}@alsaqr.test`, EMP = `share-emp-${stamp}@alsaqr.test`
const owed = async emp => Number((await one(`select outstanding from salary_accounts where employee_id=$1`, [emp])).outstanding)
const pdfText = async (page, url) => { const r = await page.request.get(BASE + url); const f = `${OUT}/t-${Date.now()}.pdf`; fs.writeFileSync(f, await r.body()); return { status: r.status(), text: execFileSync('pdftotext', ['-layout', f, '-']).toString(), cd: r.headers()['content-disposition'] ?? '' } }

try {
  console.log('\n[0] Setup: owner, three employees (one without a number, one sharing a number), salary posted, two partial payments')
  await p.goto(`${BASE}/signup`); await p.getByLabel('Work email').fill(OWNER); await p.getByLabel('Password').fill('correct-horse-battery'); await p.getByRole('button', { name: 'Create account' }).click()
  await p.waitForURL('**/onboarding'); await p.getByLabel('Company name').fill('Al Saqr Share Test'); await p.getByLabel('Your full name').fill('Owner'); await p.getByRole('button', { name: 'Create company' }).click(); await p.waitForURL(`${BASE}/`)
  const co = (await one(`select p.company_id from profiles p join auth.users u on u.id=p.id where u.email=$1`, [OWNER])).company_id
  const today = (await one(`select (now() at time zone coalesce(timezone,'Asia/Dubai'))::date::text d from companies where id=$1`, [co])).d, M = today.slice(0, 7)
  const label = new Date(`${M}-01T00:00:00Z`).toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  const mk = async (no, name, phone, salary) => { const id = (await one(`insert into employees(company_id,employee_no,full_name,phone,status) values ($1,$2,$3,$4,'active') returning id`, [co, no, name, phone])).id; await db.query(`insert into employee_compensation(employee_id,company_id,monthly_salary) values ($1,$2,$3)`, [id, co, salary]); return id }
  const ali = await mk('W-01', 'Ali Hassan', '050 111 2222', 3000), sara = await mk('W-02', 'Sara Khan', null, 2500), dup = await mk('W-03', 'Rafiq Ali', '+971501112222', 2000)
  await db.query(`insert into salary_ledger(company_id,employee_id,kind,amount,entry_date) values ($1,$2,'opening',8000,$3)`, [co, ali, `${M}-01`])
  const acc = async emp => (await one(`insert into salary_ledger(company_id,employee_id,kind,period,entry_date,amount) values ($1,$2,'accrual',$3,$4,(select monthly_salary from employee_compensation where employee_id=$2)) returning id`, [co, emp, `${M}-01`, today])).id
  const aliAcc = await acc(ali), saraAcc = await acc(sara)
  const payA = (await one(`insert into salary_payments(company_id,employee_id,period,amount,paid_on,method,reference) values ($1,$2,$3,2000,$4,'cash','CASH-1') returning id`, [co, ali, `${M}-01`, today])).id
  // two partial payments aimed at this month (multiple payments in one month)
  for (const a of [500, 700]) await db.query(`insert into salary_payments(company_id,employee_id,period,amount,paid_on,method,allocate_to) values ($1,$2,$3,$4,$5,'bank_transfer',$6)`, [co, ali, `${M}-01`, a, today, aliAcc])
  const before = { owed: await owed(ali), acc: (await one(`select count(*)::int n from salary_ledger where company_id=$1`, [co])).n, pays: (await one(`select count(*)::int n from salary_payments where company_id=$1`, [co])).n }
  ok(before.owed === 7800, `Ali is owed 7,800 (8,000 + 3,000 − 3,200 paid)`)

  console.log('\n[1] Payslip PDF: this month from the ledger, with the partial payments')
  const ps = await pdfText(p, `/api/salary-payslips/${aliAcc}`)
  ok(ps.status === 200 && /attachment; filename="Payslip_Ali-Hassan_\d{4}-\d{2}\.pdf"/.test(ps.cd), 'payslip downloads with a clear file name')
  ok(/PAYSLIP/.test(ps.text) && ps.text.includes('Ali Hassan') && ps.text.includes('W-01') && ps.text.includes(label), 'payslip: employee, ID, month')
  ok(new RegExp(`Basic salary for ${label}\\s+3,000\\.00`).test(ps.text) && /Net salary for the month\s+3,000\.00/.test(ps.text), 'payslip: basic and net salary 3,000.00')
  ok(/- 500\.00/.test(ps.text) && /- 700\.00/.test(ps.text) && /Remaining unpaid for this month\s+1,800\.00/.test(ps.text), 'payslip: both partial payments for the month, 1,800.00 still unpaid')
  ok(!/2,000\.00/.test(ps.text), 'the AED 2,000 that settled the opening balance is not shown as paid for this month')
  ok((await one(`select count(*)::int n from salary_ledger where company_id=$1`, [co])).n === before.acc, 'making the payslip posted nothing')

  console.log('\n[2] Desktop: share the payslip from the salary account page')
  await p.goto(`${BASE}/salary/${ali}`); await settle()
  await p.getByRole('button', { name: `Share the ${label} payslip via WhatsApp` }).click(); await sheet().waitFor()
  const s1 = await sheet().innerText()
  ok(s1.includes('Ali Hassan') && s1.includes('Employee W-01') && (await sheet().locator('[data-share-phone]').innerText()) === '+971 50 111 2222', 'recipient: Ali Hassan, W-01, +971 50 111 2222 (from the profile)')
  ok(s1.includes(`Payslip · ${label}`) && s1.includes('Payslip_Ali-Hassan_'), 'document: the payslip for the month and its file name')
  const msg1 = await sheet().locator('[data-share-message]').inputValue()
  ok(msg1.includes(`Please find your payslip for ${label}.`) && msg1.includes('Al Saqr Share Test') && !/AED|\d,\d{3}\.\d{2}/.test(msg1), 'message: the payslip text, no salary amount')
  ok((await sheet().locator('[data-share-duplicate]').innerText()).includes('Rafiq Ali'), 'warns that the number is also saved for another employee')
  ok(await sheet().locator('[data-share-preview]').isVisible(), 'PDF preview shown on desktop')
  ok(!(await sheet().locator('[data-share-native]').count()), 'desktop: no native share button')
  await sheet().locator('[data-share-message]').fill(msg1 + '\nRegards from HR')
  const [dl] = await Promise.all([p.waitForEvent('download'), sheet().locator('[data-share-open]').click()])
  ok(/^Payslip_Ali-Hassan_\d{4}-\d{2}\.pdf$/.test(dl.suggestedFilename()), `PDF downloaded to attach (${dl.suggestedFilename()})`)
  const opened = await p.evaluate(() => window.__opened)
  ok(opened.length === 1 && opened[0].startsWith('https://wa.me/971501112222?text=') && decodeURIComponent(opened[0]).includes('Regards from HR'), "Ali's chat opens with the edited message")
  ok((await sheet().locator('[data-share-done]').innerText()).includes('does not know whether the message was sent'), 'says WhatsApp opened, never that it was sent')
  const log1 = await one(`select doc_kind, method, phone_last4, party_id from document_shares where record_id=$1`, [aliAcc])
  ok(log1?.method === 'whatsapp_link' && log1.phone_last4 === '2222' && log1.party_id === ali, 'share logged: payslip, WhatsApp link, last 4 digits only')
  await p.keyboard.press('Escape')

  console.log('\n[3] Share a salary receipt from the payment history')
  await p.locator(`[data-payment="${payA}"]`).getByRole('button', { name: /salary receipt via WhatsApp/ }).click(); await sheet().waitFor()
  const msg2 = await sheet().locator('[data-share-message]').inputValue()
  ok(msg2.includes('Your salary payment of AED 2,000.00 dated') && msg2.includes('payment receipt attached'), 'receipt message: amount and date (as its template asks)')
  ok((await sheet().innerText()).includes(`Salary receipt SR-${payA.slice(0, 8).toUpperCase()}`), 'document: the receipt number')
  const rc = await pdfText(p, `/api/payslips/${payA}`)
  ok(/Amount paid\s+2,000\.00/.test(rc.text) && rc.text.includes('CASH-1') && rc.text.includes('Opening balance'), 'receipt PDF: amount, reference, period settled')
  await p.keyboard.press('Escape')

  console.log('\n[4] Missing and invalid numbers; saving only when asked')
  await p.goto(`${BASE}/salary`); await settle()
  await p.locator('[data-salary-rows] tr', { hasText: 'Sara Khan' }).getByRole('button', { name: /payslip via WhatsApp/ }).click(); await sheet().waitFor()
  ok((await sheet().innerText()).includes('No WhatsApp number is saved for Sara Khan') && await sheet().locator('[data-share-open]').isDisabled(), 'no number: asks for one, cannot open a chat')
  await sheet().getByLabel('WhatsApp number').fill('12345'); await sheet().getByRole('button', { name: 'Use for this share' }).click(); await p.waitForTimeout(600)
  ok((await sheet().innerText()).includes('Enter a valid WhatsApp number'), 'invalid number refused')
  await sheet().getByLabel('WhatsApp number').fill('055 333 4444'); await sheet().getByRole('button', { name: 'Use for this share' }).click(); await sheet().locator('[data-share-phone]').waitFor()
  ok((await sheet().locator('[data-share-phone]').innerText()) === '+971 55 333 4444' && (await sheet().innerText()).includes('profile is unchanged'), 'number used for this share only')
  ok((await one(`select whatsapp from employees where id=$1`, [sara])).whatsapp === null, "Sara's profile not changed")
  await sheet().getByRole('button', { name: 'Change' }).click(); await sheet().getByLabel('WhatsApp number').fill('+971 55 333 4444'); await sheet().getByRole('button', { name: "Save to Sara's profile" }).click(); await p.waitForTimeout(800)
  ok((await one(`select whatsapp from employees where id=$1`, [sara])).whatsapp === '+971553334444', 'saved to the profile only on "Save to Sara\'s profile"')
  await p.keyboard.press('Escape')

  console.log('\n[5] Phone: the PDF goes to the native share sheet')
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: await ctx.storageState() })
  await mctx.addInitScript(() => {
    navigator.canShare = () => true
    navigator.share = async d => { const f = d.files?.[0]; window.__shared = { name: f?.name, type: f?.type, size: f?.size, head: f ? await f.slice(0, 5).text() : '', text: d.text } }
  })
  const m = watch(await mctx.newPage())
  await m.goto(`${BASE}/salary/${ali}`); await settle(m)
  await m.getByRole('button', { name: `Share the ${label} payslip via WhatsApp` }).click(); await sheet(m).waitFor()
  const nb = sheet(m).locator('[data-share-native]'); await m.waitForFunction(() => !document.querySelector('[data-share-native]')?.hasAttribute('disabled'), null, { timeout: 15000 })
  ok((await nb.innerText()).includes('Share PDF to WhatsApp') && (await sheet(m).innerText()).includes('Check the chat is Ali Hassan'), 'phone: "Share PDF to WhatsApp", with a reminder to check the chat')
  await nb.click(); await m.waitForTimeout(500)
  const shared = await m.evaluate(() => window.__shared)
  ok(shared?.type === 'application/pdf' && /^Payslip_Ali-Hassan_/.test(shared.name) && shared.head === '%PDF-' && shared.size > 1000 && shared.text.includes('payslip'), `the payslip PDF itself was handed to the share sheet (${shared?.name}, ${shared?.size} bytes)`)
  ok((await one(`select count(*)::int n from document_shares where record_id=$1 and method='native_share'`, [aliAcc])).n === 1, 'logged as a native share')
  ok(await m.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 1 && (await m.locator('dialog[open]').boundingBox()).width <= 391, 'sheet fits the phone')
  await m.screenshot({ path: `${OUT}/m-share.png` }); await mctx.close()

  console.log('\n[6] Balances unchanged by sharing')
  ok(await owed(ali) === before.owed && (await one(`select count(*)::int n from salary_payments where company_id=$1`, [co])).n === before.pays && (await one(`select count(*)::int n from salary_ledger where company_id=$1`, [co])).n === before.acc, 'nothing posted, paid or changed by sharing')

  console.log('\n[7] Sales documents still share (free sheet) and still offer WhatsApp Business sending')
  const cust = (await one(`insert into customers(company_id,name,phone) values ($1,'Gulf Horizon Interiors','+971 4 555 0101') returning id`, [co])).id
  await db.query(`update customers set whatsapp='+971509998877' where id=$1`, [cust])
  const qt = (await one(`insert into invoices(company_id,doc_type,number,status,customer_id,customer_name,issue_date,valid_until,subtotal,vat_amount,total) values ($1,'quotation','AS-SH1/2026','sent',$2,'Gulf Horizon Interiors',$3,$3::date + 30,10000,500,10500) returning id`, [co, cust, today])).id
  await db.query(`insert into invoice_items(company_id,invoice_id,position,description,quantity,unit,unit_price) values ($1,$2,1,'Steel canopy',1,'L.S',10000)`, [co, qt])
  await p.goto(`${BASE}/invoices/${qt}`); await settle(p, 900)
  ok(await p.getByRole('button', { name: /Send quotation via WhatsApp/ }).first().isVisible(), 'WhatsApp Business "Send" button still there')
  await p.getByRole('button', { name: 'More actions' }).click(); await p.getByRole('menuitem', { name: 'Share on WhatsApp…' }).click(); await sheet().waitFor()
  const s7 = await sheet().innerText(), msg7 = await sheet().locator('[data-share-message]').inputValue()
  ok(s7.includes('Gulf Horizon Interiors') && (await sheet().locator('[data-share-phone]').innerText()) === '+971 50 999 8877' && msg7.includes('quotation AS-SH1/2026 for AED 10,500.00'), 'quotation: customer WhatsApp number and quotation message')
  const [dl7] = await Promise.all([p.waitForEvent('download'), sheet().locator('[data-share-open]').click()])
  ok(dl7.suggestedFilename().endsWith('.pdf') && (await p.evaluate(() => window.__opened.at(-1))).startsWith('https://wa.me/971509998877?text='), 'quotation PDF downloaded and the customer chat opened')
  await p.waitForTimeout(500)
  ok((await one(`select count(*)::int n from sales_doc_events where invoice_id=$1 and event='whatsapp'`, [qt])).n === 1, 'the existing "shared on WhatsApp" event is still recorded on the document')
  await p.keyboard.press('Escape')

  console.log('\n[8] Editable messages in Settings')
  await p.goto(`${BASE}/settings#wa-share`); await settle()
  const tpl = p.locator('[data-share-template=payslip]'); await tpl.locator('summary').click()
  await tpl.locator('textarea[name=body]').fill('Salam {employee}, your {period} payslip from {company} is attached.'); await tpl.getByRole('button', { name: 'Save message' }).click(); await settle(p, 800)
  await tpl.locator('textarea[name=body]').fill('Hi {employee}, you are owed {balance}'); await tpl.getByRole('button', { name: 'Save message' }).click(); await p.waitForTimeout(800)
  ok((await tpl.innerText()).includes('{balance} is not available'), 'a placeholder the payslip does not have is refused')
  await p.goto(`${BASE}/salary/${ali}`); await settle()
  await p.getByRole('button', { name: `Share the ${label} payslip via WhatsApp` }).click(); await sheet().waitFor()
  ok((await sheet().locator('[data-share-message]').inputValue()) === `Salam Ali Hassan, your ${label} payslip from Al Saqr Share Test is attached.`, 'the saved message is used')
  await p.keyboard.press('Escape')

  console.log('\n[9] Nothing public; employees see only their own payslips')
  const anon = await browser.newContext()
  const ar = await anon.request.get(`${BASE}/api/salary-payslips/${aliAcc}`, { maxRedirects: 0 })
  ok(ar.status() !== 200 && !(ar.headers()['content-type'] ?? '').includes('pdf'), `not signed in: no payslip (${ar.status()})`)
  await anon.close()
  await p.goto(`${BASE}/employees/${ali}`); await settle()
  await p.locator('[data-portal-access]').getByRole('button', { name: 'Give portal access' }).click()
  await p.locator('dialog[open] input[name=email]').fill(EMP); await p.locator('dialog[open]').getByRole('button', { name: 'Give access' }).click(); await settle(p, 1000)
  const ectx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true }); const ep = watch(await ectx.newPage())
  await ep.goto(`${BASE}/login`); await ep.getByLabel('Email').fill(EMP); await ep.getByLabel('Password').fill('invited-password-123'); await ep.getByRole('button', { name: 'Sign in' }).click(); await ep.waitForURL('**/me**')
  await ep.goto(`${BASE}/me/salary`); await settle(ep)
  ok(await ep.locator('[data-payslip-link]').count() === 1, 'portal: their payslip for the month is listed')
  const own = await ep.request.get(`${BASE}/api/salary-payslips/${aliAcc}`), other = await ep.request.get(`${BASE}/api/salary-payslips/${saraAcc}`, { maxRedirects: 0 })
  ok(own.status() === 200 && (await own.body()).subarray(0, 5).toString() === '%PDF-', 'own payslip downloads')
  ok(other.status() === 404, `a colleague's payslip: ${other.status()}`)
  await ectx.close()
} catch (e) {
  ok(false, `aborted: ${e.message.split('\n').slice(0, 12).join(' | ')}`); await p.screenshot({ path: `${OUT}/abort.png`, fullPage: true }).catch(() => {})
}
for (const e of jsErrors) ok(false, `JS error ${e}`)
const failed = results.filter(r => !r[0]).length
console.log(`\nshare: ${results.length - failed}/${results.length} passed`)
await browser.close(); await db.end()
process.exit(failed ? 1 : 0)
