// Platform e2e (Phase D1): sign-in history + device sessions (remote sign-out), notification rules, signed webhooks
// (local receiver, signature check, retries), read-only API keys, scheduled reports (send now + scheduler), backup status +
// full backup workbook, import wizard (mapping, check, import, undo; leads numbering), admin sign-in activity, Ctrl+K, phone.
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import http from 'node:http'
import crypto from 'node:crypto'
import pg from 'pg'

const BASE = process.env.E2E_BASE
const OUT = 'tests/e2e/shots/platform'; fs.mkdirSync(OUT, { recursive: true })
const results = []
const ok = (cond, msg) => { results.push([!!cond, msg]); console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`) }
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
const exe = fs.readdirSync('/opt/pw-browsers').filter(d => d.startsWith('chromium-')).map(d => `/opt/pw-browsers/${d}/chrome-linux/chrome`).find(p => fs.existsSync(p))
const browser = await chromium.launch({ executablePath: exe })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true }); const p = await ctx.newPage()
const jsErrors = []; p.on('pageerror', e => jsErrors.push(`${p.url()}: ${e.message}`)); p.on('dialog', d => d.accept())
const settle = async (pg_ = p, ms = 500) => { await pg_.waitForLoadState('networkidle').catch(() => {}); await pg_.waitForTimeout(ms) }
const main = (pg_ = p) => pg_.locator('main').innerText()
const dlg = () => p.locator('dialog[open]')
const waitFor = async (fn, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, 300)) } return null }
const EMAIL = `plat-${Date.now()}@alsaqr.test`, PASS = 'correct-horse-battery'
const CRON = { authorization: `Bearer ${process.env.CRON_SECRET ?? 'e2e-cron-secret-0123456789'}` }

// local webhook receiver: /ok answers 200, /fail answers 500
const got = []
const srv = http.createServer((req, res) => { let b = ''; req.on('data', d => b += d); req.on('end', () => { got.push({ path: req.url, headers: req.headers, body: b }); res.writeHead(req.url.includes('fail') ? 500 : 200); res.end('ok') }) })
await new Promise(r => srv.listen(3999, '127.0.0.1', r))
const verify = (h, body, secret) => { const [t, v1] = String(h['x-averiqo-signature'] ?? '').split(',').map(x => x.split('=')[1]); return !!v1 && crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex') === v1 }

try {
  console.log('\n[0] Setup')
  await p.goto(`${BASE}/signup`); await p.getByLabel('Work email').fill(EMAIL); await p.getByLabel('Password').fill(PASS); await p.getByRole('button', { name: 'Create account' }).click()
  await p.waitForURL('**/onboarding'); await p.getByLabel('Company name').fill('Al Saqr Platform Test'); await p.getByLabel('Your full name').fill('Platform Owner'); await p.getByRole('button', { name: 'Create company' }).click(); await p.waitForURL(`${BASE}/`)
  const me = await one(`select p.id, p.company_id from profiles p join auth.users u on u.id=p.id where u.email=$1`, [EMAIL]), co = me.company_id
  await settle()
  ok((await one(`select count(*)::int n from user_sessions where user_id=$1`, [me.id])).n === 1, 'this browser is registered as a signed-in device')

  console.log('\n[1] Sign-in history and remote sign-out')
  const other = await browser.newContext({ viewport: { width: 1280, height: 860 }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' }); const q = await other.newPage()
  await q.goto(`${BASE}/login`); await q.getByLabel('Email').fill(EMAIL); await q.getByLabel('Password').fill('wrong-password-123'); await q.getByRole('button', { name: 'Sign in' }).click(); await settle(q)
  ok((await q.locator('body').innerText()).includes('Incorrect email or password'), 'wrong password refused')
  ok((await one(`select count(*)::int n from login_events where user_id=$1 and event='sign_in_failed'`, [me.id])).n === 1, 'failed attempt recorded against the account')
  await q.getByLabel('Password').fill(PASS); await q.getByRole('button', { name: 'Sign in' }).click(); await q.waitForURL(`${BASE}/`); await settle(q)
  ok((await one(`select count(*)::int n from login_events where user_id=$1 and event='sign_in' and user_agent like '%iPhone%'`, [me.id])).n === 1, 'sign-in recorded with the device')
  await p.goto(`${BASE}/settings#account`); await settle()
  const devices = p.locator('[data-sessions] li')
  ok(await devices.count() === 2 && (await p.locator('[data-sessions]').innerText()).includes('Safari on iPhone') && (await p.locator('[data-sessions]').innerText()).includes('This device'), 'Settings lists both devices, this one marked')
  ok((await p.locator('#account').innerText()).includes('Wrong password'), 'recent activity shows the failed attempt')
  await devices.filter({ hasText: 'Safari on iPhone' }).getByRole('button', { name: 'Sign out' }).click(); await settle(p, 900)
  await q.goto(`${BASE}/tickets`); await settle(q)
  ok(/\/login\?m=revoked/.test(q.url()) && (await q.locator('body').innerText()).includes('signed out from another device'), 'the other device is signed out on its next click')
  ok((await one(`select count(*)::int n from login_events where user_id=$1 and event='session_revoked'`, [me.id])).n === 1, 'remote sign-out recorded')
  await q.goto(`${BASE}/auth/signout`); ok(!/m=revoked/.test(q.url()), 'sign-out link does nothing for a live session (no logout CSRF)')
  await other.close()

  console.log('\n[2] Webhooks')
  await p.goto(`${BASE}/settings#integrations`); await settle()
  await p.getByRole('button', { name: 'Add webhook' }).click()
  await dlg().getByLabel('Endpoint URL *').fill('http://127.0.0.1:3999/ok'); await dlg().getByLabel('Description').fill('Test receiver')
  await dlg().getByLabel('New customer').check(); await dlg().getByLabel('Quotation accepted').check()
  await dlg().getByRole('button', { name: 'Add webhook' }).click()
  const secret = await (await waitFor(async () => (await dlg().locator('input[data-secret]').count()) ? dlg().locator('input[data-secret]') : null)).inputValue()
  ok(/^whsec_/.test(secret) && !(await one(`select count(*)::int n from webhook_endpoints where secret_hint is null and company_id=$1`, [co])).n, 'signing secret shown once (only its last 4 characters are kept on the endpoint)')
  await p.keyboard.press('Escape'); await p.reload(); await settle()
  await p.locator('#integrations li', { hasText: '127.0.0.1:3999/ok' }).getByRole('button', { name: 'Send test' }).click()
  const ping = await waitFor(() => got.find(g => JSON.parse(g.body || '{}').type === 'ping'))
  ok(ping && verify(ping.headers, ping.body, secret) && ping.headers['x-averiqo-event'] === 'ping', 'test ping delivered with a valid signature')
  ok(await waitFor(async () => (await p.locator('#integrations').innerText()).includes('Delivered (HTTP 200)')), 'Settings shows the delivery result')
  // a real change made in the app → event → webhook within seconds (no scheduler needed)
  await p.goto(`${BASE}/parties?new=customer`); await settle()
  await dlg().getByLabel('Customer / company name *').fill('Webhook Client LLC'); await dlg().getByRole('button', { name: 'Save' }).click(); await settle(p, 800)
  const hook = await waitFor(() => got.find(g => g.headers['x-averiqo-event'] === 'customer.created'))
  const hb = hook ? JSON.parse(hook.body) : null
  ok(hb?.type === 'customer.created' && hb.data.name === 'Webhook Client LLC' && hb.data.url?.includes('/parties/') && verify(hook.headers, hook.body, secret), 'customer.created delivered, signed, with a link back')
  // failing endpoint → retry scheduled, error shown
  const failing = (await one(`insert into webhook_endpoints(company_id,url,events,secret_hint) values ($1,'http://127.0.0.1:3999/fail',array['customer.created'],'test') returning id`, [co])).id
  await db.query(`insert into webhook_secrets(endpoint_id,company_id,secret) values ($1,$2,$3)`, [failing, co, 'whsec_' + 'f'.repeat(32)])
  await p.goto(`${BASE}/parties?new=customer`); await settle()
  await dlg().getByLabel('Customer / company name *').fill('Second Hook Client'); await dlg().getByRole('button', { name: 'Save' }).click(); await settle(p, 800)
  const retry = await waitFor(async () => { const r = await one(`select status, response_status, attempts from webhook_deliveries where endpoint_id=$1`, [failing]); return r?.status === 'retry' ? r : null })
  ok(retry?.response_status === 500 && retry.attempts === 1, 'failed delivery (HTTP 500) scheduled for retry')
  ok(got.filter(g => g.path === '/ok' && g.headers['x-averiqo-event'] === 'customer.created').length === 2, 'the healthy endpoint is not affected by the failing one')

  console.log('\n[3] Notification rules')
  await p.goto(`${BASE}/settings#rules`); await settle()
  await p.getByRole('button', { name: 'New rule' }).click()
  await dlg().getByLabel('Rule name *').fill('Big quotation accepted'); await dlg().getByLabel('When *').selectOption('quotation.accepted')
  await dlg().getByLabel('Only if the amount is at least (AED)').fill('50000'); await dlg().getByLabel('Platform Owner').check()
  await dlg().getByRole('button', { name: 'Create rule' }).click(); await settle()
  ok((await p.locator('#rules').innerText()).includes('AED 50,000.00'), 'rule listed with its minimum amount')
  const big = (await one(`insert into invoices(company_id,doc_type,number,customer_name,total,status) values ($1,'quotation','QT-BIG-1','Marina Towers',62500,'sent') returning id`, [co])).id
  const small = (await one(`insert into invoices(company_id,doc_type,number,customer_name,total,status) values ($1,'quotation','QT-SMALL-1','Small Job',1200,'sent') returning id`, [co])).id
  await db.query(`update invoices set status='accepted' where id = any($1)`, [[big, small]])
  const sweep = await (await fetch(`${BASE}/api/cron/events`, { headers: CRON })).json()
  ok(sweep.ok && sweep.notifications >= 1, `scheduler sweep processed the events (${sweep.events} events)`)
  const bell = await waitFor(async () => (await db.query(`select title, link from in_app_notifications where user_id=$1 and title like '%accepted%'`, [me.id])).rows)
  ok(bell?.length === 1 && bell[0].title.includes('QT-BIG-1') && bell[0].link === `/invoices/${big}`, 'only the quotation over AED 50,000 raised an alert, linking to it')
  ok((await one(`select fire_count from notification_rules where company_id=$1`, [co])).fire_count === 1, 'rule shows it fired once')
  ok(got.some(g => g.headers['x-averiqo-event'] === 'quotation.accepted' && JSON.parse(g.body).data.number === 'QT-BIG-1'), 'the same event also reached the webhook')

  console.log('\n[4] API keys')
  await p.goto(`${BASE}/settings#integrations`); await settle()
  await p.getByRole('button', { name: 'Create API key' }).click()
  await dlg().getByLabel('Name *').fill('Accounting sync'); await dlg().getByLabel('Customers').check(); await dlg().getByRole('button', { name: 'Create key' }).click()
  const key = await (await waitFor(async () => (await dlg().locator('input[data-secret]').count()) ? dlg().locator('input[data-secret]') : null)).inputValue()
  ok(/^avq_[A-Za-z0-9_-]{40}$/.test(key) && !(await one(`select count(*)::int n from api_keys where key_hash=$1`, [key])).n, 'API key shown once; only its fingerprint is stored')
  await p.keyboard.press('Escape')
  const api = (path, k = key) => fetch(`${BASE}/api/v1/${path}`, { headers: { authorization: `Bearer ${k}` } })
  const list = await (await api('customers?limit=1')).json()
  ok(list.data?.length === 1 && list.next_cursor && !('notes' in list.data[0]) && 'name' in list.data[0], 'list endpoint: one page, fixed fields, next cursor')
  const page2 = await (await api(`customers?limit=50&cursor=${list.next_cursor}`)).json()
  ok(page2.data.length >= 1 && !page2.data.some(r => r.id === list.data[0].id), 'cursor continues without repeating')
  const single = await (await api(`customers/${list.data[0].id}`)).json()
  ok(single.data?.id === list.data[0].id, 'single record endpoint')
  ok((await api('invoices')).status === 403 && (await api('customers', 'avq_' + 'x'.repeat(40))).status === 401 && (await fetch(`${BASE}/api/v1/customers`)).status === 401, 'missing scope → 403, bad or missing key → 401')
  const otherCo = await one(`insert into companies(name) values ('Other Co') returning id`)
  const foreign = await one(`insert into customers(company_id,name) values ($1,'Not yours') returning id`, [otherCo.id])
  ok((await api(`customers/${foreign.id}`)).status === 404, 'another company’s record is not reachable')
  await p.reload(); await settle()
  await p.locator('#integrations tr', { hasText: 'Accounting sync' }).getByRole('button', { name: 'Revoke' }).click(); await settle(p, 800)
  ok((await api('customers')).status === 401, 'revoked key stops working immediately')

  console.log('\n[5] Scheduled reports')
  await db.query(`insert into payments(company_id,amount,paid_on) values ($1,7500,current_date - 3)`, [co]).catch(() => null)
  await p.goto(`${BASE}/settings#schedules`); await settle()
  await p.getByRole('button', { name: 'Schedule a report' }).click()
  await dlg().getByLabel('Report name *').fill('Weekly owner summary'); await dlg().getByLabel('Email').uncheck(); await dlg().getByLabel('In-app (bell)').check(); await dlg().getByLabel('Platform Owner').check()
  await dlg().getByRole('button', { name: 'Save schedule' }).click(); await settle()
  ok((await p.locator('#schedules').innerText()).includes('Every Monday, for the previous 7 days'), 'schedule listed in plain words')
  await p.locator('#schedules li', { hasText: 'Weekly owner summary' }).getByRole('button', { name: 'Send now' }).click()
  ok(await waitFor(async () => /sent to 1 channel/.test(await p.locator('#schedules').innerText())), 'Send now delivers the latest period')
  const rep = await waitFor(async () => one(`select title, body from in_app_notifications where user_id=$1 and title like 'Weekly owner summary%'`, [me.id]))
  ok(!!rep, 'report arrived in the bell')
  await db.query(`update report_schedules set last_period='W:2000-01-03' where company_id=$1`, [co])
  const cron = await (await fetch(`${BASE}/api/cron/reminders`, { headers: CRON })).json()
  ok(cron.ok && cron.reports?.reports >= 1, 'daily scheduler sends a due report')
  ok((await one(`select last_period from report_schedules where company_id=$1`, [co])).last_period.startsWith('W:'), 'schedule remembers the period it sent (no repeats)')
  ok((await one(`select ok from system_runs where job='cron' order by id desc limit 1`)).ok === true, 'scheduler run recorded as healthy')

  console.log('\n[6] Backup status')
  await p.goto(`${BASE}/backup`); await settle()
  ok((await main()).includes('No full backup has been downloaded yet') && (await main()).includes('Scheduler healthy'), 'backup page: no copy yet, scheduler healthy')
  const [dl] = await Promise.all([p.waitForEvent('download'), p.locator('[data-full-backup]').click()])
  const file = `${OUT}/backup.xlsx`; await dl.saveAs(file); const buf = fs.readFileSync(file)
  ok(buf.subarray(0, 2).toString() === 'PK' && buf.toString('latin1').includes('xl/worksheets/sheet8.xml') && /averiqo-backup-\d{4}-\d{2}-\d{2}\.xlsx/.test(dl.suggestedFilename()), `full backup workbook downloaded (${dl.suggestedFilename()})`)
  await p.reload(); await settle()
  ok((await main()).includes('Last full backup') && (await main()).includes('Full backup'), 'page shows the backup and lists it under recent exports')

  console.log('\n[7] Import wizard')
  const csv = `${OUT}/customers.csv`
  fs.writeFileSync(csv, 'Customer Name,Mobile,E-mail,VAT No\nDesert Steel LLC,+971 50 111 2222,info@desert.test,\nGulf Fabricators,+971 50 333 4444,,\nMarina Towers Owners,,owners@marina.test,\nWebhook Client LLC,,,\nBad Email Co,,not-an-email,\n')
  await p.goto(`${BASE}/import`); await settle()
  await p.locator('[data-import-wizard] input[type=file]').setInputFiles(csv); await p.getByRole('button', { name: 'Read file' }).click()
  await p.locator('[data-mapping]').waitFor()
  ok(await p.getByLabel('Column for Customer name').inputValue() === '0' && await p.getByLabel('Column for Phone').inputValue() === '1' && await p.getByLabel('Column for Email').inputValue() === '2' && await p.getByLabel('Column for TRN (VAT no.)').inputValue() === '3', 'columns matched automatically')
  await p.getByRole('button', { name: 'Check rows' }).click(); await p.locator('[data-check]').waitFor()
  const chk = await p.locator('[data-check]').innerText()
  ok(chk.includes('3 ready to import') && chk.includes('1 duplicates skipped') && chk.includes('1 rows with problems') && chk.includes('Row 6'), 'check: 3 ready, 1 duplicate, 1 problem (with its row number)')
  ok(!(await one(`select count(*)::int n from customers where company_id=$1 and name='Desert Steel LLC'`, [co])).n, 'nothing saved by the check')
  await p.getByRole('button', { name: /^Import 3/ }).click()
  ok(await waitFor(async () => (await p.locator('[data-import-wizard]').innerText()).includes('3 customers imported')), 'import done')
  const batch = await one(`select id, imported, skipped, failed from import_batches where company_id=$1 and entity='customers'`, [co])
  ok(batch?.imported === 3 && batch.skipped === 1 && batch.failed === 1, 'batch recorded with counts')
  ok((await one(`select count(*)::int n from app_events e join customers c on c.id=e.entity_id where c.import_batch_id=$1`, [batch.id])).n === 0, 'imported rows raised no per-row alerts or webhooks')
  await settle()
  await p.locator('[data-import-history] tr', { hasText: 'customers.csv' }).getByRole('button', { name: 'Undo' }).click(); await settle(p, 900)
  ok((await one(`select count(*)::int n from customers where import_batch_id=$1 and deleted_at is not null`, [batch.id])).n === 3 && (await main()).includes('Undone'), 'undo moved the 3 imported customers to the Trash')
  const leadsCsv = `${OUT}/leads.csv`
  fs.writeFileSync(leadsCsv, 'Company,Contact,Phone,Source,Budget\nPalm Villas,Ahmed,+971 55 000 1111,Walk-in,"AED 45,000"\nCreek Warehouse,Sara,,Website,12000\n')
  await p.goto(`${BASE}/import?type=leads`); await settle()
  await p.locator('[data-import-wizard] input[type=file]').setInputFiles(leadsCsv); await p.getByRole('button', { name: 'Read file' }).click(); await p.locator('[data-mapping]').waitFor()
  await p.getByRole('button', { name: 'Check rows' }).click(); await p.locator('[data-check]').waitFor(); await p.getByRole('button', { name: /^Import 2/ }).click()
  await waitFor(async () => (await p.locator('[data-import-wizard]').innerText()).includes('2 leads imported'))
  const leads = (await db.query(`select number, source, estimated_value from leads where company_id=$1 order by number`, [co])).rows
  ok(leads.length === 2 && leads.every(l => /^LD-/.test(l.number)) && leads.some(l => l.source === 'walk_in' && Number(l.estimated_value) === 45000), 'leads imported with lead numbers, source and value understood')

  console.log('\n[8] Admin views and Ctrl+K')
  await p.goto(`${BASE}/users/activity`); await settle()
  ok((await main()).includes('Wrong password') && (await main()).includes('Device signed out') && (await main()).includes('Safari on iPhone'), 'Sign-in activity shows failed attempts, sign-outs and devices')
  await p.keyboard.press('Control+k'); await p.keyboard.type('import data'); await p.waitForTimeout(300)
  ok((await p.locator('dialog[aria-label="Command palette"]').innerText()).includes('Import data (Excel / CSV)'), 'Ctrl+K finds the import wizard')
  await p.keyboard.press('Escape')

  console.log('\n[9] Phone')
  const m = await browser.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true, storageState: await ctx.storageState() }); const mp = await m.newPage()
  for (const path of ['/settings', '/import', '/backup', '/users/activity']) {
    await mp.goto(BASE + path); await mp.waitForLoadState('networkidle').catch(() => {})
    const clip = await mp.evaluate(() => { const main = document.querySelector('main'); const edge = Math.min(innerWidth, main.getBoundingClientRect().right) + 1
      const scroller = e => { for (let a = e.parentElement; a && a !== main; a = a.parentElement) { const o = getComputedStyle(a).overflowX; if (o === 'auto' || o === 'scroll') return true } return false }
      return [...main.querySelectorAll('*')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > edge && !scroller(e) }).length })
    ok(clip === 0, `${path}: nothing cut off on a 360px phone (${clip})`)
  }
  await mp.goto(`${BASE}/settings#integrations`); await mp.screenshot({ path: `${OUT}/m-settings.png`, fullPage: true }); await m.close()
  for (const [path, name] of [['/settings#integrations', 'integrations'], ['/import', 'import'], ['/backup', 'backup'], ['/users/activity', 'activity']]) { await p.goto(BASE + path); await settle(); await p.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }) }
} catch (e) {
  ok(false, `aborted: ${e.message.split('\n').slice(0, 12).join(' | ')}`); await p.screenshot({ path: `${OUT}/abort.png`, fullPage: true }).catch(() => {})
}
for (const e of jsErrors) ok(false, `JS error ${e}`)
const failed = results.filter(r => !r[0]).length
console.log(`\nPlatform suite: ${results.length - failed}/${results.length} passed`)
srv.close(); await browser.close(); await db.end()
process.exit(failed ? 1 : 0)
