// Employee claims, many at once: the red dot beside Expenses (desktop section tabs and group menu, phone tab bar / More)
// while claims wait for this approver; Select all (own claims and possible duplicates left out); approving several
// together adds each to expenses exactly once; a duplicate is approved only when ticked by hand; the dot clears.
// Real Next build + PostgREST + Postgres RLS + Chromium. Run via scripts/e2e.sh
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import pg from 'pg'

const BASE = process.env.E2E_BASE
const OUT = 'tests/e2e/shots/claims-bulk'; fs.mkdirSync(OUT, { recursive: true })
const results = []
const ok = (cond, msg) => { results.push([!!cond, msg]); console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`) }
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
const exe = fs.readdirSync('/opt/pw-browsers').filter(d => d.startsWith('chromium-')).map(d => `/opt/pw-browsers/${d}/chrome-linux/chrome`).find(p => fs.existsSync(p))
const browser = await chromium.launch({ executablePath: exe })
const jsErrors = []
const watch = page => { page.on('pageerror', e => jsErrors.push(`${page.url()}: ${e.message}`)); return page }
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const p = watch(await ctx.newPage())
const settle = async (page = p, ms = 500) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(ms) }
const stamp = Date.now(), OWNER = `bulk-owner-${stamp}@alsaqr.test`

try {
  console.log('\n[0] Setup: owner, three employees\' claims, one possible duplicate, one of the owner\'s own')
  await p.goto(`${BASE}/signup`); await p.getByLabel('Work email').fill(OWNER); await p.getByLabel('Password').fill('correct-horse-battery'); await p.getByRole('button', { name: 'Create account' }).click()
  await p.waitForURL('**/onboarding'); await p.getByLabel('Company name').fill('Al Saqr Claims Test'); await p.getByLabel('Your full name').fill('Owner'); await p.getByRole('button', { name: 'Create company' }).click(); await p.waitForURL(`${BASE}/`)
  const { co, uid } = await one(`select p.company_id co, p.id uid from profiles p join auth.users u on u.id=p.id where u.email=$1`, [OWNER])
  const today = (await one(`select (now() at time zone 'Asia/Dubai')::date::text d`)).d
  const emp = async (no, name, user = null) => (await one(`insert into employees(company_id,employee_no,full_name,status,user_id) values ($1,$2,$3,'active',$4) returning id`, [co, no, name, user])).id
  const rashid = await emp('E-01', 'Rashid Khan'), imran = await emp('E-02', 'Imran Ali'), me = await emp('E-03', 'Owner Self', uid)
  const claim = async (e, sup, ref, amt, vat = 0) => (await one(`insert into expense_claims(company_id,employee_id,spent_on,description,supplier_name,reference,amount,vat_amount,category) values ($1,$2,$3,$4,$5,$6,$7,$8,'material') returning id`, [co, e, today, `${sup} purchase`, sup, ref, amt, vat])).id
  const a = await claim(rashid, 'ADNOC', 'AD-1', 100, 5), b = await claim(rashid, 'AMIR MARINE', 'AM-48211', 613, 30.65), c = await claim(imran, 'NICE TOOLS', 'NT-9', 78, 3.9)
  await db.query(`insert into project_expenses(company_id,category,description,amount,supplier_name,reference) values ($1,'material','Discs',40,'Gulf Hardware LLC','GH-100')`, [co])
  const dup = await claim(imran, 'Gulf Hardware LLC', 'gh 100', 40), own = await claim(me, 'Taxi', 'TX-1', 25)
  const exp0 = (await one(`select count(*)::int n from project_expenses where company_id=$1`, [co])).n

  console.log('\n[1] Red dot beside Expenses while claims wait (desktop)')
  await p.goto(`${BASE}/banking`); await settle()
  const sub = p.locator('nav[aria-label="Section"] a', { hasText: 'Expenses' })
  ok(await sub.locator('[data-nav-dot]').count() === 1 && (await sub.locator('[data-nav-dot]').getAttribute('aria-label')) === '4 waiting', 'Finance section tabs: red dot beside Expenses, "4 waiting" (the owner\'s own claim is not counted)')
  ok(await p.locator('nav[aria-label="Section"] a', { hasText: 'Cheques' }).locator('[data-nav-dot]').count() === 0, 'no dot on pages with nothing waiting')
  const fin = p.locator('nav[aria-label="Main"] a', { hasText: 'Finance' })
  ok(/4/.test(await fin.innerText()), `Finance group tab counts the waiting claims (${(await fin.innerText()).replace(/\s+/g, ' ')})`)
  await p.screenshot({ path: `${OUT}/desk-dot.png`, clip: { x: 0, y: 0, width: 1440, height: 160 } })

  console.log('\n[2] Select all, then approve together')
  await p.goto(`${BASE}/expenses?tab=claims`); await settle()
  ok(await p.locator('[data-claim-row]').count() === 5, 'all 5 waiting claims are listed')
  ok(await p.locator(`[data-claim-row="${dup}"] [data-claim-dup]`).isVisible(), 'the possible duplicate is flagged in the list')
  ok(await p.locator(`[data-claim-check="${own}"]`).isDisabled(), 'the owner\'s own claim cannot be ticked')
  ok((await p.locator('[data-claims-select]').innerText()).includes('Select all (3)'), 'Select all covers 3 (own claim and possible duplicate left out)')
  await p.locator('[data-claims-select-all]').check()
  const bar = p.locator('[data-claims-bar]')
  ok((await bar.innerText()).includes('3 selected') && /830\.55/.test(await bar.innerText()), `bar: 3 selected, total AED 830.55 (${(await bar.innerText()).split('\n').slice(0, 3).join(' ')})`)
  ok(!(await p.locator(`[data-claim-check="${dup}"]`).isChecked()) && !(await p.locator(`[data-claim-check="${own}"]`).isChecked()), 'duplicate and own claim not selected')
  await p.screenshot({ path: `${OUT}/desk-selected.png` })
  await bar.locator('[data-claims-approve]').click()
  ok(await bar.locator('[data-claims-confirm]').isVisible(), 'a confirm step before approving')
  await bar.locator('[data-claims-confirm]').click(); await settle(p, 1500)
  const st = Object.fromEntries((await db.query(`select id, status, expense_id from expense_claims where id = any($1)`, [[a, b, c, dup, own]])).rows.map(r => [r.id, r]))
  ok([a, b, c].every(x => st[x].status === 'approved' && st[x].expense_id) && st[dup].status === 'pending' && st[own].status === 'pending', '3 approved; duplicate and own claim still waiting')
  ok((await one(`select count(*)::int n from project_expenses where expense_claim_id = any($1)`, [[a, b, c]])).n === 3 && (await one(`select count(*)::int n from project_expenses where company_id=$1`, [co])).n === exp0 + 3, 'exactly one expense per approved claim')
  const e = await one(`select category, amount::float, vat_amount::float, approval_status, payment_status, employee_id from project_expenses where expense_claim_id=$1`, [b])
  ok(e.category === 'material' && e.amount === 613 && e.vat_amount === 30.65 && e.approval_status === 'approved' && e.payment_status === 'paid' && e.employee_id === rashid, 'each keeps the employee, amounts and category')
  ok((await one(`select count(*)::int n from expense_claim_events where claim_id = any($1) and kind='approved'`, [[a, b, c]])).n === 3, 'audit trail: one approval each')
  ok(await p.locator('[data-claim-row]').count() === 2, 'the list now shows the 2 still waiting')

  console.log('\n[3] A duplicate is approved only when ticked by hand; approving again adds nothing')
  await p.locator(`[data-claim-check="${dup}"]`).check(); await bar.locator('[data-claims-approve]').click(); await bar.locator('[data-claims-confirm]').click(); await settle(p, 1500)
  ok((await one(`select status from expense_claims where id=$1`, [dup])).status === 'approved', 'the duplicate, ticked by hand, is approved')
  ok((await one(`select count(*)::int n from project_expenses where company_id=$1`, [co])).n === exp0 + 4, 'still exactly one expense per claim')

  console.log('\n[4] Phone: the dot moves to More / Expenses, and clears when nothing waits for this approver')
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: await ctx.storageState() })
  const m = watch(await mctx.newPage())
  await db.query(`insert into expense_claims(company_id,employee_id,spent_on,description,amount) values ($1,$2,$3,'Late taxi',30)`, [co, imran, today])
  await m.goto(`${BASE}/`); await settle(m)
  const tabbar = m.locator('nav[aria-label="Quick navigation"]')
  ok(await tabbar.locator('button [data-nav-dot]').count() === 1, 'phone home: red dot on "More" (Expenses is inside it)')
  await m.goto(`${BASE}/expenses?tab=claims`); await settle(m)
  ok(await tabbar.locator('a[data-tab="expenses"] [data-nav-dot]').count() === 1, 'phone on Expenses: the dot sits on the Expenses tab')
  await m.screenshot({ path: `${OUT}/m-claims.png` })
  ok(await m.locator('[data-claims-select-all]').isVisible(), 'phone: Select all is there')
  await m.locator('[data-claims-select-all]').check()
  const mbar = m.locator('[data-claims-bar]'), mb = await mbar.boundingBox(), tb = await tabbar.boundingBox()
  ok(mb && tb && mb.y + mb.height <= tb.y + 1 && mb.width <= 390, 'phone: the approve bar sits above the tab bar, within the screen')
  await m.screenshot({ path: `${OUT}/m-selected.png` })
  await mbar.locator('[data-claims-approve]').click(); await mbar.locator('[data-claims-confirm]').click(); await settle(m, 1500)
  await m.goto(`${BASE}/`); await settle(m)
  ok(await m.locator('[data-nav-dot]').count() === 0, 'nothing left for this approver (only their own claim waits): no red dot')
  await mctx.close()

  console.log('\n[5] Only approvers can approve in bulk')
  const r = await (await ctx.request.get(`${BASE}/expenses?tab=claims`)).text()
  ok(r.includes('data-claims-queue'), 'the approver page renders the queue')
  ok((await one(`select status from expense_claims where id=$1`, [own])).status === 'pending', 'the owner\'s own claim was never approved by the owner')
} catch (e) {
  ok(false, `aborted: ${e.message.split('\n').slice(0, 12).join(' | ')}`); await p.screenshot({ path: `${OUT}/abort.png`, fullPage: true }).catch(() => {})
}
for (const e of jsErrors) ok(false, `JS error ${e}`)
const failed = results.filter(r => !r[0]).length
console.log(`\nclaims-bulk: ${results.length - failed}/${results.length} passed`)
await browser.close(); await db.end()
process.exit(failed ? 1 : 0)
