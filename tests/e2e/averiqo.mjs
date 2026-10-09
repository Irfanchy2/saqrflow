// Averiqo refinement e2e: brand, Vehicles & Assets (flows 2-3), Reports & Analytics (flows 4-5), sidebar persistence (6),
// renumbering, exports, permissions, mobile overflow. Real Next build + PostgREST + Postgres RLS + Chromium. Run via scripts/e2e.sh
import { chromium } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import pg from 'pg'

const BASE = process.env.E2E_BASE
const OUT = 'tests/e2e/shots/averiqo'; fs.mkdirSync(OUT, { recursive: true })
const results = []
const ok = (cond, msg) => { results.push([!!cond, msg]); console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`) }
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
const exe = fs.readdirSync('/opt/pw-browsers').filter(d => d.startsWith('chromium-')).map(d => `/opt/pw-browsers/${d}/chrome-linux/chrome`).find(p => fs.existsSync(p))
const browser = await chromium.launch({ executablePath: exe })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true }); const p = await ctx.newPage()
const jsErrors = []; p.on('pageerror', e => jsErrors.push(`${p.url()}: ${e.message}`)); p.on('dialog', d => d.accept())
const settle = async (ms = 500) => { await p.waitForLoadState('networkidle').catch(() => {}); await p.waitForTimeout(ms) }
const main = () => p.locator('main').innerText()
const dlg = () => p.locator('dialog[open]')
const shot = n => p.screenshot({ path: `${OUT}/${n}.png`, fullPage: true })
const day = n => { const x = new Date(Date.now() + 4 * 3600e3); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }   // Asia/Dubai date
const EMAIL = `averiqo-${Date.now()}@alsaqr.test`

try {
  console.log('\n[B] Brand & shell')
  await p.goto(`${BASE}/login`); await settle()
  ok((await p.title()).includes('Averiqo') && await p.getByRole('img', { name: 'Averiqo' }).first().isVisible() && await p.getByRole('img', { name: 'Averiqo' }).first().evaluate(i => i.complete && i.naturalWidth > 0) && !(await p.content()).includes('SaqrFlow'), 'sign-in shows the Averiqo logo (no SaqrFlow left in the page)')
  await p.goto(`${BASE}/signup`); await p.getByLabel('Work email').fill(EMAIL); await p.getByLabel('Password').fill('correct-horse-battery'); await p.getByRole('button', { name: 'Create account' }).click()
  await p.waitForURL('**/onboarding'); await p.getByLabel('Company name').fill('AL SAQR AL AHMAR WELDING AND BLACKSMITH'); await p.getByLabel('Your full name').fill('Faisal Rahman'); await p.getByRole('button', { name: 'Create company' }).click(); await p.waitForURL(`${BASE}/`); await settle()
  const co = (await one(`select p.company_id from profiles p join auth.users u on u.id=p.id where u.email=$1`, [EMAIL])).company_id
  const aside = p.locator('aside[data-collapsed]')
  ok((await aside.innerText()).includes('Averiqo') && (await aside.innerText()).includes('AL SAQR AL AHMAR'), 'sidebar: Averiqo software brand + the company using it')
  ok(!/\b(Soon|Beta|BETA|Coming soon)\b/.test(await aside.innerText()), 'no Soon / Beta / Coming soon badges in navigation')
  ok((await p.title()).includes('Averiqo'), `browser title carries the software brand (${await p.title()})`)
  const fontOk = await p.evaluate(() => getComputedStyle(document.body).fontFamily.toLowerCase().includes('geist'))
  ok(fontOk, 'Geist font is applied')

  console.log('\n[6] Sidebar collapse persists across navigation and reload')
  await aside.getByRole('button', { name: 'Collapse sidebar' }).click(); await p.waitForTimeout(300)
  await p.goto(`${BASE}/assets`); await settle(); await p.reload(); await settle()
  ok(await p.locator('aside[data-collapsed="true"]').count() === 1, 'collapsed after navigate + refresh (cookie)')
  const mainW = await p.locator('main').evaluate(e => e.getBoundingClientRect().width)
  await p.locator('aside[data-collapsed="true"]').getByRole('button', { name: 'Expand sidebar' }).click(); await p.waitForTimeout(400)
  const mainW2 = await p.locator('main').evaluate(e => e.getBoundingClientRect().width)
  ok(mainW >= mainW2, `main content is wider with the sidebar collapsed (${Math.round(mainW)} vs ${Math.round(mainW2)}px)`)

  console.log('\n[2] Vehicle → Mulkiya → expiry → reminder')
  const emp = (await one(`insert into employees(company_id,employee_no,full_name,designation) values ($1,'E-014','Mohammed Iqbal','Driver') returning id`, [co])).id
  const emp2 = (await one(`insert into employees(company_id,employee_no,full_name,designation) values ($1,'E-022','Anil Thomas','Welder') returning id`, [co])).id
  await p.goto(`${BASE}/assets?tab=vehicles`); await settle()
  ok(/No vehicles yet/.test(await main()) && /registration, insurance and maintenance/.test(await main()), 'empty state explains what vehicles are for, with an Add action')
  await p.getByRole('button', { name: 'Add vehicle' }).first().click()
  await dlg().getByLabel('Vehicle name *').fill('Toyota Hilux pickup'); await dlg().getByLabel('Vehicle type').selectOption('Pickup')
  await dlg().getByLabel('Make').fill('Toyota'); await dlg().getByLabel('Model').fill('Hilux'); await dlg().getByLabel('Year').fill('2023')
  await dlg().getByLabel('VIN / chassis number').fill('MR0FA3CD5P0123456'); await dlg().getByLabel('Current mileage (km)').fill('48210')
  await dlg().getByLabel('Plate number').fill('AD 5 41827'); await dlg().getByLabel('Plate emirate').selectOption('Abu Dhabi')
  await dlg().getByLabel('Registration expiry').fill(day(18)); await dlg().getByLabel('Insurance company').fill('Orient Insurance'); await dlg().getByLabel('Insurance expiry').fill(day(64))
  await dlg().getByLabel('Service every (km)').fill('10000'); await dlg().getByLabel('Assigned driver').selectOption(emp)
  const save = dlg().getByRole('button', { name: 'Save vehicle' }); await save.dblclick(); await p.waitForURL(/\/assets\/[0-9a-f-]{36}$/); await settle()
  const vid = p.url().split('/').pop()
  ok((await one(`select count(*)::int n from assets where company_id=$1 and kind='vehicle'`, [co])).n === 1, 'double-click Save → exactly one vehicle')
  const v = await one(`select status, next_service_km, current_mileage from assets where id=$1`, [vid])
  ok(v.status === 'assigned' && v.next_service_km === 58210, `assigned driver → status Assigned; next service at ${v.next_service_km} km`)
  ok((await one(`select count(*)::int n from asset_assignments where asset_id=$1 and employee_id=$2 and returned_on is null`, [vid, emp])).n === 1, 'assignment history row opened automatically')
  const body = await main()
  ok(body.includes('Toyota Hilux pickup') && body.includes('Mohammed Iqbal') && body.includes('Renewals & service'), 'vehicle profile overview: details, driver, renewals')
  for (const t of ['Documents', 'Maintenance', 'Expenses', 'Assignments', 'Reminders', 'Timeline']) ok(await p.getByRole('link', { name: new RegExp(`^${t}`) }).count() >= 1, `profile section: ${t}`)
  await p.goto(`${BASE}/assets/${vid}?tab=documents`); await settle()
  await p.getByRole('button', { name: 'Upload' }).click(); await dlg().getByLabel('Document type').selectOption('mulkiya'); await dlg().getByLabel('Expiry date').fill(day(18))
  await dlg().locator('input[type=file]').setInputFiles({ name: 'mulkiya.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/MediaBox[0 0 200 200]/Parent 2 0 R>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF') })
  await dlg().getByRole('button', { name: 'Upload' }).click(); await settle(1200)
  const mdoc = await one(`select id, reminders_active, expiry_date::text e from documents where owner_type='asset' and owner_id=$1 order by created_at desc limit 1`, [vid])
  ok(mdoc?.reminders_active && mdoc.e === day(18), 'Mulkiya uploaded with its expiry; reminders on')
  ok((await one(`select count(*)::int n from reminder_sources where source_id in ($1,$2)`, [vid, mdoc.id])).n >= 3, 'registration + insurance (vehicle) and the Mulkiya document all feed the shared reminder engine')
  ok((await main()).includes('Mulkiya'), 'document listed on the vehicle')
  await p.goto(`${BASE}/assets/${vid}?tab=reminders`); await settle()
  ok(/registration/i.test(await main()) && /insurance/i.test(await main()) && /km to go/.test(await main()), 'reminders tab: dates + mileage service status')

  console.log('\n[3] Asset → assign employee → maintenance → history')
  await p.goto(`${BASE}/assets?tab=assets`); await settle()
  await p.getByRole('button', { name: 'Add asset' }).first().click()
  await dlg().getByLabel('Asset name *').fill('Lincoln MIG welding machine'); await dlg().getByLabel('Category').fill('Welding Machine')
  await dlg().getByLabel('Asset code').fill('AST-0012'); await dlg().getByLabel('Serial number').fill('LE-PW455-0912'); await dlg().getByLabel('Brand').fill('Lincoln Electric')
  await dlg().getByLabel('Purchase price (AED)').fill('18500'); await dlg().getByLabel('Current location').fill('Workshop, Musaffah'); await dlg().getByLabel('Condition').selectOption('good')
  await dlg().getByLabel('Next maintenance').fill(day(12))
  await dlg().getByRole('button', { name: 'Save asset' }).click(); await p.waitForURL(/\/assets\/[0-9a-f-]{36}$/); await settle()
  const aid = p.url().split('/').pop()
  await p.getByRole('button', { name: 'Assign', exact: true }).click(); await dlg().getByLabel('Employee').selectOption(emp2); await dlg().getByLabel('Note').fill('Site welding, Villa 214')
  await dlg().getByRole('button', { name: 'Save assignment' }).click(); await settle(900)
  const as1 = await one(`select a.status, a.assigned_to, x.note from assets a join asset_assignments x on x.asset_id=a.id and x.returned_on is null where a.id=$1`, [aid])
  ok(as1?.status === 'assigned' && as1.assigned_to === emp2 && as1.note === 'Site welding, Villa 214', 'assign: status Assigned + history row with note')
  await p.getByRole('button', { name: 'Return' }).click(); await settle(900)
  ok((await one(`select status from assets where id=$1`, [aid])).status === 'available' && (await one(`select count(*)::int n from asset_assignments where asset_id=$1 and returned_on is not null`, [aid])).n === 1, 'return: Available, assignment closed with a date')
  await p.goto(`${BASE}/assets/${aid}?tab=maintenance`); await settle()
  await p.getByRole('button', { name: 'Add record' }).click(); await dlg().getByLabel('Type').selectOption('repair'); await dlg().getByLabel('Work done *').fill('Replaced torch cable and liner')
  await dlg().getByLabel('Cost (AED)').fill('640.5'); await dlg().getByLabel('Next due').fill(day(90)); await dlg().getByRole('button', { name: 'Save record' }).click(); await settle(900)
  ok((await one(`select next_service_date::text n from assets where id=$1`, [aid])).n === day(90), 'maintenance record moves the next maintenance date (reminder follows)')
  ok((await main()).includes('640.50'), 'maintenance table shows cost as 640.50')
  await p.goto(`${BASE}/assets/${aid}?tab=assignments`); await settle()
  ok((await main()).includes('Anil Thomas') && (await main()).includes('Site welding'), 'assignment history lists who had it and the note')
  await p.goto(`${BASE}/assets/${aid}?tab=timeline`); await settle()
  const tl = await main(); ok(tl.includes('Assigned to Anil Thomas') && tl.includes('Returned') && tl.includes('Repair: Replaced torch cable'), 'timeline: assignment, return and repair in one history')
  await shot('asset-timeline')
  await p.goto(`${BASE}/assets/${vid}?tab=expenses`); await settle()
  await p.getByRole('button', { name: 'Add expense' }).click(); await dlg().getByLabel('Category *').selectOption('fuel'); await dlg().getByLabel('Description *').fill('Diesel, ADNOC Musaffah')
  await dlg().getByLabel('Amount excl. VAT (AED) *').fill('285.71'); await dlg().getByLabel(/^VAT \(AED\)/).fill('14.29'); await dlg().getByRole('button', { name: 'Save expense' }).click(); await settle(900)
  ok((await one(`select count(*)::int n from project_expenses where asset_id=$1`, [vid])).n === 1 && (await main()).includes('285.71'), 'vehicle expense recorded on the vehicle')
  await p.goto(`${BASE}/assets?tab=vehicles`); await settle()
  const vt = await main(); ok(['Vehicle', 'Plate', 'Make / model', 'Driver', 'Registration', 'Insurance', 'Next service', 'Status'].every(h => vt.includes(h)) && vt.includes('AD 5 41827'), 'vehicle list: requested columns')
  const csv = await ctx.request.get(`${BASE}/api/export/vehicles`); ok(csv.ok() && (await csv.text()).includes('MR0FA3CD5P0123456'), 'vehicle export (CSV) includes VIN')
  await p.goto(`${BASE}/search?q=Toyota`); await settle(); ok((await main()).includes('Toyota Hilux pickup'), 'global search finds “Toyota”')
  await p.goto(`${BASE}/search?q=Welding%20Machine`); await settle(); ok((await main()).includes('Lincoln MIG welding machine'), 'global search finds “Welding Machine” (category)')
  await p.goto(`${BASE}/search?q=Mohammed`); await settle(); ok((await main()).includes('Mohammed Iqbal'), 'global search finds “Mohammed”')

  console.log('\n[4] Reports → period → sales → drill into invoices')
  const cu = (await one(`insert into customers(company_id,name) values ($1,'ABC Contracting LLC') returning id`, [co])).id
  const mk = async (type, num, st, total, issued, due) => { const sub = Math.round(total / 1.05 * 100) / 100
    return (await one(`insert into invoices(company_id,doc_type,number,status,customer_id,customer_name,issue_date,due_date,subtotal,vat_amount,total) values ($1,$2,$3,$4,$5,'ABC Contracting LLC',$6,$7,$8,$9,$10) returning id`, [co, type, num, st, cu, issued, due, sub, Math.round((total - sub) * 100) / 100, total])).id }
  await mk('invoice', 'INV-T-1', 'sent', 21000, day(-3), day(27)); await mk('invoice', 'INV-T-2', 'sent', 8925, day(-40), day(-10)); await mk('invoice', 'INV-T-3', 'draft', 999, day(-1), null)
  await mk('quotation', 'AS0099001/2026', 'accepted', 31762.5, day(-2), null); await mk('quotation', 'AS0099002/2026', 'rejected', 4200, day(-2), null); await mk('quotation', 'AS0099003/2026', 'sent', 12495, day(-2), null)
  await p.goto(`${BASE}/reports`); await settle()
  const rep = await main()
  ok(/This month \(/.test(rep), 'default period: This month')
  ok(!/Coming soon|Planned|Partial\./.test(rep), 'no placeholder / “coming soon” states')
  await p.goto(`${BASE}/reports?section=sales&period=year`); await settle()
  const salesTxt = await main()
  const expectedNet = (await one(`select sum(total-vat_amount)::numeric(14,2)::text s, count(*)::int n from invoices where company_id=$1 and doc_type='invoice' and status not in ('draft','cancelled') and issue_date >= date_trunc('year', $2::date)`, [co, day(0)]))
  ok(salesTxt.includes(`AED ${Number(expectedNet.s).toLocaleString('en-US', { minimumFractionDigits: 2 })}`), `sales KPI equals the database sum (AED ${expectedNet.s}, draft excluded)`)
  await shot('reports-sales')
  await p.getByRole('link', { name: /Invoices issued/ }).click(); await settle()
  ok(/Filtered list/.test(await main()), 'KPI opens a filtered invoice list (and says so)')
  const listRows = await p.locator('main tbody tr').count()
  ok(listRows === expectedNet.n, `drill-down shows exactly the ${expectedNet.n} counted invoices (${listRows})`)
  await p.goto(`${BASE}/reports?section=receivables`); await settle()
  ok((await main()).includes('INV-T-2') && /Days overdue/.test(await main()), 'receivables: open invoice list with days overdue')
  await p.getByRole('link', { name: /^Overdue/ }).first().click(); await settle()
  ok(await p.locator('main tbody tr').count() === 1 && (await main()).includes('INV-T-2'), 'overdue KPI → the 1 overdue invoice')
  await p.goto(`${BASE}/reports?section=quotations&period=year`); await settle()
  ok((await main()).includes('50%') && (await main()).includes('1 accepted of 2 decided'), 'quotation conversion = accepted ÷ decided (1 of 2 = 50%)')

  console.log('\n[5] Reports → documents expiring → matching documents')
  await db.query(`insert into documents(company_id,name,owner_type,owner_id,expiry_date,status) values ($1,'Visa - Mohammed Iqbal','employee',$2,$3,'active'),($1,'Trade Licence','company',null,$4,'active'),($1,'Old cancelled permit','company',null,$5,'cancelled')`, [co, emp, day(9), day(25), day(5)])
  await p.goto(`${BASE}/reports?section=compliance`); await settle()
  const kpi = Number(((await p.getByRole('link', { name: /Expiring in 30 days/ }).first().innerText()).match(/\n(\d+)/) ?? [])[1])
  await p.getByRole('link', { name: /Expiring in 30 days/ }).first().click(); await settle()
  const docRows = await p.locator('main tbody tr').count()
  ok(kpi >= 3 && docRows === kpi, `“Expiring in 30 days” = ${kpi} → vault shows the same ${docRows} documents (cancelled ones excluded)`)

  console.log('\n[X] Report exports & audit')
  const qs = 'period=year'
  const rc = await ctx.request.get(`${BASE}/api/reports/sales?${qs}&format=csv`); const rct = await rc.text()
  ok(rc.ok() && rct.includes('AL SAQR AL AHMAR') && rct.includes('Averiqo') && rct.includes('Top customers'), 'CSV export: company, software, report tables')
  const rx = await ctx.request.get(`${BASE}/api/reports/receivables?${qs}&format=xlsx`)
  ok(rx.ok() && (await rx.body()).subarray(0, 2).toString() === 'PK', 'Excel export is a real .xlsx (zip)')
  const rp = await ctx.request.get(`${BASE}/api/reports/projects?${qs}&format=pdf`); fs.writeFileSync(`${OUT}/projects.pdf`, await rp.body())
  const pt = execFileSync('pdftotext', ['-layout', `${OUT}/projects.pdf`, '-']).toString()
  ok(rp.ok() && pt.includes('AL SAQR AL AHMAR') && pt.includes('Projects report') && pt.includes('Generated') && pt.includes('Averiqo Reports'), 'PDF export: business name, report title, range, generated time, page footer')
  ok((await one(`select count(*)::int n from audit_logs where company_id=$1 and action='EXPORT' and table_name like 'report:%'`, [co])).n >= 3, 'report exports are audit-logged')

  console.log('\n[N] Quotation renumbering (legacy QTN draft)')
  const old = await mk('quotation', 'QTN-2026-0004', 'draft', 1050, day(0), null)
  await p.goto(`${BASE}/invoices/${old}`); await settle(1200)
  await p.getByRole('button', { name: 'More actions' }).click(); await p.getByRole('menuitem', { name: 'Renumber to current format' }).click(); await settle(1500)
  const nn = (await one(`select number from invoices where id=$1`, [old])).number
  ok(/^AS-\d{6,}\/\d{4}$/.test(nn), `legacy draft renumbered to the configured format (${nn})`)
  ok((await one(`select count(*)::int n from invoices where company_id=$1 and number=$2`, [co, nn])).n === 1, 'new number is unique')

  console.log('\n[R] Roles: viewer sees no finance reports')
  const vemail = `viewer-${Date.now()}@alsaqr.test`
  const vctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const vp = await vctx.newPage()
  await vp.goto(`${BASE}/signup`); await vp.getByLabel('Work email').fill(vemail); await vp.getByLabel('Password').fill('correct-horse-battery'); await vp.getByRole('button', { name: 'Create account' }).click(); await vp.waitForURL('**/onboarding')
  const vu = (await one(`select id from auth.users where email=$1`, [vemail])).id
  await db.query(`insert into profiles(id,company_id,full_name,role) values ($1,$2,'View Only','viewer')`, [vu, co])
  await vp.goto(`${BASE}/reports`); await vp.waitForLoadState('networkidle')
  const vr = await vp.locator('main').innerText()
  ok(!vr.includes('Receivables') && !vr.includes('Total sales') && !vr.includes('Payments received'), 'viewer: finance sections and figures are not shown')
  await vp.goto(`${BASE}/reports?section=sales`); ok(!(await vp.locator('main').innerText()).includes('Top customers'), 'viewer: ?section=sales falls back to the overview')
  ok((await vctx.request.get(`${BASE}/api/reports/sales?format=csv`)).status() === 403, 'viewer: finance report export refused by the server (403)')
  await vctx.close()

  console.log('\n[M] Mobile 390 px: no horizontal overflow')
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: await ctx.storageState() }); const mp = await m.newPage()
  for (const path of ['/', '/assets', `/assets/${vid}`, '/reports', '/reports?section=receivables', '/invoices', '/settings']) {
    await mp.goto(BASE + path); await mp.waitForLoadState('networkidle').catch(() => {})
    const over = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    ok(over <= 1, `${path}: page width fits the phone (overflow ${over}px)`)
  }
  await mp.goto(`${BASE}/`); await mp.screenshot({ path: `${OUT}/m-dashboard.png`, fullPage: true })
  await mp.getByRole('button', { name: 'Open menu' }).click(); await mp.waitForTimeout(300)
  ok(await mp.locator('aside[aria-hidden="false"]').isVisible(), 'mobile drawer opens'); await mp.keyboard.press('Escape'); await mp.waitForTimeout(300)
  ok(await mp.locator('aside[aria-hidden="true"]').count() === 1, 'Escape closes the drawer')
  await m.close()

  console.log('\n[D] Dashboard')
  await p.goto(`${BASE}/`); await settle(); const dash = await main()
  ok(dash.includes('Outstanding receivables') && dash.includes('Needs attention') && dash.includes('Operations'), 'dashboard: financial pulse, needs attention, operations')
  ok(/AED 29,925\.00/.test(dash), 'outstanding shown as AED 29,925.00 (two decimals)')
  await shot('dashboard')
  await p.getByRole('button', { name: 'New', exact: true }).click(); ok(await p.getByRole('menuitem', { name: 'Vehicle' }).isVisible(), 'quick actions menu includes Vehicle')
  await p.getByRole('menuitem', { name: 'Vehicle' }).click(); await p.waitForURL(/new=vehicle/); await settle(); ok(await dlg().isVisible(), 'quick action opens the Add vehicle form directly')
} catch (e) {
  ok(false, `aborted: ${e.message.split('\n').slice(0, 12).join(' | ')}`); await shot('abort').catch(() => {})
}
for (const e of jsErrors) ok(false, `JS error ${e}`)
const failed = results.filter(r => !r[0]).length
console.log(`\nAveriqo suite: ${results.length - failed}/${results.length} passed`)
await browser.close(); await db.end()
process.exit(failed ? 1 : 0)
