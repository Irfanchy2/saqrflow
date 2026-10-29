// Salary accounts in the real app: opening balance, posting months (preview → confirm, never twice), Quick Pay (several
// payments a day, oldest month first, or a chosen month), reversal, advance recovery, adjustments, statement and receipt
// PDFs, existing payment history reconciled, the dashboard filters, phone layout and the employee's own view.
// Real Next build + PostgREST + Postgres RLS + Chromium. Run via scripts/e2e.sh
import { chromium } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import pg from 'pg'

const BASE = process.env.E2E_BASE
const OUT = 'tests/e2e/shots/salary'; fs.mkdirSync(OUT, { recursive: true })
const results = []
const ok = (cond, msg) => { results.push([!!cond, msg]); console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`) }
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
const exe = fs.readdirSync('/opt/pw-browsers').filter(d => d.startsWith('chromium-')).map(d => `/opt/pw-browsers/${d}/chrome-linux/chrome`).find(p => fs.existsSync(p))
const browser = await chromium.launch({ executablePath: exe })
const jsErrors = []
const watch = page => { page.on('pageerror', e => jsErrors.push(`${page.url()}: ${e.message}`)); page.on('dialog', d => d.accept()); return page }
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true }); const p = watch(await ctx.newPage())
const settle = async (page = p, ms = 500) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(ms) }
const dlg = (page = p) => page.locator('dialog[open]')
const stamp = Date.now(), OWNER = `salary-owner-${stamp}@alsaqr.test`, EMP = `salary-emp-${stamp}@alsaqr.test`
const owed = async emp => Number((await one(`select outstanding from salary_accounts where employee_id=$1`, [emp])).outstanding)
const label = ym => new Date(`${ym}-01T00:00:00Z`).toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })

/** Quick Pay from whatever page is open: amount, optional month to settle first; returns the success text. */
async function quickPay(page, trigger, amount, { first } = {}) {
  await trigger.click(); await dlg(page).locator('[data-pay-form]').waitFor()
  await dlg(page).getByLabel('Amount (AED) *').fill(String(amount))
  if (first) { await dlg(page).getByText('Advanced: pay a specific month first').click(); const sel = dlg(page).getByLabel('Settle first'); await sel.selectOption(await sel.locator('option', { hasText: first }).getAttribute('value')) }
  await dlg(page).getByRole('button', { name: /Confirm payment/ }).click()
  await dlg(page).locator('[data-pay-done]').waitFor({ timeout: 10000 })
  return dlg(page).innerText()
}

try {
  console.log('\n[0] Setup: owner, company, three employees (one with payments from before the ledger)')
  await p.goto(`${BASE}/signup`); await p.getByLabel('Work email').fill(OWNER); await p.getByLabel('Password').fill('correct-horse-battery'); await p.getByRole('button', { name: 'Create account' }).click()
  await p.waitForURL('**/onboarding'); await p.getByLabel('Company name').fill('Al Saqr Salary Test'); await p.getByLabel('Your full name').fill('Owner'); await p.getByRole('button', { name: 'Create company' }).click(); await p.waitForURL(`${BASE}/`)
  const co = (await one(`select p.company_id from profiles p join auth.users u on u.id=p.id where u.email=$1`, [OWNER])).company_id
  const today = (await one(`select (now() at time zone coalesce(timezone,'Asia/Dubai'))::date::text d from companies where id=$1`, [co])).d
  const M1 = today.slice(0, 7), M0 = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 2, 1)).toISOString().slice(0, 7)
  const mk = async (no, name, salary) => { const id = (await one(`insert into employees(company_id,employee_no,full_name,status) values ($1,$2,$3,'active') returning id`, [co, no, name])).id; await db.query(`insert into employee_compensation(employee_id,company_id,monthly_salary) values ($1,$2,$3)`, [id, co, salary]); return id }
  const ali = await mk('S-01', 'Ali Hassan', 3000), sara = await mk('S-02', 'Sara Khan', 2500), old = await mk('S-03', 'Legacy Worker', 1500)
  // two payments saved by the old screen: the second filed under next month to get past the one-payment-a-month rule
  await db.query(`insert into salary_payments(company_id,employee_id,period,amount,paid_on,method) values ($1,$2,$3,2000,$4,'cash'),($1,$2,$5,1000,$4,'cash')`, [co, old, `${M0}-01`, `${M0}-07`, `${M1}-01`])
  ok(true, `months used: ${label(M0)} (earlier) and ${label(M1)} (current)`)

  console.log('\n[A] Opening balance AED 8,000 + first month AED 3,000 = AED 11,000')
  await p.goto(`${BASE}/salary/${ali}`); await settle()
  await p.locator('[data-opening]').getByRole('button', { name: 'Set opening balance' }).click()
  await dlg().getByLabel('Amount (AED) *').fill('8000'); await dlg().getByLabel('Records start on *').fill(`${M0}-01`); await dlg().getByLabel('Note').fill('Unpaid salary before Averiqo')
  await dlg().getByRole('button', { name: 'Save opening balance' }).click(); await settle(p, 900)
  ok((await one(`select amount::float a, status from salary_ledger where employee_id=$1 and kind='opening'`, [ali]))?.a === 8000, 'opening balance saved once, as its own entry')
  await p.goto(`${BASE}/salary?month=${M0}`); await settle()
  await p.getByRole('button', { name: `Post ${label(M0)} salary` }).click()
  const list = await dlg().locator('[data-post-list]').innerText()
  ok(list.includes('Ali Hassan') && list.includes('Sara Khan') && list.includes('3,000.00'), 'preview lists each employee with the amount that will be posted')
  await dlg().getByRole('button', { name: 'Confirm and post' }).click(); await settle(p, 1000)
  ok((await one(`select count(*)::int n from salary_ledger where company_id=$1 and kind='accrual' and period=$2`, [co, `${M0}-01`])).n === 3, 'month posted for the three employees with a salary')
  ok(await owed(ali) === 11000, 'Ali is owed AED 11,000 (8,000 + 3,000)')
  ok((await p.locator('[data-salary-rows] tr', { hasText: 'Ali Hassan' }).innerText()).includes('11,000.00'), 'dashboard row shows the combined total AED 11,000.00')

  console.log('\n[E] Posting the same month again adds nothing')
  await p.getByRole('button', { name: `Post ${label(M0)} salary` }).click()
  ok((await dlg().innerText()).includes('already posted for everyone'), 'the preview says the month is already posted')
  await p.keyboard.press('Escape')
  ok((await one(`select count(*)::int n from salary_ledger where employee_id=$1 and kind='accrual'`, [ali])).n === 1, 'still one accrual for the month')

  console.log('\n[B] Two partial payments the same day settle the oldest first: AED 7,500 left')
  const done1 = await quickPay(p, p.locator('[data-salary-rows] tr', { hasText: 'Ali Hassan' }).locator('[data-quick-pay]'), 2000)
  ok(done1.includes('AED 2,000.00 recorded') && done1.includes('9,000.00'), 'first payment recorded; 9,000.00 still owed')
  ok(await dlg().getByRole('link', { name: 'Print receipt' }).isVisible() && await dlg().getByRole('link', { name: 'Download receipt' }).isVisible(), 'receipt offered right after paying')
  await dlg().getByRole('button', { name: 'Record another' }).click(); await dlg().locator('[data-pay-form]').waitFor()
  ok((await dlg().locator('[data-pay-outstanding]').innerText()).includes('9,000.00'), 'the next payment starts from the new balance')
  await dlg().getByLabel('Amount (AED) *').fill('1500'); await dlg().getByRole('button', { name: /Confirm payment/ }).click(); await dlg().locator('[data-pay-done]').waitFor({ timeout: 10000 })
  ok((await dlg().innerText()).includes('7,500.00'), 'second payment the same day accepted: 7,500.00 still owed')
  await dlg().getByRole('button', { name: 'Done' }).click(); await settle()
  ok((await one(`select count(*)::int n from salary_payments where employee_id=$1 and paid_on=$2 and status='posted'`, [ali, today])).n === 2, 'two separate payment records on the same day')
  ok((await one(`select remaining::float r from salary_obligations where employee_id=$1 and kind='opening'`, [ali])).r === 4500, 'both settled the oldest obligation (opening balance 4,500 left)')

  console.log('\n[C] Next month adds to what is left: AED 10,500')
  await p.goto(`${BASE}/salary`); await settle()
  await p.getByRole('button', { name: `Post ${label(M1)} salary` }).click(); await dlg().getByRole('button', { name: 'Confirm and post' }).click(); await settle(p, 1000)
  ok(await owed(ali) === 10500, 'AED 10,500 after the new month')
  const row = await p.locator('[data-salary-rows] tr', { hasText: 'Ali Hassan' }).innerText()
  ok(row.includes('7,500.00') && row.includes('3,000.00') && row.includes('10,500.00'), 'row: earlier months 7,500 · this month 3,000 · total 10,500')

  console.log('\n[D/F] More payments, three on one day: 9,500 then 9,250')
  await quickPay(p, p.locator('[data-salary-rows] tr', { hasText: 'Ali Hassan' }).locator('[data-quick-pay]'), 1000); await dlg().getByRole('button', { name: 'Done' }).click(); await settle()
  ok(await owed(ali) === 9500, 'AED 9,500 after AED 1,000')
  await quickPay(p, p.locator('[data-salary-rows] tr', { hasText: 'Ali Hassan' }).locator('[data-quick-pay]'), 250); await dlg().getByRole('button', { name: 'Done' }).click(); await settle()
  ok((await one(`select count(*)::int n from salary_payments where employee_id=$1 and paid_on=$2`, [ali, today])).n === 4 && await owed(ali) === 9250, 'four payments today, each its own record; 9,250 owed')

  console.log('\n[G] A payment aimed at this month settles this month first')
  await p.goto(`${BASE}/salary/${ali}`); await settle()
  await quickPay(p, p.locator('[data-quick-pay]').first(), 500, { first: label(M1) }); await dlg().getByRole('button', { name: 'Done' }).click(); await settle()
  const al = await one(`select o.kind, to_char(o.period,'YYYY-MM') m, a.amount::float a from salary_allocations a join salary_ledger o on o.id=a.obligation_id join salary_payments p on p.id=a.payment_id where p.employee_id=$1 and p.amount=500`, [ali])
  ok(al?.m === M1 && al?.a === 500, `the AED 500 went to ${label(M1)}`)
  ok((await p.locator(`[data-month="${M1}"]`).innerText()).includes('2,500.00'), `month table: ${label(M1)} has 2,500.00 left`)

  console.log('\n[H] Reversing a payment puts it back on what is owed')
  const p250 = (await one(`select id from salary_payments where employee_id=$1 and amount=250`, [ali])).id
  await p.locator(`[data-payment="${p250}"]`).getByRole('button', { name: /Reverse/ }).click()
  await dlg().getByLabel('Reason *').fill('Entered by mistake'); await dlg().getByRole('button', { name: 'Reverse', exact: true }).click(); await settle(p, 1000)
  ok((await one(`select status, reversal_reason from salary_payments where id=$1`, [p250])).status === 'reversed' && await owed(ali) === 9000, 'payment reversed with its reason; 9,000 owed again')
  ok((await p.locator(`[data-payment="${p250}"]`).innerText()).includes('Reversed') && (await p.locator('[data-history]').innerText()).includes('Entered by mistake'), 'shown as reversed, and in the history with the reason')

  console.log('\n[I] An advance is separate until recovered from salary')
  await p.locator('[data-advances]').getByRole('button', { name: 'Advance', exact: true }).click()
  await dlg().locator('input[name=amount]').fill('2000'); await dlg().getByRole('button', { name: 'Save', exact: true }).click(); await settle(p, 900)
  ok(await owed(ali) === 9000, 'giving an advance does not change the salary owed')
  await p.locator('[data-advances]').getByRole('button', { name: 'Recover from salary' }).click()
  await dlg().getByLabel('Amount (AED) *').fill('500'); await dlg().getByRole('button', { name: 'Recover', exact: true }).click(); await settle(p, 1000)
  const adv = await one(`select recovered::float r, remaining::float m from employee_advance_balances where employee_id=$1`, [ali])
  ok(await owed(ali) === 8500 && adv.r === 500 && adv.m === 1500, 'recovery: salary owed 8,500 and advance 1,500 left (each counted once)')

  console.log('\n[Adj] A deduction needs a reason')
  await p.getByRole('button', { name: 'Adjustment' }).click()
  await dlg().getByLabel('Type *').selectOption('deduction'); await dlg().getByLabel('Amount (AED) *').fill('100'); await dlg().getByLabel('Reason *').fill('Lost safety helmet')
  await dlg().getByRole('button', { name: 'Record', exact: true }).click(); await settle(p, 1000)
  ok(await owed(ali) === 8400, 'deduction recorded: 8,400 owed')

  console.log('\n[S] Statement and receipts')
  await p.goto(`${BASE}/salary/${ali}#statement`); await settle()
  ok((await p.locator('[data-closing]').innerText()).includes('8,400.00'), 'statement closing balance 8,400.00 matches the account')
  const [dl] = await Promise.all([p.waitForEvent('download'), p.locator('[data-statement]').getByRole('link', { name: 'PDF' }).click()])
  await dl.saveAs(`${OUT}/statement.pdf`); const stxt = execFileSync('pdftotext', ['-layout', `${OUT}/statement.pdf`, '-']).toString()
  ok(/salary statement/i.test(stxt) && stxt.includes('Ali Hassan') && stxt.includes('Opening balance') && /Salary owed at the end of the period\s+8,400\.00/.test(stxt), 'statement PDF: opening, months, payments and closing 8,400.00')
  const p2000 = (await one(`select id from salary_payments where employee_id=$1 and amount=2000`, [ali])).id
  const r = await p.request.get(`${BASE}/api/payslips/${p2000}`); const rb = await r.body(); fs.writeFileSync(`${OUT}/receipt.pdf`, rb)
  const rtxt = execFileSync('pdftotext', ['-layout', `${OUT}/receipt.pdf`, '-']).toString()
  ok(r.status() === 200 && /salary payment receipt/i.test(rtxt) && rtxt.includes('Opening balance') && /Amount paid\s+2,000\.00/.test(rtxt) && /owed after this payment: AED 9,000\.00/.test(rtxt), 'receipt PDF: period settled, amount, and the 9,000.00 still owed after it')
  ok((await p.request.get(`${BASE}/api/payslips/${p2000}?view=1`)).headers()['content-disposition']?.startsWith('inline'), 'receipt opens in the browser for printing')

  console.log('\n[J] Payments recorded before the ledger reconcile to what is owed today')
  await p.goto(`${BASE}/salary`); await settle()
  await p.locator('[data-salary-search]').fill('Legacy'); await p.waitForTimeout(300)
  ok(await p.locator('[data-salary-rows] tr').count() === 1, 'search finds one employee')
  ok(await owed(old) === 0, 'before: two months posted (3,000) and 3,000 already paid by the old screen')
  await p.goto(`${BASE}/salary/${old}`); await settle()
  await p.locator('[data-opening]').getByRole('button', { name: 'Set opening balance' }).click()
  await dlg().getByLabel(/Still owed today/).check(); await dlg().getByLabel('Amount (AED) *').fill('5500'); await dlg().getByLabel('Records start on *').fill(`${M0}-01`)
  await dlg().getByRole('button', { name: 'Save opening balance' }).click(); await settle(p, 1000)
  ok(await owed(old) === 5500 && (await one(`select count(*)::int n from salary_payments where employee_id=$1`, [old])).n === 2, 'owed today is 5,500 exactly; both old payments kept')
  ok((await one(`select amount::float a from salary_ledger where employee_id=$1 and kind='opening' and status='posted'`, [old])).a === 5500, 'opening worked out as 5,500 owed today + 3,000 paid − 3,000 posted = 5,500')

  console.log('\n[F2] Dashboard filters and cards')
  await p.goto(`${BASE}/salary`); await settle()
  await p.locator('[data-filter=unpaid]').click(); const unpaid = await p.locator('[data-salary-rows]').innerText()
  ok(unpaid.includes('Sara Khan') && !unpaid.includes('Ali Hassan'), 'Unpaid: Sara (nothing paid), not Ali (paid this month)')
  await p.locator('[data-filter=partial]').click(); ok((await p.locator('[data-salary-rows]').innerText()).includes('Ali Hassan'), 'Partially paid: Ali')
  await p.locator('[data-filter=all]').click()
  const cards = await p.locator('main').innerText()
  ok(cards.includes('Total owed to employees') && cards.includes(`Paid in ${label(M1)}`) && cards.includes('Employees owed salary'), 'summary cards: total owed, paid this period, salary added, employees owed')
  await p.screenshot({ path: `${OUT}/d-salary.png`, fullPage: true })

  console.log('\n[P] Phone layout')
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, storageState: await ctx.storageState() }); const mp = watch(await mctx.newPage())
  for (const path of ['/salary', `/salary/${ali}`]) {
    await mp.goto(BASE + path); await settle(mp)
    ok(await mp.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 1, `${path}: no sideways scrolling at 390 px`)
  }
  await mp.goto(`${BASE}/salary`); await settle(mp)
  ok(await mp.locator('[data-salary-cards] li').first().isVisible(), 'phones get one card per employee')
  await mp.locator('[data-salary-cards] li', { hasText: 'Sara Khan' }).locator('[data-quick-pay]').click()
  await dlg(mp).locator('[data-pay-form]').waitFor(); await mp.waitForTimeout(400)
  ok((await dlg(mp).boundingBox()).width <= 391 && await dlg(mp).evaluate(d => d.scrollWidth <= d.clientWidth + 1), 'Quick Pay opens as a sheet that fits the phone')
  await mp.screenshot({ path: `${OUT}/m-salary-pay.png` }); await mp.keyboard.press('Escape')

  console.log('\n[EP] The employee sees only their own account')
  await p.goto(`${BASE}/employees/${ali}`); await settle()
  await p.locator('[data-portal-access]').getByRole('button', { name: 'Give portal access' }).click()
  await dlg().locator('input[name=email]').fill(EMP); await dlg().getByRole('button', { name: 'Give access' }).click(); await settle(p, 1000)
  const ectx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); const ep = watch(await ectx.newPage())
  await ep.goto(`${BASE}/login`); await ep.getByLabel('Email').fill(EMP); await ep.getByLabel('Password').fill('invited-password-123'); await ep.getByRole('button', { name: 'Sign in' }).click(); await ep.waitForURL('**/me**')
  await ep.goto(`${BASE}/me/salary`); await settle(ep); await ep.locator('[data-private]').first().click(); await ep.waitForTimeout(300)
  const mine = await ep.locator('main').innerText()
  ok(mine.includes('8,400.00') && mine.includes('Opening balance') && mine.includes(label(M1)), 'portal: salary owed 8,400.00, month by month')
  ok(!mine.includes('Sara') && !mine.includes('Legacy'), 'nothing about colleagues')
  const own = await ep.request.get(`${BASE}/api/salary-statements/${ali}`), theirs = await ep.request.get(`${BASE}/api/salary-statements/${sara}`, { maxRedirects: 0 })
  ok(own.status() === 200 && (await own.body()).subarray(0, 5).toString() === '%PDF-', 'own statement downloads')
  ok([302, 303, 307, 403, 404].includes(theirs.status()), `a colleague's statement is refused (${theirs.status()})`)
  await ep.goto(`${BASE}/salary`); await ep.waitForLoadState('domcontentloaded'); ok(new URL(ep.url()).pathname === '/me', '/salary sends an employee back to their portal')
  await ectx.close(); await mctx.close()
} catch (e) {
  ok(false, `aborted: ${e.message.split('\n').slice(0, 12).join(' | ')}`); await p.screenshot({ path: `${OUT}/abort.png`, fullPage: true }).catch(() => {})
}
for (const e of jsErrors) ok(false, `JS error ${e}`)
const failed = results.filter(r => !r[0]).length
console.log(`\nsalary: ${results.length - failed}/${results.length} passed`)
await browser.close(); await db.end()
process.exit(failed ? 1 : 0)
