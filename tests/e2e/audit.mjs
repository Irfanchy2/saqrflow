// Visual audit: signs up, seeds a realistic TEST-ONLY dataset into the local e2e database, and screenshots key pages
// at desktop and phone widths. Not a pass/fail suite; used for before/after UI review. Run: E2E_ONLY=audit.mjs scripts/e2e.sh
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import pg from 'pg'

const BASE = process.env.E2E_BASE
const OUT = process.env.AUDIT_OUT || 'tests/e2e/shots/audit'; fs.mkdirSync(OUT, { recursive: true })
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const q = async (sql, args = []) => (await db.query(sql, args)).rows
const exe = fs.readdirSync('/opt/pw-browsers').filter(d => d.startsWith('chromium-')).map(d => `/opt/pw-browsers/${d}/chrome-linux/chrome`).find(p => fs.existsSync(p))
const browser = await chromium.launch({ executablePath: exe })
const EMAIL = `audit-${Date.now()}@alsaqr.test`
const d = n => { const x = new Date(); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10) }

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const p = await ctx.newPage()
const errors = []; p.on('pageerror', e => errors.push(`${p.url()}: ${e.message}`))
await p.goto(`${BASE}/signup`); await p.getByLabel('Work email').fill(EMAIL); await p.getByLabel('Password').fill('correct-horse-battery'); await p.getByRole('button', { name: 'Create account' }).click()
await p.waitForURL('**/onboarding'); await p.getByLabel('Company name').fill('AL SAQR AL AHMAR WELDING AND BLACKSMITH'); await p.getByLabel('Your full name').fill('Faisal Rahman'); await p.getByRole('button', { name: 'Create company' }).click(); await p.waitForURL(`${BASE}/`)
const [{ company_id: co }] = await q(`select p.company_id from profiles p join auth.users u on u.id=p.id where u.email=$1`, [EMAIL])

if (!process.env.AUDIT_EMPTY) {
  const cust = await q(`insert into customers(company_id,name,phone,address,trn) values
    ($1,'ABC Contracting LLC','+971 50 418 2290','Office 12, Musaffah M-44, Abu Dhabi','100123456700003'),
    ($1,'Gulf Horizon Interiors','+971 55 902 1174','Al Quoz Industrial 3, Dubai',null),
    ($1,'Noor Al Madina Building Maintenance','+971 2 551 8093','Mussafah Shabiya 10, Abu Dhabi',null) returning id`, [co])
  const emp = await q(`insert into employees(company_id,employee_no,full_name,designation,status) values
    ($1,'E-014','Mohammed Iqbal','Welder','active'),($1,'E-022','Rashid Kareem','Driver','active'),($1,'E-031','Anil Thomas','Fabricator','active') returning id`, [co])
  await q(`insert into documents(company_id,name,owner_type,owner_id,expiry_date,status) values
    ($1,'Visa - Mohammed Iqbal','employee',$2,$4,'active'),($1,'Emirates ID - Rashid Kareem','employee',$3,$5,'active'),
    ($1,'Trade Licence','company',null,$6,'active'),($1,'Civil Defence Certificate','company',null,$7,'active')`, [co, emp[0].id, emp[1].id, d(12), d(-3), d(41), d(75)])
  await q(`insert into cheques(company_id,cheque_no,direction,party_name,bank_name,amount,cheque_date,status) values
    ($1,'004417','incoming','ABC Contracting LLC','ADCB',18450.00,$2,'received'),($1,'110293','outgoing','Emirates Steel Trading','RAKBANK',7320.50,$3,'issued')`, [co, d(5), d(9)])
  const proj = await q(`insert into projects(company_id,name,customer_id,status,contract_value,start_date) values ($1,'Villa 214 staircase and handrails',$2,'active',46800,$3) returning id`, [co, cust[0].id, d(-20)])
  for (const [i, [type, num, st, tot, cu]] of [['quotation', 'AS0025180/2026', 'sent', 12495, 0], ['quotation', 'AS0025181/2026', 'accepted', 31762.5, 1], ['quotation', 'AS0025182/2026', 'draft', 4200, 2], ['invoice', 'INV-2026-0001', 'sent', 21000, 0], ['invoice', 'INV-2026-0002', 'overdue', 8925, 1]].entries()) {
    const sub = Math.round(tot / 1.05 * 100) / 100
    const [inv] = await q(`insert into invoices(company_id,doc_type,number,status,customer_id,customer_name,issue_date,due_date,subtotal,vat_amount,total,project_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
      [co, type, num, st, cust[cu].id, ['ABC Contracting LLC', 'Gulf Horizon Interiors', 'Noor Al Madina Building Maintenance'][cu], d(-30 + i * 5), type === 'invoice' ? d(st === 'overdue' ? -6 : 20) : null, sub, Math.round((tot - sub) * 100) / 100, tot, cu === 0 ? proj[0].id : null])
    await q(`insert into invoice_items(company_id,invoice_id,position,description,quantity,unit,unit_price) values ($1,$2,1,'MS handrail 50mm pipe, primer and 2 coats paint',42,'Rmt',$3)`, [co, inv.id, Math.round(sub / 42 * 100) / 100])
  }
  await q(`insert into assets(company_id,name,kind,plate_or_serial,assigned_to,registration_expiry,insurance_expiry,status) values
    ($1,'Toyota Hilux pickup','vehicle','AD 5 41827',$2,$3,$4,'active'),($1,'Lincoln Electric welding machine','equipment','LE-PW455-0912',$5,null,null,'active')`, [co, emp[1].id, d(18), d(64), emp[0].id]).catch(e => console.log('assets seed:', e.message))
  // Phase 1: leads in several stages, a visit, a work order with tasks, a daily report
  await q(`insert into leads(company_id,number,company_name,contact_person,phone,service,source,estimated_value,stage,next_followup) values
    ($1,'LD-2026-0001','Al Noor Villas LLC','Mr. Khalid','+971 50 765 4321','Steel staircase with glass balustrade','instagram',48000,'site_visit_required',$2),
    ($1,'LD-2026-0002','Gulf Pergola Co','Ahmed','+971 55 100 2233','Pergola 6 x 4 m','google',12000,'negotiation',$3),
    ($1,'LD-2026-0003','Mussafah Warehouse 12','Ravi','+971 52 220 1188','Mezzanine floor 120 m²','referral',96000,'quotation_sent',null),
    ($1,'LD-2026-0004','Villa 9 Khalifa City','Sara','+971 50 998 7766','Main gate and fence','walk_in',18500,'new',$2)`, [co, d(0), d(-2)])
  const [lead] = await q(`select id from leads where company_id=$1 and number='LD-2026-0001'`, [co])
  await q(`insert into site_visits(company_id,number,lead_id,location,scheduled_date,scheduled_time,status,requirements,measurements) values ($1,'SV-2026-0001',$2,'Al Barsha 2, Villa 22, Dubai',$3,'10:30','scheduled','Straight staircase, 17 risers','Width 1,100 mm')`, [co, lead.id, d(1)])
  const [wo] = await q(`insert into work_orders(company_id,number,title,project_id,customer_id,status,priority,start_date,target_date,site_location,scope) values ($1,'WO-2026-0001','Fabricate and install villa staircase',$2,$3,'in_fabrication','high',$4,$5,'Villa 214, Khalifa City','• Stringers\n• Treads\n• Handrail') returning id`, [co, proj[0].id, cust[0].id, d(-5), d(12)])
  await q(`insert into tasks(company_id,title,work_order_id,project_id,due_date,status,employee_id) values ($1,'Cut and weld stringers',$2,$3,$4,'completed',$6),($1,'Prime and paint',$2,$3,$5,'in_progress',$6),($1,'Install treads and balustrade',$2,$3,$5,'todo',$6)`, [co, wo.id, proj[0].id, d(-1), d(3), emp[2].id])
  await q(`insert into daily_site_reports(company_id,number,project_id,work_order_id,report_date,work_done,progress,issues) values ($1,'DSR-2026-0001',$2,$3,$4,'Stringers welded and primed. Treads cut to size.',40,'Glass delivery delayed')`, [co, proj[0].id, wo.id, d(0)])
}

const pages = ['/', '/invoices', '/parties', '/documents', '/employees', '/projects', '/assets', '/cheques', '/reports', '/settings', '/reminders', '/search?q=ABC']
for (const path of pages) {
  await p.goto(BASE + path); await p.waitForLoadState('networkidle').catch(() => {}); await p.waitForTimeout(400)
  await p.screenshot({ path: `${OUT}/d${path.replace(/[/?=]/g, '_') || '_home'}.png`, fullPage: true })
}
const inv = await q(`select id from invoices where company_id=$1 and doc_type='quotation' order by number limit 1`, [co])
if (inv[0]) { await p.goto(`${BASE}/invoices/${inv[0].id}`); await p.waitForTimeout(1200); await p.screenshot({ path: `${OUT}/d_editor.png` }) }
// a real phone: touch, device pixels, the page's own viewport meta (isMobile)
const m = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, storageState: await ctx.storageState() }); const mp = await m.newPage()
const one = async sql => (await q(sql, [co]))[0]?.id
const ids = { lead: await one(`select id from leads where company_id=$1 limit 1`), wo: await one(`select id from work_orders where company_id=$1 limit 1`), proj: await one(`select id from projects where company_id=$1 limit 1`),
  emp: await one(`select id from employees where company_id=$1 limit 1`), asset: await one(`select id from assets where company_id=$1 limit 1`), cust: await one(`select id from customers where company_id=$1 limit 1`), inv: inv[0]?.id,
  sv: await one(`select id from site_visits where company_id=$1 limit 1`), dsr: await one(`select id from daily_site_reports where company_id=$1 limit 1`) }
const mpages = (process.env.AUDIT_PAGES ?? '/,/inbox,/tasks,/leads,/leads?view=list,/site-visits,/invoices,/parties,/catalog,/projects,/work-orders,/site-reports,/assets,/cheques,/expenses,/employees,/documents,/vault,/reports,/reminders,/calendar,/settings,/search?q=ABC').split(',')
  .concat(Object.entries({ lead: '/leads/', wo: '/work-orders/', proj: '/projects/', emp: '/employees/', asset: '/assets/', cust: '/parties/', inv: '/invoices/', sv: '/site-visits/', dsr: '/site-reports/' }).filter(([k]) => ids[k]).map(([k, base]) => base + ids[k]))
const report = []
for (const path of mpages) {
  const t0 = Date.now(); await mp.goto(BASE + path); await mp.waitForLoadState('networkidle').catch(() => {}); const ms = Date.now() - t0
  const info = await mp.evaluate(() => {
    const over = document.documentElement.scrollWidth - innerWidth
    const small = [...document.querySelectorAll('a,button,select,input:not([type=hidden]),[role=tab]')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.height < 32 || r.width < 32) && getComputedStyle(e).visibility !== 'hidden' }).length
    const tinyText = [...document.querySelectorAll('main *')].filter(e => e.childElementCount === 0 && e.textContent.trim() && parseFloat(getComputedStyle(e).fontSize) < 11).length
    const inputs = [...document.querySelectorAll('input,select,textarea')].filter(e => e.getBoundingClientRect().width > 0 && parseFloat(getComputedStyle(e).fontSize) < 16).length
    return { over, small, tinyText, inputs, h: document.documentElement.scrollHeight }
  })
  report.push({ path: path.replace(/[0-9a-f-]{36}/, ':id'), ms, ...info })
  await mp.screenshot({ path: `${OUT}/m${path.replace(/[0-9a-f-]{36}/, 'id').replace(/[/?=&]/g, '_') || '_home'}.png`, fullPage: true })
}
console.table(report)
fs.writeFileSync(`${OUT}/mobile-report.json`, JSON.stringify(report, null, 1))
console.log('audit shots →', OUT, errors.length ? '\nJS errors:\n' + errors.join('\n') : '(no JS errors)')
await browser.close(); await db.end()
