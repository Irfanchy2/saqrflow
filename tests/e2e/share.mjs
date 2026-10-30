// Free "Share via WhatsApp" for payslips, salary receipts and sales documents: the right employee and number, the right
// PDF (monthly payslip from the salary ledger), editable message, desktop (PDF download + wa.me chat, with a plain "attach it
// by hand" instruction) and phone (the PDF file itself handed to the share menu, message copied), for all five document types;
// a phone browser that cannot share files; a server reply that is not a PDF; missing / invalid / duplicate numbers, saving a
// number only on request, the share log, balances untouched, the employee's own payslips and nothing public.
// The phone share menu is simulated (headless Chromium has none): the test checks exactly what the page hands to it.
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
const pdfToText = buf => { const f = `${OUT}/t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.pdf`; fs.writeFileSync(f, buf); return execFileSync('pdftotext', ['-layout', f, '-']).toString() }
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
  ok((await sheet().locator('[data-share-how]').innerText()).includes('This browser cannot attach the PDF to WhatsApp automatically') && (await sheet().locator('[data-share-open]').innerText()).includes('Download PDF & open chat'), 'desktop: says up front that the PDF must be attached by hand')
  await sheet().locator('[data-share-message]').fill(msg1 + '\nRegards from HR')
  const [dl] = await Promise.all([p.waitForEvent('download'), sheet().locator('[data-share-open]').click()])
  ok(/^Payslip_Ali-Hassan_\d{4}-\d{2}\.pdf$/.test(dl.suggestedFilename()), `PDF downloaded to attach (${dl.suggestedFilename()})`)
  const opened = await p.evaluate(() => window.__opened)
  ok(opened.length === 1 && opened[0].startsWith('https://wa.me/971501112222?text=') && decodeURIComponent(opened[0]).includes('Regards from HR'), "Ali's chat opens with the edited message")
  const done2 = await sheet().locator('[data-share-done]').innerText()
  ok(done2.includes('does not know whether the message was sent') && done2.includes('The PDF is not attached yet') && done2.includes('paperclip'), 'says WhatsApp opened and the PDF still has to be attached, never that it was attached or sent')
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
  const [dl3] = await Promise.all([p.waitForEvent('download'), sheet().locator('[data-share-open]').click()])
  ok(/^Salary_receipt_Ali-Hassan_\d{4}-\d{2}-\d{2}\.pdf$/.test(dl3.suggestedFilename()) && (await p.evaluate(() => window.__opened.at(-1))).startsWith('https://wa.me/971501112222?text=Dear%20Ali%20Hassan'), `desktop receipt: ${dl3.suggestedFilename()} downloaded, Ali's chat opened`)
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

  console.log('\n[5] Desktop: quotation, tax invoice and delivery note through the same sheet')
  const cust = (await one(`insert into customers(company_id,name,phone) values ($1,'Gulf Horizon Interiors','+971 4 555 0101') returning id`, [co])).id
  await db.query(`update customers set whatsapp='+971509998877' where id=$1`, [cust])
  const sdoc = async (type, number, status, total) => (await one(`insert into invoices(company_id,doc_type,number,status,customer_id,customer_name,issue_date,valid_until,due_date,subtotal,vat_amount,total) values ($1,$2,$3,$4,$5,'Gulf Horizon Interiors',$6,$6::date + 30,$6::date + 30,$7,$8,$9) returning id`, [co, type, number, status, cust, today, total ? 10000 : 0, total ? 500 : 0, total])).id
  const qt = await sdoc('quotation', 'AS-SH1/2026', 'sent', 10500), inv = await sdoc('invoice', 'INV-SH1/2026', 'sent', 10500), dn = await sdoc('delivery_note', 'DN-SH1/2026', 'sent', 0)
  for (const d of [qt, inv, dn]) await db.query(`insert into invoice_items(company_id,invoice_id,position,description,quantity,unit,unit_price) values ($1,$2,1,'Steel canopy',1,'L.S',10000)`, [co, d])
  const SALES = [[qt, 'quotation', 'Quotation AS-SH1/2026', 'AS-SH1-2026_Gulf-Horizon-Interiors_Quotation.pdf', 'quotation AS-SH1/2026 for AED 10,500.00'], [inv, 'invoice', 'Tax invoice INV-SH1/2026', 'INV-SH1-2026_Gulf-Horizon-Interiors.pdf', 'tax invoice INV-SH1/2026 for AED 10,500.00'],
    [dn, 'delivery_note', 'Delivery note DN-SH1/2026', 'DN-SH1-2026_Gulf-Horizon-Interiors.pdf', 'delivery note DN-SH1/2026']]
  const downloads = async id => (await one(`select count(*)::int n from sales_doc_events where invoice_id=$1 and event='downloaded'`, [id])).n
  for (const [id, k, docLabel, fname, inMsg] of SALES) {
    await p.goto(`${BASE}/invoices/${id}`); await settle(p, 900)
    if (k === 'quotation') ok(await p.getByRole('button', { name: /Send quotation via WhatsApp/ }).first().isVisible(), 'WhatsApp Business "Send" button still there')
    await p.getByRole('button', { name: 'More actions' }).click(); await p.getByRole('menuitem', { name: 'Share on WhatsApp…' }).click(); await sheet().waitFor(); await settle(p, 600)
    const st = await sheet().innerText(), mg = await sheet().locator('[data-share-message]').inputValue()
    ok(st.includes('Gulf Horizon Interiors') && st.includes(docLabel) && st.includes(fname) && (await sheet().locator('[data-share-phone]').innerText()) === '+971 50 999 8877' && mg.includes(inMsg), `${k}: customer, WhatsApp number, ${fname}, its own message`)
    ok((await sheet().locator('[data-share-preview]').getAttribute('src')).endsWith('/pdf?view=1') && await downloads(id) === 0, `${k}: preview opens inline (not as a download) and is not counted as a download`)
    const [dlS] = await Promise.all([p.waitForEvent('download'), sheet().locator('[data-share-open]').click()])
    ok(dlS.suggestedFilename() === fname && (await p.evaluate(() => window.__opened.at(-1))).startsWith('https://wa.me/971509998877?text='), `${k}: the PDF downloads under the name the sheet tells you to attach (${dlS.suggestedFilename()}), and the customer chat opened`)
    const fsz = fs.statSync(await dlS.path()).size
    ok(fsz > 1000 && fs.readFileSync(await dlS.path()).subarray(0, 5).toString() === '%PDF-', `${k}: the downloaded file is a real PDF (${fsz} bytes)`)
    await p.waitForTimeout(500)
    if (k === 'quotation') ok((await one(`select count(*)::int n from sales_doc_events where invoice_id=$1 and event='whatsapp'`, [qt])).n === 1, 'the existing "shared on WhatsApp" event is still recorded on the document')
    await p.keyboard.press('Escape')
  }

  console.log('\n[6] Android phone: the PDF file itself goes to the share menu, for all five documents')
  const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36'
  // the browser's share menu and clipboard are recorded: exactly what the page hands over (keys, file name, type, bytes)
  const mockShare = ({ files }) => {
    navigator.canShare = d => files && !!d?.files?.length && d.files.every(f => f instanceof File && f.type === 'application/pdf')
    navigator.share = async d => {
      const f = d.files?.[0], b = f ? new Uint8Array(await f.arrayBuffer()) : null; let bin = ''; if (b) for (const x of b) bin += String.fromCharCode(x)
      window.__shared = { keys: Object.keys(d), count: d.files?.length ?? 0, name: f?.name, type: f?.type, size: f?.size, head: bin.slice(0, 5), b64: b ? btoa(bin) : '' }
    }
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async t => { window.__copied = t } } })
  }
  const phoneCtx = async files => { const c = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: ANDROID, acceptDownloads: true, storageState: await ctx.storageState() }); await c.addInitScript(spyOpen); await c.addInitScript(mockShare, { files }); return c }
  const mctx = await phoneCtx(true), m = watch(await mctx.newPage()), mPage = m
  const fileReady = page => page.waitForFunction(() => document.querySelector('dialog[open] [data-share-sheet]')?.getAttribute('data-share-file') === 'ready', null, { timeout: 20000 })
  const phoneShare = async (open, what, m = mPage) => {
    await m.evaluate(() => { window.__shared = null; window.__copied = null })
    await open(); await sheet(m).waitFor(); await fileReady(m)
    const how = await sheet(m).locator('[data-share-how]').innerText(), msg = await sheet(m).locator('[data-share-message]').inputValue(), to = await sheet(m).locator('[data-share-phone]').innerText()
    await sheet(m).locator('[data-share-native]').click(); await m.waitForFunction(() => !!window.__shared, null, { timeout: 10000 }); await sheet(m).locator('[data-share-done]').waitFor()
    const sh = await m.evaluate(() => window.__shared), done = await sheet(m).locator('[data-share-done]').innerText(), copied = await m.evaluate(() => window.__copied)
    const text = sh.b64 ? pdfToText(Buffer.from(sh.b64, 'base64')) : ''
    ok(how.includes('The PDF goes into WhatsApp as a file') && sheet(m).locator('[data-share-native]') && (await sheet(m).locator('[data-share-native]').innerText()).includes('Share PDF to WhatsApp'), `${what}: "Share PDF to WhatsApp" is the main action, with how it works`)
    ok(sh.count === 1 && sh.type === 'application/pdf' && sh.head === '%PDF-' && sh.size > 150, `${what}: one real PDF file handed to the share menu (${sh.name}, ${sh.size} bytes, ${sh.type})`)
    ok(sh.keys.join() === 'files', `${what}: only the file is shared (no text that makes WhatsApp drop the PDF)`)
    ok(copied === msg && done.includes('The PDF was passed to the share menu') && done.includes('paste the message'), `${what}: the message is copied to paste as the caption, and the sheet says so`)
    return { sh, text, to, msg }
  }
  await m.goto(`${BASE}/salary/${ali}`); await settle(m)
  const r1 = await phoneShare(() => m.getByRole('button', { name: `Share the ${label} payslip via WhatsApp` }).click(), 'payslip')
  ok(/^Payslip_Ali-Hassan_\d{4}-\d{2}\.pdf$/.test(r1.sh.name) && /PAYSLIP/.test(r1.text) && r1.text.includes('Ali Hassan') && r1.text.includes(label) && r1.to === '+971 50 111 2222', `payslip: the shared file is Ali's ${label} payslip, for +971 50 111 2222`)
  ok((await one(`select count(*)::int n from document_shares where record_id=$1 and method='native_share'`, [aliAcc])).n === 1, 'logged as a native share')
  ok(await m.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 1 && (await m.locator('dialog[open]').boundingBox()).width <= 391, 'sheet fits the phone')
  await m.screenshot({ path: `${OUT}/m-share.png` })
  // text-only chat link on the phone: opens the chat with the message, downloads nothing, and does not claim a PDF
  const noDl = m.waitForEvent('download', { timeout: 1500 }).then(() => true, () => false)
  await sheet(m).locator('[data-share-open]').click()
  ok(!(await noDl) && decodeURIComponent((await m.evaluate(() => window.__opened.at(-1))) ?? '').includes('Please find your payslip') && (await sheet(m).locator('[data-share-open]').innerText()).includes('text only'), 'phone: "Open chat with message (text only)" opens the chat with the message and downloads nothing')
  await m.keyboard.press('Escape'); await m.waitForTimeout(300)
  const r2 = await phoneShare(() => m.locator(`[data-payment="${payA}"]`).getByRole('button', { name: /salary receipt via WhatsApp/ }).click(), 'salary receipt')
  ok(/^Salary_receipt_Ali-Hassan_\d{4}-\d{2}-\d{2}\.pdf$/.test(r2.sh.name) && /Amount paid\s+2,000\.00/.test(r2.text) && r2.text.includes('CASH-1') && r2.to === '+971 50 111 2222', `salary receipt: the shared file is the AED 2,000.00 receipt (CASH-1), for Ali`)
  await m.keyboard.press('Escape')
  for (const [id, k, , fname] of SALES) {
    await m.goto(`${BASE}/invoices/${id}`); await settle(m, 900)
    const r = await phoneShare(() => m.locator('[data-share-capsule]').click(), k)
    ok(r.sh.name === fname && r.text.includes(k === 'quotation' ? 'AS-SH1/2026' : k === 'invoice' ? 'INV-SH1/2026' : 'DN-SH1/2026') && r.text.includes('Gulf Horizon Interiors') && r.to === '+971 50 999 8877', `${k}: the phone capsule shares ${fname} (the right document, for Gulf Horizon Interiors)`)
    await m.keyboard.press('Escape')
  }
  await mctx.close()

  console.log('\n[7] Phone browser that cannot share files: download + chat, said plainly')
  const nctx = await phoneCtx(false), n = watch(await nctx.newPage())
  await n.goto(`${BASE}/salary/${ali}`); await settle(n)
  await n.getByRole('button', { name: `Share the ${label} payslip via WhatsApp` }).click(); await sheet(n).waitFor(); await settle(n, 400)
  ok(!(await sheet(n).locator('[data-share-native]').count()) && (await sheet(n).getAttribute('data-share-mode')) === 'manual' && (await sheet(n).locator('[data-share-how]').innerText()).includes('cannot attach the PDF to WhatsApp automatically'), 'no file sharing: no share button, and the sheet says the PDF must be attached by hand')
  const [dln] = await Promise.all([n.waitForEvent('download'), sheet(n).locator('[data-share-open]').click()])
  ok(/^Payslip_Ali-Hassan_/.test(dln.suggestedFilename()) && (await n.evaluate(() => window.__opened.at(-1))).startsWith('https://wa.me/971501112222') && (await sheet(n).locator('[data-share-done]').innerText()).includes('The PDF is not attached yet'), 'PDF downloaded, chat opened, "not attached yet" shown')
  await nctx.close()

  console.log('\n[8] A reply that is not a PDF is never shared')
  const fctx = await phoneCtx(true), f = watch(await fctx.newPage())
  await f.route('**/api/salary-payslips/*?share=1', r => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Sign in</title>' }))
  await f.goto(`${BASE}/salary/${ali}`); await settle(f)
  await f.getByRole('button', { name: `Share the ${label} payslip via WhatsApp` }).click(); await sheet(f).waitFor()
  await f.waitForFunction(() => document.querySelector('dialog[open] [data-share-sheet]')?.getAttribute('data-share-file') === 'failed', null, { timeout: 15000 })
  ok((await sheet(f).locator('[data-share-file-error]').innerText()).includes('did not return a PDF') && !(await sheet(f).locator('[data-share-native]').count()) && !(await f.evaluate(() => window.__shared)), 'a sign-in page instead of the PDF: refused, nothing shared, the sheet explains and offers manual attach')
  await f.unroute('**/api/salary-payslips/*?share=1')
  await sheet(f).locator('[data-share-retry]').click(); await fileReady(f)
  ok(await sheet(f).locator('[data-share-native]').isEnabled(), '"Try again" fetches the real PDF and the share button is ready')
  await fctx.close()

  console.log('\n[8b] More documents: salary statement, customer receipt, customer statement, employee PDF; list and toolbar entry points')
  const pay1 = (await one(`insert into payments(company_id,invoice_id,customer_id,amount,paid_on,method,reference) values ($1,$2,$3,2500,$4,'bank_transfer','TT-77') returning id`, [co, inv, cust, today])).id
  // desktop: open the sheet, check it, download what it names, return the file's text
  const deskShare = async (open, what, { name, fname, msgHas, docHas }) => {
    await open(); await sheet().waitFor(); await settle(p, 500)
    const st = await sheet().innerText(), mg = await sheet().locator('[data-share-message]').inputValue(), to = await sheet().locator('[data-share-phone]').innerText().catch(() => '')
    ok(st.includes(name) && (typeof fname === 'string' ? st.includes(fname) : fname.test(st)) && mg.includes(msgHas) && (await sheet().locator('[data-share-how]').innerText()).includes('cannot attach the PDF to WhatsApp automatically'), `${what}: recipient ${name} (${to}), its file name and message, manual-attach instruction`)
    const [d] = await Promise.all([p.waitForEvent('download'), sheet().locator('[data-share-open]').click()])
    const buf = fs.readFileSync(await d.path()), txt = buf.subarray(0, 5).toString() === '%PDF-' ? `${(() => { try { return pdfToText(buf) } catch { return '' } })()}\n${buf.toString('latin1')}` : ''
    ok((typeof fname === 'string' ? d.suggestedFilename() === fname : fname.test(d.suggestedFilename())) && st.includes(d.suggestedFilename()) && docHas.every(x => txt.toLowerCase().includes(x.toLowerCase())) && (await p.evaluate(() => window.__opened.at(-1))).startsWith('https://wa.me/'), `${what}: ${d.suggestedFilename()} downloaded (the right document) and the chat opened`)
    await p.keyboard.press('Escape'); await p.waitForTimeout(300)
  }
  await p.goto(`${BASE}/salary/${ali}`); await settle()
  await deskShare(() => p.locator('[data-statement]').getByRole('button', { name: 'Share' }).click(), 'salary statement',
    { name: 'Ali Hassan', fname: /Salary_statement_Ali-Hassan_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.pdf/, msgHas: 'Please find attached your salary statement from', docHas: ['Salary statement', 'Ali Hassan', 'W-01'] })
  await p.goto(`${BASE}/invoices?tab=payments`); await settle()
  await deskShare(() => p.locator('[data-share=customer_receipt]').first().click(), 'customer payment receipt (payments list)',
    { name: 'Gulf Horizon Interiors', fname: `Receipt_Gulf-Horizon-Interiors_${today}.pdf`, msgHas: 'Thank you for your payment of AED 2,500.00', docHas: ['2,500.00', 'Gulf Horizon Interiors', 'INV-SH1/2026'] })
  ok(await p.getByRole('button', { name: 'Send payment receipt via WhatsApp' }).first().isVisible(), 'payments list: WhatsApp Business receipt button kept, labelled separately')
  await p.goto(`${BASE}/invoices/${inv}`); await settle(p, 900)
  ok(await p.locator('[data-payment-panel] [data-share=customer_receipt]').count() === 1, 'invoice page: each recorded payment can share its receipt')
  ok(await p.locator('[data-share-toolbar]').isVisible() && (await p.getByRole('button', { name: 'Send tax invoice via WhatsApp' }).first().innerText()).includes('Business'), 'editor toolbar: "Share" (free, with PDF) and the WhatsApp Business button labelled "Business"')
  await p.locator('[data-share-toolbar]').click(); await sheet().waitFor()
  ok((await sheet().innerText()).includes('Tax invoice INV-SH1/2026'), 'toolbar "Share" opens the sheet for this invoice'); await p.keyboard.press('Escape')
  await p.goto(`${BASE}/parties/${cust}`); await settle()
  await deskShare(() => p.getByRole('button', { name: 'Share statement' }).click(), 'customer statement',
    { name: 'Gulf Horizon Interiors', fname: `Statement_Gulf-Horizon-Interiors_${today}.pdf`, msgHas: 'statement of account as of', docHas: ['Gulf Horizon Interiors', 'INV-SH1/2026'] })
  ok(await p.getByRole('button', { name: 'Send statement with WhatsApp Business' }).isVisible(), 'customer page: WhatsApp Business statement kept, labelled "Business"')
  for (const [tab, num] of [['quotation', 'AS-SH1/2026'], ['invoice', 'INV-SH1/2026'], ['delivery_note', 'DN-SH1/2026']]) {
    await p.goto(`${BASE}/invoices?tab=${tab}`); await settle()
    await p.getByRole('button', { name: new RegExp(`Share .* ${num.replace('/', '\\/')} via WhatsApp`) }).click(); await sheet().waitFor()
    ok((await sheet().innerText()).includes(num) && (await sheet().locator('[data-share-phone]').innerText()) === '+971 50 999 8877', `${tab} list: the row's share button opens ${num} for the customer`); await p.keyboard.press('Escape'); await p.waitForTimeout(300)
  }
  // employee file: a PDF can be shared with the employee; an image cannot (it is downloaded instead)
  const mini = t => Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\ntrailer<</Root 1 0 R>>\n%% ${t}\n%%EOF`)
  const addDoc = async (name, file) => {
    await p.goto(`${BASE}/employees/${ali}?tab=documents`); await settle()
    await p.getByRole('button', { name: 'Add' }).first().click(); const dg = p.locator('dialog[open]')
    await dg.getByLabel('Document name *').fill(name); await dg.getByLabel('Category *').selectOption({ index: 1 }); await dg.locator('input[type=file]').setInputFiles(file)
    await dg.getByRole('button', { name: 'Save document' }).click(); await settle(p, 1500)
  }
  await addDoc('Labour contract Ali', { name: 'labour-contract-ali.pdf', mimeType: 'application/pdf', buffer: mini('contract-ali') })
  await addDoc('Photo Ali', { name: 'photo-ali.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64') })
  const docPdf = (await one(`select id from documents where name='Labour contract Ali'`)).id
  ok(await p.locator('[data-share=employee_document]').count() === 1, "employee file: only the PDF has a share button (the image does not)")
  await deskShare(() => p.locator('[data-share=employee_document]').click(), 'employee document', { name: 'Ali Hassan', fname: 'labour-contract-ali.pdf', msgHas: 'Please find attached your document', docHas: ['contract-ali'] })
  ok((await one(`select count(*)::int n from document_shares where doc_kind='employee_document' and record_id=$1`, [docPdf])).n === 1, 'employee document share logged')
  // phone: the same four documents go to the share menu as real PDF files
  const m2ctx = await phoneCtx(true), m2 = watch(await m2ctx.newPage())
  await m2.goto(`${BASE}/salary/${ali}`); await settle(m2)
  let r = await phoneShare(() => m2.locator('[data-statement]').getByRole('button', { name: 'Share' }).click(), 'phone: salary statement', m2)
  ok(/^Salary_statement_Ali-Hassan_/.test(r.sh.name) && /salary statement/i.test(r.text) && r.text.includes('Ali Hassan'), `phone: the salary statement PDF itself (${r.sh.name})`); await m2.keyboard.press('Escape')
  await m2.goto(`${BASE}/parties/${cust}`); await settle(m2)
  r = await phoneShare(() => m2.locator('[data-share=customer_receipt]').first().click(), 'phone: customer receipt', m2)
  ok(r.sh.name === `Receipt_Gulf-Horizon-Interiors_${today}.pdf` && r.text.includes('2,500.00') && r.to === '+971 50 999 8877', `phone: the payment receipt PDF for Gulf Horizon Interiors (${r.sh.name})`); await m2.keyboard.press('Escape'); await m2.waitForTimeout(300)
  r = await phoneShare(() => m2.getByRole('button', { name: 'Share statement' }).click(), 'phone: customer statement', m2)
  ok(r.sh.name === `Statement_Gulf-Horizon-Interiors_${today}.pdf` && r.text.includes('INV-SH1/2026'), `phone: the statement of account PDF (${r.sh.name})`); await m2.keyboard.press('Escape')
  await m2.goto(`${BASE}/employees/${ali}?tab=documents`); await settle(m2)
  r = await phoneShare(() => m2.locator('[data-share=employee_document]').click(), 'phone: employee document', m2)
  ok(r.sh.name === 'labour-contract-ali.pdf' && Buffer.from(r.sh.b64, 'base64').toString('latin1').includes('contract-ali') && r.to === '+971 50 111 2222', 'phone: the employee\'s own PDF file, for Ali'); await m2.keyboard.press('Escape')
  await m2ctx.close()
  const anon2 = await browser.newContext()
  const ar2 = await anon2.request.get(`${BASE}/api/payment-receipts/${pay1}`, { maxRedirects: 0 })
  ok(ar2.status() !== 200 && !(ar2.headers()['content-type'] ?? '').includes('pdf'), `not signed in: no payment receipt (${ar2.status()})`); await anon2.close()

  console.log('\n[9] Balances unchanged by sharing')
  ok(await owed(ali) === before.owed && (await one(`select count(*)::int n from salary_payments where company_id=$1`, [co])).n === before.pays && (await one(`select count(*)::int n from salary_ledger where company_id=$1`, [co])).n === before.acc, 'nothing posted, paid or changed by sharing')

  console.log('\n[10] Editable messages in Settings')
  await p.goto(`${BASE}/settings#wa-share`); await settle()
  const tpl = p.locator('[data-share-template=payslip]'); await tpl.locator('summary').click()
  await tpl.locator('textarea[name=body]').fill('Salam {employee}, your {period} payslip from {company} is attached.'); await tpl.getByRole('button', { name: 'Save message' }).click(); await settle(p, 800)
  await tpl.locator('textarea[name=body]').fill('Hi {employee}, you are owed {balance}'); await tpl.getByRole('button', { name: 'Save message' }).click(); await p.waitForTimeout(800)
  ok((await tpl.innerText()).includes('{balance} is not available'), 'a placeholder the payslip does not have is refused')
  await p.goto(`${BASE}/salary/${ali}`); await settle()
  await p.getByRole('button', { name: `Share the ${label} payslip via WhatsApp` }).click(); await sheet().waitFor()
  ok((await sheet().locator('[data-share-message]').inputValue()) === `Salam Ali Hassan, your ${label} payslip from Al Saqr Share Test is attached.`, 'the saved message is used')
  await p.keyboard.press('Escape')

  console.log('\n[11] Nothing public; employees see only their own payslips')
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
