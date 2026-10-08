// Phase 1 operations e2e. Flow 1: Lead → activity → site visit (+ report) → quotation from the visit → sent → accepted (lead Won)
// → work order (+ project) → tasks → invoice → payment. Flow 3: project → daily site report (+ photo, attendance) → task → completion.
// Plus pipeline drag-and-drop, cost control "incomplete" state, permissions, search, mobile. Real Next build + PostgREST + Postgres RLS + Chromium.
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import pg from 'pg'

const BASE = process.env.E2E_BASE
const OUT = 'tests/e2e/shots/operations'; fs.mkdirSync(OUT, { recursive: true })
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
const idOf = () => p.url().split('/').pop().split('?')[0]
const menu = async item => { await p.getByRole('button', { name: 'More actions' }).click(); await p.getByRole('menuitem', { name: item }).click() }
const day = n => { const x = new Date(Date.now() + 4 * 3600e3); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
const EMAIL = `ops-${Date.now()}@alsaqr.test`

try {
  console.log('\n[0] Setup')
  await p.goto(`${BASE}/signup`); await p.getByLabel('Work email').fill(EMAIL); await p.getByLabel('Password').fill('correct-horse-battery'); await p.getByRole('button', { name: 'Create account' }).click()
  await p.waitForURL('**/onboarding'); await p.getByLabel('Company name').fill('Al Saqr Ops Test'); await p.getByLabel('Your full name').fill('Ops Owner'); await p.getByRole('button', { name: 'Create company' }).click(); await p.waitForURL(`${BASE}/`)
  const co = (await one(`select p.company_id from profiles p join auth.users u on u.id=p.id where u.email=$1`, [EMAIL])).company_id
  const welder = (await one(`insert into employees(company_id,employee_no,full_name,designation) values ($1,'E-101','Anil Thomas','Welder') returning id`, [co])).id
  const fitter = (await one(`insert into employees(company_id,employee_no,full_name,designation) values ($1,'E-102','Rashid Khan','Fitter') returning id`, [co])).id
  const nav = await p.locator('aside[data-collapsed]').innerText()
  for (const l of ['Leads & Pipeline', 'Site Visits', 'Work Orders', 'Daily Site Reports', 'Tasks']) ok(nav.includes(l), `sidebar: ${l}`)
  ok(nav.includes('Sales & CRM') && nav.includes('Projects & site'), 'sidebar grouped: Sales & CRM, Projects & site')
  ok(!/inventory|stock|warehouse/i.test(nav), 'no inventory / stock / warehouse module anywhere in navigation')

  console.log('\n[1a] Lead (double-click save → one lead, numbered)')
  await p.goto(`${BASE}/leads`); await settle()
  ok(/No leads yet/.test(await main()), 'empty pipeline explains what to do')
  await p.getByRole('button', { name: 'New lead' }).first().click()
  await dlg().getByLabel('Customer / company name').fill('Al Noor Villas LLC'); await dlg().getByLabel('Contact person').fill('Mr. Khalid')
  await dlg().getByLabel('Phone', { exact: true }).fill('+971 50 765 4321'); await dlg().getByLabel('Email').fill('khalid@alnoor.test'); await dlg().getByLabel('Location / site').fill('Al Barsha 2, Villa 22, Dubai')
  await dlg().getByLabel('Service required').fill('Steel staircase with glass balustrade'); await dlg().getByLabel('Lead source').selectOption('instagram')
  await dlg().getByLabel('Estimated value (AED)').fill('48000'); await dlg().getByLabel('Next follow-up').fill(day(0))
  await dlg().getByRole('button', { name: 'Save lead' }).dblclick(); await p.waitForURL(/\/leads\/[0-9a-f-]{36}$/); await settle()
  const lid = idOf(), lead = await one(`select number, stage, salesperson_id is not null sp from leads where id=$1`, [lid])
  ok((await one(`select count(*)::int n from leads where company_id=$1`, [co])).n === 1 && /^LD-\d{4}-\d{4}$/.test(lead.number) && lead.sp, `double-click → one lead ${lead.number}, assigned to the creator`)
  ok((await one(`select count(*)::int n from reminder_sources where source_type='lead_followup' and source_id=$1`, [lid])).n === 1, 'next follow-up feeds the reminder engine')

  console.log('\n[1b] Activity → stage moves to Contacted')
  const af = p.locator('form', { has: p.getByRole('button', { name: 'Add to history' }) })
  await af.getByLabel('Type').selectOption('call'); await af.getByLabel('What happened').fill('Called; customer wants a site visit this week'); await af.getByLabel('Next follow-up').fill(day(2))
  await af.getByRole('button', { name: 'Add to history' }).click(); await settle(900)
  const l1 = await one(`select stage, next_followup::text f from leads where id=$1`, [lid])
  ok(l1.stage === 'contacted' && l1.f === day(2), 'first call moves New → Contacted and sets the next follow-up')
  ok((await main()).includes('Called; customer wants a site visit') && (await main()).includes('Moved from'), 'activity history shows the call and the stage change')

  console.log('\n[1c] Site visit from the lead → complete with measurements → printable report')
  await p.getByRole('button', { name: 'Schedule' }).click()
  ok(await dlg().getByLabel('Site location').inputValue() === 'Al Barsha 2, Villa 22, Dubai', 'visit form pre-filled with the lead location and contact')
  await dlg().getByLabel('Time').fill('10:30'); await dlg().getByLabel('Assigned employee').selectOption(fitter)
  await dlg().getByRole('button', { name: 'Schedule visit' }).click(); await p.waitForURL(/\/site-visits\/[0-9a-f-]{36}$/); await settle()
  const vid = idOf()
  ok((await one(`select stage from leads where id=$1`, [lid])).stage === 'site_visit_required', 'scheduling a visit moves the lead to Site visit required')
  await p.getByRole('button', { name: 'Complete visit' }).click()
  await dlg().getByLabel('Customer requirements').fill('Straight staircase, 17 risers, glass balustrade both sides')
  await dlg().getByLabel('Measurements').fill('Width 1,100 mm\nFloor-to-floor 3,250 mm')
  await dlg().getByRole('button', { name: 'Save as completed' }).click(); await settle(1000)
  const v = await one(`select status, completed_at is not null c, number from site_visits where id=$1`, [vid])
  ok(v.status === 'completed' && v.c, `visit ${v.number} completed`)
  ok((await one(`select stage from leads where id=$1`, [lid])).stage === 'site_visit_completed', 'lead → Site visit done')
  await p.getByRole('button', { name: 'Photos' }).click(); await dlg().getByLabel('Caption').fill('Stair opening')
  await dlg().locator('input[type=file]').setInputFiles({ name: 'opening.png', mimeType: 'image/png', buffer: PNG }); await dlg().getByRole('button', { name: 'Upload photos' }).click(); await settle(1200)
  ok((await one(`select count(*)::int n from document_relationships where related_type='site_visit' and related_id=$1 and role like 'photo_%'`, [vid])).n === 1, 'site photo stored privately and linked to the visit')
  ok(await p.locator(`img[src*="/thumb?w=320"]`).count() === 1, 'photo shown as a small thumbnail (not the full image)')
  const rp = await ctx.newPage(); await rp.goto(`${BASE}/print/report/site_visit/${vid}`); await rp.waitForLoadState('networkidle')
  const rpt = await rp.locator('.sales-paper').innerText()
  ok(rpt.includes('SITE VISIT REPORT') && rpt.includes('Al Noor Villas LLC') && rpt.includes('Floor-to-floor 3,250 mm') && rpt.includes('Customer / site representative'), 'printable visit report: letterhead area, customer, measurements, signatures')
  ok((await rp.title()).startsWith('Site_Visit_Report_'), `print file name ${await rp.title()}`)
  await rp.pdf({ path: `${OUT}/site-visit-report.pdf`, printBackground: true, preferCSSPageSize: true }); await rp.close()

  console.log('\n[1d] Quotation from the visit (no re-entry) → sent → accepted → lead Won')
  await p.getByRole('button', { name: 'New quotation' }).click(); await p.waitForURL(/\/invoices\/[0-9a-f-]{36}$/); await settle(1200)
  const qid = idOf(), q = await one(`select customer_name, attention, site, reference, lead_id, notes from invoices where id=$1`, [qid])
  ok(q.customer_name === 'Al Noor Villas LLC' && q.attention === 'Mr. Khalid' && q.site === 'Al Barsha 2, Villa 22, Dubai' && q.lead_id === lid, 'quotation pre-filled from the lead: customer, attention, site, linked lead')
  ok(q.reference.includes(lead.number) && q.reference.includes(v.number) && /Measurements/.test(q.notes ?? ''), `reference ${q.reference}; visit measurements carried into notes`)
  ok((await one(`select stage from leads where id=$1`, [lid])).stage === 'quotation_preparation', 'lead → Preparing quotation')
  await p.getByLabel('Line 1 description').fill('Steel staircase with glass balustrade, supply and installation')
  await p.getByLabel('Qty', { exact: true }).nth(0).fill('1'); await p.getByLabel('Rate (AED)', { exact: true }).nth(0).fill('45000')
  await p.getByRole('button', { name: 'Save', exact: true }).click(); await settle(1500)
  const cust = await one(`select customer_id from leads where id=$1`, [lid])
  ok(!!cust.customer_id, 'saving the quotation created the customer and linked it back to the lead (Lead → Customer)')
  await menu('Mark as sent'); await settle(1000)
  ok((await one(`select stage from leads where id=$1`, [lid])).stage === 'quotation_sent', 'quotation sent → lead Quotation sent')
  await menu('Mark as accepted'); await settle(1000)
  const won = await one(`select stage, won_at is not null w from leads where id=$1`, [lid])
  ok(won.stage === 'won' && won.w, 'quotation accepted → lead Won (timestamped)')

  console.log('\n[1e] Work order from the accepted quotation → project → tasks')
  await menu('Create work order (and project)'); await p.waitForURL(/\/work-orders\/[0-9a-f-]{36}$/); await settle()
  const wid = idOf(), wo = await one(`select w.number, w.status, w.scope, w.project_id, p.contract_value::text cv, p.customer_id from work_orders w join projects p on p.id=w.project_id where w.id=$1`, [wid])
  ok(/^WO-/.test(wo.number) && wo.status === 'approved' && wo.scope.includes('Steel staircase') && wo.cv === '45000.00' && wo.customer_id === cust.customer_id, `work order ${wo.number}: scope from the quotation lines; project created with contract AED ${wo.cv}`)
  ok((await one(`select project_id from invoices where id=$1`, [qid])).project_id === wo.project_id && (await one(`select project_id from leads where id=$1`, [lid])).project_id === wo.project_id, 'quotation and lead linked to the new project')
  await p.getByRole('button', { name: 'Assign' }).click(); await dlg().getByLabel('Employee').selectOption(welder); await dlg().getByLabel('Role').fill('Welder'); await dlg().getByRole('button', { name: 'Assign' }).click(); await settle(800)
  for (const t of ['Cut and weld stringers', 'Install treads and balustrade']) {
    await p.getByRole('button', { name: 'Add task' }).click(); await dlg().getByLabel('Task').fill(t); await dlg().getByLabel('Worker / employee').selectOption(welder)
    await dlg().getByRole('button', { name: 'Add task' }).click(); await settle(800)
  }
  ok((await one(`select count(*)::int n from tasks where work_order_id=$1 and project_id=$2`, [wid, wo.project_id])).n === 2, 'two tasks on the work order (also filed under the project)')
  await p.getByRole('button', { name: 'Mark done: Cut and weld stringers' }).click(); await settle(900)
  ok(/50% complete/.test(await main()), 'work order completion = average of its tasks (50%)')
  await p.getByRole('button', { name: 'Move to Scheduled' }).click(); await settle(800)
  ok((await one(`select status from work_orders where id=$1`, [wid])).status === 'scheduled', 'status advanced Approved → Scheduled')
  await shot('work-order')

  console.log('\n[1f] Invoice → payment (closes Flow 1)')
  await p.goto(`${BASE}/invoices/${qid}`); await settle(1000)
  await menu('Convert to invoice'); await p.waitForURL(u => !u.href.includes(qid)); await settle()
  const iid = idOf()
  await menu('Issue tax invoice'); await settle(1000)
  await p.getByRole('button', { name: 'Record payment' }).click(); await dlg().getByLabel('Amount (AED) *').fill('20000'); await dlg().getByLabel('Reference').fill('TT-OPS-1')
  await dlg().getByRole('button', { name: 'Save payment' }).click(); await settle(1500)
  const inv = await one(`select i.status, i.project_id, b.paid::text paid from invoices i join invoice_balances b on b.id=i.id where i.id=$1`, [iid])
  ok(inv.project_id === wo.project_id && inv.status === 'partially_paid' && inv.paid === '20000.00', 'invoice on the project, AED 20,000 received → Partially paid')

  console.log('\n[3] Project → daily site report (+ attendance, photo) → task → completion; cost control')
  await p.goto(`${BASE}/projects/${wo.project_id}`); await settle()
  const pj = await main()
  ok(pj.includes('Cost data incomplete') && pj.includes('Estimated cost (budget)') && pj.includes('Material costs'), 'cost control says what is missing instead of inventing figures')
  ok(pj.includes('Commercial (invoiced of contract)') && pj.includes('Inspection & handover'), 'progress shows overall, fabrication, installation, inspection, commercial')
  await p.getByRole('button', { name: 'Set estimate' }).click(); await dlg().getByLabel('Materials (AED)').fill('18000'); await dlg().getByLabel('Labour (AED)').fill('9000')
  await dlg().getByRole('button', { name: 'Save estimate' }).click(); await settle(900)
  ok((await one(`select sum(amount)::text s from project_budgets where project_id=$1`, [wo.project_id])).s === '27000.00', 'estimate saved per category')
  ok(/AED 18,000\.00/.test(await main()) || /18,000\.00/.test(await main()), 'estimated profit = contract − estimate (AED 18,000.00)')
  await p.getByRole('button', { name: 'New report' }).click()
  ok(await dlg().locator(`input[name=attendance][value="${welder}"]`).isChecked(), 'attendance pre-ticks the project team / crew')
  await dlg().getByLabel('Work completed today').fill('Stringers welded and primed. Treads cut.')
  await dlg().getByLabel('Progress today %').fill('40'); await dlg().getByLabel('Issues').fill('Glass delivery delayed by supplier')
  await dlg().getByRole('button', { name: 'Save report' }).dblclick(); await p.waitForURL(/\/site-reports\/[0-9a-f-]{36}$/); await settle()
  const rid = idOf()
  ok((await one(`select count(*)::int n from daily_site_reports where project_id=$1`, [wo.project_id])).n === 1, 'double-click → one daily report')
  ok((await one(`select site_progress from projects where id=$1`, [wo.project_id])).site_progress === 40, 'report progress raised the project site progress to 40%')
  await p.getByRole('button', { name: 'Photos' }).click(); await dlg().locator('input[type=file]').setInputFiles({ name: 'site.png', mimeType: 'image/png', buffer: PNG }); await dlg().getByRole('button', { name: 'Upload photos' }).click(); await settle(1200)
  ok((await one(`select count(*)::int n from document_relationships where related_type='project' and related_id=$1 and role='photo_progress'`, [wo.project_id])).n === 1, 'report photo also appears in the project photo gallery')
  const dp = await ctx.newPage(); await dp.goto(`${BASE}/print/report/site_report/${rid}`); await dp.waitForLoadState('networkidle')
  const dpt = await dp.locator('.sales-paper').innerText(); await dp.close()
  ok(dpt.includes('DAILY SITE REPORT') && dpt.includes('Anil Thomas') && dpt.includes('Glass delivery delayed'), 'printable daily report with attendance and issues')
  await p.goto(`${BASE}/tasks?view=open&project=${wo.project_id}`); await settle()
  await p.getByRole('button', { name: 'Mark done: Install treads and balustrade' }).click(); await settle(900)
  ok((await one(`select count(*)::int n from tasks where work_order_id=$1 and status='completed' and completion=100`, [wid])).n === 2, 'all work order tasks completed (100%)')

  console.log('\n[P] Pipeline board: drag-and-drop + lost reason')
  const l2 = (await one(`insert into leads(company_id,number,company_name,source,estimated_value) values ($1,'LD-E2E-2','Gulf Pergola Co','google',12000) returning id`, [co])).id
  await p.goto(`${BASE}/leads`); await settle()
  const card = p.locator('li[draggable=true]', { hasText: 'Gulf Pergola Co' })
  // HTML5 drag-and-drop: the same dragstart → dragover → drop sequence the browser sends for a mouse drag
  const dt = await p.evaluateHandle(() => new DataTransfer()), col = p.locator('section[aria-label^="Negotiation"]')
  await card.dispatchEvent('dragstart', { dataTransfer: dt }); await col.dispatchEvent('dragover', { dataTransfer: dt }); await col.dispatchEvent('drop', { dataTransfer: dt }); await settle(1200)
  ok((await one(`select stage from leads where id=$1`, [l2])).stage === 'negotiation', 'drag the card to Negotiation → saved')
  await card.getByLabel('Move Gulf Pergola Co to').selectOption('lost'); await p.waitForTimeout(300)
  await dlg().getByLabel('Reason').selectOption('price'); await dlg().getByRole('button', { name: 'Mark as lost' }).click(); await settle(1200)
  const l2r = await one(`select stage, lost_reason from leads where id=$1`, [l2])
  ok(l2r.stage === 'lost' && l2r.lost_reason === 'price', 'keyboard / phone "Move to" → Lost asks for the reason first')
  await shot('pipeline')
  await p.goto(`${BASE}/leads?view=sources`); await settle()
  const src = await main()
  ok(src.includes('Instagram') && src.includes('Google') && src.includes('Price too high'), 'source analytics + lost reasons from real leads')

  console.log('\n[S] Search + Ctrl+K')
  await p.goto(`${BASE}/search?q=Al%20Noor`); await settle()
  ok((await main()).includes('Leads') && (await main()).includes('Al Noor Villas LLC'), 'global search finds the lead')
  await p.goto(`${BASE}/search?q=${encodeURIComponent(wo.number)}`); await settle()
  ok((await main()).includes('Work orders'), 'global search finds the work order by number')

  console.log('\n[R] Permissions: an employee login sees only their own tasks, no CRM')
  const EMP = `ops-emp-${Date.now()}@alsaqr.test`
  const ectx = await browser.newContext(); const ep = await ectx.newPage()
  await ep.goto(`${BASE}/signup`); await ep.getByLabel('Work email').fill(EMP); await ep.getByLabel('Password').fill('correct-horse-battery'); await ep.getByRole('button', { name: 'Create account' }).click(); await ep.waitForURL('**/onboarding')
  const eu = (await one(`select id from auth.users where email=$1`, [EMP])).id
  await db.query(`insert into profiles(id,company_id,full_name,role) values ($1,$2,'Site Hand','employee')`, [eu, co])
  await db.query(`insert into tasks(company_id,title,owner_id,due_date) values ($1,'Collect scaffolding',$2,$3)`, [co, eu, day(0)])
  await ep.goto(`${BASE}/tasks`); await ep.waitForLoadState('networkidle')
  const et = await ep.locator('main').innerText()
  ok(et.includes('Collect scaffolding') && !et.includes('Install treads'), 'employee sees their own task only')
  await ep.goto(`${BASE}/leads`); await ep.waitForLoadState('networkidle')
  ok(!ep.url().includes('/leads'), 'employee is sent away from Leads (no crm.view)')
  await ep.goto(`${BASE}/tasks`); await ep.getByRole('button', { name: 'Mark done: Collect scaffolding' }).click(); await ep.waitForTimeout(1200)
  ok((await one(`select status from tasks where title='Collect scaffolding' and company_id=$1`, [co])).status === 'completed', 'employee can complete their own task')
  ok((await one(`select count(*)::int n from in_app_notifications where user_id=(select id from auth.users where email=$1) and title like 'Task completed:%'`, [EMAIL])).n === 0, 'no self-notification (task was created by SQL, creator unknown)')
  await ectx.close()

  console.log('\n[M] Mobile 390 px')
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: await ctx.storageState() }); const mp = await m.newPage()
  for (const path of ['/leads', `/leads/${lid}`, '/site-visits', `/site-visits/${vid}`, '/work-orders', `/work-orders/${wid}`, '/tasks', '/site-reports', `/site-reports/${rid}`, `/projects/${wo.project_id}`]) {
    await mp.goto(BASE + path); await mp.waitForLoadState('networkidle').catch(() => {}); await mp.waitForTimeout(250)
    const over = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    ok(over <= 1, `${path}: fits the phone (overflow ${over}px)`)
  }
  await mp.goto(`${BASE}/tasks?view=done`); await mp.screenshot({ path: `${OUT}/m-tasks.png`, fullPage: true })
  const tap = await mp.locator('main ul button[type=submit]').first().boundingBox()
  ok(tap && tap.width >= 40 && tap.height >= 40, `task check-off target is finger-sized (${tap?.width}×${tap?.height})`)
  await m.close()
} catch (e) {
  ok(false, `aborted: ${e.message.split('\n').slice(0, 12).join(' | ')}`); await shot('abort').catch(() => {})
}
for (const e of jsErrors) ok(false, `JS error ${e}`)
const failed = results.filter(r => !r[0]).length
console.log(`\nOperations suite: ${results.length - failed}/${results.length} passed`)
await browser.close(); await db.end()
process.exit(failed ? 1 : 0)
