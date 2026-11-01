// Petty cash attachments, the always-visible petty cash card in the Employee Portal, and "Log in as employee" (owners
// only, active Employee logins only, Back to admin restores the owner, sign-out ends both, audit log). Real Next build +
// PostgREST + Postgres RLS + Chromium. Run via scripts/e2e.sh
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import pg from 'pg'

const BASE = process.env.E2E_BASE
const OUT = 'tests/e2e/shots/petty-extra'; fs.mkdirSync(OUT, { recursive: true })
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
const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
const file = name => ({ name: `${name}.png`, mimeType: 'image/png', buffer: Buffer.concat([PNG1, Buffer.from(`averiqo-${name}-${Date.now()}`)]) })
const stamp = Date.now(), OWNER = `pe-owner-${stamp}@alsaqr.test`, EMP = `pe-emp-${stamp}@alsaqr.test`
const path = page => new URL(page.url()).pathname

try {
  console.log('\n[0] Setup: owner, an employee with a portal login (no petty cash yet), a manager login on another employee')
  await p.goto(`${BASE}/signup`); await p.getByLabel('Work email').fill(OWNER); await p.getByLabel('Password').fill('correct-horse-battery'); await p.getByRole('button', { name: 'Create account' }).click()
  await p.waitForURL('**/onboarding'); await p.getByLabel('Company name').fill('Al Saqr Login-as Test'); await p.getByLabel('Your full name').fill('Owner Rafi'); await p.getByRole('button', { name: 'Create company' }).click(); await p.waitForURL(`${BASE}/`)
  const { co, uid } = await one(`select p.company_id co, p.id uid from profiles p join auth.users u on u.id=p.id where u.email=$1`, [OWNER])
  const emp = (await one(`insert into employees(company_id,employee_no,full_name,status) values ($1,'E-301','Mohammed Ayub','active') returning id`, [co])).id
  const mgrEmp = (await one(`insert into employees(company_id,employee_no,full_name,status) values ($1,'E-302','Sara Accountant','active') returning id`, [co])).id
  const mgrUser = (await one(`insert into auth.users(email) values ($1) returning id`, [`pe-acc-${stamp}@alsaqr.test`])).id
  await db.query(`insert into profiles(id,company_id,full_name,role) values ($1,$2,'Sara Accountant','accountant')`, [mgrUser, co])
  await db.query(`update employees set user_id=$1 where id=$2`, [mgrUser, mgrEmp])
  await p.goto(`${BASE}/employees/${emp}`); await settle()
  await p.locator('[data-portal-access]').getByRole('button', { name: 'Give portal access' }).click()
  await dlg(p).locator('input[name=email]').fill(EMP); await dlg(p).getByRole('button', { name: 'Give access' }).click(); await settle(p, 1000)
  const empUser = (await one(`select user_id from employees where id=$1`, [emp])).user_id
  ok(!!empUser, 'employee has a portal login')

  console.log('\n[1] Employee (phone, no petty cash yet): the petty cash card is on Home with "Add petty cash received" and an attachment')
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); const m = watch(await mctx.newPage())
  await m.goto(`${BASE}/login`); await m.getByLabel('Email').fill(EMP); await m.getByLabel('Password').fill('invited-password-123'); await m.getByRole('button', { name: 'Sign in' }).click()
  await m.waitForURL(u => new URL(u).pathname === '/me', { timeout: 15000 }).catch(() => {}); await settle(m)
  const card = m.locator('[data-petty-card]')
  ok(await card.isVisible() && (await card.innerText()).includes('0.00'), 'Home: petty cash card shown even with nothing yet (AED 0.00)')
  await card.getByRole('button', { name: 'Add petty cash received' }).click(); await settle(m, 300)
  await dlg(m).locator('input[name=amount]').fill('300'); await dlg(m).locator('input[name=counterparty]').fill('Owner Rafi')
  await dlg(m).locator('input[name=attachment]').setInputFiles(file('voucher'))
  await dlg(m).getByRole('button', { name: 'Send for approval' }).click(); await settle(m, 1500)
  const req = await one(`select r.id, r.status, r.document_id, d.owner_type, d.owner_id from petty_cash_requests r left join documents d on d.id=r.document_id where r.employee_id=$1`, [emp])
  ok(req?.status === 'pending' && req.document_id && req.owner_type === 'petty_cash' && req.owner_id === emp, 'report saved as pending with its attachment (filed under the employee\'s petty cash)')
  await m.goto(`${BASE}/me/expenses`); await settle(m)
  ok(await m.locator('[data-petty-card] [data-petty-card-actions]').isVisible(), 'My expenses: the same card with its actions')
  ok((await m.request.get(`${BASE}/api/documents/${req.document_id}/download?mode=preview`)).status() === 200, 'employee opens their own attachment')

  console.log('\n[2] Owner: the report shows its attachment; Issue petty cash with an attachment')
  await p.goto(`${BASE}/expenses?tab=petty&view=requests&open=${req.id}`); await settle()
  const link = p.locator('[data-petty-detail] [data-petty-file]')
  ok(await link.isVisible(), 'report detail: "Open attachment"')
  ok((await ctx.request.get(`${BASE}${await link.getAttribute('href')}`)).headers()['content-type']?.startsWith('image/png'), 'owner opens the attachment (the photo itself)')
  await p.getByRole('button', { name: 'Issue petty cash' }).first().click(); await settle(p, 400)
  await dlg(p).locator('select[name=employee_id]').selectOption(emp); await dlg(p).locator('input[name=amount]').fill('500')
  await dlg(p).locator('input[name=purpose]').fill('Site purchases'); await dlg(p).locator('input[name=attachment]').setInputFiles(file('issue-slip'))
  await dlg(p).getByRole('button', { name: 'Confirm money handed over' }).click(); await settle(p, 1500)
  const ent = await one(`select e.document_id, d.owner_type, d.owner_id from petty_cash_entries e join documents d on d.id=e.document_id where e.employee_id=$1 and e.kind='received'`, [emp])
  ok(ent?.owner_type === 'petty_cash' && ent.owner_id === emp, 'issued with its attachment')
  await p.goto(`${BASE}/expenses/petty-cash/${emp}`); await settle()
  ok(await p.locator('[data-petty-statement] [data-petty-file]').count() === 1, 'wallet statement row links the attachment')
  ok((await m.request.get(`${BASE}/api/documents/${ent.document_id}/download?mode=preview`)).status() === 200, 'the employee can open the hand-over slip too')
  const strangerDoc = (await one(`insert into documents(company_id,name,owner_type,owner_id) values ($1,'Other wallet','petty_cash',$2) returning id`, [co, mgrEmp])).id
  ok((await m.request.get(`${BASE}/api/documents/${strangerDoc}/download?mode=preview`)).status() !== 200, 'not another employee\'s attachment')

  console.log('\n[3] Log in as employee: owner only, Employee logins only')
  await p.goto(`${BASE}/employees`); await settle()
  ok(await p.locator(`[data-login-as="${emp}"]`).count() === 1, 'employees list: "Log in as employee" on the card of a person with an Employee login')
  ok(await p.locator(`[data-login-as="${mgrEmp}"]`).count() === 0, 'not offered for a manager / accountant login')
  await p.locator(`[data-login-as="${emp}"]`).getByRole('button').click()
  await p.waitForURL(u => new URL(u).pathname === '/me', { timeout: 15000 }).catch(() => {}); await settle(p)
  ok(path(p) === '/me', `owner lands in the employee portal (${path(p)})`)
  const bar = p.locator('[data-impersonating]')
  ok(await bar.isVisible() && (await bar.innerText()).includes('Viewing as Mohammed Ayub') && (await bar.innerText()).includes('Owner Rafi'), 'banner: "Viewing as Mohammed Ayub", signed in by the owner')
  ok((await p.locator('header').first().innerText()).includes('Mohammed Ayub') || (await p.locator('main').innerText()).includes('Mohammed'), 'the portal is the employee\'s own')
  ok((await p.locator('[data-petty-available]').first().innerText()).includes('500.00'), 'sees the employee\'s petty cash (AED 500.00)')
  await p.screenshot({ path: `${OUT}/viewing-as.png` })
  await p.goto(`${BASE}/expenses?tab=petty`); await settle()
  ok(path(p) === '/me', 'while switched, admin pages are closed (the employee\'s limits apply)')
  ok((await one(`select count(*)::int n from audit_logs where company_id=$1 and action='IMPERSONATE_START' and record_id=$2 and user_id=$3`, [co, emp, uid])).n === 1, 'audit log: start recorded with the owner')
  await p.locator('[data-back-to-admin]').click(); await p.waitForURL(u => new URL(u).pathname === `/employees/${emp}`, { timeout: 15000 }).catch(() => {}); await settle(p)
  ok(path(p) === `/employees/${emp}`, `"Back to admin" returns to the employee page (${path(p)})`)
  await p.goto(`${BASE}/expenses?tab=petty`); await settle()
  ok(path(p) === '/expenses' && await p.locator('[data-petty-overview]').isVisible(), 'the owner is the owner again (admin pages open)')
  ok((await one(`select count(*)::int n from audit_logs where company_id=$1 and action='IMPERSONATE_END' and record_id=$2`, [co, emp])).n === 1, 'audit log: end recorded')
  ok(!(await ctx.cookies()).some(k => k.name === 'averiqo-imp'), 'the kept-session cookie is gone')

  console.log('\n[4] Signing out while switched signs out completely')
  await p.goto(`${BASE}/employees/${emp}`); await settle()
  await p.locator(`[data-portal-access] [data-login-as="${emp}"]`).getByRole('button').click(); await p.waitForURL(u => new URL(u).pathname === '/me', { timeout: 15000 }).catch(() => {}); await settle(p)
  const ck = (await ctx.cookies()).find(k => k.name === 'averiqo-imp')
  ok(ck?.httpOnly && ck.value.split('.').length === 3 && !Buffer.from(ck.value.split('.')[2], 'base64url').toString('latin1').includes('"rt"'), 'while switched the owner session is kept encrypted in an httpOnly cookie')
  await p.locator('form button[aria-label="Sign out"]').click(); await p.waitForURL(u => new URL(u).pathname === '/login', { timeout: 15000 }).catch(() => {}); await settle(p)
  ok(path(p) === '/login', 'sign out goes to the login page')
  await p.goto(`${BASE}/`); await settle()
  ok(path(p) === '/login', 'nobody is signed in afterwards (the owner session was not left behind)')
  await mctx.close()
} catch (e) {
  ok(false, `aborted: ${e.message.split('\n').slice(0, 12).join(' | ')}`); await p.screenshot({ path: `${OUT}/abort.png`, fullPage: true }).catch(() => {})
}
for (const e of jsErrors) ok(false, `JS error ${e}`)
const failed = results.filter(r => !r[0]).length
console.log(`\npetty-extra: ${results.length - failed}/${results.length} passed`)
await browser.close(); await db.end()
process.exit(failed ? 1 : 0)
