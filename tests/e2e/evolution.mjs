// Evolution API e2e (self-hosted WhatsApp Web gateway, stand-in on the test gateway): settings validation, encrypted API key,
// QR linking (instance created with Averiqo's webhook + secret header), Test connection, sending the tax invoice PDF as a
// WhatsApp document with any custom text (no Meta templates / 24-hour window), delivery receipts and read → "Viewed",
// webhook auth and company scoping, STOP opt-out, number not on WhatsApp, phone unlinked → retry, internal test
// notification as plain text, switching back to Meta (sandbox), phone layout.
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import pg from 'pg'

const BASE = process.env.E2E_BASE, GW = process.env.E2E_GATEWAY ?? 'http://127.0.0.1:54399'
const OUT = 'tests/e2e/shots/evolution'; fs.mkdirSync(OUT, { recursive: true })
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
const evo = async () => (await (await fetch(`${GW}/mock/calls`)).json()).evolution
const scan = async (instance, state = 'open') => (await fetch(`${GW}/mock/evolution-scan`, { method: 'POST', body: JSON.stringify({ instance, state }) })).json()
const wa = () => p.locator('dialog[data-wa-dialog][open]')
const openDialog = async btn => { await btn.click(); await waitFor(async () => (await wa().locator('[data-wa-preview]').count()) > 0) }
const send = async () => { await wa().getByRole('button', { name: 'Send' }).click(); return waitFor(async () => { const t = await wa().innerText(); return /Sent to|sandbox mode|Not sent|Not sent yet|opted out/.test(t) ? t : null }, 25000) }
const close = () => wa().getByRole('button', { name: 'Close' }).first().click()
const EMAIL = `evo-${Date.now()}@alsaqr.test`, INSTANCE = `alsaqr-${Date.now().toString(36)}`, KEY = 'e2e-evo-global-key'
const ev = () => p.locator('#evolution')

try {
  console.log('\n[0] Setup')
  await p.goto(`${BASE}/signup`); await p.getByLabel('Work email').fill(EMAIL); await p.getByLabel('Password').fill('correct-horse-battery'); await p.getByRole('button', { name: 'Create account' }).click()
  await p.waitForURL('**/onboarding'); await p.getByLabel('Company name').fill('Al Saqr Evolution Test'); await p.getByLabel('Your full name').fill('Evo Owner'); await p.getByRole('button', { name: 'Create company' }).click(); await p.waitForURL(`${BASE}/`)
  const co = (await one(`select p.company_id from profiles p join auth.users u on u.id=p.id where u.email=$1`, [EMAIL])).company_id
  const cust = (await one(`insert into customers(company_id,name,phone,whatsapp) values ($1,'Falcon Towers LLC','04 555 1234','+971 50 111 2222') returning id`, [co])).id
  const inv = (await one(`insert into invoices(company_id,doc_type,number,customer_id,customer_name,total,status,issue_date,due_date) values ($1,'invoice','INV-E1',$2,'Falcon Towers LLC',10500,'sent',$3,$4) returning id`, [co, cust, day(-20), day(-5)])).id
  await db.query(`insert into invoice_items(company_id,invoice_id,position,description,quantity,unit_price) values ($1,$2,1,'Steel canopy',1,10000)`, [co, inv])
  const rcp = (await one(`insert into notification_recipients(company_id,name,whatsapp_number,channels,whatsapp_opt_in,opted_in_at) values ($1,'Site manager','+971502223333',array['whatsapp'],'opted_in',now()) returning id`, [co])).id
  ok(true, 'seeded a customer with a WhatsApp number, a tax invoice and an opted-in internal recipient')

  console.log('\n[1] Settings: validation, encrypted key')
  await p.goto(`${BASE}/settings#evolution`); await settle()
  ok(await ev().isVisible() && (await ev().innerText()).includes('WhatsApp via Evolution API'), 'the Evolution API card is in Settings')
  ok((await ev().innerText()).includes('Save the server URL, instance name and API key first'), 'linking waits until the server is configured')
  await ev().getByLabel(/Send WhatsApp messages through Evolution API/).check()
  await ev().getByLabel('Server URL').fill(`${GW}/mock/evolution/`); await ev().getByLabel('Instance name').fill('../admin'); await ev().getByLabel('API key').fill(KEY)
  await ev().getByRole('button', { name: 'Save' }).click(); await settle(700)
  ok((await ev().innerText()).includes('Instance name: 2–64 letters'), 'an unsafe instance name is refused')
  await ev().getByLabel('Instance name').fill(INSTANCE); await ev().getByRole('button', { name: 'Save' }).click(); await settle(900)
  ok((await ev().innerText()).includes('WhatsApp messages now go through your Evolution API server'), 'saved')
  const set = Object.fromEntries((await db.query(`select key, value from app_settings where company_id=$1 and key like 'whatsapp.%'`, [co])).rows.map(r => [r.key, r.value]))
  ok(set['whatsapp.provider'] === 'evolution' && set['whatsapp.evolution_url'] === `${GW}/mock/evolution` && set['whatsapp.evolution_instance'] === INSTANCE, 'provider, URL (trailing slash removed) and instance stored')
  const sec = await one(`select ciphertext from integration_secrets where company_id=$1 and name='evolution_api_key'`, [co])
  ok(sec && !sec.ciphertext.includes(KEY), 'API key stored encrypted')
  await p.reload(); await settle()
  ok(!(await p.content()).includes(KEY), 'the API key is never sent back to the browser')
  ok((await ev().innerText()).includes('A key is stored') && (await ev().innerText()).includes('Not linked'), 'card shows a key is stored and the number is not linked yet')

  console.log('\n[2] Link the phone by QR code')
  await ev().getByRole('button', { name: 'Link WhatsApp' }).click()
  ok(await waitFor(async () => (await ev().locator('img[data-evo-qr]').count()) > 0), 'the QR code from the server is shown')
  ok((await ev().innerText()).includes('Linked devices'), 'with step-by-step instructions')
  await ev().screenshot({ path: `${OUT}/qr.png` })
  const create = (await evo()).find(c => c.path === 'instance/create' && c.json?.instanceName === INSTANCE)
  const hookUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://127.0.0.1:3100'}/api/webhooks/evolution/${co}`
  ok(create?.json?.integration === 'WHATSAPP-BAILEYS' && create.json.qrcode === true && create.json.webhook?.url === hookUrl && create.json.webhook.enabled === true
    && /^[0-9a-f]{64}$/.test(create.json.webhook.headers?.['x-averiqo-token'] ?? '') && JSON.stringify(create.json.webhook.events) === JSON.stringify(['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE']), 'instance created with Averiqo’s webhook URL, a secret header and the needed events')
  const TOKEN = create.json.webhook.headers['x-averiqo-token']
  ok(!(await one(`select ciphertext from integration_secrets where company_id=$1 and name='evolution_webhook_secret'`, [co])).ciphertext.includes(TOKEN), 'webhook secret stored encrypted')
  await scan(INSTANCE)
  ok(await waitFor(async () => (await ev().innerText()).includes('WhatsApp is linked'), 15000), 'scanning the code links the phone (detected automatically)')
  await settle(800)
  ok(await waitFor(async () => (await ev().innerText()).includes('Linked · live')), 'card shows Linked · live')
  await ev().getByRole('button', { name: 'Test connection' }).click()
  ok(await waitFor(async () => (await ev().innerText()).includes(`Connected: instance “${INSTANCE}” is linked to WhatsApp.`)), 'Test connection confirms the link')
  await ev().getByRole('button', { name: 'Link WhatsApp' }).count().then(n => ok(n === 0, 'no second link button once linked'))
  ok((await (await ctx.request.get(`${BASE}/reminders`)).text()).includes('Evolution API server'), 'Reminders page says messages go through the Evolution API server')

  console.log('\n[3] Send the tax invoice')
  await p.goto(`${BASE}/invoices/${inv}`); await settle(800)
  await openDialog(p.getByRole('button', { name: 'Send tax invoice via WhatsApp' }))
  const dlg = await wa().innerText()
  ok(dlg.includes('Live') && !dlg.includes('template is') && dlg.includes('PDF attached'), 'dialog: live, PDF attached, no Meta template warning')
  ok(await wa().getByLabel('Write a custom message').count() === 1 && !dlg.includes('last 24 hours'), 'custom message allowed any time (no 24-hour window)')
  let r = await send()
  ok(r?.includes('Sent to +9715 ••• 222'), 'sent')
  let calls = await evo(); let media = calls.filter(c => c.path === `message/sendMedia/${INSTANCE}`).at(-1)
  ok(media?.json?.number === '971501112222' && media.json.mediatype === 'document' && media.json.mimetype === 'application/pdf' && media.json.pdf === '%PDF-' && /\.pdf$/.test(media.json.fileName)
    && media.json.caption.includes('Falcon Towers LLC') && media.json.caption.includes('INV-E1') && media.json.caption.includes('AED 10,500.00'), 'the invoice PDF goes as a WhatsApp document with the message as caption')
  const sent = await one(`select status, provider_message_id from notification_logs where company_id=$1 and kind='invoice' order by created_at desc limit 1`, [co])
  ok(sent?.status === 'sent' && /^3EB0E2E/.test(sent.provider_message_id), 'logged as sent with the WhatsApp message id')
  await close()
  await openDialog(p.getByRole('button', { name: 'Send tax invoice via WhatsApp' }))
  await wa().getByLabel('Write a custom message').check(); await wa().getByRole('textbox', { name: 'Custom message' }).fill('Dear Mr Khalid, invoice attached. EID 784-1990-1234567-6 on file.')
  r = await send(); ok(r?.includes('Sent to'), 'custom message sent without the customer writing first')
  media = (await evo()).filter(c => c.path === `message/sendMedia/${INSTANCE}`).at(-1)
  ok(media?.json?.caption === 'Dear Mr Khalid, invoice attached. EID 784-••••-•••••••-• on file.', 'custom caption sent, ID numbers masked')
  await close()

  console.log('\n[4] Webhook: auth, receipts, read → viewed, scoping')
  const hook = (payload, token = TOKEN, company = co) => fetch(`${BASE}/api/webhooks/evolution/${company}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { 'x-averiqo-token': token } : {}) }, body: JSON.stringify(payload) })
  const upd = (status, id = sent.provider_message_id, instance = INSTANCE) => ({ event: 'messages.update', instance, data: { keyId: id, remoteJid: '971501112222@s.whatsapp.net', fromMe: true, status } })
  ok((await hook(upd('DELIVERY_ACK'), null)).status === 401 && (await hook(upd('DELIVERY_ACK'), 'wrong')).status === 401, 'no token / wrong token: 401')
  ok((await hook(upd('DELIVERY_ACK'), TOKEN, '00000000-0000-0000-0000-000000000000')).status === 401, 'another company id with this token: 401')
  ok((await one(`select count(*)::int n from security_events where detail like 'Evolution webhook%'`)).n >= 2, 'rejected calls are logged as security events')
  await hook(upd('DELIVERY_ACK', sent.provider_message_id, 'someone-else'))
  ok((await one(`select status from notification_logs where provider_message_id=$1`, [sent.provider_message_id])).status === 'sent', 'events for another instance are ignored')
  ok((await hook(upd('DELIVERY_ACK'))).status === 200 && await waitFor(async () => (await one(`select status from notification_logs where provider_message_id=$1`, [sent.provider_message_id])).status === 'delivered'), 'delivery receipt marks it delivered')
  await hook(upd('READ'))
  ok(await waitFor(async () => (await one(`select status from notification_logs where provider_message_id=$1`, [sent.provider_message_id])).status === 'read'), 'read receipt marks it read')
  ok((await one(`select viewed_at from invoices where id=$1`, [inv])).viewed_at, 'the tax invoice counts as viewed by the customer')
  await hook(upd('SERVER_ACK'))
  ok((await one(`select status from notification_logs where provider_message_id=$1`, [sent.provider_message_id])).status === 'read', 'a late "sent" ack never downgrades a read message')
  await p.goto(`${BASE}/parties/${cust}`); await settle()
  ok((await p.locator('[data-wa-history]').innerText()).includes('Read'), 'history under the customer shows Read')

  console.log('\n[5] STOP, number not on WhatsApp, phone unlinked')
  await hook({ event: 'messages.upsert', instance: INSTANCE, data: { key: { remoteJid: '971501112222@s.whatsapp.net', fromMe: false, id: 'IN1' }, message: { conversation: 'STOP' }, messageTimestamp: Math.floor(Date.now() / 1000) } })
  ok((await one(`select opted_out_at from whatsapp_contacts where company_id=$1 and phone='+971501112222'`, [co]))?.opted_out_at, 'STOP reply opts the customer out')
  await p.goto(`${BASE}/invoices/${inv}`); await settle(800)
  await openDialog(p.getByRole('button', { name: 'Send tax invoice via WhatsApp' }))
  ok((await wa().innerText()).includes('opted out') && await wa().getByRole('button', { name: 'Send' }).isDisabled(), 'the dialog blocks sending to an opted-out number')
  await close()
  await hook({ event: 'messages.upsert', instance: INSTANCE, data: { key: { remoteJid: '971501112222@s.whatsapp.net', fromMe: false, id: 'IN2' }, message: { conversation: 'START' }, messageTimestamp: Math.floor(Date.now() / 1000) } })
  ok(!(await one(`select opted_out_at from whatsapp_contacts where company_id=$1 and phone='+971501112222'`, [co])).opted_out_at, 'START opts back in')
  await openDialog(p.getByRole('button', { name: 'Send tax invoice via WhatsApp' }))
  await wa().getByLabel('WhatsApp number').fill('+971501230000'); r = await send()
  ok(r?.includes('Not sent: 971501230000 is not on WhatsApp'), 'a number that is not on WhatsApp: clear error, not retried')
  ok((await one(`select status from notification_logs where company_id=$1 and to_number='+971501230000'`, [co]))?.status === 'failed', 'logged as failed')
  await close()
  await scan(INSTANCE, 'close')
  await openDialog(p.getByRole('button', { name: 'Send tax invoice via WhatsApp' })); r = await send()
  ok(r?.includes('Not sent yet') && r.includes('Connection Closed'), 'phone offline / unlinked: kept for automatic retry with the reason')
  ok((await one(`select status from notification_logs where company_id=$1 order by created_at desc limit 1`, [co])).status === 'retry', 'status retry')
  await close(); await scan(INSTANCE, 'open')

  console.log('\n[6] Internal notifications as plain text')
  await p.goto(`${BASE}/reminders?tab=recipients`); await settle()
  const row = p.locator('tr', { hasText: 'Site manager' })
  await row.getByRole('button', { name: 'whatsapp' }).click(); await settle(1500)
  const tlog = await one(`select status, provider_message_id from notification_logs where company_id=$1 and recipient_id=$2 order by created_at desc limit 1`, [co, rcp])
  const txt = (await evo()).filter(c => c.path === `message/sendText/${INSTANCE}`).at(-1)
  ok(tlog?.status === 'sent' && txt?.json?.number === '971502223333' && txt.json.text.startsWith('AVERIQO TEST') && txt.json.text.includes('Test from Evo Owner'), 'a test notification goes to the site manager as plain WhatsApp text')
  await hook({ event: 'messages.upsert', instance: INSTANCE, data: { key: { remoteJid: '971502223333@s.whatsapp.net', fromMe: false }, message: { conversation: 'stop' } } })
  ok((await one(`select whatsapp_opt_in from notification_recipients where id=$1`, [rcp])).whatsapp_opt_in === 'opted_out', 'STOP from an internal recipient opts them out (this company only)')

  console.log('\n[7] Phone layout')
  const m = await browser.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true, storageState: await ctx.storageState() }); const mp = await m.newPage()
  await mp.goto(`${BASE}/settings#evolution`); await mp.waitForLoadState('networkidle').catch(() => {}); await mp.waitForTimeout(800)
  const fit = await mp.evaluate(() => { const c = document.querySelector('#evolution'); if (!c) return null; return [...c.querySelectorAll('*')].every(e => e.getBoundingClientRect().right <= innerWidth + 1) && document.documentElement.scrollWidth <= innerWidth + 1 })
  ok(fit === true, 'Evolution card fits a 360px phone (no sideways scroll)')
  await mp.locator('#evolution').screenshot({ path: `${OUT}/m-settings.png` }); await m.close()

  console.log('\n[8] Unlink, switch back to Meta')
  await p.goto(`${BASE}/settings#evolution`); await settle()
  await ev().getByRole('button', { name: 'Unlink number' }).click()
  ok(await waitFor(async () => (await ev().getByRole('button', { name: 'Link WhatsApp' }).count()) === 1), 'Unlink logs the number out on the server')
  ok((await evo()).some(c => c.method === 'DELETE' && c.path === `instance/logout/${INSTANCE}`), 'logout called on the server')
  await ev().getByLabel(/Send WhatsApp messages through Evolution API/).uncheck(); await ev().getByRole('button', { name: 'Save' }).click(); await settle(900)
  ok((await one(`select value from app_settings where company_id=$1 and key='whatsapp.provider'`, [co])).value === 'meta', 'switched back to the Meta Cloud API')
  const before = (await evo()).length
  await p.goto(`${BASE}/invoices/${inv}`); await settle(800)
  await openDialog(p.getByRole('button', { name: 'Send tax invoice via WhatsApp' })); r = await send()
  ok(r?.includes('Recorded in sandbox mode') && (await evo()).length === before, 'with Meta not connected: sandbox, nothing goes to the Evolution server')
  await close()
} catch (e) {
  ok(false, `aborted: ${e.message.split('\n').slice(0, 12).join(' | ')}`); await p.screenshot({ path: `${OUT}/abort.png`, fullPage: true }).catch(() => {})
}
for (const e of jsErrors) ok(false, `JS error ${e}`)
const failed = results.filter(r => !r[0]).length
console.log(`\nEvolution suite: ${results.length - failed}/${results.length} passed`)
await browser.close(); await db.end()
process.exit(failed ? 1 : 0)
