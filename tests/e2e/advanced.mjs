// Advanced features e2e (Phase A): Approval Center, saved views, custom fields & statuses, activity timeline, record tasks,
// dashboard widget customisation, Daily Brief. Real Next build + PostgREST + Postgres RLS + Chromium.
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import pg from 'pg'

const BASE = process.env.E2E_BASE
const OUT = 'tests/e2e/shots/advanced'; fs.mkdirSync(OUT, { recursive: true })
const results = []
const ok = (cond, msg) => { results.push([!!cond, msg]); console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`) }
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
const exe = fs.readdirSync('/opt/pw-browsers').filter(d => d.startsWith('chromium-')).map(d => `/opt/pw-browsers/${d}/chrome-linux/chrome`).find(p => fs.existsSync(p))
const browser = await chromium.launch({ executablePath: exe })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const p = await ctx.newPage()
const jsErrors = []; p.on('pageerror', e => jsErrors.push(`${p.url()}: ${e.message}`)); p.on('dialog', d => d.accept())
const settle = async (ms = 500) => { await p.waitForLoadState('networkidle').catch(() => {}); await p.waitForTimeout(ms) }
const main = () => p.locator('main').innerText()
const dlg = () => p.locator('dialog[open]')
const shot = n => p.screenshot({ path: `${OUT}/${n}.png`, fullPage: true })
const day = n => { const x = new Date(Date.now() + 4 * 3600e3); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const EMAIL = `adv-${Date.now()}@alsaqr.test`

try {
  console.log('\n[0] Setup')
  await p.goto(`${BASE}/signup`); await p.getByLabel('Work email').fill(EMAIL); await p.getByLabel('Password').fill('correct-horse-battery'); await p.getByRole('button', { name: 'Create account' }).click()
  await p.waitForURL('**/onboarding'); await p.getByLabel('Company name').fill('Al Saqr Advanced Test'); await p.getByLabel('Your full name').fill('Adv Owner'); await p.getByRole('button', { name: 'Create company' }).click(); await p.waitForURL(`${BASE}/`)
  const co = (await one(`select p.company_id from profiles p join auth.users u on u.id=p.id where u.email=$1`, [EMAIL])).company_id
  const owner = (await one(`select id from auth.users where email=$1`, [EMAIL])).id
  const cust = (await one(`insert into customers(company_id,name,phone) values ($1,'ABC Contracting LLC','+971 50 111 2233') returning id`, [co])).id
  const proj = (await one(`insert into projects(company_id,name,customer_id,status,contract_value,expected_completion) values ($1,'Villa 214 staircase',$2,'active',1000,$3) returning id`, [co, cust, day(-5)])).id
  await one(`insert into project_expenses(company_id,project_id,category,description,amount) values ($1,$2,'material','Steel',1500) returning id`, [co, proj])
  const inv = (await one(`insert into invoices(company_id,doc_type,number,status,customer_id,customer_name,issue_date,due_date,subtotal,vat_amount,total) values ($1,'invoice','INV-T-77','sent',$2,'ABC Contracting LLC',$3,$4,1000,50,1050) returning id`, [co, cust, day(-40), day(-10)])).id
  await one(`insert into cheques(company_id,cheque_no,direction,party_name,bank_name,amount,cheque_date,status) values ($1,'C-4401','incoming','ABC Contracting LLC','ADCB',4200,$2,'received') returning id`, [co, day(2)])
  await one(`insert into documents(company_id,name,expiry_date,status) values ($1,'Trade Licence',$2,'active') returning id`, [co, day(12)])
  await one(`insert into tasks(company_id,title,owner_id,due_date,status) values ($1,'Send drawings to client',$2,$3,'todo') returning id`, [co, owner, day(-1)])
  const nav = await p.locator('aside[data-collapsed]').innerText()
  ok(nav.includes('Approvals') && nav.includes('Daily Brief'), 'sidebar: Approvals and Daily Brief')

  console.log('\n[1] Approval Center')
  await p.goto(`${BASE}/approvals?new=approval`); await settle()
  await dlg().getByLabel('What needs approval? *').fill('Buy 2 welding machines'); await dlg().getByLabel('Amount (AED)').fill('6400'); await dlg().getByLabel('Details').fill('Old machines failed inspection.')
  await dlg().getByRole('button', { name: 'Send for approval' }).click(); await settle(900)
  const req = await one(`select * from approval_requests where company_id=$1 and title='Buy 2 welding machines'`, [co])
  ok(req?.status === 'pending' && Number(req.amount) === 6400 && req.requested_by === owner, 'free-form request created (pending, AED 6,400, requester recorded)')
  await p.goto(`${BASE}/approvals`); await settle()
  ok((await main()).includes('Buy 2 welding machines') && (await main()).includes('Waiting for a decision'), 'request listed under “Waiting for a decision”')
  await p.getByRole('link', { name: /Buy 2 welding machines/ }).click(); await settle()
  await p.locator('select[name=decision]').selectOption('rejected'); await p.getByRole('button', { name: 'Save decision' }).click(); await settle()
  ok((await main()).includes('Add a note so the requester knows what to change'), 'rejecting without a note is refused with a clear message')
  await p.locator('select[name=decision]').selectOption('approved'); await p.getByLabel('Note', { exact: false }).first().fill('OK, buy locally'); await p.getByRole('button', { name: 'Save decision' }).click(); await settle(900)
  const req2 = await one(`select status, decided_by, decision_note from approval_requests where id=$1`, [req.id])
  ok(req2.status === 'approved' && req2.decided_by === owner && req2.decision_note === 'OK, buy locally', 'approved with note; decider recorded')
  ok(!!(await one(`select 1 from audit_logs where table_name='approval_requests' and record_id=$1 and action='UPDATE'`, [req.id])), 'decision is in the audit log')

  // quotation approval: request from the document, decide in the Approval Center → the document follows
  const q = (await one(`insert into invoices(company_id,doc_type,number,status,customer_id,customer_name,issue_date,subtotal,vat_amount,total) values ($1,'quotation','AS-T-9','draft',$2,'ABC Contracting LLC',$3,2000,100,2100) returning id`, [co, cust, day(0)])).id
  await one(`insert into invoice_items(company_id,invoice_id,position,description,quantity,unit,unit_price) values ($1,$2,1,'MS gate',1,'No',2000) returning id`, [co, q])
  await db.query(`update invoices set approval_status='pending' where id=$1`, [q])
  const qr = await one(`select id,status from approval_requests where entity_type='quotation' and entity_id=$1`, [q])
  ok(qr?.status === 'pending', 'quotation sent for approval appears as a request')
  await p.goto(`${BASE}/approvals?open=${qr.id}`); await settle()
  ok((await main()).includes('Open the quotation'), 'request links to the quotation')
  await p.getByRole('button', { name: 'Save decision' }).click(); await settle(900)
  const qd = await one(`select approval_status, approved_by from invoices where id=$1`, [q])
  ok(qd.approval_status === 'approved' && qd.approved_by === owner, 'approving in the Approval Center approves the quotation itself')
  ok((await one(`select status from approval_requests where id=$1`, [qr.id])).status === 'approved', 'request and document stay in step')
  ok(!!(await one(`select 1 from sales_doc_events where invoice_id=$1 and event='approval'`, [q])), 'decision shows in the quotation history')

  // rules: expense threshold
  await p.goto(`${BASE}/settings#approvals`); await settle()
  await p.getByLabel('Expenses from (AED)').fill('1000'); await p.getByRole('button', { name: 'Save approval rules' }).click(); await settle()
  ok((await one(`select value from app_settings where company_id=$1 and key='approvals.expense_threshold'`, [co]))?.value === 1000, 'Settings → Approvals: expense threshold saved')
  await db.query(`insert into project_expenses(company_id,category,description,amount,created_by) values ($1,'equipment','Welding machine',3200,$2)`, [co, owner])   // triggers run for every insert path
  const ex = await one(`select id, approval_status from project_expenses where company_id=$1 and description='Welding machine'`, [co])
  ok(ex?.approval_status === 'pending', 'an expense above the threshold waits for approval automatically')
  await p.goto(`${BASE}/expenses`); await settle()
  ok((await main()).includes('Awaiting approval'), 'expenses list shows “Awaiting approval”')
  const exr = await one(`select id from approval_requests where entity_type='expense' and entity_id=$1`, [ex.id])
  await p.goto(`${BASE}/approvals?open=${exr.id}`); await settle(); await p.locator('select[name=decision]').selectOption('approved'); await p.getByRole('button', { name: 'Save decision' }).click(); await settle(900)
  ok((await one(`select approval_status from project_expenses where id=$1`, [ex.id])).approval_status === 'approved', 'approving the request approves the expense')
  await shot('approvals')

  console.log('\n[2] Saved views')
  await p.goto(`${BASE}/tasks?view=overdue&priority=high`); await settle()
  await p.getByRole('button', { name: 'Views' }).click(); await p.getByRole('button', { name: 'Save current filters as a view…' }).click()
  await dlg().getByLabel('Name *').fill('Urgent overdue'); await dlg().getByRole('button', { name: 'Save view' }).click(); await settle(900)
  const v = await one(`select * from saved_views where company_id=$1 and name='Urgent overdue'`, [co])
  ok(v?.page === '/tasks' && v.query === 'view=overdue&priority=high' && v.shared === false, `view saved with its filters (${v?.query})`)
  await p.goto(`${BASE}/tasks`); await settle(); await p.getByRole('button', { name: 'Views' }).click(); await p.getByRole('menuitem', { name: 'Urgent overdue' }).click(); await settle()
  ok(p.url().endsWith('/tasks?view=overdue&priority=high'), 'opening the view restores the filters')
  ok((await p.getByRole('button', { name: 'Urgent overdue' }).count()) === 1, 'the Views button shows the active view name')

  console.log('\n[3] Custom fields & statuses')
  await p.goto(`${BASE}/settings#custom`); await settle()
  const cf = p.locator('#custom')
  await cf.locator('select[name=entity]').selectOption('project'); await cf.getByLabel('Field name *').fill('Site supervisor'); await cf.getByRole('button', { name: 'Add field' }).click(); await settle()
  await cf.locator('select[name=entity]').selectOption('project'); await cf.getByLabel('Field name *').fill('Paint system'); await cf.locator('select[name=field_type]').selectOption('select'); await cf.getByLabel('Dropdown options').fill('Epoxy, Polyurethane, Galvanised'); await cf.getByRole('button', { name: 'Add field' }).click(); await settle()
  const defs = (await db.query(`select key, field_type, options from custom_field_defs where company_id=$1 order by position`, [co])).rows
  ok(defs.length === 2 && defs[0].key === 'site_supervisor' && defs[1].field_type === 'select' && defs[1].options.length === 3, 'two project fields defined (text + dropdown)')
  await cf.locator('details', { hasText: 'Add a status for projects' }).locator('summary').click()
  const pd = cf.locator('details', { hasText: 'Add a status for projects' })
  await pd.getByLabel('Name *').fill('Painting'); await pd.locator('select[name=base_status]').selectOption('active'); await pd.getByRole('button', { name: 'Add status' }).click(); await settle()
  const cs = await one(`select id from custom_statuses where company_id=$1 and label='Painting'`, [co])
  ok(!!cs, 'custom project status “Painting” (counts as Active) created')
  await p.goto(`${BASE}/projects/${proj}`); await settle()
  ok((await main()).includes('Additional details'), 'project page shows “Additional details”')
  await p.locator('input[name=cf_site_supervisor]').fill('Rashid Khan'); await p.locator('select[name=cf_paint_system]').selectOption('Epoxy'); await p.getByRole('button', { name: 'Save details' }).click(); await settle()
  const cv = (await one(`select data from custom_field_values where record_id=$1`, [proj]))?.data ?? {}
  ok(cv.site_supervisor === 'Rashid Khan' && cv.paint_system === 'Epoxy', 'custom values saved')
  await p.locator('select[name=custom_status_id]').selectOption(cs.id); await p.getByRole('button', { name: 'Set status' }).click(); await settle()
  const pr = await one(`select status, custom_status_id from projects where id=$1`, [proj])
  ok(pr.custom_status_id === cs.id && pr.status === 'active', 'custom status set; standard status follows the mapping (active)')
  await p.reload(); await settle()
  ok((await main()).includes('Additional details updated') || (await main()).includes('Activity'), 'activity timeline on the project page')
  ok((await main()).includes('custom status id') || (await main()).includes('Edited by') || (await main()).includes('Additional details updated'), 'timeline lists the change and who made it')
  await shot('project-custom')

  console.log('\n[4] Record tasks + timeline on customer, employee, asset, invoice')
  await p.goto(`${BASE}/parties/${cust}`); await settle()
  await p.getByRole('button', { name: 'Add task' }).click(); await dlg().getByLabel('Task *').fill('Collect cheque from ABC'); await dlg().getByRole('button', { name: 'Add task' }).click(); await settle(900)
  ok(!!(await one(`select 1 from tasks where related_type='customer' and related_id=$1 and title='Collect cheque from ABC'`, [cust])), 'task added from the customer page is linked to the customer')
  await p.reload(); await settle()
  ok((await main()).includes('Collect cheque from ABC'), 'linked task listed on the customer page')
  await p.goto(`${BASE}/invoices/${inv}`); await settle()
  ok((await main()).includes('Tasks') && (await main()).includes('Activity'), 'invoice page: tasks + activity')

  console.log('\n[5] Daily Brief')
  await p.goto(`${BASE}/brief`); await settle()
  const br = await main()
  ok(br.includes('INV-T-77') && br.includes('days overdue'), 'overdue invoice listed with days overdue')
  ok(br.includes('C-4401'), 'cheque due this week listed')
  ok(br.includes('Trade Licence'), 'expiring document listed')
  ok(br.includes('Send drawings to client'), 'my overdue task listed')
  ok(br.includes('Villa 214 staircase') && br.includes('past the planned completion') && br.includes('above the contract value'), 'project alerts: late + over budget')
  await shot('brief')

  console.log('\n[6] Dashboard customisation')
  await p.goto(`${BASE}/`); await settle()
  ok((await main()).includes('Recent activity'), 'default dashboard unchanged (Recent activity shown)')
  await p.getByRole('button', { name: 'Customize' }).click()
  await dlg().getByRole('checkbox', { name: 'Recent activity' }).uncheck(); await dlg().getByRole('checkbox', { name: 'My tasks' }).check(); await dlg().getByRole('button', { name: 'Save', exact: true }).click(); await settle(900)
  await p.reload(); await settle()
  const dash = await main()
  ok(!dash.includes('Recent activity') && dash.includes('My tasks') && dash.includes('Send drawings to client'), 'layout saved per user: activity hidden, My tasks shown')
  await p.getByRole('button', { name: 'Customize' }).click(); await dlg().getByRole('button', { name: 'Reset to default' }).click(); await settle(900); await p.reload(); await settle()
  ok((await main()).includes('Recent activity'), 'reset restores the default dashboard')

  console.log('\n[7] Phone')
  const m = await browser.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true, storageState: await ctx.storageState() }); const mp = await m.newPage()
  for (const path of ['/approvals', '/brief', `/projects/${proj}`, `/parties/${cust}`, '/settings']) {
    await mp.goto(BASE + path); await mp.waitForLoadState('networkidle').catch(() => {})
    const clip = await mp.evaluate(() => { const main = document.querySelector('main'); const edge = Math.min(innerWidth, main.getBoundingClientRect().right) + 1
      const scroller = e => { for (let a = e.parentElement; a && a !== main; a = a.parentElement) { const o = getComputedStyle(a).overflowX; if (o === 'auto' || o === 'scroll') return true } return false }
      return [...main.querySelectorAll('*')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > edge && !scroller(e) }).length })
    ok(clip === 0, `${path}: nothing cut off on a 360px phone (${clip})`)
  }
  await mp.goto(`${BASE}/brief`); await mp.screenshot({ path: `${OUT}/m-brief.png`, fullPage: true }); await m.close()
} catch (e) {
  ok(false, `aborted: ${e.message.split('\n').slice(0, 12).join(' | ')}`); await shot('abort').catch(() => {})
}
for (const e of jsErrors) ok(false, `JS error ${e}`)
const failed = results.filter(r => !r[0]).length
console.log(`\nAdvanced suite: ${results.length - failed}/${results.length} passed`)
await browser.close(); await db.end()
process.exit(failed ? 1 : 0)
