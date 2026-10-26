// QA sweep: opens every page of the app as each role (owner, accountant, HR manager, project manager, viewer, employee)
// in the seeded demo company, on desktop and on a phone, and records what a real user would hit: server errors, JS errors,
// console errors, failed requests, pages wider than the phone, slow pages. Then probes access control: pages and APIs
// each role must not reach, another company's records by id, and signed-out requests.
// Real Next build + PostgREST + Postgres RLS + Chromium. Run via scripts/e2e.sh (E2E_ONLY=qa-sweep.mjs).
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import pg from 'pg'

const BASE = process.env.E2E_BASE, GW = process.env.E2E_GATEWAY
const OUT = 'tests/e2e/shots/qa'; fs.mkdirSync(OUT, { recursive: true })
const results = []
const ok = (cond, msg) => { results.push([!!cond, msg]); console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`) }
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
const exe = fs.readdirSync('/opt/pw-browsers').filter(d => d.startsWith('chromium-')).map(d => `/opt/pw-browsers/${d}/chrome-linux/chrome`).find(p => fs.existsSync(p))
const browser = await chromium.launch({ executablePath: exe })
const PW = 'qa-password-123'
const signupApi = (email, password = PW) => fetch(`${GW}/auth/v1/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) })
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/

// every page without an id in its address (from app/**/page.tsx)
const STATIC = ['/', '/approvals', '/assets', '/assistant', '/audit', '/backup', '/banking', '/brief', '/calendar', '/catalog', '/cheques', '/documents',
  '/employees', '/expenses', '/expenses?tab=claims', '/import', '/inbox', '/invoices', '/invoices?tab=quotation', '/invoices?tab=delivery_note', '/invoices?tab=payments',
  '/kb', '/leads', '/parties', '/projects', '/reminders', '/reports', '/search?q=steel', '/settings', '/site-reports', '/site-visits', '/stock', '/stock?tab=movements',
  '/tasks', '/tickets', '/trash', '/users', '/users/activity', '/vault', '/work-orders', '/print/qr']
const PORTAL = ['/me', '/me/attendance', '/me/expenses', '/me/salary', '/me/profile']
const DETAIL = /^\/(assets|documents|employees|inbox|invoices|kb|leads|parties|projects|site-reports|site-visits|tickets|work-orders)\/[0-9a-f-]{36}$/

async function login(ctx, email, password = PW) {
  const p = await ctx.newPage()
  await p.goto(`${BASE}/login`); await p.getByLabel('Email').fill(email); await p.getByLabel('Password').fill(password)
  await p.getByRole('button', { name: 'Sign in', exact: true }).click(); await p.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 20000 })
  return p
}

/** Opens one page and records what a user would run into. */
async function visit(p, path, phone) {
  const issues = { js: [], console: [], failed: [] }
  const onErr = e => issues.js.push(e.message.split('\n')[0])
  const onCon = m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) issues.console.push(m.text().slice(0, 200)) }
  const onRes = r => { const u = new URL(r.url()); if (u.origin === BASE && r.status() >= 400 && !(r.status() === 404 && u.searchParams.has('_rsc'))) issues.failed.push(`${r.status()} ${u.pathname}${u.search.slice(0, 40)}`) }
  p.on('pageerror', onErr); p.on('console', onCon); p.on('response', onRes)
  const t0 = Date.now(); let status = 0
  try {
    const r = await p.goto(BASE + path, { waitUntil: 'load', timeout: 30000 }); status = r?.status() ?? 0
    await p.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {})
  } catch (e) { issues.js.push(`navigation: ${e.message.split('\n')[0]}`) }
  const ms = Date.now() - t0
  const info = await p.evaluate(() => ({
    over: document.documentElement.scrollWidth - window.innerWidth,
    text: document.body.innerText.slice(0, 4000),
    links: [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href')),
    a11y: (() => {
      const vis = el => { const r = el.getBoundingClientRect(), st = getComputedStyle(el); return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && !el.closest('[aria-hidden="true"],.sr-only,dialog:not([open])') }
      const named = el => (el.getAttribute('aria-label') || el.getAttribute('title') || (el.getAttribute('aria-labelledby') && document.getElementById(el.getAttribute('aria-labelledby'))?.textContent) || el.innerText || [...el.querySelectorAll('img[alt],svg title')].map(x => x.getAttribute?.('alt') ?? x.textContent).join('')).trim().length > 0
      const desc = el => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.getAttribute('name') ? `[name=${el.getAttribute('name')}]` : ''}${el.getAttribute('href') ? `[href=${el.getAttribute('href').slice(0, 30)}]` : ''}.${(el.className?.baseVal ?? el.className ?? '').toString().split(' ').slice(0, 2).join('.')}`
      const html = el => el.outerHTML.replace(/\s+/g, ' ').slice(0, 220)
      const unnamed = [...document.querySelectorAll('button,a[href],[role=button],[role=tab],[role=menuitem]')].filter(el => vis(el) && !named(el)).map(el => `${desc(el)} ${html(el)}`)
      const fields = [...document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]),select,textarea')].filter(el => vis(el) && !(el.labels?.length || el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('title'))).map(el => `${desc(el)} ${html(el).slice(0, 120)}`)
      const imgs = [...document.querySelectorAll('img')].filter(el => vis(el) && !el.hasAttribute('alt')).map(el => `img[src=${(el.getAttribute('src') ?? '').slice(0, 40)}]`)
      const ids = {}; for (const el of document.querySelectorAll('[id]')) ids[el.id] = (ids[el.id] ?? 0) + 1
      return { unnamed, fields, imgs, dupIds: Object.keys(ids).filter(k => ids[k] > 1) }
    })(),
  })).catch(() => ({ over: 0, text: '', links: [], a11y: { unnamed: [], fields: [], imgs: [], dupIds: [] } }))
  p.off('pageerror', onErr); p.off('console', onCon); p.off('response', onRes)
  const final = new URL(p.url()).pathname
  return { path, final, status, ms, over: phone ? info.over : 0, ...issues, text: info.text, links: info.links, a11y: info.a11y }
}

const report = { pages: [], access: [], probes: [] }
try {
  console.log('\n[0] Setup: another real company (for cross-company probes), the demo company, one login per role')
  const oc = await browser.newContext(); const op = await oc.newPage()
  await op.goto(`${BASE}/signup`); await op.getByLabel('Work email').fill(`qa-other-${Date.now()}@t.test`); await op.getByLabel('Password').fill('correct-horse-battery'); await op.getByRole('button', { name: 'Create account' }).click()
  await op.waitForURL('**/onboarding'); await op.getByLabel('Company name').fill('QA Other Co'); await op.getByLabel('Your full name').fill('Other Owner'); await op.getByRole('button', { name: 'Create company' }).click(); await op.waitForURL(`${BASE}/`)
  await oc.close()
  const O = (await one(`select id from companies where name = 'QA Other Co' order by created_at desc limit 1`)).id
  const oCust = (await one(`insert into customers(company_id, name) values ($1, 'Other Customer LLC') returning id`, [O])).id
  const oInv = (await one(`insert into invoices(company_id, doc_type, number, customer_id, customer_name, issue_date) values ($1, 'invoice', 'OTHER-1', $2, 'Other Customer LLC', current_date) returning id`, [O, oCust])).id
  const oDoc = (await one(`insert into documents(company_id, name) values ($1, 'Other trade licence') returning id`, [O])).id
  const oEmp = (await one(`insert into employees(company_id, employee_no, full_name) values ($1, 'O-1', 'Other Worker') returning id`, [O])).id
  const oProj = (await one(`insert into projects(company_id, name, status) values ($1, 'Other Tower', 'active') returning id`, [O])).id

  // its own owner and a company seeded with the app's sample data (demo_provision), so it can run after the demo suite
  ok((await signupApi('qa-owner@t.test')).ok, 'owner login created')
  const D = (await one(`select demo_provision((select id from auth.users where email = 'qa-owner@t.test'), 'QA Sample Co') id`)).id
  const roles = ['accountant', 'hr_manager', 'project_manager', 'viewer', 'employee']
  for (const r of roles) {
    ok((await signupApi(`qa-${r}@t.test`)).ok, `login for ${r}`)
    const uid = (await one(`select id from auth.users where email = $1`, [`qa-${r}@t.test`])).id
    await db.query(`insert into profiles(id, company_id, full_name, role) values ($1, $2, $3, $4)`, [uid, D, `QA ${r}`, r])
    if (r === 'employee') await db.query(`update employees set user_id = $1 where id = (select id from employees where company_id = $2 and user_id is null and deleted_at is null order by employee_no limit 1)`, [uid, D])
  }
  const counts = await one(`select (select count(*) from invoices where company_id=$1)::int inv, (select count(*) from employees where company_id=$1)::int emp, (select count(*) from projects where company_id=$1)::int proj, (select count(*) from customers where company_id=$1)::int cust`, [D])
  ok(counts.inv > 0 && counts.emp > 0 && counts.proj > 0, `demo company seeded (${JSON.stringify(counts)})`)

  console.log('\n[1] Owner, desktop: every page, then the records found on them')
  const owner = await browser.newContext({ viewport: { width: 1366, height: 860 } })
  const p = await login(owner, 'qa-owner@t.test')
  const seen = new Set(), details = []
  for (const path of STATIC) {
    const v = await visit(p, path, false); report.pages.push({ role: 'owner', vp: 'desktop', ...v, text: undefined, links: undefined })
    for (const l of v.links) { const u = (l ?? '').split('?')[0]; if (DETAIL.test(u) && !seen.has(u.replace(UUID, ':id')) ) { seen.add(u.replace(UUID, ':id')); details.push(u) } }
  }
  // a second record of each kind as well, and the record sub-pages
  const extra = details.flatMap(d => d.startsWith('/parties/') ? [`${d}/ledger`, `/print/statement/${d.split('/')[2]}`] : d.startsWith('/invoices/') ? [`/print/sales/${d.split('/')[2]}`] : [])
  const projId = details.find(d => d.startsWith('/projects/'))
  const tabs = projId ? ['overview', 'finance', 'work', 'files', 'activity'].map(t => `${projId}?tab=${t}`) : []
  const empId = details.find(d => d.startsWith('/employees/'))
  const etabs = empId ? ['documents', 'salary', 'attendance'].map(t => `${empId}?tab=${t}`) : []
  for (const path of [...details, ...extra, ...tabs, ...etabs]) { const v = await visit(p, path, false); report.pages.push({ role: 'owner', vp: 'desktop', ...v, text: undefined, links: undefined }) }
  ok(details.length >= 8, `records opened from list pages: ${details.length} kinds (${details.map(d => d.split('/')[1]).join(', ')})`)

  console.log('\n[2] Owner, phone (390 px): the same pages')
  const ph = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: await owner.storageState() })
  const pp = await ph.newPage()
  for (const path of [...STATIC, ...details]) { const v = await visit(pp, path, true); report.pages.push({ role: 'owner', vp: 'phone', ...v, text: undefined, links: undefined }) }
  await ph.close()

  console.log('\n[3] Each role: every page (what it may open, what it is turned away from)')
  const roleCtx = {}
  for (const r of roles) {
    const ctx = await browser.newContext({ viewport: r === 'employee' ? { width: 390, height: 844 } : { width: 1366, height: 860 } }); roleCtx[r] = ctx
    const rp = await login(ctx, `qa-${r}@t.test`)
    for (const path of [...STATIC, ...details, ...(r === 'employee' ? PORTAL : [])]) {
      const v = await visit(rp, path, r === 'employee')
      report.pages.push({ role: r, vp: r === 'employee' ? 'phone' : 'desktop', ...v, links: undefined, text: v.text.slice(0, 300) })
    }
  }

  console.log('\n[4] Access control probes (API and pages by id)')
  const OTHER = /Other Customer LLC|OTHER-1|Other trade licence|Other Worker|Other Tower/
  /** An API must refuse (not 200); a page may answer, but only with "not found" / sign-in / no access, never the data. */
  const probe = async (who, ctx, url) => {
    const req = ctx ? ctx.request : (await browser.newContext()).request
    const res = await req.get(BASE + url, { maxRedirects: 0, failOnStatusCode: false })
    const body = (await res.text().catch(() => '')).slice(0, 200000)
    const leaked = OTHER.test(body), api = url.startsWith('/api/')
    const pass = !leaked && (api ? res.status() !== 200 : res.status() !== 200 || /not found|could not be found|no access|not allowed|permission/i.test(body))
    report.probes.push({ who, url, status: res.status(), leaked, pass })
    ok(pass, `${who}: ${url} → ${res.status()}${leaked ? ' LEAKED other company data' : ''}`)
  }
  // another company's records, opened by id by the demo owner
  for (const u of [`/invoices/${oInv}`, `/parties/${oCust}`, `/projects/${oProj}`, `/employees/${oEmp}`, `/documents/${oDoc}`, `/print/sales/${oInv}`, `/api/sales/${oInv}/pdf`, `/api/documents/${oDoc}/download`, `/api/statements/${oCust}`, `/parties/${oCust}/ledger`, `/print/statement/${oCust}`])
    await probe('owner→other company', owner, u)
  // what each restricted role must not get from the API
  const fin = [`/api/export/invoices?format=csv`, `/api/reports/finance?format=csv`, `/api/statements/${(await one(`select id from customers where company_id=$1 limit 1`, [D])).id}`]
  for (const r of ['hr_manager', 'project_manager', 'viewer', 'employee']) for (const u of [...fin, ...(r === 'hr_manager' ? [] : ['/api/backup'])]) await probe(r, roleCtx[r], u)
  // HR has data.export: its customer list leaves out the opening balance (money owed), finance's includes it
  const custCsv = async ctx => (await (await ctx.request.get(`${BASE}/api/export/customers?format=csv`)).text()).split('\n')[0]
  ok(!/opening_balance/.test(await custCsv(roleCtx.hr_manager)) && /opening_balance/.test(await custCsv(roleCtx.accountant)), 'customer export: opening balance only for finance users (HR: no, accountant: yes)')
  const bk = await roleCtx.hr_manager.request.get(`${BASE}/api/backup`)
  ok(bk.status() === 200 && /spreadsheet/.test(bk.headers()['content-type'] ?? ''), 'HR backup: allowed (data.export), RLS-scoped lists only')
  for (const u of ['/api/export/employees?format=csv', '/api/options/customers', '/api/customers/search?q=a', `/api/payslips/${(await one(`select id from salary_payments where company_id=$1 limit 1`, [D]))?.id ?? '00000000-0000-0000-0000-000000000000'}`])
    await probe('employee', roleCtx.employee, u)
  // signed out
  for (const u of ['/api/export/invoices?format=csv', '/api/backup', `/api/sales/${oInv}/pdf`, '/api/options/customers', '/invoices', '/me'])
    await probe('signed out', null, u)
  console.log('\n[5] Customer opening balance: hidden from non-finance editors, and kept when they save')
  const cust = (await one(`select id from customers where company_id=$1 order by name limit 1`, [D])).id
  await db.query(`update customers set opening_balance = 1234.5, opening_balance_date = '2026-01-01' where id = $1`, [cust])
  const pm = await roleCtx.project_manager.newPage(); await pm.goto(`${BASE}/parties/${cust}`); await pm.waitForLoadState('networkidle')
  await pm.getByRole('button', { name: 'Edit' }).first().click(); await pm.waitForTimeout(400)
  ok(await pm.locator('dialog[open] input[name=opening_balance]').count() === 0 && !(await pm.locator('body').innerText()).includes('1,234.50'), 'project manager: no opening balance on the customer page or in its Edit form')
  await pm.locator('dialog[open] input[name=contact_person]').fill('Site Engineer'); await pm.locator('dialog[open]').getByRole('button', { name: /^Save/ }).first().click(); await pm.waitForTimeout(1200)
  const cb = await one(`select opening_balance::float ob, opening_balance_date::text d, contact_person from customers where id=$1`, [cust])
  ok(cb.contact_person === 'Site Engineer' && cb.ob === 1234.5 && cb.d === '2026-01-01', `saved by the project manager: contact changed, opening balance kept (${cb.ob} on ${cb.d})`)
  const acc = await roleCtx.accountant.newPage(); await acc.goto(`${BASE}/parties/${cust}`); await acc.waitForLoadState('networkidle')
  await acc.getByRole('button', { name: 'Edit' }).first().click(); await acc.waitForTimeout(400)
  ok(await acc.locator('dialog[open] input[name=opening_balance]').inputValue() === '1234.5', 'accountant (finance): sees and can edit the opening balance')

  console.log('\n[6] Edge cases as a user would type them: customer form')
  const op2 = await owner.newPage(); await op2.goto(`${BASE}/parties`); await op2.waitForLoadState('networkidle')
  const openNew = async () => { await op2.getByRole('button', { name: /Add client/i }).first().click(); await op2.waitForTimeout(400) }
  const dlg2 = op2.locator('dialog[open]')
  await openNew(); await dlg2.locator('input[name=name]').fill('A'); await dlg2.getByRole('button', { name: /^Save/ }).first().click(); await op2.waitForTimeout(600)
  ok(await dlg2.count() === 1 && await dlg2.locator('input[name=name]').evaluate(el => !el.checkValidity()), 'a one-letter name is refused before sending (minimum 2)')
  const odd = `مؤسسة الصقر — "Steel" & Sons <b>LLC</b> ${'x'.repeat(150)}`.slice(0, 200)
  await dlg2.locator('input[name=name]').fill(odd); await dlg2.locator('input[name=email]').fill('not-an-email'); await dlg2.getByRole('button', { name: /^Save/ }).first().click(); await op2.waitForTimeout(600)
  ok(await dlg2.count() === 1 && await dlg2.locator('input[name=email]').evaluate(el => !el.checkValidity()), 'an invalid email is refused with a message, the dialog stays open')
  await dlg2.locator('input[name=email]').fill('info@alsaqr.ae'); await dlg2.getByRole('button', { name: /^Save/ }).first().click(); await op2.waitForTimeout(1500)
  const saved = await one(`select id, name from customers where company_id=$1 and email = 'info@alsaqr.ae'`, [D])
  ok(saved?.name === odd, 'Arabic, quotes, ampersand, angle brackets and a 200-character name are saved exactly')
  await op2.goto(`${BASE}/parties/${saved.id}`); await op2.waitForLoadState('networkidle')
  ok((await op2.locator('body').innerText()).includes('مؤسسة الصقر') && await op2.locator('b:text("LLC")').count() === 0, 'shown as text after reload (no HTML injected)')
  await op2.goto(`${BASE}/parties?q=${encodeURIComponent('الصقر')}`); await op2.waitForLoadState('networkidle')
  ok((await op2.locator('main').innerText()).includes('مؤسسة الصقر'), 'search finds it by its Arabic name')
  const over = await (async () => { const ph2 = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: await owner.storageState() }); const q = await ph2.newPage(); await q.goto(`${BASE}/parties/${saved.id}`); await q.waitForLoadState('networkidle'); const o = await q.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); await ph2.close(); return o })()
  ok(over <= 1, `the long name fits a phone screen (overflow ${over}px)`)
  await owner.close(); for (const c of Object.values(roleCtx)) await c.close()
} catch (e) { ok(false, `aborted: ${e.stack?.split('\n').slice(0, 6).join(' | ') || e}`) }

// ── summary: everything a user would have run into ──
const bad = report.pages.filter(v => v.status >= 500 || v.js.length || v.over > 1 || v.failed.some(f => /^5/.test(f)))
for (const v of bad) ok(false, `${v.role}/${v.vp} ${v.path} → ${v.status} ${v.final !== v.path.split('?')[0] ? `(→ ${v.final}) ` : ''}${v.js.length ? `JS: ${v.js.join('; ')} ` : ''}${v.over > 1 ? `overflow ${v.over}px ` : ''}${v.failed.filter(f => /^5/.test(f)).join(', ')}`)
const consoleIssues = report.pages.filter(v => v.console.length || v.failed.some(f => /^4/.test(f)))
console.log(`\nconsole errors / 4xx requests on ${consoleIssues.length} page views (details in ${OUT}/sweep.json)`)
for (const v of consoleIssues.slice(0, 40)) console.log(`  · ${v.role}/${v.vp} ${v.path}: ${[...v.console, ...v.failed].slice(0, 3).join(' | ')}`)
const slow = report.pages.filter(v => v.ms > 3000).sort((a, b) => b.ms - a.ms)
console.log(`\nslow page views (> 3 s): ${slow.length}`); for (const v of slow.slice(0, 15)) console.log(`  · ${v.role}/${v.vp} ${v.path}: ${v.ms} ms`)
const a11y = {}
for (const v of report.pages.filter(v => v.a11y && v.final === v.path.split('?')[0])) for (const [k, list] of Object.entries(v.a11y)) for (const x of list) { const key = `${k}: ${x}`; (a11y[key] ??= new Set()).add(v.path.replace(UUID, ':id')) }
const a11yRows = Object.entries(a11y).sort((a, b) => b[1].size - a[1].size)
console.log(`\naccessibility findings: ${a11yRows.length} distinct`); for (const [k, set] of a11yRows.slice(0, 40)) console.log(`  · ${k}  (${set.size} page${set.size > 1 ? 's' : ''}: ${[...set].slice(0, 4).join(', ')})`)
report.a11y = a11yRows.map(([k, set]) => ({ issue: k, pages: [...set] }))
fs.writeFileSync(`${OUT}/sweep.json`, JSON.stringify(report, null, 1))
ok(report.pages.length > 300, `${report.pages.length} page views, ${report.probes.length} access probes`)
await browser.close(); await db.end()
const failed = results.filter(r => !r[0]).length
console.log(`\nQA sweep: ${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
