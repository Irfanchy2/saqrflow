// Service & warranty + Knowledge base e2e (Phase C): warranty → ticket (auto warranty, SLA due date) → notes → resolve;
// public service-request form and customer-portal "Report an issue" create tickets; KB article, versions, search; trash; phone.
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import pg from 'pg'

const BASE = process.env.E2E_BASE
const OUT = 'tests/e2e/shots/service'; fs.mkdirSync(OUT, { recursive: true })
const results = []
const ok = (cond, msg) => { results.push([!!cond, msg]); console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`) }
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
const exe = fs.readdirSync('/opt/pw-browsers').filter(d => d.startsWith('chromium-')).map(d => `/opt/pw-browsers/${d}/chrome-linux/chrome`).find(p => fs.existsSync(p))
const browser = await chromium.launch({ executablePath: exe })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const p = await ctx.newPage()
const jsErrors = []; p.on('pageerror', e => jsErrors.push(`${p.url()}: ${e.message}`)); p.on('dialog', d => d.accept())
const settle = async (pg_ = p, ms = 500) => { await pg_.waitForLoadState('networkidle').catch(() => {}); await pg_.waitForTimeout(ms) }
const main = () => p.locator('main').innerText()
const dlg = () => p.locator('dialog[open]')
const day = n => { const x = new Date(Date.now() + 4 * 3600e3); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const EMAIL = `svc-${Date.now()}@alsaqr.test`
const visitor = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage()

try {
  console.log('\n[0] Setup')
  await p.goto(`${BASE}/signup`); await p.getByLabel('Work email').fill(EMAIL); await p.getByLabel('Password').fill('correct-horse-battery'); await p.getByRole('button', { name: 'Create account' }).click()
  await p.waitForURL('**/onboarding'); await p.getByLabel('Company name').fill('Al Saqr Service Test'); await p.getByLabel('Your full name').fill('Service Owner'); await p.getByRole('button', { name: 'Create company' }).click(); await p.waitForURL(`${BASE}/`)
  const co = (await one(`select p.company_id from profiles p join auth.users u on u.id=p.id where u.email=$1`, [EMAIL])).company_id
  const cust = (await one(`insert into customers(company_id,name,phone) values ($1,'Villa 9 Owner','+971 50 222 3344') returning id`, [co])).id
  const proj = (await one(`insert into projects(company_id,name,customer_id,status) values ($1,'Villa 9 sliding gate',$2,'completed') returning id`, [co, cust])).id
  const nav = await p.locator('aside[data-collapsed]').innerText()
  ok(nav.includes('Service & Warranty') && nav.includes('Knowledge Base'), 'sidebar: Service & Warranty, Knowledge Base')

  console.log('\n[1] Warranty → ticket')
  await p.goto(`${BASE}/tickets?tab=warranties&new=warranty`); await settle()
  await dlg().getByLabel('What is covered *').fill('Sliding gate, motor and welds'); await dlg().locator('select[name=customer_id]').selectOption(cust); await dlg().locator('select[name=project_id]').selectOption(proj)
  await dlg().locator('input[name=start_date]').fill(day(-60)); await dlg().locator('select[name=months]').selectOption('12'); await dlg().getByRole('button', { name: 'Save warranty' }).click(); await settle(p, 900)
  const w = await one(`select * from warranties where company_id=$1`, [co])
  ok(/^WR-\d{4}-\d{4}$/.test(w?.number) && w.end_date.toISOString().slice(0, 10) === (() => { const d = new Date(`${day(-60)}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 12); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10) })(), `warranty ${w?.number} recorded for 1 year`)
  await p.goto(`${BASE}/tickets?new=ticket`); await settle()
  await dlg().getByLabel('Issue *').fill('Gate stops halfway'); await dlg().locator('select[name=customer_id]').selectOption(cust); await dlg().locator('select[name=priority]').selectOption('high')
  await dlg().getByLabel('Contact phone').fill('+971 50 222 3344'); await dlg().getByRole('button', { name: 'Open ticket' }).click(); await p.waitForURL(/\/tickets\/[0-9a-f-]{36}$/); await settle()
  const tid = p.url().split('/').pop()
  const t = await one(`select * from service_tickets where id=$1`, [tid])
  ok(/^ST-/.test(t.number) && t.warranty_id === w.id && t.under_warranty, `${t.number}: warranty found automatically`)
  ok(t.due_date.toISOString().slice(0, 10) === day(2), 'high priority → due in 2 days')
  ok((await main()).includes('Covered: the ticket was opened within the warranty period'), 'ticket page shows warranty cover')
  await p.getByLabel('Note').fill('Called customer, visit tomorrow 10:00'); await p.getByRole('button', { name: 'Add note' }).click(); await settle(p, 900)
  ok((await main()).includes('Called customer, visit tomorrow'), 'note on the timeline')
  await p.locator('select[name=status]').selectOption('resolved'); await p.getByRole('button', { name: 'Update' }).click(); await settle(p, 900)
  ok((await main()).includes('Write what was done'), 'resolving without a resolution is refused')
  await p.getByLabel('Resolution').fill('Replaced limit switch, tested 10 cycles'); await p.getByRole('button', { name: 'Update' }).click(); await settle(p, 900)
  const t2 = await one(`select status, resolved_at from service_tickets where id=$1`, [tid])
  ok(t2.status === 'resolved' && !!t2.resolved_at, 'ticket resolved with timestamp')
  ok(!!(await one(`select 1 from ticket_events where ticket_id=$1 and kind='status' and body like '%Resolved%'`, [tid])), 'status change on the timeline')
  await p.goto(`${BASE}/parties/${cust}`); await settle()
  ok((await main()).includes(t.number) && (await main()).includes(w.number), 'customer page lists the ticket and the warranty')

  console.log('\n[2] Tickets from outside')
  await db.query(`insert into public_forms(company_id,slug,title,kind) values ($1,'svc-test-repair','Request a repair','service_request')`, [co])
  await visitor.goto(`${BASE}/f/svc-test-repair`); await settle(visitor)
  await visitor.getByLabel('Your name *').fill('Villa 9 Owner'); await visitor.getByLabel('Phone / WhatsApp *').fill('050 222 3344'); await visitor.getByLabel('What is the problem? *').fill('Gate remote not working')
  await visitor.waitForTimeout(2600); await visitor.getByRole('button', { name: 'Send service request' }).click(); await settle(visitor, 900)
  ok(/service request number is ST-/.test(await visitor.locator('body').innerText()), 'public service-request form returns a ticket number')
  const ft = await one(`select * from service_tickets where company_id=$1 and source='form'`, [co])
  ok(ft?.customer_id === cust && ft.under_warranty, 'form ticket matched to the customer by phone and checked against the warranty')
  await p.goto(`${BASE}/parties/${cust}`); await settle()
  const form = p.locator('form', { has: p.getByRole('button', { name: 'Create secure link' }) }).first()
  await form.getByRole('button', { name: 'Create secure link' }).click(); const link = await p.locator('input[aria-label="Secure link"]').first().inputValue()
  await visitor.goto(link); await settle(visitor)
  await visitor.locator('summary', { hasText: 'Report an issue' }).click()
  const rf = visitor.locator('form', { has: visitor.getByRole('button', { name: 'Send' }) }).last()
  await rf.getByLabel('Your name *').fill('Villa 9 Owner'); await rf.getByLabel('What is the problem? *').fill('Paint peeling near the hinge'); await rf.getByRole('button', { name: 'Send' }).click(); await settle(visitor, 900)
  ok(/Your reference is ST-/.test(await visitor.locator('body').innerText()), 'customer portal: issue reported, reference shown')
  ok(!!(await one(`select 1 from service_tickets where company_id=$1 and source='portal' and customer_id=$2 and title='Paint peeling near the hinge'`, [co, cust])), 'portal ticket created for that customer')
  await visitor.reload(); await settle(visitor)
  ok((await visitor.locator('body').innerText()).includes('Paint peeling near the hinge'), 'portal lists the customer’s service requests')

  console.log('\n[3] Knowledge base')
  await p.goto(`${BASE}/kb?new=kb`); await settle()
  await dlg().getByLabel('Title *').fill('Hot work permit before welding on site'); await dlg().locator('input[name=category]').fill('Safety'); await dlg().locator('input[name=tags]').fill('welding, permit')
  await dlg().locator('textarea[name=body]').fill('# Before you start\n1. Get the permit signed by the site engineer\n2. Fire extinguisher within 5 m\n\n# During work\n- Fire watch stays 30 minutes after\n- Never weld near paint thinner')
  await dlg().getByRole('button', { name: 'Save article' }).click(); await p.waitForURL(/\/kb\/[0-9a-f-]{36}$/); await settle()
  const kid = p.url().split('/').pop()
  ok((await p.locator('[data-kb-body] h2').count()) === 2 && (await p.locator('[data-kb-body] ol li').count()) === 2 && (await p.locator('[data-kb-body] ul li').count()) === 2, 'article renders headings, numbered steps and bullets')
  await p.getByRole('button', { name: 'Edit' }).click(); await dlg().locator('textarea[name=body]').fill('# Before you start\n1. Get the permit signed\n2. Fire extinguisher within 5 m\n3. Remove flammables'); await dlg().getByRole('button', { name: 'Save new version' }).click(); await settle(p, 900)
  ok((await one(`select version from kb_articles where id=$1`, [kid])).version === 2, 'edit saved as version 2')
  await p.reload(); await settle()
  ok((await main()).includes('Earlier versions') && (await main()).includes('Version 1'), 'version history listed')
  await p.goto(`${BASE}/kb/${kid}?v=1`); await settle()
  ok((await main()).includes('You are viewing version 1') && (await main()).includes('Never weld near paint thinner'), 'old version viewable')
  await p.goto(`${BASE}/kb?q=extinguisher`); await settle()
  ok((await main()).includes('Hot work permit'), 'KB search finds content text')

  console.log('\n[4] Search, trash, brief')
  await p.goto(`${BASE}/search?q=${encodeURIComponent(t.number)}`); await settle()
  ok((await main()).includes('Service tickets') && (await main()).includes('Gate stops halfway'), 'global search finds the ticket')
  await p.goto(`${BASE}/search?q=hot%20work`); await settle()
  ok((await main()).includes('Knowledge base'), 'global search finds the article')
  await p.goto(`${BASE}/tickets/${ft.id}`); await settle(); await p.getByRole('button', { name: 'Delete' }).click(); await p.waitForURL(/\/tickets$/); await settle()
  await p.goto(`${BASE}/trash`); await settle()
  ok((await main()).includes(ft.number), 'trashed ticket listed in Trash')
  await db.query(`update service_tickets set due_date=$2 where company_id=$1 and source='portal'`, [co, day(-1)])
  await p.goto(`${BASE}/brief`); await settle()
  ok((await main()).includes('Service tickets due') && (await main()).includes('Paint peeling'), 'Daily Brief lists overdue tickets')

  console.log('\n[5] Phone')
  const m = await browser.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true, storageState: await ctx.storageState() }); const mp = await m.newPage()
  for (const path of ['/tickets', `/tickets/${tid}`, '/tickets?tab=warranties', '/kb', `/kb/${kid}`]) {
    await mp.goto(BASE + path); await mp.waitForLoadState('networkidle').catch(() => {})
    const clip = await mp.evaluate(() => { const main = document.querySelector('main'); const edge = Math.min(innerWidth, main.getBoundingClientRect().right) + 1
      const scroller = e => { for (let a = e.parentElement; a && a !== main; a = a.parentElement) { const o = getComputedStyle(a).overflowX; if (o === 'auto' || o === 'scroll') return true } return false }
      return [...main.querySelectorAll('*')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > edge && !scroller(e) }).length })
    ok(clip === 0, `${path}: nothing cut off on a 360px phone (${clip})`)
  }
  await mp.goto(`${BASE}/tickets/${tid}`); await mp.screenshot({ path: `${OUT}/m-ticket.png`, fullPage: true }); await m.close()
  await p.goto(`${BASE}/tickets/${tid}`); await settle(); await p.screenshot({ path: `${OUT}/ticket.png`, fullPage: true })
  await p.goto(`${BASE}/kb/${kid}`); await settle(); await p.screenshot({ path: `${OUT}/kb.png`, fullPage: true })
} catch (e) {
  ok(false, `aborted: ${e.message.split('\n').slice(0, 12).join(' | ')}`); await p.screenshot({ path: `${OUT}/abort.png`, fullPage: true }).catch(() => {})
}
for (const e of jsErrors) ok(false, `JS error ${e}`)
const failed = results.filter(r => !r[0]).length
console.log(`\nService suite: ${results.length - failed}/${results.length} passed`)
await browser.close(); await db.end()
process.exit(failed ? 1 : 0)
