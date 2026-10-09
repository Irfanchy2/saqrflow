// Secure links & public forms e2e (Phase B): customer portal (quotes accept, invoices, statement, PDFs), quotation
// accept / reject link, document request upload, supplier portal (delivery confirmation, invoice upload), revocation,
// token tampering, public enquiry form (spam guards, lead creation), QR labels, phone layout.
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import pg from 'pg'

const BASE = process.env.E2E_BASE
const OUT = 'tests/e2e/shots/portals'; fs.mkdirSync(OUT, { recursive: true })
const results = []
const ok = (cond, msg) => { results.push([!!cond, msg]); console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`) }
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
const exe = fs.readdirSync('/opt/pw-browsers').filter(d => d.startsWith('chromium-')).map(d => `/opt/pw-browsers/${d}/chrome-linux/chrome`).find(p => fs.existsSync(p))
const browser = await chromium.launch({ executablePath: exe })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const p = await ctx.newPage()
const jsErrors = []; p.on('pageerror', e => jsErrors.push(`${p.url()}: ${e.message}`)); p.on('dialog', d => d.accept())
const settle = async (pg_ = p, ms = 500) => { await pg_.waitForLoadState('networkidle').catch(() => {}); await pg_.waitForTimeout(ms) }
const main = (pg_ = p) => pg_.locator(pg_ === p ? "main" : "body").innerText()
const day = n => { const x = new Date(Date.now() + 4 * 3600e3); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
const EMAIL = `portal-${Date.now()}@alsaqr.test`
// an anonymous visitor (no session at all)
const anonCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const v = await anonCtx.newPage()
v.on('pageerror', e => jsErrors.push(`[visitor] ${v.url()}: ${e.message}`))
const makeLink = async (nth = 0, fill = async () => {}) => {
  const form = p.locator('form', { has: p.getByRole('button', { name: 'Create secure link' }) }).nth(nth)
  await fill(form); await form.getByRole('button', { name: 'Create secure link' }).click()
  const input = p.locator('input[aria-label="Secure link"]').first(); await input.waitFor({ timeout: 15000 })
  return input.inputValue()
}

try {
  console.log('\n[0] Setup')
  await p.goto(`${BASE}/signup`); await p.getByLabel('Work email').fill(EMAIL); await p.getByLabel('Password').fill('correct-horse-battery'); await p.getByRole('button', { name: 'Create account' }).click()
  await p.waitForURL('**/onboarding'); await p.getByLabel('Company name').fill('Al Saqr Portal Test'); await p.getByLabel('Your full name').fill('Portal Owner'); await p.getByRole('button', { name: 'Create company' }).click(); await p.waitForURL(`${BASE}/`)
  const co = (await one(`select p.company_id from profiles p join auth.users u on u.id=p.id where u.email=$1`, [EMAIL])).company_id
  const owner = (await one(`select id from auth.users where email=$1`, [EMAIL])).id
  const cust = (await one(`insert into customers(company_id,name,contact_person) values ($1,'Gulf Horizon Interiors','Mr. Faris') returning id`, [co])).id
  const other = (await one(`insert into customers(company_id,name) values ($1,'Someone Else LLC') returning id`, [co])).id
  const mk = async (type, num, status, total, customer = cust, extra = {}) => {
    const r = await one(`insert into invoices(company_id,doc_type,number,status,customer_id,customer_name,issue_date,due_date,valid_until,subtotal,vat_amount,total,subject,sent_at,lead_id)
      values ($1,$2,$3,$4,$5,'Gulf Horizon Interiors',$6,$7,$8,$9,$10,$11,$12,now(),$13) returning id`, [co, type, num, status, customer, day(-5), type === 'invoice' ? day(-1) : null, type === 'quotation' ? day(20) : null, Math.round(total / 1.05 * 100) / 100, Math.round((total - total / 1.05) * 100) / 100, total, extra.subject ?? null, extra.lead ?? null])
    await one(`insert into invoice_items(company_id,invoice_id,position,description,quantity,unit,unit_price) values ($1,$2,1,'MS handrail with primer',10,'Rmt',$3) returning id`, [co, r.id, Math.round(total / 1.05 / 10 * 100) / 100])
    return r.id
  }
  const lead = (await one(`insert into leads(company_id,number,company_name,stage,source) values ($1,'LD-T-1','Gulf Horizon Interiors','quotation_sent','referral') returning id`, [co])).id
  const q1 = await mk('quotation', 'AS-T-101', 'sent', 21000, cust, { subject: 'Staircase handrail', lead })
  const q2 = await mk('quotation', 'AS-T-102', 'sent', 4200)
  const inv = await mk('invoice', 'INV-T-501', 'sent', 10500)
  const draft = await mk('quotation', 'AS-T-DRAFT', 'draft', 999)
  const foreign = await mk('invoice', 'INV-T-OTHER', 'sent', 777, other)
  const proj = (await one(`insert into projects(company_id,name,customer_id,status,fabrication_progress,site_progress) values ($1,'Villa 7 staircase',$2,'active',60,20) returning id`, [co, cust])).id
  await one(`insert into project_milestones(company_id,project_id,title,due_date,done) values ($1,$2,'Fabrication complete',$3,true) returning id`, [co, proj, day(-2)])

  console.log('\n[1] Customer portal')
  await p.goto(`${BASE}/parties/${cust}`); await settle()
  ok((await main()).includes('Customer portal') && (await main()).includes('Request documents'), 'customer page offers Customer portal and Request documents')
  const portal = await makeLink(0)
  ok(/\/p\/[A-Za-z0-9_-]{43}$/.test(portal), `portal link created (${portal.replace(/[A-Za-z0-9_-]{43}$/, '…')})`)
  const tokenHash = (await one(`select token_hash from share_links where company_id=$1 and kind='customer_portal'`, [co])).token_hash
  ok(/^[0-9a-f]{64}$/.test(tokenHash) && !tokenHash.includes(portal.split('/').pop()), 'only the SHA-256 hash of the token is stored')
  await v.goto(portal.startsWith('http') ? portal : BASE + portal); await settle(v)
  const pt = await main(v)
  ok(pt.includes('Gulf Horizon Interiors') && pt.includes('AS-T-101') && pt.includes('INV-T-501') && pt.includes('Villa 7 staircase'), 'visitor (signed out) sees their quotations, invoices and project')
  ok(!pt.includes('AS-T-DRAFT') && !pt.includes('INV-T-OTHER') && !pt.includes('Someone Else'), 'drafts and other customers’ documents are not shown')
  ok(pt.includes('60%') && pt.includes('Fabrication complete'), 'project progress and milestones shown')
  const pdf = await v.request.get(`${portal.startsWith('http') ? portal : BASE + portal}/doc/${inv}`)
  ok(pdf.ok() && pdf.headers()['content-type'] === 'application/pdf' && (await pdf.body()).subarray(0, 4).toString() === '%PDF', 'invoice PDF downloads through the portal')
  ok((await v.request.get(`${portal.startsWith('http') ? portal : BASE + portal}/doc/${foreign}`)).status() === 404, 'another customer’s invoice id → 404')
  ok((await v.request.get(`${portal.startsWith('http') ? portal : BASE + portal}/doc/${draft}`)).status() === 404, 'a draft → 404')
  const st = await v.request.get(`${portal.startsWith('http') ? portal : BASE + portal}/statement`)
  ok(st.ok() && (await st.body()).subarray(0, 4).toString() === '%PDF', 'statement of account PDF')
  await v.locator('summary', { hasText: 'Accept or decline AS-T-101' }).click()
  const acc = v.locator('form', { has: v.getByRole('button', { name: 'Accept' }) }).first()
  await acc.getByLabel('Your name *').fill('Faris Al Mansoori'); await acc.getByRole('button', { name: 'Accept' }).click(); await settle(v, 900)
  ok(/is accepted|Accepted\. Thank you/.test(await main(v)), 'customer accepts in the portal and sees a confirmation')
  const qa = await one(`select status from invoices where id=$1`, [q1])
  ok(qa.status === 'accepted', 'quotation status → accepted')
  ok((await one(`select stage from leads where id=$1`, [lead])).stage === 'won', 'linked lead moved to Won')
  ok(!!(await one(`select 1 from sales_doc_events where invoice_id=$1 and event='status' and detail like '%online by Faris Al Mansoori%'`, [q1])), 'history records who accepted online')
  ok(!!(await one(`select 1 from in_app_notifications where user_id=$1 and link=$2`, [owner, `/invoices/${q1}`])), 'office notified')
  ok(!!(await one(`select 1 from share_link_events e join share_links l on l.id=e.link_id where l.company_id=$1 and e.event='accepted'`, [co])), 'link log: accepted')

  console.log('\n[2] Quotation accept / reject link')
  await p.goto(`${BASE}/invoices/${q2}`); await settle()
  const ql = await makeLink(0)
  await v.goto(ql.startsWith('http') ? ql : BASE + ql); await settle(v)
  ok((await main(v)).includes('AS-T-102') && (await main(v)).includes('Your answer'), 'quotation page shows the document and the answer forms')
  ok((await one(`select status from invoices where id=$1`, [q2])).status === 'viewed', 'opening it marks the quotation Viewed')
  const pdf2 = await v.request.get(`${ql.startsWith('http') ? ql : BASE + ql}/pdf`)
  ok(pdf2.ok() && (await pdf2.body()).subarray(0, 4).toString() === '%PDF', 'quotation PDF from the link')
  const dec = v.locator('form', { has: v.getByRole('button', { name: 'Decline' }) })
  await dec.getByLabel('Your name *').fill('Faris'); await dec.getByLabel('Reason').fill('Budget moved to next year'); await dec.getByRole('button', { name: 'Decline' }).click(); await settle(v, 900)
  ok((await one(`select status from invoices where id=$1`, [q2])).status === 'rejected', 'declined → status rejected')
  ok(!!(await one(`select 1 from sales_doc_events where invoice_id=$1 and detail like '%Budget moved to next year%'`, [q2])), 'reason kept in the history')

  console.log('\n[3] Revocation and tampering')
  await p.goto(`${BASE}/parties/${cust}`); await settle()
  await p.getByRole('button', { name: 'Switch off' }).first().click(); await settle(p, 900)
  await v.goto(portal.startsWith('http') ? portal : BASE + portal); await settle(v)
  ok((await main(v).catch(() => v.locator('body').innerText())).includes('not available'), 'switched-off link shows “not available”')
  await v.goto(`${BASE}/p/${'A'.repeat(43)}`); ok((await v.locator('body').innerText()).includes('not available'), 'made-up token → not available')
  await v.goto(`${BASE}/s/${(ql.split('/').pop())}`); ok((await v.locator('body').innerText()).includes('not available'), 'a quotation token does not open the supplier portal')
  await v.goto(`${BASE}/invoices`); ok(v.url().includes('/login'), 'the app itself still requires sign-in')

  console.log('\n[4] Document request (employee)')
  const emp = (await one(`insert into employees(company_id,employee_no,full_name) values ($1,'E-301','Anil Thomas') returning id`, [co])).id
  await p.goto(`${BASE}/employees/${emp}?tab=documents`); await settle()
  const dr = await makeLink(0, async f => { await f.getByLabel('Documents needed *').fill('Passport copy\nEmirates ID') })
  await v.goto(dr.startsWith('http') ? dr : BASE + dr); await settle(v)
  ok((await main(v)).includes('Passport copy') && (await main(v)).includes('Emirates ID'), 'request page lists the requested documents')
  fs.writeFileSync(`${OUT}/passport.png`, PNG)
  await v.getByLabel('Your name *').fill('Anil Thomas'); await v.locator('select[name=item]').selectOption('Passport copy'); await v.locator('input[type=file]').setInputFiles(`${OUT}/passport.png`)
  await v.getByRole('button', { name: 'Send files' }).click(); await settle(v, 1200)
  ok((await main(v)).includes('Received 1 file'), 'upload confirmed to the employee')
  const ib = await one(`select status, suggestion, review_reasons from document_inbox where company_id=$1 order by created_at desc limit 1`, [co])
  ok(ib?.status === 'needs_review' && ib.suggestion?.owner?.id === emp && ib.review_reasons[0].includes('Passport copy'), 'file waits in Smart Inbox for review, pre-linked to the employee')
  await v.reload(); await settle(v)
  ok((await main(v)).includes('received'), 'request page ticks off the received document')

  console.log('\n[5] Supplier portal')
  const sup = (await one(`insert into suppliers(company_id,name) values ($1,'Emirates Steel Trading') returning id`, [co])).id
  const po = (await one(`insert into invoices(company_id,doc_type,number,status,customer_name,issue_date,subtotal,vat_amount,total,sent_at) values ($1,'purchase_order','PO-T-9','sent','Emirates Steel Trading',$2,1000,50,1050,now()) returning id`, [co, day(-1)])).id
  await one(`insert into invoice_items(company_id,invoice_id,position,description,quantity,unit,unit_price) values ($1,$2,1,'RHS 100x50x3',20,'Len',50) returning id`, [co, po])
  await p.goto(`${BASE}/invoices/${po}`); await settle()
  ok((await p.locator('select[name=supplier_id]').inputValue()) === sup, 'PO page suggests the supplier by name')
  await p.getByRole('button', { name: 'Save supplier' }).click(); await settle(p, 900)
  ok((await one(`select supplier_id from invoices where id=$1`, [po])).supplier_id === sup, 'PO linked to the supplier')
  await p.reload(); await settle()
  const sl = await makeLink(0)
  await v.goto(sl.startsWith('http') ? sl : BASE + sl); await settle(v)
  ok((await main(v)).includes('PO-T-9') && !(await main(v)).includes('INV-T-501'), 'supplier sees their purchase order only')
  await v.locator('summary', { hasText: 'Confirm delivery of PO-T-9' }).click()
  const cf = v.locator('form', { has: v.getByRole('button', { name: 'Confirm delivery' }) })
  await cf.getByLabel('Your name *').fill('Rakesh (ESt)'); await cf.getByLabel('Delivery note no.').fill('DN-8812'); await cf.getByRole('button', { name: 'Confirm delivery' }).click(); await settle(v, 900)
  const pc = await one(`select supplier_confirmed_at, supplier_confirmation from invoices where id=$1`, [po])
  ok(!!pc.supplier_confirmed_at && pc.supplier_confirmation.reference === 'DN-8812' && pc.supplier_confirmation.by === 'Rakesh (ESt)', 'delivery confirmation stored on the PO')
  const up = v.locator('form', { has: v.getByRole('button', { name: 'Upload invoice' }) })
  fs.writeFileSync(`${OUT}/inv.png`, PNG)
  await up.getByLabel('Your name *').fill('Rakesh'); await up.locator('select[name=po_number]').selectOption('PO-T-9'); await up.getByLabel('Invoice number').fill('EST-4471'); await up.getByLabel('Amount (AED)').fill('1050')
  await up.locator('input[type=file]').setInputFiles(`${OUT}/inv.png`); await up.getByRole('button', { name: 'Upload invoice' }).click(); await settle(v, 1200)
  const si = await one(`select review_reasons, suggestion from document_inbox where company_id=$1 order by created_at desc limit 1`, [co])
  ok(si.review_reasons[0].includes('PO-T-9') && si.review_reasons[0].includes('EST-4471') && si.suggestion.owner.id === sup, 'supplier invoice in Smart Inbox with PO, invoice number, supplier')
  await p.goto(`${BASE}/invoices/${po}`); await settle()
  ok((await main()).includes('Delivery confirmed by Rakesh (ESt)'), 'PO page shows the supplier’s confirmation')

  console.log('\n[6] Public enquiry form')
  await p.goto(`${BASE}/settings#forms`); await settle()
  const pf = p.locator('#forms')
  await pf.getByLabel('Title *').fill('Request a quotation'); await pf.getByLabel('Web address *').fill('alsaqr-test-quote'); await pf.getByRole('button', { name: 'Publish form' }).click(); await settle(p, 900)
  ok(!!(await one(`select 1 from public_forms where slug='alsaqr-test-quote' and company_id=$1`, [co])), 'form published')
  await v.goto(`${BASE}/f/alsaqr-test-quote`); await settle(v)
  ok((await v.locator('h1').innerText()) === 'Request a quotation', 'form opens for anyone')
  const fill = async () => { await v.getByLabel('Your name *').fill('Hamdan Saeed'); await v.getByLabel('Phone / WhatsApp *').fill('+971 50 123 4567'); await v.getByLabel('Company').fill('Saeed Villas'); await v.getByLabel('What do you need? *').fill('Pergola 6 x 4 m with louvres') }
  await fill(); await v.getByRole('button', { name: 'Send enquiry' }).click(); await settle(v, 600)
  ok((await main(v)).includes('Please take a moment'), 'instant (bot-speed) submission refused')
  await v.waitForTimeout(2600); await v.getByRole('button', { name: 'Send enquiry' }).click(); await settle(v, 900)
  ok(/Your reference is LD-/.test(await main(v)), 'enquiry accepted with a lead number')
  const L = await one(`select * from leads where company_id=$1 and contact_person='Hamdan Saeed'`, [co])
  ok(L?.source === 'website' && L.stage === 'new' && L.company_name === 'Saeed Villas' && L.notes.includes('Pergola'), 'lead created (source Website, stage New)')
  ok(!!(await one(`select 1 from in_app_notifications where user_id=$1 and link=$2`, [owner, `/leads/${L.id}`])), 'sales team notified')
  // honeypot: a filled hidden field is silently dropped
  await v.goto(`${BASE}/f/alsaqr-test-quote`); await settle(v); await fill(); await v.locator('input[name=website]').evaluate(el => { el.value = 'http://spam' }); await v.waitForTimeout(2600)
  await v.getByRole('button', { name: 'Send enquiry' }).click(); await settle(v, 900)
  ok(Number((await one(`select count(*)::int n from leads where company_id=$1 and contact_person='Hamdan Saeed'`, [co])).n) === 1, 'honeypot submission creates no lead')
  for (let i = 0; i < 5; i++) { await v.goto(`${BASE}/f/alsaqr-test-quote`); await fill(); await v.waitForTimeout(2600); await v.getByRole('button', { name: 'Send enquiry' }).click(); await settle(v, 500) }
  ok((await main(v)).includes('several requests already'), 'per-visitor rate limit kicks in')
  await db.query(`update public_forms set enabled=false where slug='alsaqr-test-quote'`)
  await v.goto(`${BASE}/f/alsaqr-test-quote`); ok((await v.locator('body').innerText()).includes('not available'), 'switched-off form shows “not available”')

  console.log('\n[7] QR labels')
  const veh = (await one(`insert into assets(company_id,name,kind,plate_or_serial,status) values ($1,'Toyota Hilux','vehicle','AD 5 41827','active') returning id`, [co])).id
  await p.goto(`${BASE}/assets/${veh}`); await settle()
  ok((await p.getByRole('link', { name: 'QR label' }).count()) === 1, 'vehicle page has a QR label button')
  await p.goto(`${BASE}/print/qr?type=asset&ids=${veh}`); await settle()
  ok((await p.locator('svg').count()) >= 1 && (await p.locator('body').innerText()).includes('AD 5 41827'), 'label page renders a QR code with the plate')
  await p.goto(`${BASE}/print/qr?type=project&ids=${proj}`); await settle()
  ok((await p.locator('body').innerText()).includes('Villa 7 staircase'), 'project QR label')
  await p.screenshot({ path: `${OUT}/qr.png` })

  console.log('\n[8] Phone')
  const m = await browser.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true }); const mp = await m.newPage()
  await db.query(`update public_forms set enabled=true where slug='alsaqr-test-quote'`)
  for (const path of [dr, sl, '/f/alsaqr-test-quote']) {
    await mp.goto(path.startsWith('http') ? path : BASE + path); await mp.waitForLoadState('networkidle').catch(() => {})
    const over = await mp.evaluate(() => document.documentElement.scrollWidth - innerWidth)
    ok(over <= 1, `${path.replace(/[A-Za-z0-9_-]{43}/, '…')}: fits a 360px phone (${over})`)
  }
  await mp.goto(BASE + '/f/alsaqr-test-quote'); await mp.screenshot({ path: `${OUT}/m-form.png`, fullPage: true }); await m.close()
} catch (e) {
  ok(false, `aborted: ${e.message.split('\n').slice(0, 12).join(' | ')}`); await p.screenshot({ path: `${OUT}/abort.png`, fullPage: true }).catch(() => {}); await v.screenshot({ path: `${OUT}/abort-visitor.png`, fullPage: true }).catch(() => {})
}
for (const e of jsErrors) ok(false, `JS error ${e}`)
const failed = results.filter(r => !r[0]).length
console.log(`\nPortals suite: ${results.length - failed}/${results.length} passed`)
await browser.close(); await db.end()
process.exit(failed ? 1 : 0)
