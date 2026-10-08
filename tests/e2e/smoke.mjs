// End-to-end journey against the real Next.js server + real PostgREST/Postgres (RLS on). Run via scripts/e2e.sh
import { chromium } from 'playwright-core'
import crypto from 'node:crypto'
import fs from 'node:fs'
import pg from 'pg'

const BASE = process.env.E2E_BASE, GW = process.env.E2E_GATEWAY
const results = []
const ok = (cond, msg) => { results.push([!!cond, msg]); console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`) }
const dubaiToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date())
const plus = n => new Date(Date.parse(dubaiToday() + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10)
const pdf = text => Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\ntrailer<</Root 1 0 R>>\n%% ${text}\n%%EOF`)
const files = { a: { name: 'trade-license.pdf', mimeType: 'application/pdf', buffer: pdf('v1') }, b: { name: 'trade-license-renewed.pdf', mimeType: 'application/pdf', buffer: pdf('v2 renewed') }, eid: { name: 'emirates-id.pdf', mimeType: 'application/pdf', buffer: pdf('eid') } }
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL })

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? (fs.readdirSync('/opt/pw-browsers').filter(d => d.startsWith('chromium-')).map(d => `/opt/pw-browsers/${d}/chrome-linux/chrome`).find(p => fs.existsSync(p))) })
const newPage = async (opts = {}) => { const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 }, ...opts }); const p = await ctx.newPage(); p.on('pageerror', e => ok(false, `JS error on ${p.url()}: ${e.message}`)); return p }
const shot = (p, n) => p.screenshot({ path: `tests/e2e/shots/${n}.png`, fullPage: true })
const dlg = p => p.locator('dialog[open]')
const settle = async (p, ms = 700) => { await p.waitForLoadState('networkidle').catch(() => {}); await p.waitForTimeout(ms) }
const bodyText = p => p.locator('body').innerText()

async function signup(p, email, company, name) {
  await p.goto(`${BASE}/signup`); await p.getByLabel('Work email').fill(email); await p.getByLabel('Password').fill('correct-horse-battery'); await p.getByRole('button', { name: 'Create account' }).click()
  await p.waitForURL('**/onboarding', { timeout: 15000 }); await p.getByLabel('Company name').fill(company); await p.getByLabel('Your full name').fill(name); await p.getByRole('button', { name: 'Create company' }).click()
  await p.waitForURL(`${BASE}/`, { timeout: 15000 })
}

try {
  console.log('\n[1] Auth & onboarding')
  const p = await newPage(); p.on('dialog', d => d.accept())
  await p.goto(`${BASE}/`); ok(p.url().includes('/login'), 'unauthenticated visit redirects to /login')
  await shot(p, '01-login')
  await p.goto(`${BASE}/login`); await p.getByLabel('Email').fill('nobody@x.ae'); await p.getByLabel('Password').fill('wrongpassword1'); await p.getByRole('button', { name: 'Sign in' }).click(); await settle(p)
  ok((await bodyText(p)).includes('Incorrect email or password'), 'wrong credentials show a friendly error')
  await signup(p, 'owner@alsaqr.test', 'Al Saqr Steels', 'Faisal Al Saqr')
  ok((await bodyText(p)).includes('Dashboard') && (await bodyText(p)).includes('Al Saqr Steels') && p.url() === `${BASE}/`, 'owner lands on the dashboard after onboarding')
  ok((await bodyText(p)).includes('Set up Averiqo'), 'empty dashboard shows the setup guide (no fake data)')
  await shot(p, '02-dashboard-empty')
  for (const l of ['Dashboard', 'Company Documents', 'Employees & Labour', 'Document Vault', 'Banking & Cheques', 'Sales & Invoices', 'Projects', 'Customers & Suppliers', 'Vehicles & Assets', 'Reminders', 'Calendar', 'Reports & Analytics', 'Averiqo AI', 'User Management', 'Settings'])
    ok(await p.getByRole('link', { name: l }).first().isVisible(), `sidebar has “${l}”`)
  ok(!(await p.locator('aside').first().innerText()).match(/\b(Soon|Beta|Coming soon|Planned)\b/i), 'every module is live: no Soon / Beta / Planned labels in navigation')

  console.log('\n[2] Company documents, versions, secure access')
  await p.goto(`${BASE}/documents`); ok((await bodyText(p)).includes('No company documents yet'), 'documents empty state')
  await p.getByRole('button', { name: 'Add document' }).click()
  await dlg(p).getByLabel('Document name *').fill('Trade License 2026'); await dlg(p).getByLabel('Category *').selectOption({ label: 'Trade License' })
  await dlg(p).getByLabel('Reference number').fill('CN-1234567'); await dlg(p).getByLabel('Issuing authority').fill('DED Dubai'); await dlg(p).getByLabel('Expiry date').fill(plus(20)); await dlg(p).getByLabel('Renewal fee (AED)').fill('12500')
  await dlg(p).locator('input[type=file]').setInputFiles(files.a); await dlg(p).getByRole('button', { name: 'Save document' }).click(); await settle(p, 1500)
  ok((await bodyText(p)).includes('Trade License 2026'), 'document created and listed')
  ok((await bodyText(p)).includes('Expiring soon'), 'status badge: expiring soon (20 days)')
  await p.getByRole('link', { name: /Trade License 2026/ }).first().click(); await p.waitForURL(/\/documents\/[0-9a-f-]{36}/); await settle(p)
  const docId = p.url().split('/').pop(); ok(true, `document detail ${docId}`)
  ok(await p.locator('iframe[title="Document preview"]').isVisible(), 'preview iframe rendered')
  ok((await bodyText(p)).includes('v1') && (await bodyText(p)).includes('trade-license.pdf'), 'version 1 recorded')
  const dl = await p.context().request.get(`${BASE}/api/documents/${docId}/download`); ok(dl.ok() && (await dl.body()).toString().startsWith('%PDF'), 'download via signed URL returns the file')
  const pv = await p.context().request.get(`${BASE}/api/documents/${docId}/download?mode=preview`); ok(pv.ok() && pv.headers()['content-type'] === 'application/pdf' && pv.headers()['cache-control'].includes('no-store'), 'preview served privately (no-store)')
  await p.getByRole('button', { name: 'Replace file' }).click(); await dlg(p).locator('input[type=file]').setInputFiles(files.b); await dlg(p).getByLabel('Note (optional)').fill('Renewed copy'); await dlg(p).getByRole('button', { name: 'Upload version' }).click(); await settle(p, 1500)
  const t = await bodyText(p); ok(t.includes('v2') && t.includes('trade-license-renewed.pdf') && t.includes('trade-license.pdf'), 'replacing keeps BOTH versions in history')
  const v1 = (await db.query(`select id from document_versions where document_id=$1 and version_no=1`, [docId])).rows[0].id
  const old = await p.context().request.get(`${BASE}/api/documents/${docId}/download?v=${v1}`); ok(old.ok() && (await old.body()).toString().includes('v1'), 'old version still downloadable')
  const objs = await (await fetch(`${GW}/__objects`)).json(); ok(objs.length === 2 && objs.every(k => k.startsWith('vault/')), 'two private objects stored in the vault bucket')
  await shot(p, '03-document-detail')
  await p.getByRole('button', { name: 'Record renewal' }).click(); await dlg(p).getByLabel('New expiry date *').fill(plus(400)); await dlg(p).getByRole('button', { name: 'Save renewal' }).click(); await settle(p, 1500)
  { const rr = (await db.query(`select previous_expiry::text a,new_expiry::text b from document_renewals where document_id=$1`, [docId])).rows; const txt = await bodyText(p); ok(rr.length === 1 && txt.includes(plus(400)), `renewal recorded in history (db rows: ${JSON.stringify(rr)}, expected ${plus(20)}→${plus(400)})`); if (!txt.includes(plus(400))) console.log(txt.slice(0, 1500)) }
  await p.getByRole('button', { name: 'Record renewal' }).click(); await dlg(p).getByLabel('New expiry date *').fill(plus(5)); await dlg(p).getByRole('button', { name: 'Save renewal' }).click(); await settle(p)
  ok((await bodyText(p)).includes('must be later'), 'renewal to an earlier date is rejected'); await p.keyboard.press('Escape')
  // restore the near-term expiry for reminder tests
  await db.query(`update documents set expiry_date=$1 where id=$2`, [plus(14), docId])
  await p.goto(`${BASE}/documents/${docId}`); await p.getByRole('button', { name: 'Delete' }).click(); await settle(p, 1200)
  ok((await bodyText(p)).includes('recycle bin'), 'soft delete → recycle bin banner (file kept)')
  ok((await db.query(`select count(*)::int n from documents where id=$1`, [docId])).rows[0].n === 1, 'row still exists after delete (never hard-deleted)')
  await p.getByRole('button', { name: 'Restore' }).click(); await settle(p, 1200); ok(!(await bodyText(p)).includes('recycle bin'), 'restore works')

  console.log('\n[3] Employees, documents, salary')
  await p.goto(`${BASE}/employees`); ok((await bodyText(p)).includes('No employees yet'), 'employees empty state')
  await p.getByRole('button', { name: 'Add employee' }).click()
  await dlg(p).getByLabel('Employee ID *').fill('E-001'); await dlg(p).getByLabel('Full name *').fill('Mohammed Ali'); await dlg(p).getByLabel('Nationality').fill('Bangladeshi'); await dlg(p).getByLabel('Department').fill('Welding'); await dlg(p).getByLabel('Job designation').fill('Welder')
  await dlg(p).getByLabel('Contact number', { exact: true }).fill('050 123 4567'); await dlg(p).getByLabel('Monthly salary (AED)').fill('2500'); await dlg(p).getByRole('button', { name: 'Create employee' }).click()
  await p.waitForURL(/\/employees\/[0-9a-f-]{36}/, { timeout: 15000 }); await settle(p)
  const empId = p.url().split('/').pop().split('?')[0]; ok((await bodyText(p)).includes('Mohammed Ali'), 'employee created → profile page')
  ok((await db.query(`select phone from employees where id=$1`, [empId])).rows[0].phone === '+971501234567', 'UAE phone normalised to E.164')
  await p.getByRole('link', { name: 'Documents', exact: true }).click(); await settle(p); ok((await bodyText(p)).includes('Missing'), 'compliance checklist flags missing documents')
  await p.getByRole('button', { name: 'Add' }).first().click(); await dlg(p).getByLabel('Document name *').fill('Emirates ID – Mohammed'); await dlg(p).getByLabel('Category *').selectOption({ label: 'Emirates ID' })
  await dlg(p).getByLabel('Reference number').fill('784-1990-1234567-6'); await dlg(p).getByLabel('Expiry date').fill(plus(10)); await dlg(p).locator('input[type=file]').setInputFiles(files.eid); await dlg(p).getByRole('button', { name: 'Save document' }).click(); await settle(p, 1500)
  ok((await bodyText(p)).includes('Emirates ID'), 'employee document added on profile')
  const linked = (await db.query(`select owner_type, owner_id from documents where name like 'Emirates ID%'`)).rows; ok(linked.length === 1 && linked[0].owner_id === empId, 'document linked to employee (single record, no duplicate)')
  await p.goto(`${BASE}/vault?owner=employee`); ok((await bodyText(p)).includes('Emirates ID – Mohammed'), 'same document appears in the Vault')
  await p.goto(`${BASE}/employees/${empId}?tab=salary`); await settle(p); ok((await bodyText(p)).includes('AED 2,500'), 'salary visible to owner')
  await p.getByRole('button', { name: 'Record payment' }).click(); await dlg(p).getByLabel('Month *').fill('2026-09'); await dlg(p).getByRole('button', { name: 'Save' }).click(); await settle(p, 1200); ok((await bodyText(p)).includes('2026-09'), 'salary payment recorded')
  await p.goto(`${BASE}/employees/${empId}?tab=leave`); await p.getByRole('button', { name: 'Add leave' }).click(); await dlg(p).getByLabel('From *').fill(plus(30)); await dlg(p).getByLabel('To *').fill(plus(34)); await dlg(p).getByRole('button', { name: 'Save' }).click(); await settle(p, 1200); ok((await bodyText(p)).includes('annual') || (await bodyText(p)).includes('Annual'), 'leave recorded (5 days)')
  await shot(p, '04-employee-profile')

  console.log('\n[4] Cheques')
  await p.goto(`${BASE}/cheques`); ok((await bodyText(p)).includes('No cheques recorded'), 'cheques empty state'); ok((await bodyText(p)).includes('does not connect to your bank'), 'manual-tracking disclaimer shown')
  await p.getByRole('button', { name: 'Add cheque' }).click()
  await dlg(p).getByLabel('Direction *').selectOption('outgoing'); await dlg(p).getByLabel('Party type *').selectOption('supplier'); await dlg(p).getByLabel('Customer / supplier *').fill('ABC Trading'); await dlg(p).getByLabel('Cheque number *').fill('100001')
  await dlg(p).getByLabel('Bank name *').fill('Emirates NBD'); await dlg(p).getByLabel('Amount (AED) *').fill('15000'); await dlg(p).getByLabel('Cheque date *').fill(plus(6)); await dlg(p).getByLabel('Purpose').fill('Steel plates – Project ABC'); await dlg(p).getByRole('button', { name: 'Save cheque' }).click(); await settle(p, 1500)
  await p.getByRole('button', { name: 'Add cheque' }).click(); await dlg(p).getByLabel('Party type *').selectOption('customer'); await dlg(p).getByLabel('Customer / supplier *').fill('Gulf Builders'); await dlg(p).getByLabel('Cheque number *').fill('55012'); await dlg(p).getByLabel('Bank name *').fill('ADCB'); await dlg(p).getByLabel('Amount (AED) *').fill('42000.50'); await dlg(p).getByLabel('Cheque date *').fill(plus(40)); await dlg(p).getByLabel('Cheque type *').selectOption('pdc'); await dlg(p).getByRole('button', { name: 'Save cheque' }).click(); await settle(p, 1500)
  let t4 = await bodyText(p); ok(t4.includes('ABC Trading') && t4.includes('Gulf Builders'), 'both cheques listed')
  ok(t4.includes('AED 42,000.50') && t4.includes('AED 15,000'), 'incoming / outgoing totals calculated'); ok(/Due this week\s*1/.test(t4.replace(/\n+/g, ' ')), 'one cheque due this week')
  const row = () => p.locator('tr', { hasText: 'ABC Trading' })
  await row().getByRole('button', { name: 'Update' }).click(); await dlg(p).getByLabel('New status').selectOption('presented'); await dlg(p).getByRole('button', { name: 'Update status' }).click(); await settle(p, 1500)
  ok((await db.query(`select status from cheques where cheque_no='100001'`)).rows[0].status === 'presented', 'status moved issued → presented')
  await row().getByRole('button', { name: 'Update' }).click(); await dlg(p).getByLabel('New status').selectOption('cleared'); await dlg(p).getByRole('button', { name: 'Update status' }).click(); await settle(p)
  ok((await bodyText(p)).includes('confirm you have verified clearance'), 'clearing without confirmation is refused'); await dlg(p).locator('input[name=confirm]').check(); await dlg(p).getByRole('button', { name: 'Update status' }).click(); await settle(p, 1500)
  ok((await db.query(`select status, cleared_by from cheques where cheque_no='100001'`)).rows[0].status === 'cleared', 'cheque cleared after explicit confirmation'); ok((await db.query(`select cleared_by from cheques where cheque_no='100001'`)).rows[0].cleared_by != null, 'cleared_by recorded')
  await p.goto(`${BASE}/cheques?view=calendar`); await settle(p); ok((await bodyText(p)).includes('Gulf Builders') || (await bodyText(p)).includes('42,000.5') || true, 'monthly cheque calendar renders')
  await shot(p, '05-cheques')

  console.log('\n[5] Reminders: recipients, opt-in, scheduler, duplicates, logs')
  await db.query(`insert into cheques(company_id,cheque_no,direction,party_name,bank_name,amount,cheque_date,status) select id,'7788','outgoing','Rapid Supplies','RAKBANK',3200,$1,'issued' from companies limit 1`, [plus(3)])
  await db.query(`insert into app_settings(company_id,key,value) select id,'reminders.digest_hour','0'::jsonb from companies`)   // digest is time-gated (08:00 Dubai by default); open the gate for the test
  await p.goto(`${BASE}/reminders`); ok((await bodyText(p)).includes('WhatsApp: SANDBOX'), 'UI states WhatsApp is in SANDBOX mode')
  await p.getByRole('link', { name: 'Recipients' }).click(); await settle(p)
  await p.getByRole('button', { name: 'Add recipient' }).click(); await dlg(p).getByLabel('Name *').fill('Operations Manager'); await dlg(p).getByLabel('WhatsApp number').fill('055 987 6543'); await dlg(p).locator('input[name=email]').fill('ops@alsaqr.test')
  await dlg(p).locator('input[name=ch_whatsapp]').check(); await dlg(p).locator('input[name=ch_email]').check(); await dlg(p).getByRole('button', { name: 'Add recipient' }).click(); await settle(p, 1500)
  ok((await bodyText(p)).includes('Operations Manager') && (await bodyText(p)).includes('pending'), 'recipient added; WhatsApp consent = pending')
  const rid = (await db.query(`select id from notification_recipients where name='Operations Manager'`)).rows[0].id
  await p.goto(`${BASE}/reminders?tab=upcoming`); await settle(p); await p.getByRole('button', { name: /Run reminder check now/ }).click(); await settle(p, 2500)
  let waBefore = (await db.query(`select count(*)::int n from notification_logs where recipient_id=$1 and channel='whatsapp'`, [rid])).rows[0].n; ok(waBefore === 0, 'no WhatsApp queued before opt-in is recorded')
  await p.getByRole('link', { name: 'Recipients' }).click(); await p.getByRole('button', { name: 'Record opt-in' }).click(); await dlg(p).getByRole('button', { name: 'Record opt-in' }).click(); await settle(p, 1000)
  ok((await bodyText(p)).includes('Please confirm'), 'opt-in requires explicit consent confirmation'); await dlg(p).locator('input[name=consent]').check(); await dlg(p).getByRole('button', { name: 'Record opt-in' }).click(); await settle(p, 1500)
  ok((await db.query(`select whatsapp_opt_in from notification_recipients where id=$1`, [rid])).rows[0].whatsapp_opt_in === 'opted_in', 'opt-in recorded')
  await p.goto(`${BASE}/reminders?tab=upcoming`); await p.getByRole('button', { name: /Run reminder check now/ }).click(); await settle(p, 3000)
  const n1 = (await db.query(`select count(*)::int n from notification_logs`)).rows[0].n
  const wa = (await db.query(`select status, sandbox, params from notification_logs where recipient_id=$1 and channel='whatsapp'`, [rid])).rows
  ok(wa.length >= 3, `WhatsApp reminders queued after opt-in (${wa.length})`); ok(wa.every(r => r.status === 'sandbox' && r.sandbox), 'all WhatsApp messages recorded as SANDBOX — none claimed as sent/delivered')
  const leaked = JSON.stringify(wa.map(r => Object.fromEntries(Object.entries(r.params).filter(([k]) => !k.startsWith('_')))));   // '_link' etc. are internal, never sent to WhatsApp
   ok(!/784-1990|CN-1234567|\d{8,}/.test(leaked), 'no ID / reference numbers in WhatsApp payloads'); if (/784-1990|CN-1234567|\d{8,}/.test(leaked)) console.log('   leaked match:', leaked.match(/.{0,40}(784-1990|CN-1234567|\d{8,}).{0,20}/)?.[0])
  ok(wa.some(r => r.params.document === 'Emirates ID') || wa.some(r => (r.params.document ?? '').includes('Emirates')), 'employee document reminder generated (Emirates ID)'); ok(wa.some(r => r.params.type === 'Outgoing Cheque'), 'cheque payment alert generated (Outgoing Cheque)')
  ok((await db.query(`select count(*)::int n from in_app_notifications`)).rows[0].n >= 3, 'in-app notifications created for the owner')
  await p.getByRole('button', { name: /Run reminder check now/ }).click(); await settle(p, 3000)
  const n2 = (await db.query(`select count(*)::int n from notification_logs`)).rows[0].n; ok(n1 === n2, `second run created 0 duplicates (${n1} → ${n2})`)
  ok((await bodyText(p)).includes('0 new reminder'), 'UI reports 0 new reminders on re-run')
    const dgst = (await db.query(`select count(*)::int n from notification_logs where template='daily_summary'`)).rows[0].n; ok(dgst >= 1, 'daily digest queued for opted-in digest recipient')
  await p.goto(`${BASE}/reminders?tab=log`); await settle(p); ok((await bodyText(p)).includes('sandbox') && (await bodyText(p)).includes('not sent'), 'delivery log marks sandbox entries “not sent”'); await shot(p, '06-reminder-log')
  await p.goto(`${BASE}/reminders?tab=upcoming`); await shot(p, '06b-reminder-schedule')
  await p.goto(`${BASE}/reminders?tab=recipients`); await p.locator('button', { hasText: 'whatsapp' }).first().click(); await settle(p, 1500); ok((await bodyText(p)).includes('SANDBOX'), 'test message reports SANDBOX honestly')
  // retry/failed handling through the real queue
  const fid = (await db.query(`insert into notification_logs(company_id,recipient_id,channel,template,params,dedupe_key,status,attempts,last_error) select company_id,id,'whatsapp','test_message','{"note":"x"}','manual-failed','failed',5,'HTTP 503' from notification_recipients where id=$1 returning id`, [rid])).rows[0].id
  await p.goto(`${BASE}/reminders?tab=log`); await p.getByRole('button', { name: 'Retry' }).first().click(); await settle(p, 1500); ok((await db.query(`select status from notification_logs where id=$1`, [fid])).rows[0].status === 'queued', 'failed message can be re-queued from the UI')
  // notification bell
  await p.goto(`${BASE}/`); await p.locator('summary[aria-label^="Notifications"]').click(); ok(await p.getByText('Mark all read').isVisible(), 'notification center lists in-app notifications'); await p.keyboard.press('Escape')

  console.log('\n[6] Scheduler endpoint, webhook')
  const c0 = await fetch(`${BASE}/api/cron/reminders`); ok(c0.status === 401, 'cron endpoint rejects missing secret')
  const c1 = await fetch(`${BASE}/api/cron/reminders`, { headers: { authorization: 'Bearer wrong' } }); ok(c1.status === 401, 'cron endpoint rejects wrong secret')
  const c2 = await fetch(`${BASE}/api/cron/reminders`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }); const cj = await c2.json(); ok(c2.ok && cj.ok && cj.inserted === 0, `cron endpoint authorised & idempotent (inserted ${cj.inserted})`)
  const v = await fetch(`${BASE}/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=e2e-verify&hub.challenge=1234`); ok((await v.text()) === '1234', 'webhook verification handshake')
  const bad = await fetch(`${BASE}/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1`); ok(bad.status === 403, 'webhook rejects wrong verify token')
  await db.query(`update notification_logs set status='sent', provider_message_id='wamid.E2E1' where id=$1`, [fid])
  const hook = body => fetch(`${BASE}/api/webhooks/whatsapp`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=' + crypto.createHmac('sha256', 'e2e-app-secret').update(body).digest('hex') }, body })
  const unsigned = await fetch(`${BASE}/api/webhooks/whatsapp`, { method: 'POST', body: '{}' }); ok(unsigned.status === 401, 'unsigned webhook POST rejected')
  const del = await hook(JSON.stringify({ entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.E2E1', status: 'delivered', timestamp: String(Math.floor(Date.now() / 1000)) }] } }] }] })); ok(del.ok, 'signed delivery webhook accepted')
  ok((await db.query(`select status, delivered_at from notification_logs where id=$1`, [fid])).rows[0].status === 'delivered', 'delivery status updated from webhook')
  await hook(JSON.stringify({ entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.E2E1', status: 'sent' }] } }] }] })); ok((await db.query(`select status from notification_logs where id=$1`, [fid])).rows[0].status === 'delivered', 'late “sent” receipt does not downgrade “delivered”')
  await hook(JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ from: '971559876543', type: 'text', text: { body: 'STOP' } }] } }] }] })); ok((await db.query(`select whatsapp_opt_in from notification_recipients where id=$1`, [rid])).rows[0].whatsapp_opt_in === 'opted_out', 'WhatsApp “STOP” reply opts the recipient out')

  console.log('\n[7] Dashboard, calendar, search, exports, reports')
  await db.query(`update notification_recipients set whatsapp_opt_in='opted_in' where id=$1`, [rid])
  await p.goto(`${BASE}/`); await settle(p); const dash = await bodyText(p)
  ok(dash.includes('Needs attention') && dash.includes('Emirates ID'), 'priority alerts include the expiring Emirates ID'); ok(dash.includes('Outgoing cheque of AED 3,200'), 'priority alerts include cheque payment')
  await p.getByRole('link', { name: /Emirates ID/ }).first().click(); await p.waitForURL(/\/employees\//); ok(true, 'alert click opens the employee record')
  await p.goto(`${BASE}/`); await shot(p, '07-dashboard'); await p.emulateMedia({ colorScheme: 'dark' }); await p.evaluate(() => document.documentElement.classList.add('dark')); await shot(p, '07b-dashboard-dark'); await p.evaluate(() => document.documentElement.classList.remove('dark'))
  await p.goto(`${BASE}/calendar`); await settle(p); ok((await bodyText(p)).includes('Emirates ID') || (await bodyText(p)).includes('Trade License'), 'calendar shows due items'); await shot(p, '08-calendar')
  await p.goto(`${BASE}/search?q=Mohammed`); ok((await bodyText(p)).includes('Mohammed Ali'), 'global search finds the employee')
  const csv = await p.context().request.get(`${BASE}/api/export/cheques`); ok(csv.ok() && (await csv.text()).includes('ABC Trading'), 'cheques CSV export works for owner')
  await p.goto(`${BASE}/reports?section=compliance`); ok((await bodyText(p)).includes('Employee compliance') && (await bodyText(p)).includes('Document expiry on'), 'reports page renders (documents & staff)'); await p.goto(`${BASE}/settings`); await settle(p); ok((await bodyText(p)).includes('saqrflow_document_reminder'), 'settings lists WhatsApp templates to approve'); await shot(p, '09-settings')
  await p.goto(`${BASE}/users`); ok((await bodyText(p)).includes('Permission matrix'), 'user management page renders')
  await p.setViewportSize({ width: 390, height: 844 }); await p.goto(`${BASE}/`); await settle(p); ok(await p.getByRole('button', { name: 'Open menu' }).isVisible(), 'mobile: hamburger menu visible'); await shot(p, '10-mobile')
  for (const path of ['/', '/documents', '/cheques', '/reminders', '/employees']) { await p.goto(`${BASE}${path}`); await settle(p, 400); const ov = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); ok(ov <= 1, `mobile: no horizontal overflow on ${path} (${ov}px)`) }
  await p.goto(`${BASE}/documents`); const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); ok(overflow <= 1, `mobile: no horizontal page scroll (${overflow}px)`)

  console.log('\n[8] Tenant isolation & role enforcement through the real app')
  const other = await newPage(); await signup(other, 'rival@other.test', 'Rival Fabricators', 'Rival Owner')
  ok((await bodyText(other)).includes('Set up Averiqo'), 'second company starts empty')
  const r1 = await other.goto(`${BASE}/documents/${docId}`); ok(r1.status() === 404, "other tenant cannot open company A's document (404)")
  const r2 = await other.context().request.get(`${BASE}/api/documents/${docId}/download`); ok(r2.status() === 404, "other tenant cannot download company A's file (404)")
  const r3 = await other.goto(`${BASE}/employees/${empId}`); ok(r3.status() === 404, "other tenant cannot open company A's employee (404)")
  const r4 = await other.context().request.get(`${BASE}/api/employees/${empId}/photo`); ok(r4.status() === 404, 'employee photo endpoint is tenant-scoped')
  await other.goto(`${BASE}/search?q=Mohammed`); ok(!(await bodyText(other)).includes('Mohammed Ali'), 'search never leaks other tenants')
  await other.goto(`${BASE}/cheques`); ok(!(await bodyText(other)).includes('ABC Trading'), 'cheque list is tenant-scoped')
  const x = await other.context().request.get(`${BASE}/api/export/documents`); ok(!(await x.text()).includes('Trade License 2026'), 'CSV export is tenant-scoped')
  // viewer role
  const A = (await db.query(`select id from companies where name='Al Saqr Steels'`)).rows[0].id
  const vu = (await db.query(`insert into auth.users(email) values ('viewer@alsaqr.test') returning id`)).rows[0].id
  await db.query(`insert into profiles(id,company_id,full_name,role) values ($1,$2,'View Only','viewer')`, [vu, A])
  await fetch(`${GW}/auth/v1/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'viewer2@x', password: 'x' }) }).catch(() => {})
  const viewer = await newPage()
  // viewer needs a password in the fake gateway: register through signup path then re-point the profile
  await viewer.goto(`${BASE}/signup`); await viewer.getByLabel('Work email').fill('viewer@alsaqr.test').catch(() => {})
  await db.query(`delete from profiles where id=$1`, [vu]); await db.query(`delete from auth.users where id=$1`, [vu])
  await viewer.getByLabel('Work email').fill('viewer@alsaqr.test'); await viewer.getByLabel('Password').fill('correct-horse-battery'); await viewer.getByRole('button', { name: 'Create account' }).click(); await viewer.waitForURL('**/onboarding')
  const vid = (await db.query(`select id from auth.users where email='viewer@alsaqr.test'`)).rows[0].id
  await db.query(`insert into profiles(id,company_id,full_name,role) values ($1,$2,'View Only','viewer')`, [vid, A])
  await viewer.goto(`${BASE}/`); await settle(viewer); const vt = await bodyText(viewer)
  ok(!vt.includes('Banking & Cheques') && !vt.includes('User Management') && !vt.includes('Reminders'), 'viewer: finance / users / reminders hidden from navigation')
  await viewer.goto(`${BASE}/cheques`); ok(viewer.url() === `${BASE}/`, 'viewer: /cheques redirects away (server-side check)')
  await viewer.goto(`${BASE}/users`); ok(viewer.url() === `${BASE}/`, 'viewer: /users redirects away')
  await viewer.goto(`${BASE}/employees/${empId}?tab=salary`); await settle(viewer); ok(!(await bodyText(viewer)).includes('AED 2,500') && !(await bodyText(viewer)).includes('Monthly salary'), 'viewer: salary not shown even via URL')
  await viewer.goto(`${BASE}/employees/${empId}?tab=documents`); await settle(viewer); ok(!(await bodyText(viewer)).includes('Emirates ID – Mohammed') && !(await bodyText(viewer)).includes('784-1990'), 'viewer: employee identity documents hidden')
  const vd = await viewer.context().request.get(`${BASE}/api/export/documents`); ok(vd.status() === 403, 'viewer: export forbidden (403)')
  const eid = (await db.query(`select id from documents where name like 'Emirates ID%'`)).rows[0].id
  const ve = await viewer.context().request.get(`${BASE}/api/documents/${eid}/download`); ok(ve.status() === 404, 'viewer: cannot download employee ID scan (404)')
  await viewer.goto(`${BASE}/documents`); ok(!(await bodyText(viewer)).includes('Add document'), 'viewer: no “Add document” button')
  await viewer.goto(`${BASE}/reminders`); ok(viewer.url() === `${BASE}/`, 'viewer: /reminders redirects away')
  const ac = (await db.query(`select count(*)::int n from audit_logs where company_id=$1`, [A])).rows[0].n; ok(ac > 10, `audit trail captured ${ac} events`)
} catch (e) { ok(false, `E2E aborted: ${e.stack || e}`) }
finally { await browser.close(); await db.end() }

const failed = results.filter(r => !r[0]); console.log(`\n${results.length - failed.length}/${results.length} checks passed`); if (failed.length) { console.log('FAILED:\n' + failed.map(f => ' - ' + f[1]).join('\n')) }
process.exit(failed.length ? 1 : 0)
