// Employee Portal & RBAC: an "employee" login is confined to its own portal (pages AND APIs), sees only its own salary,
// attendance and expenses, checks in/out (when enabled), sends expense claims (receipt scan or by hand) that stay out of
// the company's expenses until an approver approves them; approval adds the expense exactly once, linked to the employee
// and the receipt. Correction and rejection round trips, notifications, payslips, admin controls and the phone layout.
// Real Next build + PostgREST + Postgres RLS + Chromium. Run via scripts/e2e.sh
import { chromium } from 'playwright-core'
import crypto from 'node:crypto'
import fs from 'node:fs'
import pg from 'pg'

const BASE = process.env.E2E_BASE, GW = process.env.E2E_GATEWAY
const OUT = 'tests/e2e/shots/portal'; fs.mkdirSync(OUT, { recursive: true })
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
const fixtures = o => fetch(`${GW}/mock/fixtures`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(o) })
const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
const png = tag => Buffer.concat([PNG1, Buffer.from(`averiqo-${tag}-${Date.now()}`)])
const sha = b => crypto.createHash('sha256').update(b).digest('hex')
const stamp = Date.now(), OWNER = `portal-owner-${stamp}@alsaqr.test`, EMP = `portal-emp-${stamp}@alsaqr.test`, yr = new Date().getFullYear()
const RECEIPT = `ENOC SERVICE STATION
Sheikh Zayed Road, Dubai
TRN: 100345678900003
TAX INVOICE
Invoice No: ENOC-7781
Date: 05/10/${yr}
Diesel 40.00 L 3.10 124.00
Subtotal 124.00
VAT 5% 6.20
Total AED 130.20`

try {
  console.log('\n[0] Setup: owner, company, two employees with salary, advances and attendance')
  await p.goto(`${BASE}/signup`); await p.getByLabel('Work email').fill(OWNER); await p.getByLabel('Password').fill('correct-horse-battery'); await p.getByRole('button', { name: 'Create account' }).click()
  await p.waitForURL('**/onboarding'); await p.getByLabel('Company name').fill('Al Saqr Portal Test'); await p.getByLabel('Your full name').fill('Owner'); await p.getByRole('button', { name: 'Create company' }).click(); await p.waitForURL(`${BASE}/`)
  const co = (await one(`select p.company_id from profiles p join auth.users u on u.id=p.id where u.email=$1`, [OWNER])).company_id
  const today = (await one(`select (now() at time zone coalesce(timezone,'Asia/Dubai'))::date::text d from companies where id=$1`, [co])).d
  const month = today.slice(0, 8) + '01', prevMonth = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 2, 1)).toISOString().slice(0, 10)
  const emp = (await one(`insert into employees(company_id,employee_no,full_name,designation,status) values ($1,'E-101','Rashid Khan','Steel fixer','active') returning id`, [co])).id
  const other = (await one(`insert into employees(company_id,employee_no,full_name,status) values ($1,'E-102','Imran Ali','active') returning id`, [co])).id
  await db.query(`insert into employee_compensation(employee_id,company_id,monthly_salary) values ($1,$3,4000),($2,$3,7777)`, [emp, other, co])
  const pay = (await one(`insert into salary_payments(company_id,employee_id,period,amount,paid_on,method) values ($1,$2,$3,4000,$3::date + 28,'wps') returning id`, [co, emp, prevMonth])).id
  const otherPay = (await one(`insert into salary_payments(company_id,employee_id,period,amount,paid_on,method) values ($1,$2,$3,7777,$3::date + 28,'wps') returning id`, [co, other, prevMonth])).id
  await db.query(`insert into employee_advances(company_id,employee_id,kind,amount,given_on,monthly_recovery) values ($1,$2,'advance',600,$4,200),($1,$3,'advance',9999,$4,null)`, [co, emp, other, month])
  await db.query(`insert into attendance_records(company_id,employee_id,work_date,status,overtime_hours) values ($1,$2,$3,'present',2),($1,$4,$3,'absent',0)`, [co, emp, month, other])
  const otherClaim = (await one(`insert into expense_claims(company_id,employee_id,spent_on,description,amount,supplier_name) values ($1,$2,$3,'Imran taxi fare',45,'Dubai Taxi') returning id`, [co, other, today])).id
  const ownerDoc = (await one(`insert into documents(company_id,name,owner_type) values ($1,'Trade licence','company') returning id`, [co])).id

  console.log('\n[1] Settings → Employee portal: self check-in on, advance limit 25%')
  await p.goto(`${BASE}/settings#employee-portal`); await settle()
  const card = p.locator('#employee-portal')
  await card.locator('input[name=checkin]').check(); await card.locator('input[name=advance_limit_pct]').fill('25')
  await card.locator('input[name=work_start]').fill('00:00'); await card.locator('input[name=work_end]').fill('23:59'); await card.locator('input[name=overtime_max_hours]').fill('5')
  await card.getByRole('button', { name: 'Save portal settings' }).click(); await settle(p, 900)
  ok((await one(`select value::text v from app_settings where company_id=$1 and key='portal.checkin'`, [co]))?.v === 'true', 'portal.checkin saved as true')
  ok((await one(`select value::text v from app_settings where company_id=$1 and key='portal.work_end'`, [co]))?.v === '"23:59"' && (await one(`select value::text v from app_settings where company_id=$1 and key='portal.overtime_max_hours'`, [co]))?.v === '5', 'working hours and overtime limit saved')
  ok((await one(`select value::text v from app_settings where company_id=$1 and key='portal.advance_limit_pct'`, [co]))?.v === '25', 'advance limit saved (25%)')
  const cards = p.locator('#company-cards')
  for (const [label, num, kind] of [['Company credit card', '4111 2222 3333 249865', 'credit'], ['Fuel card', '1234', 'debit']]) {
    await cards.locator('input[name=label]').fill(label); await cards.locator('input[name=last4]').fill(num.slice(-4)); await cards.locator('select[name=kind]').selectOption(kind)
    await cards.getByRole('button', { name: 'Add card' }).click(); await settle(p, 900)
  }
  const cardRows = (await db.query(`select id, label, last4, kind from company_cards where company_id=$1 order by created_at`, [co])).rows
  ok(cardRows.length === 2 && cardRows[0].last4 === '9865' && cardRows[1].kind === 'debit', 'Settings → Company cards: two cards saved (last 4 digits only)')
  ok((await cards.innerText()).includes('••9865'), 'the card list shows ••9865')
  const card9865 = cardRows[0].id

  console.log('\n[2] Admin gives Rashid portal access (invite by email → Employee login linked to his record)')
  await p.goto(`${BASE}/employees/${emp}`); await settle()
  await p.locator('[data-portal-access]').getByRole('button', { name: 'Give portal access' }).click()
  await dlg(p).locator('input[name=email]').fill(EMP); await dlg(p).getByRole('button', { name: 'Give access' }).click(); await settle(p, 1000)
  const eu = await one(`select u.id, p.role, p.is_active, p.full_name from auth.users u join profiles p on p.id=u.id where u.email=$1`, [EMP])
  ok(eu && eu.role === 'employee' && eu.is_active && eu.full_name === 'Rashid Khan', 'invited login has the Employee role, named after the employee')
  ok((await one(`select user_id from employees where id=$1`, [emp])).user_id === eu?.id, 'employee record linked to the new login')
  ok((await p.locator('[data-portal-access]').innerText()).includes('Active'), 'employee page shows the active portal login')

  console.log('\n[2b] Users page: an Employee login must be tied to its employee record')
  const lu = (await one(`insert into auth.users(email) values ($1) returning id`, [`portal-imran-${stamp}@alsaqr.test`])).id
  await db.query(`insert into profiles(id,company_id,full_name,role) values ($1,$2,'Imran login','viewer')`, [lu, co])
  await p.goto(`${BASE}/users`); await settle()
  const userRow = () => p.locator('tr').filter({ has: p.locator('td:first-child', { hasText: 'Imran login' }) }), row = userRow()
  ok(await row.locator('select[name=employee_id] option', { hasText: 'Rashid Khan' }).isDisabled(), 'an employee already linked to another login cannot be picked twice')
  await row.locator('select[name=role]').selectOption('employee'); await row.getByRole('button', { name: 'Save' }).click(); await settle(p, 900)
  ok((await one(`select role from profiles where id=$1`, [lu])).role === 'viewer' && /Choose which employee/.test(await p.locator('main').innerText()), 'Employee role without an employee record is refused, with the reason')
  await row.locator('select[name=role]').selectOption('employee'); await row.locator('select[name=employee_id]').selectOption(other)
  await row.getByRole('button', { name: 'Save' }).click(); await settle(p, 900)
  ok((await one(`select role from profiles where id=$1`, [lu])).role === 'employee' && (await one(`select user_id from employees where id=$1`, [other])).user_id === lu, 'role Employee + record Imran Ali saved: the login is linked to his record')
  await p.goto(`${BASE}/users`); await settle()
  await userRow().locator('select[name=employee_id]').selectOption(''); await userRow().locator('select[name=role]').selectOption('viewer')
  await userRow().getByRole('button', { name: 'Save' }).click(); await settle(p, 900)
  ok((await one(`select user_id from employees where id=$1`, [other])).user_id === null, 'choosing “No employee record” unlinks it again')

  console.log('\n[3] The employee signs in on a phone and lands in the portal')
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }); const m = watch(await mctx.newPage())
  await m.goto(`${BASE}/login`); await m.getByLabel('Email').fill(EMP); await m.getByLabel('Password').fill('invited-password-123'); await m.getByRole('button', { name: 'Sign in' }).click()
  await m.waitForURL(u => new URL(u).pathname === '/me', { timeout: 15000 }).catch(() => {}); await settle(m)
  ok(new URL(m.url()).pathname === '/me', `after sign-in the employee is in the portal (${new URL(m.url()).pathname})`)
  const home = await m.locator('main').innerText()
  ok(home.includes('Rashid') && home.includes('Add an expense') && home.includes('Salary') && home.includes('Attendance'), 'portal home: greeting, add expense, salary, attendance')
  ok(!home.includes('7,777') && !home.includes('Imran'), 'nothing about a colleague (salary, name) on the page')
  ok(await m.locator('[data-private=hidden]').first().isVisible(), 'salary amounts are hidden until tapped')
  await m.locator('[data-salary] [data-private]').first().click(); await m.waitForTimeout(250)
  ok((await m.locator('[data-salary]').innerText()).includes('4,000.00') && await m.locator('[data-private=hidden]').count() === 0, 'tap shows own salary AED 4,000.00 (all amounts revealed together)')
  ok((await m.locator('[data-salary]').innerText()).includes('400.00'), 'available advance = 25% of 4,000 − 600 still owed = AED 400.00')
  await m.screenshot({ path: `${OUT}/m-home.png`, fullPage: true })

  await db.query(`update app_settings set value='false'::jsonb where company_id=$1 and key='portal.checkin'`, [co])
  await m.goto(`${BASE}/me/attendance`); await settle(m)
  ok((await m.locator('[data-checkin-off]').innerText()).includes('recorded by HR') && await m.locator('[data-punch]').count() === 0, 'check-in turned off: Attendance says HR records it (no buttons)')
  await db.query(`update app_settings set value='true'::jsonb where company_id=$1 and key='portal.checkin'`, [co])
  await m.goto(`${BASE}/me/attendance`); await settle(m)
  ok(await m.locator('[data-checkin-off]').count() === 0 && await m.locator('[data-punch=in]').isVisible(), 'check-in turned on: the Check in button shows on Attendance')

  console.log('\n[4] Confinement: every company page and API sends the employee back to the portal')
  for (const path of ['/', '/expenses', '/expenses?tab=claims', '/invoices', '/projects', '/employees', `/employees/${other}`, `/employees/${emp}`, '/settings', '/reports', '/users', '/approvals', '/documents', '/vault', '/tasks', '/banking', '/audit']) {
    await m.goto(BASE + path); await m.waitForLoadState('domcontentloaded')
    ok(new URL(m.url()).pathname === '/me', `${path} → /me`)
  }
  for (const api of ['/api/export/expenses?format=xlsx', `/api/documents/${ownerDoc}/download`]) {
    const r = await m.request.get(BASE + api, { maxRedirects: 0 }).catch(e => ({ status: () => 0, headers: () => ({}), e }))
    const loc = r.headers()['location'] ?? ''
    ok([302, 303, 307, 308].includes(r.status()) ? loc.endsWith('/me') : r.status() === 404 || r.status() === 401 || r.status() === 403, `${api} refused (${r.status()} ${loc})`)
  }
  ok((await m.request.get(`${BASE}/api/payslips/${otherPay}`)).status() === 404, "a colleague's payslip: 404")
  const own = await m.request.get(`${BASE}/api/payslips/${pay}`)
  ok(own.status() === 200 && (own.headers()['content-type'] ?? '').includes('pdf') && (await own.body()).subarray(0, 5).toString() === '%PDF-', 'own payslip downloads as a PDF')
  await m.goto(`${BASE}/me/expenses/${otherClaim}`); ok((await m.locator('body').innerText()).match(/not found|404/i), "a colleague's expense claim: not found")

  console.log('\n[5] Check in and out (server time), once each')
  await m.goto(`${BASE}/me`); await settle(m)
  await m.locator('[data-punch=in]').click(); await settle(m, 900)
  let a = await one(`select status, source, check_in_at, check_out_at from attendance_records where employee_id=$1 and work_date=$2`, [emp, today])
  ok(a && a.status === 'present' && a.source === 'self' && a.check_in_at && !a.check_out_at, 'checked in: present, source self, time set by the server')
  await m.locator('[data-punch=out]').click(); await settle(m, 900)
  a = await one(`select check_in_at, check_out_at from attendance_records where employee_id=$1 and work_date=$2`, [emp, today])
  ok(a.check_out_at && a.check_out_at >= a.check_in_at, 'checked out after check-in')
  ok(await m.locator('[data-today-state=day-done]').isVisible() && /Day \d\d:\d\d–\d\d:\d\d/.test(await m.locator('[data-today]').innerText()), 'today card shows the finished day with its times')
  ok(await m.locator('[data-punch=ot_start]').count() === 0 && (await m.locator('[data-today]').innerText()).includes('Overtime can start after 23:59'), 'overtime is not offered during the working day')
  // the working day has ended (end time moved to 00:01): overtime can start, with a running timer, and stops on request
  await db.query(`update app_settings set value = '"00:01"'::jsonb where company_id=$1 and key='portal.work_end'`, [co])
  await m.goto(`${BASE}/me`); await settle(m)
  await m.locator('[data-punch=ot_start]').click(); await settle(m, 900)
  ok(await m.locator('[data-today-state=overtime]').isVisible() && await m.locator('[data-timer]').isVisible() && (await m.locator('[data-today]').innerText()).includes('5 h maximum'), 'overtime running: timer shown, stops by itself after 5 h')
  await m.locator('[data-punch=ot_stop]').click(); await settle(m, 900)
  a = await one(`select overtime_start_at, overtime_end_at, overtime_hours::float h from attendance_records where employee_id=$1 and work_date=$2`, [emp, today])
  ok(a.overtime_start_at && a.overtime_end_at && a.h < 0.1 && await m.locator('[data-today-state=done]').isVisible(), 'overtime stopped and recorded on the day')
  // forgotten overtime from earlier stops by itself at the limit (closed on the next page view)
  await db.query(`insert into attendance_records(company_id,employee_id,work_date,status,check_in_at,check_out_at,overtime_start_at,source) values ($1,$2,'2026-01-05','present','2026-01-05 08:00+04','2026-01-05 18:00+04','2026-01-05 18:10+04','self')`, [co, emp])
  await m.goto(`${BASE}/me/attendance?m=2026-01`); await settle(m)
  const old = await one(`select overtime_end_at, overtime_hours::float h from attendance_records where employee_id=$1 and work_date='2026-01-05'`, [emp])
  ok(old.h === 5 && new Date(old.overtime_end_at).toISOString() === '2026-01-05T19:10:00.000Z' && (await m.locator('[data-attendance-days]').innerText()).includes('Overtime 18:10–23:10'), 'forgotten overtime stopped by itself after 5 h (18:10–23:10)')
  await db.query(`update app_settings set value = '"23:59"'::jsonb where company_id=$1 and key='portal.work_end'`, [co])
  await m.goto(`${BASE}/me`); await settle(m)

  console.log('\n[6] Expense claim from a receipt photo: read, checked, sent; not in company expenses')
  const img = png('claim')
  await fixtures({ ocr: { [sha(img)]: RECEIPT }, gemini: [{ needle: 'ENOC-7781', response: { supplier: 'ENOC Service Station', trn: '100345678900003', invoice_no: 'ENOC-7781', date: `${yr}-10-05`, subtotal: 124, vat: 6.2, total: 130.2, lines: [] } }] })
  const expBefore = (await one(`select count(*)::int n from project_expenses where company_id=$1`, [co])).n
  await m.locator('input[data-claim-file]').setInputFiles({ name: 'enoc.png', mimeType: 'image/png', buffer: img })
  await dlg(m).locator('[data-scan-done]').waitFor({ timeout: 25000 }); await m.waitForTimeout(300)
  ok(await dlg(m).getByLabel('Invoice / receipt no.').inputValue() === 'ENOC-7781' && Number(await dlg(m).getByLabel('Amount excl. VAT (AED) *').inputValue()) === 124, 'receipt read: number ENOC-7781, amount 124.00')
  ok(await dlg(m).locator('select[name=paid_with]').isVisible() && await dlg(m).locator('select[name=project_id]').count() === 0 && await dlg(m).locator('select[name=employee_id]').count() === 0, 'claim form: “How did you pay?”, no project / employee / bank pickers')
  await dlg(m).getByLabel('Category *').selectOption('fuel'); await dlg(m).getByLabel('Description *').fill('Diesel for site van')
  await m.screenshot({ path: `${OUT}/m-claim-form.png` })
  await dlg(m).getByRole('button', { name: 'Send for approval' }).click(); await settle(m, 800)
  ok(await dlg(m).count() === 1 && /checked these details/i.test(await dlg(m).innerText()), 'a scanned claim needs “I checked these details” before sending')
  await dlg(m).locator('input[name=verified]').check(); await dlg(m).getByRole('button', { name: 'Send for approval' }).click(); await settle(m, 1200)
  const c1 = await one(`select c.*, d.owner_type, d.owner_id, (select count(*)::int from document_versions v where v.document_id=d.id) versions from expense_claims c left join documents d on d.id=c.receipt_document_id where c.employee_id=$1 and c.reference='ENOC-7781'`, [emp])
  ok(c1 && c1.status === 'pending' && c1.source === 'scan' && Number(c1.amount) === 124 && Number(c1.vat_amount) === 6.2 && c1.category === 'fuel', 'claim saved: pending, scanned, 124.00 + 6.20 VAT, fuel')
  ok(c1 && c1.owner_type === 'expense_claim' && c1.owner_id === c1.id && c1.versions === 1, "the receipt is stored as the claim's own document")
  ok((await one(`select count(*)::int n from project_expenses where company_id=$1`, [co])).n === expBefore, 'nothing added to company expenses while pending')
  ok((await one(`select count(*)::int n from in_app_notifications n join auth.users u on u.id=n.user_id where u.email=$1 and n.link = $2`, [OWNER, `/expenses?tab=claims&open=${c1?.id}`])).n === 1, 'the owner (approver) is notified')
  ok((await one(`select count(*)::int n from expense_claim_events where claim_id=$1 and kind='submitted'`, [c1.id])).n === 1, 'audit trail: submitted')

  console.log('\n[7] By hand, and the same receipt twice is refused')
  await m.goto(`${BASE}/me/expenses`); await settle(m)
  const manual = async (ref, desc, amount, card) => {
    await m.locator('[data-claim-manual]:visible').first().click(); await settle(m, 300)
    await dlg(m).locator('input[name=supplier_name]').fill('Al Madina Hypermarket'); await dlg(m).getByLabel('Invoice / receipt no.').fill(ref)
    await dlg(m).getByLabel('Description *').fill(desc); await dlg(m).getByLabel('Amount excl. VAT (AED) *').fill(amount); await dlg(m).getByLabel('Category *').selectOption('food')
    if (card) {
      ok(await dlg(m).locator('select[name=card_id]').count() === 0, 'no card question for a cash payment')
      await dlg(m).locator('select[name=paid_with]').selectOption('card')
      const sel = dlg(m).locator('select[name=card_id]')
      ok(await sel.isVisible() && await sel.evaluate(el => el.required) && await sel.inputValue() === '', 'paid by card: “Which card?” appears, required, nothing pre-chosen with two cards')
      ok((await sel.locator('option').allInnerTexts()).some(t => t.includes('Company credit card ••9865')), 'the card list shows “Company credit card ••9865”')
      await dlg(m).getByRole('button', { name: 'Send for approval' }).click(); await settle(m, 500)
      ok((await one(`select count(*)::int n from expense_claims where employee_id=$1 and reference=$2`, [emp, ref])).n === 0, 'not sent until the card is chosen')
      await sel.selectOption(card)
    }
    await dlg(m).getByRole('button', { name: 'Send for approval' }).click(); await settle(m, 1000)
  }
  await m.locator('[data-claim-manual]:visible').first().click(); await settle(m, 300)
  await dlg(m).locator('input[name=supplier_name]').fill('ENOC SERVICE STATION'); await m.waitForTimeout(200)
  ok(await dlg(m).getByLabel('Supplier TRN').inputValue() === '100345678900003', 'a supplier used before fills in its TRN by itself')
  await m.keyboard.press('Escape'); await settle(m, 300)
  await manual('AM-501', 'Water and snacks for crew', '80', card9865); await manual('AM-777', 'Cold drinks for site', '20')
  await manual('am 501', 'Water again', '80')
  ok(/already sent/i.test(await dlg(m).innerText()) && (await one(`select count(*)::int n from expense_claims where employee_id=$1 and lower(reference) like 'am%501'`, [emp])).n === 1, 'second claim for receipt AM-501 refused: “You already sent receipt…”')
  await m.keyboard.press('Escape'); await settle(m, 300)
  ok((await one(`select paid_with, card_id from expense_claims where employee_id=$1 and reference='AM-501'`, [emp]))?.card_id === card9865, 'card claim saved with the chosen card')
  const c2 = (await one(`select id from expense_claims where employee_id=$1 and reference='AM-501'`, [emp])).id, c3 = (await one(`select id from expense_claims where employee_id=$1 and reference='AM-777'`, [emp])).id
  await m.goto(`${BASE}/me/expenses`); await settle(m)
  const list = await m.locator('[data-claim-list]').innerText()
  ok(list.includes('ENOC') && list.includes('Al Madina') && !list.includes('Imran') && !list.includes('Dubai Taxi'), 'My expenses lists only his own claims')
  await m.goto(`${BASE}/me/expenses/${c3}`); await settle(m)
  await m.getByRole('button', { name: 'Withdraw' }).click(); await settle(m, 900)
  ok((await one(`select status from expense_claims where id=$1`, [c3])).status === 'withdrawn', 'an open claim can be withdrawn by the employee')

  console.log('\n[8] Approver: queue, correction request, then approval adds the expense exactly once')
  await p.goto(`${BASE}/expenses`); await settle()
  ok((await p.locator('[data-claims-waiting]').innerText()).trim() === '3', 'Expenses → “Employee claims” tab shows 3 waiting (2 Rashid + 1 Imran)')
  await p.goto(`${BASE}/approvals`); await settle()
  ok(await p.locator('[data-claims-banner]').isVisible(), 'Approvals page points to the waiting employee claims')
  await p.goto(`${BASE}/expenses?tab=claims&open=${c1.id}`); await settle()
  const detail = await p.locator(`[data-claim-detail="${c1.id}"]`).innerText()
  ok(detail.includes('Rashid Khan') && detail.includes('ENOC-7781') && await p.locator('[data-claim-receipt]').isVisible(), 'claim detail: employee, receipt number, receipt link')
  const exp1Before = (await one(`select count(*)::int n from project_expenses where company_id=$1`, [co])).n
  await p.locator('[data-claim-decide] input[value=correction_requested]').check()
  await p.locator('[data-claim-decide]').getByRole('button', { name: 'Save decision' }).click(); await settle(p, 700)
  ok((await one(`select status from expense_claims where id=$1`, [c1.id])).status === 'pending', 'a correction request without a reason is refused')
  await p.locator('[data-claim-decide] textarea[name=note]').fill('Please add the litres on the receipt to the notes')
  await p.locator('[data-claim-decide]').getByRole('button', { name: 'Save decision' }).click(); await settle(p, 1000)
  ok((await one(`select status, decision_note from expense_claims where id=$1`, [c1.id])).status === 'correction_requested', 'sent back for correction')
  ok((await one(`select count(*)::int n from in_app_notifications where user_id=$1 and title like 'Correction needed:%'`, [eu.id])).n === 1, 'the employee is notified')

  await m.goto(`${BASE}/me`); await settle(m)
  ok((await m.locator('main').innerText()).includes('needs a correction'), 'portal home shows “One expense needs a correction”')
  await m.goto(`${BASE}/me/expenses/${c1.id}`); await settle(m)
  ok((await m.locator('[data-decision-note]').innerText()).includes('litres'), 'the approver’s note is shown on the claim')
  await m.getByRole('button', { name: 'Correct and send again' }).click(); await settle(m, 300)
  await dlg(m).getByLabel('Notes').fill('40 litres diesel')
  await dlg(m).locator('select[name=paid_with]').selectOption('card'); await dlg(m).locator('select[name=card_id]').selectOption(card9865)
  await dlg(m).getByRole('button', { name: 'Send for approval' }).click(); await settle(m, 1100)
  const c1b = await one(`select status, notes, amount::float, card_id from expense_claims where id=$1`, [c1.id])
  ok(c1b.card_id === card9865, 'corrected to a card payment with the card chosen')
  await m.goto(`${BASE}/me/expenses/${c1.id}`); await settle(m)
  ok((await m.locator('main').innerText()).includes('Company credit card ••9865'), 'the employee sees which card was used')
  ok(c1b.status === 'pending' && c1b.notes === '40 litres diesel' && c1b.amount === 124, 'corrected and pending again (amount kept)')
  ok((await one(`select count(*)::int n from expense_claim_events where claim_id=$1 and kind='resubmitted'`, [c1.id])).n === 1, 'audit trail: resubmitted')

  const proj = (await one(`insert into projects(company_id,name,status) values ($1,'Villa 214 Fit-out','active') returning id`, [co])).id
  // two approver screens open on the same claim (or a double click): both press Approve
  const p2 = watch(await ctx.newPage())
  await p.goto(`${BASE}/expenses?tab=claims&open=${c1.id}`); await settle()
  ok((await p.locator(`[data-claim-detail="${c1.id}"]`).innerText()).includes('••9865'), 'the approver sees which card was used')
  await p2.goto(`${BASE}/expenses?tab=claims&open=${c1.id}`); await settle(p2)
  await p.locator('[data-claim-decide] select[name=project_id]').selectOption(proj)
  await p.locator('[data-claim-decide]').getByRole('button', { name: 'Save decision' }).click(); await settle(p, 1200)
  await p2.locator('[data-claim-decide]').getByRole('button', { name: 'Save decision' }).click(); await settle(p2, 1200); await p2.close()
  const ap = await one(`select c.status, c.expense_id, e.id eid, e.employee_id, e.receipt_document_id, e.project_id, e.approval_status, e.verified_at, e.payment_status, e.amount::float, e.vat_amount::float, e.category, e.supplier_id, e.expense_claim_id from expense_claims c left join project_expenses e on e.id=c.expense_id where c.id=$1`, [c1.id])
  ok(ap.status === 'approved' && ap.eid && ap.expense_claim_id === c1.id, 'approved: linked both ways to one new company expense')
  ok((await one(`select card_id from project_expenses where id=$1`, [ap.eid])).card_id === card9865, 'the card goes onto the company expense')
  ok(ap.employee_id === emp && ap.receipt_document_id === c1.receipt_document_id && ap.project_id === proj, 'expense carries the employee, the original receipt and the chosen project')
  ok(ap.approval_status === 'approved' && ap.verified_at && ap.payment_status === 'paid' && ap.amount === 124 && ap.vat_amount === 6.2 && ap.category === 'fuel' && ap.supplier_id, 'verified, approved, paid, same amounts; supplier linked')
  ok((await one(`select count(*)::int n from project_expenses where company_id=$1`, [co])).n === exp1Before + 1, 'exactly one expense added')
  ok((await one(`select count(*)::int n from project_expenses where expense_claim_id=$1`, [c1.id])).n === 1, 'the second approval (other screen) added nothing: still exactly one expense')
  ok((await one(`select count(*)::int n from expense_claim_events where claim_id=$1 and kind='approved'`, [c1.id])).n === 1, 'audit trail: approved once')
  ok((await one(`select count(*)::int n from project_expenses where expense_claim_id in ($1,$2,$3)`, [c2, c3, otherClaim])).n === 0, 'pending / withdrawn claims are not expenses (so never in totals or the Tally export)')
  ok((await one(`select count(*)::int n from in_app_notifications where user_id=$1 and title like 'Expense approved:%'`, [eu.id])).n === 1, 'the employee is told it was approved')
  await p.goto(`${BASE}/expenses?q=ENOC`); await settle()
  ok((await p.locator('main').innerText()).includes('Diesel for site van'), 'the approved claim appears in the Expenses list')

  console.log('\n[9] Rejection with a reason')
  await p.goto(`${BASE}/expenses?tab=claims&open=${c2}`); await settle()
  await p.locator('[data-claim-decide] input[value=rejected]').check(); await p.locator('[data-claim-decide] textarea[name=note]').fill('Food is covered by the daily allowance')
  await p.locator('[data-claim-decide]').getByRole('button', { name: 'Save decision' }).click(); await settle(p, 1000)
  ok((await one(`select status from expense_claims where id=$1`, [c2])).status === 'rejected' && (await one(`select count(*)::int n from project_expenses where expense_claim_id=$1`, [c2])).n === 0, 'rejected, and not an expense')
  await m.goto(`${BASE}/me/expenses/${c2}`); await settle(m)
  ok((await m.locator('[data-decision-note]').innerText()).includes('daily allowance') && await m.getByRole('button', { name: 'Withdraw' }).count() === 0, 'employee sees the reason; a decided claim cannot be changed')
  await m.goto(`${BASE}/me`); await settle(m)
  ok((await m.locator('[data-stat=approved]').innerText()).trim() === '1' && (await m.locator('[data-stat=rejected]').innerText()).trim() === '1' && (await m.locator('[data-stat=pending]').innerText()).trim() === '0', 'dashboard counts: 1 approved, 1 rejected, 0 pending')

  console.log('\n[10] HR records attendance; advance form is duplicate-safe')
  await p.goto(`${BASE}/employees/${emp}?tab=attendance`); await settle()
  await p.getByRole('button', { name: 'Record a day' }).click(); await dlg(p).getByLabel('Day *').fill(month); await dlg(p).getByLabel('Status *').selectOption('half_day'); await dlg(p).getByLabel('Overtime (hours)').fill('1.5')
  await dlg(p).getByRole('button', { name: 'Save', exact: true }).click(); await settle(p, 900)
  const hr = await one(`select status, overtime_hours::float ot, count(*) over ()::int n from attendance_records where employee_id=$1 and work_date=$2`, [emp, month])
  ok(hr.status === 'half_day' && hr.ot === 1.5 && hr.n === 1, 'the existing day was corrected (one row per day): half day, 1.5 h overtime')
  await p.goto(`${BASE}/employees/${emp}?tab=salary`); await settle()
  await p.locator('main').getByRole('button', { name: 'Add', exact: true }).last().click()
  await dlg(p).locator('input[name=amount]').fill('300'); const idem = await dlg(p).locator('input[name=idempotency_key]').inputValue()
  ok(/^[0-9a-f-]{36}$/.test(idem), 'advance form carries an idempotency key')
  await dlg(p).getByRole('button', { name: 'Save', exact: true }).click(); await settle(p, 900)
  await db.query(`insert into employee_advances(company_id,employee_id,kind,amount,idempotency_key) values ($1,$2,'advance',300,$3) on conflict do nothing`, [co, emp, idem])
  ok((await one(`select count(*)::int n from employee_advances where employee_id=$1 and amount=300`, [emp])).n === 1, 'the same advance sent twice is recorded once')
  await m.goto(`${BASE}/me/salary`); await settle(m)
  await m.locator('[data-private]').first().click(); await m.waitForTimeout(250)
  const sal = await m.locator('main').innerText()
  ok(sal.includes('900.00') && sal.includes('100.00'), 'portal salary page updates at once: 900.00 to repay, 100.00 advance still available')
  ok((await one(`select count(*)::int n from in_app_notifications where user_id=$1 and title='Salary advance paid to you'`, [eu.id])).n === 1, 'the employee is notified of the advance (once)')
  await m.goto(`${BASE}/me`); await settle(m)
  ok((await m.locator('[data-last-advance]').innerText()).includes(new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${today}T00:00:00Z`))), 'portal home shows the last advance received, with its date')
  await m.goto(`${BASE}/me/attendance?m=${month.slice(0, 7)}`); await settle(m)
  ok((await m.locator('[data-attendance-days]').innerText()).includes('Half day'), 'portal attendance shows the corrected day')

  console.log('\n[11] Phone layout (390 px): every portal page fits, big targets, tab bar')
  for (const path of ['/me', '/me/expenses', `/me/expenses/${c1.id}`, '/me/attendance', '/me/salary', '/me/profile']) {
    await m.goto(BASE + path); await settle(m, 250)
    const over = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    ok(over <= 1, `${path}: fits the phone (overflow ${over}px)`)
    await m.screenshot({ path: `${OUT}/m${path.replace(/\//g, '-').replace(/-[0-9a-f-]{36}/, '-claim')}.png`, fullPage: true })
  }
  await m.goto(`${BASE}/me`); await settle(m)
  const scanBtn = await m.locator('[data-claim-scan]').boundingBox(), tabBar = m.locator('nav[aria-label="My portal"]').last()
  ok(scanBtn && scanBtn.height >= 56 && scanBtn.width >= 300, `“Scan receipt” is a large button (${Math.round(scanBtn?.width)}×${Math.round(scanBtn?.height)})`)
  ok(await tabBar.isVisible() && (await tabBar.locator('a').count()) === 5, 'bottom tab bar with 5 tabs')
  for (const y of [0, 900]) { await m.evaluate(v => scrollTo(0, v), y); await m.waitForTimeout(200); const b = await tabBar.boundingBox(); ok(b && b.y > 844 - 110 && b.y + b.height <= 844, `tab bar stays at the bottom of the screen (scroll ${y}: y=${Math.round(b?.y)})`) }
  const desk = watch(await (await browser.newContext({ viewport: { width: 1280, height: 860 }, storageState: await mctx.storageState() })).newPage())
  await desk.goto(`${BASE}/me`); await settle(desk); await desk.screenshot({ path: `${OUT}/d-home.png`, fullPage: true })
  ok(await desk.locator('nav[aria-label="My portal"]').first().isVisible(), 'desktop: tabs under the header')
  await desk.context().close()
  const am = watch(await (await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: await ctx.storageState() })).newPage())
  await am.goto(`${BASE}/expenses?tab=claims&open=${c1.id}`); await settle(am)
  ok(await am.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) <= 1, 'admin claim queue fits a phone')
  await am.screenshot({ path: `${OUT}/m-admin-claims.png`, fullPage: true }); await am.context().close()

  console.log('\n[12] Revoking access')
  await p.goto(`${BASE}/employees/${emp}`); await settle()
  await p.locator('[data-portal-access]').getByRole('button', { name: 'Remove access' }).click(); await settle(p, 1000)
  const rv = await one(`select e.user_id, p.is_active from employees e, profiles p where e.id=$1 and p.id=$2`, [emp, eu.id])
  ok(rv.user_id === null && rv.is_active === false, 'link removed and the employee login switched off (records kept)')
  ok((await one(`select count(*)::int n from expense_claims where employee_id=$1`, [emp])).n === 3, 'his claims are kept')
  await m.goto(`${BASE}/me/salary`); await settle(m)
  ok(!(await m.locator('body').innerText()).includes('4,000.00'), 'the switched-off login no longer sees the salary')
  await mctx.close()
} catch (e) {
  ok(false, `aborted: ${e.message.split('\n').slice(0, 12).join(' | ')}`); await p.screenshot({ path: `${OUT}/abort.png` }).catch(() => {})
}
for (const e of jsErrors) ok(false, `JS error ${e}`)
const failed = results.filter(r => !r[0]).length
console.log(`\nportal: ${results.length - failed}/${results.length} passed`)
await browser.close(); await db.end()
process.exit(failed ? 1 : 0)
