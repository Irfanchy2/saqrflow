// Employee Petty Cash, end to end: the admin issues petty cash (company cash −1,000 once); the employee sees it in the
// portal (phone), submits a business expense paid from petty cash, reports money received and a return; the admin
// confirms each (red dot, Approval Center), approves the expense (wallet deducted once, no second cash movement),
// adjusts, pays a reimbursement for an expense paid with own money; statement PDF, CSV, WhatsApp share; employee
// isolation; salary untouched; phone layout. Real Next build + PostgREST + Postgres RLS + Chromium. Run via scripts/e2e.sh
import { chromium } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import pg from 'pg'

const BASE = process.env.E2E_BASE
const OUT = 'tests/e2e/shots/petty'; fs.mkdirSync(OUT, { recursive: true })
const results = []
const ok = (cond, msg) => { results.push([!!cond, msg]); console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`) }
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
const exe = fs.readdirSync('/opt/pw-browsers').filter(d => d.startsWith('chromium-')).map(d => `/opt/pw-browsers/${d}/chrome-linux/chrome`).find(p => fs.existsSync(p))
const browser = await chromium.launch({ executablePath: exe })
const jsErrors = []
const watch = page => { page.on('pageerror', e => jsErrors.push(`${page.url()}: ${e.message}`)); page.on('dialog', d => d.accept()); return page }
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const p = watch(await ctx.newPage())
const settle = async (page = p, ms = 500) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(ms) }
const dlg = page => page.locator('dialog[open]')
const stamp = Date.now(), OWNER = `petty-owner-${stamp}@alsaqr.test`, EMP = `petty-emp-${stamp}@alsaqr.test`
const bal = async emp => Number((await one(`select coalesce(sum(amount),0) s from petty_cash_entries where employee_id=$1 and book='wallet'`, [emp])).s)
const due = async emp => Number((await one(`select coalesce(sum(amount),0) s from petty_cash_entries where employee_id=$1 and book='reimbursement'`, [emp])).s)
const cash = async acct => Number((await one(`select coalesce(sum(amount),0) s from bank_transactions where bank_id=$1`, [acct])).s)
const pdfText = buf => { const f = `${OUT}/_tmp.pdf`; fs.writeFileSync(f, buf); try { return execFileSync('pdftotext', ['-layout', f, '-'], { encoding: 'utf8' }) } catch { return buf.toString('latin1') } }

try {
  console.log('\n[0] Setup: owner, company, employee with a portal login, a cash box account, a project, a salary record')
  await p.goto(`${BASE}/signup`); await p.getByLabel('Work email').fill(OWNER); await p.getByLabel('Password').fill('correct-horse-battery'); await p.getByRole('button', { name: 'Create account' }).click()
  await p.waitForURL('**/onboarding'); await p.getByLabel('Company name').fill('Al Saqr Petty Cash Test'); await p.getByLabel('Your full name').fill('Owner'); await p.getByRole('button', { name: 'Create company' }).click(); await p.waitForURL(`${BASE}/`)
  const co = (await one(`select p.company_id from profiles p join auth.users u on u.id=p.id where u.email=$1`, [OWNER])).company_id
  const today = (await one(`select (now() at time zone coalesce(timezone,'Asia/Dubai'))::date::text d from companies where id=$1`, [co])).d
  const emp = (await one(`insert into employees(company_id,employee_no,full_name,designation,status) values ($1,'E-201','Mohammed Ayub','Site supervisor','active') returning id`, [co])).id
  const other = (await one(`insert into employees(company_id,employee_no,full_name,status) values ($1,'E-202','Imran Ali','active') returning id`, [co])).id
  await db.query(`insert into employee_compensation(employee_id,company_id,monthly_salary) values ($1,$2,4000)`, [emp, co])
  await db.query(`insert into salary_payments(company_id,employee_id,period,amount,paid_on,method) values ($1,$2,date_trunc('month',$3::date)::date,1500,$3,'cash')`, [co, emp, today])
  await db.query(`insert into employee_advances(company_id,employee_id,kind,amount,given_on,monthly_recovery) values ($1,$2,'advance',600,$3,200)`, [co, emp, today])
  const box = (await one(`insert into banks(company_id,name,account_display_name,is_account,account_type) values ($1,'Office cash box','Main',true,'cash') returning id`, [co])).id
  await db.query(`insert into projects(company_id,name,status) values ($1,'Site A','active')`, [co])
  const salarySnap = async () => (await one(`select md5(coalesce((select string_agg(row(x.*)::text,'|' order by x.id) from salary_payments x where company_id=$1),'') || coalesce((select string_agg(row(x.*)::text,'|' order by x.id) from employee_advances x where company_id=$1),'') || coalesce((select string_agg(row(x.*)::text,'|' order by x.id) from salary_ledger x where company_id=$1),'')) h`, [co])).h
  const salary0 = await salarySnap()
  await p.goto(`${BASE}/employees/${emp}`); await settle()
  await p.locator('[data-portal-access]').getByRole('button', { name: 'Give portal access' }).click()
  await dlg(p).locator('input[name=email]').fill(EMP); await dlg(p).getByRole('button', { name: 'Give access' }).click(); await settle(p, 1000)
  ok(!!(await one(`select user_id from employees where id=$1`, [emp])).user_id, 'employee has a portal login')

  console.log('\n[1] Admin: Expenses → Petty cash → Issue petty cash AED 1,000 (money handed over, from the cash box)')
  await p.goto(`${BASE}/expenses?tab=petty`); await settle()
  ok(await p.locator('[data-petty-overview]').isVisible(), 'Petty cash overview with totals')
  await p.getByRole('button', { name: 'Issue petty cash' }).first().click(); await settle(p, 400)
  const d = dlg(p)
  await d.locator('select[name=employee_id]').selectOption(emp); await d.locator('input[name=amount]').fill('1000')
  await d.locator('input[name=purpose]').fill('Materials purchase for Site A'); await d.locator('select[name=project_id]').selectOption({ label: 'Site A' })
  await d.locator('select[name=paid_from_bank_id]').selectOption(box)
  await p.screenshot({ path: `${OUT}/desk-issue.png` })
  await d.getByRole('button', { name: 'Confirm money handed over' }).click(); await settle(p, 1200)
  ok(await bal(emp) === 1000, `wallet: AED 1,000 (${await bal(emp)})`)
  ok(await cash(box) === -1000, `company cash box: −1,000 once (${await cash(box)})`)
  ok((await one(`select count(*)::int n from project_expenses where company_id=$1`, [co])).n === 0, 'issuing petty cash is not an expense')
  await p.goto(`${BASE}/expenses?tab=petty`); await settle()
  ok((await p.locator(`[data-petty-wallet="${emp}"]`).innerText()).includes('1,000.00'), 'wallet listed with AED 1,000.00 available')

  console.log('\n[2] Employee on a phone: sees the balance, submits an expense from petty cash, reports money received and a return')
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }); const m = watch(await mctx.newPage())
  await m.goto(`${BASE}/login`); await m.getByLabel('Email').fill(EMP); await m.getByLabel('Password').fill('invited-password-123'); await m.getByRole('button', { name: 'Sign in' }).click()
  await m.waitForURL(u => new URL(u).pathname === '/me', { timeout: 15000 }).catch(() => {}); await settle(m)
  ok((await m.locator('[data-petty-card]').innerText()).includes('1,000.00'), 'portal home: Available petty cash AED 1,000.00')
  await m.goto(`${BASE}/me/expenses/petty-cash`); await settle(m)
  ok((await m.locator('[data-petty-available]').innerText()).includes('1,000.00'), 'petty cash page: AED 1,000.00 available')
  ok((await m.locator('main').innerText()).includes('never deducted from your salary'), 'clearly separate from salary')
  await m.screenshot({ path: `${OUT}/m-wallet.png`, fullPage: true })
  // a business expense, paid from petty cash (preselected because the employee holds petty cash)
  await m.locator('[data-claim-manual]:visible').first().click(); await settle(m, 300)
  ok(await dlg(m).locator('select[name=funded_by]').inputValue() === 'petty_cash', '"Paid from": Company petty cash is preselected')
  await dlg(m).locator('input[name=supplier_name]').fill('Gulf Steel Trading'); await dlg(m).getByLabel('Description *').fill('Rebar ties and binding wire')
  await dlg(m).getByLabel('Amount excl. VAT (AED) *').fill('250'); await dlg(m).getByLabel('Category *').selectOption('material')
  await dlg(m).getByRole('button', { name: 'Send for approval' }).click(); await settle(m, 1200)
  const cl = await one(`select id, funded_by, status, amount::float + vat_amount::float t from expense_claims where employee_id=$1 order by created_at desc limit 1`, [emp])
  ok(cl?.funded_by === 'petty_cash' && cl.status === 'pending', `expense sent: pending, paid from petty cash (total ${cl?.t})`)
  ok(await bal(emp) === 1000, 'pending expense does not change the balance')
  // money received from the admin
  await m.goto(`${BASE}/me/expenses/petty-cash`); await settle(m)
  await m.getByRole('button', { name: 'Add petty cash received' }).click(); await settle(m, 300)
  await dlg(m).locator('input[name=amount]').fill('500'); await dlg(m).locator('input[name=counterparty]').fill('Owner')
  await dlg(m).locator('input[name=purpose]').fill('Tools'); await dlg(m).getByRole('button', { name: 'Send for approval' }).click(); await settle(m, 1000)
  // and a return
  await m.getByRole('button', { name: 'Return unused petty cash' }).click(); await settle(m, 300)
  await dlg(m).locator('input[name=amount]').fill('100'); await dlg(m).locator('input[name=counterparty]').fill('Owner'); await dlg(m).getByRole('button', { name: 'Send for confirmation' }).click(); await settle(m, 1000)
  const reqs = (await db.query(`select id, kind, status, amount::float a from petty_cash_requests where employee_id=$1 order by created_at`, [emp])).rows
  ok(reqs.length === 2 && reqs.every(r => r.status === 'pending'), 'two reports pending admin approval')
  ok(await bal(emp) === 1000, 'reports do not change the balance before approval')
  ok((await m.locator('[data-petty-open]').innerText()).includes('Pending admin approval'), 'employee sees them as Pending admin approval')
  await m.screenshot({ path: `${OUT}/m-pending.png`, fullPage: true })
  const over = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  ok(over <= 1, `phone: no sideways scrolling on the petty cash page (${over}px)`)

  console.log('\n[3] Admin: red dot, Approval Center, confirm the reports')
  await p.goto(`${BASE}/approvals`); await settle()
  ok(await p.locator('[data-petty-banner]').isVisible(), 'Approval Center: petty cash reports waiting')
  await p.goto(`${BASE}/banking`); await settle()
  const dot = p.locator('nav[aria-label="Section"] a', { hasText: 'Expenses' }).locator('[data-nav-dot]')
  ok(await dot.count() === 1 && (await dot.getAttribute('aria-label')) === '3 waiting', `red dot beside Expenses: 1 claim + 2 reports (${await dot.getAttribute('aria-label').catch(() => '')})`)
  ok((await one(`select count(*)::int n from in_app_notifications n join auth.users u on u.id=n.user_id where u.email=$1 and n.link like '/expenses?tab=petty&open=%'`, [OWNER])).n === 2, 'owner notified of both reports')
  const rec = reqs.find(r => r.kind === 'received'), ret = reqs.find(r => r.kind === 'return')
  await p.goto(`${BASE}/expenses?tab=petty&view=requests&open=${rec.id}`); await settle()
  ok(await p.locator('[data-petty-match] input[value=new]').isChecked(), 'no recorded hand-over matches: "New money" is chosen')
  await p.locator('[data-petty-decide]').getByRole('button', { name: 'Save decision' }).click(); await settle(p, 1200)
  ok(await bal(emp) === 1500, `confirmed: wallet AED 1,500 (${await bal(emp)})`)
  await p.goto(`${BASE}/expenses?tab=petty&view=requests&open=${ret.id}`); await settle()
  await p.locator('[data-petty-decide] select[name=deposit_bank_id]').selectOption(box)
  await p.locator('[data-petty-decide]').getByRole('button', { name: 'Save decision' }).click(); await settle(p, 1200)
  ok(await bal(emp) === 1400 && await cash(box) === -900, `return confirmed: wallet 1,400, cash box back up by 100 (${await bal(emp)}, ${await cash(box)})`)
  ok((await one(`select count(*)::int n from in_app_notifications where company_id=$1 and link='/me/expenses/petty-cash' and title like 'Petty cash%confirmed'`, [co])).n === 2, 'employee told both were confirmed')

  console.log('\n[4] Admin approves the expense: settled from petty cash once, no second cash movement')
  await p.goto(`${BASE}/expenses?tab=claims&open=${cl.id}`); await settle()
  ok((await p.locator('[data-claim-detail]').innerText()).includes('Company petty cash'), 'claim shows "Paid from: Company petty cash" and the balance held')
  ok(await p.locator('[data-claim-settle] input[name=petty]').inputValue() === cl.t.toFixed(2), `settlement defaults to the full ${cl.t.toFixed(2)} from petty cash`)
  await p.locator('[data-claim-decide]').getByRole('button', { name: 'Save decision' }).click(); await settle(p, 1500)
  ok(Math.abs(await bal(emp) - (1400 - cl.t)) < 0.001, `wallet after the expense: ${(1400 - cl.t).toFixed(2)} (${await bal(emp)})`)
  const ex = await one(`select amount::float + vat_amount::float t, paid_from_bank_id from project_expenses where expense_claim_id=$1`, [cl.id])
  ok(ex && ex.t === cl.t && ex.paid_from_bank_id === null, 'expense recognised once, with no company account (no double count)')
  ok(await cash(box) === -900, 'company cash unchanged by the settlement')
  await p.goto(`${BASE}/expenses?tab=claims&open=${cl.id}`); await settle()
  ok(await p.locator('[data-claim-settlement]').isVisible(), 'approved claim shows how it was settled')

  console.log('\n[5] Wallet page: statement, adjust, personal-money expense and partial reimbursement')
  await p.goto(`${BASE}/expenses/petty-cash/${emp}`); await settle()
  const stmt = await p.locator('[data-petty-statement]').innerText()
  ok(['Petty cash received', 'Approved expense settled', 'Petty cash returned', (1400 - cl.t).toLocaleString('en-US', { minimumFractionDigits: 2 })].every(s => stmt.includes(s)), 'statement: received, settled, returned and the closing balance')
  await p.getByRole('button', { name: 'Adjust' }).click(); await settle(p, 300)
  await dlg(p).locator('input[name=amount]').fill('12.5'); await dlg(p).locator('input[name=reason]').fill('Cash count short')
  await dlg(p).getByRole('button', { name: 'Record adjustment' }).click(); await settle(p, 1200)
  ok(Math.abs(await bal(emp) - (1387.5 - cl.t)) < 0.001, 'authorized adjustment −12.50 with its reason')
  const pc = (await one(`insert into expense_claims(company_id,employee_id,spent_on,description,amount,funded_by,supplier_name) values ($1,$2,$3,'Taxi to site',250,'personal','Dubai Taxi') returning id`, [co, emp, today])).id
  const w0 = await bal(emp)
  await p.goto(`${BASE}/expenses?tab=claims&open=${pc}`); await settle()
  await p.locator('[data-claim-decide]').getByRole('button', { name: 'Save decision' }).click(); await settle(p, 1500)
  ok(await bal(emp) === w0 && await due(emp) === 250, `own money AED 250: wallet unchanged, reimbursement due 250 (${await due(emp)})`)
  await p.goto(`${BASE}/expenses/petty-cash/${emp}`); await settle()
  await p.getByRole('button', { name: 'Pay reimbursement' }).click(); await settle(p, 300)
  await dlg(p).locator('input[name=amount]').fill('100'); await dlg(p).locator('select[name=paid_from_bank_id]').selectOption(box)
  await dlg(p).getByRole('button', { name: 'Record payment' }).click(); await settle(p, 1200)
  ok(await due(emp) === 150 && await cash(box) === -1000, `paid back 100: 150 still due; cash box −100 (${await due(emp)}, ${await cash(box)})`)
  await p.screenshot({ path: `${OUT}/desk-wallet.png`, fullPage: true })

  console.log('\n[6] Reverse a mistake: the entry stays, an opposite entry is added')
  await p.goto(`${BASE}/expenses/petty-cash/${emp}`); await settle()
  const adjRow = p.locator('[data-petty-row="adjustment"]')
  await adjRow.getByRole('button', { name: /Reverse/ }).click(); await settle(p, 300)
  await dlg(p).locator('textarea[name=reason]').fill('Recounted: nothing missing'); await dlg(p).getByRole('button', { name: 'Reverse' }).click(); await settle(p, 1200)
  ok(Math.abs(await bal(emp) - (1400 - cl.t)) < 0.001, 'adjustment reversed: balance restored')
  ok((await one(`select count(*)::int n from petty_cash_entries where employee_id=$1 and kind in ('adjustment','reversal')`, [emp])).n === 2, 'both entries kept (nothing deleted)')

  console.log('\n[7] Statement PDF, CSV, WhatsApp share')
  const pdf = await ctx.request.get(`${BASE}/api/petty-cash/${emp}/statement`)
  const txt = pdfText(await pdf.body())
  ok(pdf.headers()['content-type'] === 'application/pdf' && /PETTY CASH STATEMENT/i.test(txt) && txt.includes('Mohammed Ayub') && txt.includes((1400 - cl.t).toLocaleString('en-US', { minimumFractionDigits: 2 })), 'statement PDF: title, employee, closing balance')
  const csv = await (await ctx.request.get(`${BASE}/api/petty-cash/export?employee=${emp}`)).text()
  ok(csv.includes('Petty cash received') && csv.includes('Reimbursement paid') && csv.includes('Mohammed Ayub'), 'CSV export of the transactions')
  await p.goto(`${BASE}/expenses/petty-cash/${emp}`); await settle()
  await p.locator('[data-petty-statement]').getByRole('button', { name: 'Share' }).click(); await settle(p, 1200)
  const sheet = await p.locator('dialog[open]').innerText().catch(() => '')
  ok(/Petty cash statement/i.test(sheet), 'WhatsApp share sheet opens for the petty cash statement')
  await p.keyboard.press('Escape')

  console.log('\n[8] Employee sees the result; cannot see anyone else; salary untouched')
  await m.goto(`${BASE}/me/expenses/petty-cash`); await settle(m)
  const page = await m.locator('main').innerText()
  ok((await m.locator('[data-petty-available]').innerText()).includes((1400 - cl.t).toLocaleString('en-US', { minimumFractionDigits: 2 })), 'employee balance matches')
  ok(page.includes('150.00') && page.includes('To be paid back to you'), 'employee sees AED 150 still to be paid back')
  ok((await m.request.get(`${BASE}/api/petty-cash/${emp}/statement`)).headers()['content-type'] === 'application/pdf', 'employee downloads their own statement')
  ok((await m.request.get(`${BASE}/api/petty-cash/${other}/statement`)).status() === 403, 'another employee\'s statement: refused')
  const exp = await m.request.get(`${BASE}/api/petty-cash/export`); ok(!/text\/csv/.test(exp.headers()['content-type'] ?? '') && !(await exp.text()).includes('Transaction ID'), 'company CSV: refused for an employee')
  await m.goto(`${BASE}/expenses?tab=petty`); await settle(m)
  ok(!new URL(m.url()).pathname.startsWith('/expenses'), `admin petty cash page: not reachable for the employee (${new URL(m.url()).pathname})`)
  ok(await salarySnap() === salary0, 'salary payments, salary advances and salary ledger completely unchanged')

  console.log('\n[9] Admin on a phone')
  const actx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: await ctx.storageState() })
  const a = watch(await actx.newPage())
  for (const u of ['/expenses?tab=petty', `/expenses/petty-cash/${emp}`]) {
    await a.goto(`${BASE}${u}`); await settle(a)
    const o = await a.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    ok(o <= 1, `phone ${u}: no sideways page scrolling (${o}px)`)
  }
  await a.screenshot({ path: `${OUT}/m-admin-wallet.png`, fullPage: true })
  await actx.close(); await mctx.close()
} catch (e) {
  ok(false, `aborted: ${e.message.split('\n').slice(0, 12).join(' | ')}`); await p.screenshot({ path: `${OUT}/abort.png`, fullPage: true }).catch(() => {})
}
for (const e of jsErrors) ok(false, `JS error ${e}`)
const failed = results.filter(r => !r[0]).length
console.log(`\npetty: ${results.length - failed}/${results.length} passed`)
await browser.close(); await db.end()
process.exit(failed ? 1 : 0)
