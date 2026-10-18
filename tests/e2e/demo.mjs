// Shared demo account (demo@admin.com / admin123): login panel, isolated sample company, blocked sensitive actions,
// daily reset through the cron, real companies untouched, phone layout. Real Next build + PostgREST + Postgres RLS + Chromium.
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import pg from 'pg'

const BASE = process.env.E2E_BASE
const OUT = 'tests/e2e/shots/demo'; fs.mkdirSync(OUT, { recursive: true })
const results = []
const ok = (cond, msg) => { results.push([!!cond, msg]); console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`) }
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
const exe = fs.readdirSync('/opt/pw-browsers').filter(d => d.startsWith('chromium-')).map(d => `/opt/pw-browsers/${d}/chrome-linux/chrome`).find(p => fs.existsSync(p))
const browser = await chromium.launch({ executablePath: exe })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const p = await ctx.newPage()
const jsErrors = []; p.on('pageerror', e => jsErrors.push(`${p.url()}: ${e.message}`)); p.on('dialog', d => d.accept())
const settle = async (ms = 500) => { await p.waitForLoadState('networkidle').catch(() => {}); await p.waitForTimeout(ms) }
const dlg = () => p.locator('dialog[open]')
const text = () => p.locator('body').innerText()
// rows that belong to real (non-demo) companies: must never change
const realCounts = async () => (await db.query(`select (select count(*) from invoices i join companies c on c.id = i.company_id where not c.is_demo)::int inv,
  (select count(*) from customers i join companies c on c.id = i.company_id where not c.is_demo)::int cust,
  (select count(*) from payments i join companies c on c.id = i.company_id where not c.is_demo)::int pay,
  (select count(*) from employees i join companies c on c.id = i.company_id where not c.is_demo)::int emp,
  (select count(*) from companies where not is_demo)::int companies`)).rows[0]

try {
  console.log('\n[0] A real company, then the demo (as production does: an auth user, then demo_provision)')
  const real = await browser.newContext(); const rp = await real.newPage()
  await rp.goto(`${BASE}/signup`); await rp.getByLabel('Work email').fill(`real-${Date.now()}@alsaqr.test`); await rp.getByLabel('Password').fill('correct-horse-battery'); await rp.getByRole('button', { name: 'Create account' }).click()
  await rp.waitForURL('**/onboarding'); await rp.getByLabel('Company name').fill('Real Steel Co'); await rp.getByLabel('Your full name').fill('Real Owner'); await rp.getByRole('button', { name: 'Create company' }).click(); await rp.waitForURL(`${BASE}/`)
  await real.close()
  const R = (await one(`select id from companies where name = 'Real Steel Co' order by created_at desc limit 1`)).id
  await db.query(`insert into customers(company_id, name) values ($1, 'Real Customer LLC')`, [R])
  await db.query(`insert into employees(company_id, employee_no, full_name) values ($1, 'R-1', 'Real Worker')`, [R])
  const before = await realCounts()
  const sb = await fetch(`${process.env.E2E_GATEWAY}/auth/v1/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'demo@admin.com', password: 'admin123' }) })
  ok(sb.ok, 'demo@admin.com exists in auth')
  const uid = (await one(`select id from auth.users where email = 'demo@admin.com'`)).id
  const D = (await one(`select demo_provision($1) id`, [uid])).id
  ok((await one(`select is_demo from companies where id = $1`, [D])).is_demo, 'its company is flagged is_demo')

  console.log('\n[1] Login page')
  await p.goto(`${BASE}/login`); await settle()
  const panel = p.locator('[data-demo-panel]')
  ok(await panel.isVisible() && (await panel.innerText()).includes('demo@admin.com') && (await panel.innerText()).includes('admin123'), 'login page shows the demo panel with the email and password')
  await p.screenshot({ path: `${OUT}/01-login.png` })
  await panel.getByRole('button', { name: 'Open the demo' }).click(); await p.waitForURL(`${BASE}/`, { timeout: 20000 }); await settle()
  ok(await p.locator('[data-demo-banner]').isVisible(), 'one click signs in; the app shows the shared-demo banner')
  ok((await text()).includes('Demo Steel Works LLC'), 'the demo company is shown')
  await p.screenshot({ path: `${OUT}/02-dashboard.png` })

  console.log('\n[2] Sample data, own company only')
  await p.goto(`${BASE}/invoices?tab=invoice`); await settle()
  const pays = await p.locator('[data-invoice-row] [data-pay-status]').evaluateAll(els => els.map(e => e.getAttribute('data-pay-status')))
  ok(['paid', 'partially_paid', 'overdue', 'unpaid'].every(s => pays.includes(s)), `tax invoices cover every payment status (${pays.join(', ')})`)
  ok((await p.locator('[data-invoice-row]').count()) === 5, 'five sample tax invoices')
  await p.goto(`${BASE}/parties`); await settle()
  ok((await text()).includes('Marina Crest Developments LLC') && !(await text()).includes('Real Customer LLC'), 'customers are the invented sample ones; the real company is not visible')
  for (const [path, want] of [['/projects', 'Crest Tower podium canopy'], ['/employees', 'Karthik Raman'], ['/documents', 'Trade License'], ['/leads', 'Palm Grove Villas'],
    ['/assets', 'Pickup: site crew'], ['/tasks', 'Book third-party weld inspection'], ['/cheques', 'Coastal Metals Supply'], ['/work-orders', 'Canopy rafters'], ['/tickets', 'Loose grating panel']]) {
    const r = await p.goto(`${BASE}${path}`); await settle(200)
    ok(r.ok() && (await text()).includes(want), `${path} has sample records (${want})`)
  }

  console.log('\n[3] Sensitive actions are refused on the server')
  await p.goto(`${BASE}/users`); await settle()
  await p.getByRole('button', { name: 'Invite user' }).click()
  await dlg().getByLabel('Full name').fill('Someone'); await dlg().getByLabel('Email').fill('someone@x.test'); await dlg().getByRole('button', { name: 'Send invitation' }).click(); await settle(600)
  ok((await dlg().innerText()).includes('Not available in the shared demo'), 'inviting users is refused')
  ok((await one(`select count(*)::int n from profiles where company_id = $1`, [D])).n === 1, 'no user was added')
  await p.keyboard.press('Escape')
  await p.goto(`${BASE}/settings#account`); await settle()
  ok((await text()).includes('Not available in the shared demo (it would lock other visitors out)'), 'two-step setup is not offered')
  // the forgot-password form never sends anything for the shared address
  const anon = await browser.newContext(); const q = await anon.newPage()
  await q.goto(`${BASE}/login/forgot`); await q.getByLabel('Email').fill('demo@admin.com'); await q.getByRole('button', { name: 'Send reset link' }).click()
  await q.waitForLoadState('networkidle'); await q.waitForTimeout(500)
  ok((await q.locator('body').innerText()).includes('its password is always admin123'), 'password reset for the demo explains instead of sending')
  await anon.close()

  console.log('\n[4] Visitors change things; the daily cron puts it back')
  await db.query(`update customers set name = 'Defaced by a visitor' where company_id = $1 and name = 'Marina Crest Developments LLC'`, [D])
  await db.query(`insert into customers(company_id, name) values ($1, 'Added by a visitor')`, [D])
  const r = await fetch(`${BASE}/api/cron/reminders`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }); const j = await r.json()
  ok(r.ok && j.demoCompanies === 1, `cron reset the demo (${JSON.stringify({ demoCompanies: j.demoCompanies, demoFiles: j.demoFiles, demoError: j.demoError })})`)
  ok((await one(`select count(*)::int n from customers where company_id = $1 and name like '%visitor%'`, [D])).n === 0, 'visitor changes are gone')
  ok((await one(`select count(*)::int n from customers where company_id = $1`, [D])).n === 6, 'the six sample customers are back')
  await p.goto(`${BASE}/parties`); await settle()
  ok((await text()).includes('Marina Crest Developments LLC') && await p.locator('[data-demo-banner]').isVisible(), 'a signed-in visitor keeps working after the reset')
  const after = await realCounts()
  ok(JSON.stringify(after) === JSON.stringify(before), `real companies untouched (${JSON.stringify(after)})`)

  console.log('\n[5] Phone')
  await p.setViewportSize({ width: 390, height: 844 }); await p.goto(`${BASE}/`); await settle()
  const wide = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth)
  ok(await p.locator('[data-demo-banner]').isVisible() && wide <= 1, `banner fits on a phone (overflow ${wide}px)`)
  await p.screenshot({ path: `${OUT}/03-phone.png` })
  await p.getByRole('button', { name: 'Create your own account →' }).click(); await p.waitForURL('**/signup'); ok(true, '"Create your own account" signs out and opens sign-up')
  const m = await browser.newContext({ viewport: { width: 390, height: 844 } }); const mp = await m.newPage()
  await mp.goto(`${BASE}/login`); await mp.waitForLoadState('networkidle')
  ok(await mp.locator('[data-demo-panel]').isVisible() && await mp.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 1, 'login demo panel fits on a phone')
  await mp.screenshot({ path: `${OUT}/04-login-phone.png`, fullPage: true }); await m.close()
  ok(jsErrors.length === 0, `no JS errors${jsErrors.length ? ': ' + jsErrors.slice(0, 3).join(' | ') : ''}`)
} catch (e) { ok(false, `crashed: ${e.message}`); await p.screenshot({ path: `${OUT}/crash.png` }).catch(() => {}) }
await browser.close(); await db.end()
const failed = results.filter(r => !r[0])
console.log(`\n${results.length - failed.length}/${results.length} demo checks passed`)
process.exit(failed.length ? 1 : 0)
