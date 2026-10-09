// WhatsApp Business e2e: Send via WhatsApp for all 11 message types (number auto-filled, preview, PDF attached), sandbox,
// connecting a number (encrypted token, Test connection), template edit → submit → approval → live send through the Cloud API
// stand-in (media upload + template with document header), delivery receipts, failures, 24-hour window custom message with
// masking, STOP opt-out, history under customer / employee, delivery log, phone layout.
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import crypto from 'node:crypto'
import pg from 'pg'

const BASE = process.env.E2E_BASE, GW = process.env.E2E_GATEWAY ?? 'http://127.0.0.1:54399'
const OUT = 'tests/e2e/shots/whatsapp'; fs.mkdirSync(OUT, { recursive: true })
const results = []
const ok = (cond, msg) => { results.push([!!cond, msg]); console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`) }
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
const exe = fs.readdirSync('/opt/pw-browsers').filter(d => d.startsWith('chromium-')).map(d => `/opt/pw-browsers/${d}/chrome-linux/chrome`).find(p => fs.existsSync(p))
const browser = await chromium.launch({ executablePath: exe })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const p = await ctx.newPage()
const jsErrors = []; p.on('pageerror', e => jsErrors.push(`${p.url()}: ${e.message}`)); p.on('dialog', d => d.accept())
const settle = async (ms = 500) => { await p.waitForLoadState('networkidle').catch(() => {}); await p.waitForTimeout(ms) }
const waitFor = async (fn, ms = 12000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn().catch(() => null); if (v) return v; await new Promise(r => setTimeout(r, 300)) } return null }
const day = n => { const x = new Date(Date.now() + 4 * 3600e3); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const wa = () => p.locator('dialog[data-wa-dialog][open]')
const graph = async () => (await (await fetch(`${GW}/mock/calls`)).json()).graph
const hook = async payload => { const raw = JSON.stringify(payload); return fetch(`${BASE}/api/webhooks/whatsapp`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=' + crypto.createHmac('sha256', 'e2e-app-secret').update(raw).digest('hex') }, body: raw }) }
const EMAIL = `wa-${Date.now()}@alsaqr.test`
/** opens a WhatsApp dialog from a button, waits for the preview, sends, returns the result text */
const openDialog = async btn => { await btn.click(); await waitFor(async () => (await wa().locator('[data-wa-preview]').count()) > 0 || (await wa().innerText()).match(/not found|permission|Link the|Only employee/)) }
const send = async () => { await wa().getByRole('button', { name: 'Send' }).click(); return waitFor(async () => { const t = await wa().innerText(); return /Sent to|sandbox mode|Not sent|Not sent yet|opted out|only be sent/.test(t) ? t : null }, 20000) }
const close = () => wa().getByRole('button', { name: 'Close' }).first().click()

try {
  console.log('\n[0] Setup')
  await p.goto(`${BASE}/signup`); await p.getByLabel('Work email').fill(EMAIL); await p.getByLabel('Password').fill('correct-horse-battery'); await p.getByRole('button', { name: 'Create account' }).click()
  await p.waitForURL('**/onboarding'); await p.getByLabel('Company name').fill('Al Saqr WhatsApp Test'); await p.getByLabel('Your full name').fill('WA Owner'); await p.getByRole('button', { name: 'Create company' }).click(); await p.waitForURL(`${BASE}/`)
  const co = (await one(`select p.company_id from profiles p join auth.users u on u.id=p.id where u.email=$1`, [EMAIL])).company_id
  const cust = (await one(`insert into customers(company_id,name,phone,whatsapp) values ($1,'Falcon Towers LLC','04 555 1234','+971 50 111 2222') returning id`, [co])).id
  const inv = (await one(`insert into invoices(company_id,doc_type,number,customer_id,customer_name,total,status,issue_date,due_date) values ($1,'invoice','INV-W1',$2,'Falcon Towers LLC',10500,'sent',$3,$4) returning id`, [co, cust, day(-20), day(-5)])).id
  await db.query(`insert into invoice_items(company_id,invoice_id,position,description,quantity,unit_price) values ($1,$2,1,'Steel canopy',1,10000)`, [co, inv])
  const qt = (await one(`insert into invoices(company_id,doc_type,number,customer_id,customer_name,total,status,issue_date,valid_until) values ($1,'quotation','AS-W1/2026',$2,'Falcon Towers LLC',25000,'sent',$3,$4) returning id`, [co, cust, day(-3), day(27)])).id
  const dn = (await one(`insert into invoices(company_id,doc_type,number,customer_id,customer_name,total,status,issue_date) values ($1,'delivery_note','DL-W1',$2,'Falcon Towers LLC',0,'sent',$3) returning id`, [co, cust, day(-1)])).id
  const pay = (await one(`insert into payments(company_id,invoice_id,amount,paid_on,method,reference) values ($1,$2,2500,$3,'bank_transfer','TT-889') returning id`, [co, inv, day(-1)])).id
  const emp = (await one(`insert into employees(company_id,employee_no,full_name,designation,phone) values ($1,'E-77','Anil Thomas','Fabricator','+971 55 333 4444') returning id`, [co])).id
  await db.query(`insert into employee_compensation(employee_id,company_id,monthly_salary) values ($1,$2,4200)`, [emp, co])
  const sal = (await one(`insert into salary_payments(company_id,employee_id,period,amount,paid_on,method) values ($1,$2,$3,4200,$4,'wps') returning id`, [co, emp, day(-30).slice(0, 8) + '01', day(-2)])).id
  const visa = (await one(`insert into documents(company_id,name,owner_type,owner_id,expiry_date,reference_no,status) values ($1,'Residence visa','employee',$2,$3,'784199012345676','active') returning id`, [co, emp, day(20)])).id
  const chq = (await one(`insert into cheques(company_id,cheque_no,direction,party_type,customer_id,party_name,bank_name,amount,cheque_date,status) values ($1,'004417','incoming','customer',$2,'Falcon Towers LLC','ADCB',18450,$3,'received') returning id`, [co, cust, day(4)])).id
  const proj = (await one(`insert into projects(company_id,name,customer_id,status,fabrication_progress,site_progress) values ($1,'Falcon canopy',$2,'active',60,20) returning id`, [co, cust])).id
  ok(true, 'seeded a customer, invoice, quotation, delivery note, payment, employee + payslip + visa, cheque and project')

  console.log('\n[1] Sandbox (WhatsApp not connected yet)')
  await p.goto(`${BASE}/invoices/${inv}`); await settle(800)
  await openDialog(p.getByRole('button', { name: 'Send tax invoice via WhatsApp' }))
  ok(await wa().getByLabel('WhatsApp number').inputValue() === '+971501112222', 'number auto-filled from the customer (WhatsApp number preferred)')
  const pv = await wa().locator('[data-wa-preview]').innerText()
  ok(pv.includes('Falcon Towers LLC') && pv.includes('INV-W1') && pv.includes('AED 10,500.00') && pv.includes('PDF attached'), 'preview shows the exact message and the attached PDF')
  ok((await wa().innerText()).includes('Sandbox: not sent'), 'sandbox mode is clearly shown')
  let r = await send(); ok(r?.includes('Recorded in sandbox mode: nothing was sent'), 'sandbox send is recorded, nothing leaves Averiqo')
  const sb = await one(`select status, attachment_path, attachment_name, party_type, party_id, kind from notification_logs where company_id=$1 and kind='invoice'`, [co])
  ok(sb?.status === 'sandbox' && sb.party_id === cust && /\.pdf$/.test(sb.attachment_name) && sb.attachment_path?.startsWith(`${co}/whatsapp/`), 'queued in the notification log with its PDF in private storage')
  await close()

  console.log('\n[2] Connect the WhatsApp Business number')
  await p.goto(`${BASE}/settings#whatsapp`); await settle()
  const w = p.locator('#whatsapp')
  await w.getByLabel('Phone number ID').fill('1234567890'); await w.getByLabel('WhatsApp Business Account ID').fill('9876543210'); await w.getByLabel('Meta App ID').fill('1122334455')
  await w.getByLabel('Access token').fill('test-wa-token'); await w.getByRole('button', { name: 'Save' }).click(); await settle(900)
  const sec = await one(`select ciphertext from integration_secrets where company_id=$1 and name='whatsapp_token'`, [co])
  ok(sec && !sec.ciphertext.includes('test-wa-token'), 'access token stored encrypted (server-side only)')
  await p.reload(); await settle()
  ok((await p.content()).includes('test-wa-token') === false, 'the token is never sent back to the browser')
  await p.locator('#whatsapp').getByRole('button', { name: 'Test connection' }).click()
  ok(await waitFor(async () => (await p.locator('#whatsapp').innerText()).includes('Connected: Al Saqr Test · +971 4 555 0100')), 'Test connection shows the business number from WhatsApp')

  console.log('\n[3] Templates: edit, submit, approval')
  const tpl = k => p.locator(`[data-wa-template="${k}"]`)
  await tpl('invoice').locator('summary').click()
  await tpl('invoice').getByLabel(/^Message/).fill('Dear {customer}, your tax invoice {number} for {amount} is attached (due {due_date}). Thank you, {company}')
  await tpl('invoice').getByRole('button', { name: 'Save text' }).click(); await settle()
  ok((await tpl('invoice').innerText()).includes('Dear Falcon') === false && (await tpl('invoice').innerText()).includes('ABC Contracting LLC'), 'template preview uses sample data')
  await tpl('invoice').getByRole('button', { name: 'Submit to WhatsApp for approval' }).click()
  ok(await waitFor(async () => (await tpl('invoice').innerText()).toLowerCase().includes('pending')), 'submitted: status pending')
  const sub = (await graph()).find(g => g.method === 'POST' && /message_templates$/.test(g.path))
  ok(sub?.json?.name === 'averiqo_invoice' && sub.json.category === 'UTILITY' && sub.json.components[0].format === 'DOCUMENT' && sub.json.components[0].example.header_handle[0] === 'handle-TEST1'
    && sub.json.components[1].text === 'Dear {{1}}, your tax invoice {{2}} for {{3}} is attached (due {{4}}). Thank you, {{5}}', 'Meta receives a utility template with a PDF header and numbered variables')
  await p.goto(`${BASE}/invoices/${inv}`); await settle(800)
  await openDialog(p.getByRole('button', { name: 'Send tax invoice via WhatsApp' }))
  ok((await wa().innerText()).includes('pending at WhatsApp') && await wa().getByRole('button', { name: 'Send' }).isDisabled(), 'cannot send with a template that is not approved yet')
  await close()
  await fetch(`${GW}/mock/graph-approve`, { method: 'POST', body: JSON.stringify({ names: ['averiqo_invoice'] }) })
  await p.goto(`${BASE}/settings#wa-templates`); await settle(); await p.locator('#wa-templates').getByRole('button', { name: 'Check status' }).click()
  ok(await waitFor(async () => (await tpl('invoice').innerText()).includes('approved')), 'Check status picks up the approval')

  console.log('\n[4] Live send with the PDF')
  await p.goto(`${BASE}/invoices/${inv}`); await settle(800)
  await openDialog(p.getByRole('button', { name: 'Send tax invoice via WhatsApp' }))
  ok((await wa().innerText()).includes('Live') && (await wa().locator('[data-wa-preview]').innerText()).includes('your tax invoice INV-W1'), 'live mode, preview uses the approved text')
  const before = (await graph()).length
  r = await send(); ok(r?.includes('Sent to +9715 ••• 222'), 'sent (number masked in the confirmation)')
  const calls = (await graph()).slice(before)
  const media = calls.find(g => /\/media$/.test(g.path)), msg = calls.find(g => /\/messages$/.test(g.path))
  ok(media && media.size > 1000 && media.type.includes('multipart'), 'the generated PDF was uploaded to WhatsApp')
  ok(msg?.json?.type === 'template' && msg.json.to === '971501112222' && msg.json.template.name === 'averiqo_invoice' && msg.json.template.components[0].parameters[0].document.id.startsWith('media-')
    && msg.json.template.components[0].parameters[0].document.filename.endsWith('.pdf') && JSON.stringify(msg.json.template.components[1].parameters.map(x => x.text)) === JSON.stringify(['Falcon Towers LLC', 'INV-W1', 'AED 10,500.00', formatD(day(-5)), 'Al Saqr WhatsApp Test']), 'template message: PDF header and the values in order')
  const sent = await one(`select status, provider_message_id from notification_logs where company_id=$1 and kind='invoice' and status <> 'sandbox' order by created_at desc limit 1`, [co])
  ok(sent?.status === 'sent' && /^wamid\./.test(sent.provider_message_id), 'logged as sent with the WhatsApp message id')
  await close()

  console.log('\n[5] Delivery receipts, failures')
  await hook({ entry: [{ changes: [{ value: { statuses: [{ id: sent.provider_message_id, status: 'delivered', timestamp: String(Math.floor(Date.now() / 1000)) }] } }] }] })
  ok(await waitFor(async () => (await one(`select status from notification_logs where provider_message_id=$1`, [sent.provider_message_id])).status === 'delivered'), 'delivery receipt from WhatsApp marks it delivered')
  await p.goto(`${BASE}/parties/${cust}`); await settle()
  const hist = await p.locator('[data-wa-history]').innerText()
  ok(hist.includes('Tax invoice') && hist.includes('Delivered') && hist.includes('Sandbox (not sent)') && hist.includes('+9715 ••• 222'), 'history under the customer: each message with its status')
  await p.goto(`${BASE}/invoices/${inv}`); await settle(800)
  await openDialog(p.getByRole('button', { name: 'Send tax invoice via WhatsApp' }))
  await wa().getByLabel('WhatsApp number').fill('+971501230000'); r = await send()
  ok(r?.includes('Not sent: Message undeliverable'), 'a WhatsApp error is shown, not hidden')
  ok((await one(`select status, last_error from notification_logs where company_id=$1 and to_number='+971501230000'`, [co]))?.status === 'failed', 'logged as failed with the reason')
  await close()

  console.log('\n[6] 24-hour window: custom message (masked), then STOP')
  await hook({ entry: [{ changes: [{ value: { metadata: { phone_number_id: '1234567890' }, messages: [{ from: '971501112222', type: 'text', text: { body: 'Any update on the canopy?' }, timestamp: String(Math.floor(Date.now() / 1000)) }] } }] }] })
  ok(await waitFor(async () => !!(await one(`select last_inbound_at from whatsapp_contacts where company_id=$1 and phone='+971501112222'`, [co]))?.last_inbound_at), 'customer’s inbound message recorded (opens the 24-hour window)')
  await p.goto(`${BASE}/projects/${proj}`); await settle()
  await openDialog(p.getByRole('button', { name: 'Send update' }))
  ok((await wa().innerText()).includes('not submitted to WhatsApp yet') && (await wa().innerText()).includes('you can send a custom message'), 'template not submitted, but the open window allows a custom message')
  await wa().getByLabel(/Write a custom message/).check()
  await wa().getByLabel('Custom message', { exact: true }).fill('Hello, the canopy is 60% fabricated. Site starts Monday. Your EID 784-1990-1234567-6 copy is fine.')
  const b2 = (await graph()).length; r = await send(); ok(r?.includes('Sent to'), 'custom message sent inside the window')
  const free = (await graph()).slice(b2).find(g => /\/messages$/.test(g.path))
  ok(free?.json?.type === 'text' && free.json.text.body.includes('784-••••-•••••••-•') && !free.json.text.body.includes('1234567'), 'Emirates ID number masked before sending')
  await close()
  await hook({ entry: [{ changes: [{ value: { metadata: { phone_number_id: '1234567890' }, messages: [{ from: '971501112222', type: 'text', text: { body: 'STOP' }, timestamp: String(Math.floor(Date.now() / 1000)) }] } }] }] })
  await p.goto(`${BASE}/invoices/${inv}`); await settle(800)
  await openDialog(p.getByRole('button', { name: 'Send tax invoice via WhatsApp' }))
  ok((await wa().innerText()).includes('opted out') && await wa().getByRole('button', { name: 'Send' }).isDisabled(), 'after STOP the customer cannot be messaged')
  await close()
  await hook({ entry: [{ changes: [{ value: { metadata: { phone_number_id: '1234567890' }, messages: [{ from: '971501112222', type: 'text', text: { body: 'START' }, timestamp: String(Math.floor(Date.now() / 1000)) }] } }] }] })

  console.log('\n[7] Every message type (templates submitted and approved)')
  await p.goto(`${BASE}/settings#wa-templates`); await settle()
  for (const k of ['quotation', 'delivery_note', 'receipt', 'payslip', 'statement', 'payment_reminder', 'quotation_followup', 'document_expiry', 'cheque_reminder', 'project_update']) {
    await tpl(k).locator('summary').click(); await tpl(k).getByRole('button', { name: /Submit to WhatsApp/ }).click(); await waitFor(async () => (await tpl(k).innerText()).toLowerCase().includes('pending'))
  }
  await fetch(`${GW}/mock/graph-approve`, { method: 'POST', body: JSON.stringify({ names: ['quotation', 'delivery_note', 'receipt', 'payslip', 'statement', 'payment_reminder', 'quotation_followup', 'document_expiry', 'cheque_reminder', 'project_update'].map(k => `averiqo_${k}`) }) })
  await p.reload(); await settle(); await p.locator('#wa-templates').getByRole('button', { name: 'Check status' }).click(); await settle(900)
  const cases = [
    ['quotation', `/invoices/${qt}`, 'Send quotation via WhatsApp', ['AS-W1/2026', 'AED 25,000.00'], true],
    ['quotation_followup', `/invoices/${qt}`, 'Send follow-up via WhatsApp', ['following up on our quotation AS-W1/2026'], true],
    ['delivery_note', `/invoices/${dn}`, 'Send delivery note via WhatsApp', ['delivery note DL-W1'], true],
    ['payment_reminder', `/invoices/${inv}`, 'Send reminder via WhatsApp', ['INV-W1 has AED 8,000.00 outstanding'], true],
    ['receipt', '/invoices?tab=payments', 'Send payment receipt via WhatsApp', ['payment of AED 2,500.00', 'INV-W1'], true],
    ['statement', `/parties/${cust}`, 'Send statement', ['statement of account', 'Balance: AED 8,000.00'], true],
    ['payslip', `/employees/${emp}?tab=salary`, /payslip via WhatsApp/, ['Anil Thomas', 'payslip for'], true],
    ['document_expiry', `/employees/${emp}?tab=documents`, /expiry reminder via WhatsApp/, ['Residence visa expires on'], false],
    ['cheque_reminder', '/cheques', 'Send cheque 004417 reminder via WhatsApp', ['cheque ending 4417', 'AED 18,450.00'], false],
    ['project_update', `/projects/${proj}`, 'Send update', ['Falcon canopy', '60% / 20%'], false],
  ]
  for (const [k, path, btn, expect, pdf] of cases) {
    await p.goto(BASE + path); await settle(800)
    await openDialog(p.getByRole('button', { name: btn }).first())
    const prev = await wa().locator('[data-wa-preview]').innerText().catch(() => '')
    const ph = await wa().getByLabel('WhatsApp number').inputValue().catch(() => '')
    const b = (await graph()).length; r = await send()
    const cs = (await graph()).slice(b), m2 = cs.find(g => /\/messages$/.test(g.path))
    const row = await one(`select status, attachment_name from notification_logs where company_id=$1 and kind=$2 order by created_at desc limit 1`, [co, k])
    ok(expect.every(e => prev.includes(e)) && !!ph && r?.includes('Sent to') && row?.status === 'sent' && m2?.json?.template?.name === `averiqo_${k}` && (pdf ? !!cs.find(g => /\/media$/.test(g.path)) && /\.pdf$/.test(row.attachment_name) : !cs.find(g => /\/media$/.test(g.path))),
      `${k}: ${pdf ? 'PDF + ' : ''}template sent to ${ph}`)
    if (k === 'payslip') ok(!/4,?200|AED/.test(prev), 'payslip message text contains no salary amount')
    if (k === 'document_expiry') ok(!prev.includes('784199012345676') && !prev.includes('5676'), 'expiry reminder never contains the document number')
    await close()
  }
  await p.goto(`${BASE}/employees/${emp}?tab=history`); await settle()
  ok((await p.locator('[data-wa-history]').innerText()).includes('Salary payslip') && (await p.locator('[data-wa-history]').innerText()).includes('Document expiry reminder'), 'history under the employee')
  await p.goto(`${BASE}/reminders?tab=log`); await settle()
  ok((await p.locator('main').innerText()).includes('Tax invoice · +9715 ••• 222'), 'delivery log lists WhatsApp document sends')
  ok(!(await p.content()).includes('test-wa-token'), 'token never appears in any page')

  console.log('\n[8] Phone')
  const m = await browser.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true, storageState: await ctx.storageState() }); const mp = await m.newPage()
  await mp.goto(`${BASE}/invoices/${inv}`); await mp.waitForLoadState('networkidle').catch(() => {}); await mp.waitForTimeout(800)
  await mp.getByRole('button', { name: 'Send tax invoice via WhatsApp' }).click(); await mp.waitForTimeout(1500)
  const fit = await mp.evaluate(() => { const d = document.querySelector('dialog[data-wa-dialog][open]'); if (!d) return null; const r = d.getBoundingClientRect(); return r.left >= -1 && r.right <= innerWidth + 1 && [...d.querySelectorAll('*')].every(e => e.getBoundingClientRect().right <= innerWidth + 1) })
  ok(fit === true, 'send dialog fits a 360px phone')
  await mp.screenshot({ path: `${OUT}/m-dialog.png` }); await m.close()
  await p.goto(`${BASE}/settings#wa-templates`); await settle(); await p.locator('#wa-templates').screenshot({ path: `${OUT}/templates.png` })
} catch (e) {
  ok(false, `aborted: ${e.message.split('\n').slice(0, 12).join(' | ')}`); await p.screenshot({ path: `${OUT}/abort.png`, fullPage: true }).catch(() => {})
}
function formatD(iso) { return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) }
for (const e of jsErrors) ok(false, `JS error ${e}`)
const failed = results.filter(r => !r[0]).length
console.log(`\nWhatsApp suite: ${results.length - failed}/${results.length} passed`)
await browser.close(); await db.end()
process.exit(failed ? 1 : 0)
