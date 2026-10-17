// Quotation → invoice → payment, end to end, on desktop and on a phone: units on every output, document status vs
// payment status, Record payment / Mark as paid / partially paid / unpaid / Cancel, list columns and quick actions.
// Real Next build + PostgREST + Postgres RLS + Chromium. Run via scripts/e2e.sh
import { chromium } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import pg from 'pg'

const BASE = process.env.E2E_BASE
const OUT = 'tests/e2e/shots/payments-status'; fs.mkdirSync(OUT, { recursive: true })
const results = []
const ok = (cond, msg) => { results.push([!!cond, msg]); console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`) }
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
const exe = fs.readdirSync('/opt/pw-browsers').filter(d => d.startsWith('chromium-')).map(d => `/opt/pw-browsers/${d}/chrome-linux/chrome`).find(p => fs.existsSync(p))
const browser = await chromium.launch({ executablePath: exe })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const p = await ctx.newPage()
const jsErrors = []; p.on('pageerror', e => jsErrors.push(`${p.url()}: ${e.message}`)); p.on('dialog', d => d.accept())
const settle = async (ms = 600, page = p) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(ms) }
const dlg = (page = p) => page.locator('dialog[open]')
const menu = async item => { await p.getByRole('button', { name: 'More actions' }).click(); await p.getByRole('menuitem', { name: item }).click() }
const unit = i => p.locator('label:has(> span:text-is("Unit")) select').nth(i)
const panel = (page = p) => page.locator('[data-payment-panel]')
const pay = async (page = p) => (await panel(page).locator('[data-pay-status]').first().getAttribute('data-pay-status').catch(() => null))
const docSt = async (page = p) => (await page.locator('h1 + [aria-label] [data-doc-status], [data-doc-status]').first().getAttribute('data-doc-status'))
const pdfText = async url => { const r = await ctx.request.get(url); const f = `${OUT}/${url.split('/').at(-2)}.pdf`; fs.writeFileSync(f, await r.body()); return execFileSync('pdftotext', ['-layout', f, '-']).toString() }
const EMAIL = `pay-${Date.now()}@alsaqr.test`

try {
  console.log('\n[0] Setup')
  await p.goto(`${BASE}/signup`); await p.getByLabel('Work email').fill(EMAIL); await p.getByLabel('Password').fill('correct-horse-battery'); await p.getByRole('button', { name: 'Create account' }).click()
  await p.waitForURL('**/onboarding'); await p.getByLabel('Company name').fill('Al Saqr Payments Test'); await p.getByLabel('Your full name').fill('Owner'); await p.getByRole('button', { name: 'Create company' }).click(); await p.waitForURL(`${BASE}/`)
  const co = (await one(`select p.company_id from profiles p join auth.users u on u.id=p.id where u.email=$1`, [EMAIL])).company_id
  const cu = (await one(`insert into customers(company_id,name,address,phone) values ($1,'Gulf Towers LLC','Al Barsha, Dubai','+971501234567') returning id`, [co])).id
  ok(true, 'company and customer ready')

  console.log('\n[1] Quotation units: L.S, SQM and a typed unit, saved and shown everywhere')
  await p.goto(`${BASE}/parties/${cu}`); await settle()
  await p.getByRole('button', { name: 'New quotation' }).first().click(); await p.waitForURL(/\/invoices\/[0-9a-f-]{36}$/); await settle()
  const qid = p.url().split('/').pop()
  const opts = await unit(0).locator('option').allInnerTexts()
  ok(['L.S', 'LM', 'SQM', 'PCS', 'KG', 'TON', 'SET', 'LOT'].every(u => opts.includes(u)) && opts.includes('Other…'), `unit list offers L.S, LM, SQM, PCS, KG, TON, SET, LOT and Other… (${opts.length} options)`)
  await p.getByLabel('Line 1 description').fill('Design, fabrication and installation of MS staircase'); await unit(0).selectOption('L.S')
  await p.locator('label:has(> span:text-is("Rate (AED)")) input').nth(0).fill('18000')
  await p.getByRole('button', { name: 'Add line' }).click(); await p.getByLabel('Line 2 description').fill('Cladding panels')
  await p.locator('label:has(> span:text-is("Qty")) input').nth(1).fill('12.5'); await unit(1).selectOption('SQM'); await p.locator('label:has(> span:text-is("Rate (AED)")) input').nth(1).fill('240')
  await p.getByRole('button', { name: 'Add line' }).click(); await p.getByLabel('Line 3 description').fill('Cement for footings')
  await p.locator('label:has(> span:text-is("Qty")) input').nth(2).fill('20'); await unit(2).selectOption('__other__')
  await p.getByLabel('Line 3 unit (type your own)').fill('BAG'); await p.getByLabel('Line 3 unit (type your own)').press('Enter')
  await p.locator('label:has(> span:text-is("Rate (AED)")) input').nth(2).fill('25')
  await p.getByRole('button', { name: 'Save', exact: true }).click(); await settle(1200)
  const saved = (await db.query(`select unit, quantity::float q from invoice_items where invoice_id=$1 order by position`, [qid])).rows
  ok(JSON.stringify(saved.map(r => r.unit)) === '["L.S","SQM","BAG"]', `units saved as chosen: ${saved.map(r => r.unit).join(', ')}`)
  await p.reload(); await settle()
  ok(await unit(0).inputValue() === 'L.S' && await unit(1).inputValue() === 'SQM' && await unit(2).inputValue() === 'BAG', 'editor shows the saved units after reload (incl. the typed one)')
  const prevQty = await p.locator('.sales-paper td[data-qty]').allInnerTexts()
  ok(prevQty.map(t => t.replace(/\s+/g, ' ').trim()).join('|') === '1 L.S|12.5 SQM|20 BAG', `preview: quantity and unit at full size (${prevQty.map(t => t.replace(/\s+/g, ' ')).join(' / ')})`)
  const pr = await ctx.newPage(); await pr.goto(`${BASE}/print/sales/${qid}`); await settle(400, pr)
  ok((await pr.locator('.sales-paper td[data-qty]').allInnerTexts()).map(t => t.replace(/\s+/g, ' ').trim()).join('|') === '1 L.S|12.5 SQM|20 BAG', 'print: same units'); await pr.close()
  const qpdf = await pdfText(`${BASE}/api/sales/${qid}/pdf`)
  ok(/1 L\.S/.test(qpdf) && /12\.5 SQM/.test(qpdf) && /20 BAG/.test(qpdf), 'PDF: "1 L.S", "12.5 SQM", "20 BAG"')

  console.log('\n[2] Convert to a tax invoice; issue it')
  await menu('Mark as sent'); await settle(900)
  await menu('Convert to invoice'); await p.waitForURL(u => !u.href.endsWith(qid)); await settle()
  const iid = p.url().split('/').pop()
  ok(JSON.stringify((await db.query(`select unit from invoice_items where invoice_id=$1 order by position`, [iid])).rows.map(r => r.unit)) === '["L.S","SQM","BAG"]', 'invoice keeps the quotation units')
  ok(await docSt() === 'draft' && !(await p.locator('[data-pay-status]').count()), 'draft invoice: "Draft", no payment status yet')
  await menu('Issue tax invoice'); await settle(1000)
  const total = Number((await one(`select total from invoices where id=$1`, [iid])).total)
  ok(await docSt() === 'sent' && await pay() === 'unpaid', 'issued: "Sent | Unpaid"')
  ok((await p.locator('h1').first().locator('..').innerText()).replace(/\s+/g, ' ').includes('Sent | Unpaid'), 'editor header shows both statuses side by side: "Sent | Unpaid"')
  const fig = await p.locator('[data-payment-figures]').innerText()
  ok(['Invoice total', 'Paid amount', 'Remaining balance', 'Due date', 'Payment status'].every(k => fig.includes(k)), 'payment panel: total, paid, balance, due date, payment status')
  for (const b of ['Record payment', 'Mark as paid', 'Mark partially paid', 'Cancel invoice']) ok(await p.locator('[data-invoice-actions]').getByRole('button', { name: b }).isVisible(), `action visible: ${b}`)
  ok(!(await p.locator('[data-invoice-actions]').getByRole('button', { name: 'Mark as unpaid' }).count()), '"Mark as unpaid" only once something is paid')

  console.log('\n[3] Partial payment → Partially paid')
  await p.locator('[data-invoice-actions]').getByRole('button', { name: 'Mark partially paid' }).click()
  await dlg().getByLabel('Amount (AED) *').fill(String(total)); await dlg().getByRole('button', { name: 'Save part payment' }).click(); await settle(800)
  ok(await dlg().isVisible() && (await one(`select count(*)::int n from payments where invoice_id=$1`, [iid])).n === 0 && await dlg().getByLabel('Amount (AED) *').evaluate(el => !el.checkValidity()), 'partial payment of the whole balance is refused (field limit; the server refuses it too)')
  await dlg().locator('form').evaluate(f => { f.noValidate = true }); await dlg().getByRole('button', { name: 'Save part payment' }).click(); await settle(900)
  ok((await dlg().innerText()).includes('is the whole balance') && (await one(`select count(*)::int n from payments where invoice_id=$1`, [iid])).n === 0, 'the server refuses it as well (bypassing the browser check): "use Mark as paid"')
  await dlg().getByLabel('Amount (AED) *').fill('5000'); await dlg().getByLabel('Reference').fill('TT-7781'); await dlg().getByLabel('Payment method *').selectOption('bank_transfer')
  await dlg().getByRole('button', { name: 'Save part payment' }).click(); await settle(1200)
  ok(await pay() === 'partially_paid', 'payment status → Partially paid')
  const hist = await p.locator('[data-payment-history]').innerText()
  ok(hist.includes('5,000.00') && hist.includes('TT-7781') && hist.includes('Bank transfer') && hist.includes(new Date().getFullYear().toString()), 'payment history: date, amount, method, reference')
  ok((await p.locator('[data-payment-figures]').innerText()).includes('5,000.00'), 'paid amount updated')
  ok(await docSt() === 'sent', 'document status stays "Sent" (not mixed with payment)')

  console.log('\n[4] Mark as paid → Paid (a real payment of the balance)')
  await p.locator('[data-invoice-actions]').getByRole('button', { name: 'Mark as paid' }).click()
  ok((await dlg().innerText()).includes(`AED ${(total - 5000).toLocaleString('en-US', { minimumFractionDigits: 2 })}`), 'Mark as paid shows the exact balance to be recorded')
  await dlg().getByLabel('Payment method *').selectOption('cheque'); await dlg().getByLabel('Reference').fill('CHQ 004512')
  await dlg().getByRole('button', { name: /and mark as paid/ }).click(); await settle(1200)
  ok(await pay() === 'paid', 'payment status → Paid')
  const sums = await one(`select count(*)::int n, sum(amount)::float s from payments where invoice_id=$1`, [iid])
  ok(sums.n === 2 && Math.abs(sums.s - total) < 0.005, `Paid only with recorded payments: ${sums.n} payments = AED ${sums.s} (invoice ${total})`)
  ok(!(await p.locator('[data-invoice-actions]').getByRole('button', { name: 'Record payment' }).count()) && await p.locator('[data-invoice-actions]').getByRole('button', { name: 'Mark as unpaid' }).isVisible(), 'paid: no more Record payment; Mark as unpaid offered')
  ok(!(await p.locator('[data-invoice-actions]').getByRole('button', { name: 'Cancel invoice' }).count()), 'an invoice with payments cannot be cancelled')

  console.log('\n[5] Mark as unpaid (money kept as customer credit)')
  await p.locator('[data-invoice-actions]').getByRole('button', { name: 'Mark as unpaid' }).click()
  await dlg().getByRole('button', { name: 'Mark as unpaid' }).click(); await settle(500)
  ok(await dlg().isVisible(), 'a reason is required')
  await dlg().getByLabel('Reason *').fill('Cheque bounced'); await dlg().getByRole('button', { name: 'Mark as unpaid' }).click(); await settle(1200)
  ok(await pay() === 'unpaid', 'payment status → Unpaid')
  const kept = await one(`select count(*)::int n, sum(amount)::float s, bool_and(notes like '%Cheque bounced%') why from payments where customer_id=$1 and invoice_id is null`, [cu])
  ok(kept.n === 2 && Math.abs(kept.s - total) < 0.005 && kept.why, 'no payment deleted: both kept on account for the customer, with the reason')
  ok((await one(`select count(*)::int n from sales_doc_events where invoice_id=$1 and detail like 'Marked as unpaid%'`, [iid])).n === 1, 'logged in the invoice history')
  await p.goto(`${BASE}/invoices?tab=payments`); await settle()
  ok((await p.locator('main').innerText()).includes('On account (not applied)') && (await p.locator('main').innerText()).includes('Gulf Towers LLC'), 'Payments tab: shown as on account, with the customer')

  console.log('\n[6] Invoice list: columns, statuses, filters, quick actions')
  await one(`update invoices set due_date = current_date - 3 where id=$1`, [iid])
  await p.goto(`${BASE}/invoices?tab=invoice`); await settle()
  const heads = await p.locator('table thead th').allInnerTexts()
  ok(['Invoice status', 'Payment status', 'Total (AED)', 'Paid', 'Balance', 'Due date'].every(h => heads.some(x => x.includes(h))), `list columns: ${heads.filter(Boolean).join(' · ')}`)
  const row = p.locator(`tr[data-invoice-row]`).first()
  ok(await row.locator('[data-doc-status="sent"]').count() === 1 && await row.locator('[data-pay-status="overdue"]').count() === 1, 'row: "Sent" and "Overdue" in separate columns')
  ok(await row.locator('[data-pay-status="overdue"].due-pulse').count() === 1, 'overdue badge has the subtle pulse (finite, not blinking)')
  ok(/\d+ days late/.test(await row.innerText()), 'due date column shows days late')
  await p.goto(`${BASE}/invoices?tab=invoice&view=overdue`); await settle()
  ok(await p.locator('tr[data-invoice-row]').count() === 1, 'Overdue filter lists it')
  await p.goto(`${BASE}/invoices?tab=invoice&view=paid`); await settle()
  ok(await p.locator('tr[data-invoice-row]').count() === 0, 'Paid filter: nothing (no payments on it now)')
  await p.goto(`${BASE}/invoices?tab=invoice`); await settle()
  await p.getByRole('button', { name: /^Actions for / }).first().click()
  const items = await p.getByRole('menuitem').allInnerTexts()
  ok(['Open', 'Record payment', 'Mark as paid', 'Download PDF', 'Send via WhatsApp', 'Print', 'Mark as partially paid'].every(x => items.includes(x)), `quick actions: ${items.join(' · ')}`)
  await p.getByRole('menuitem', { name: 'Record payment' }).click()
  await dlg().getByLabel('Amount (AED) *').fill('1000'); await dlg().getByLabel('Payment method *').selectOption('cash'); await dlg().getByRole('button', { name: 'Save payment' }).click(); await settle(1200)
  ok(await p.locator('tr[data-invoice-row]').first().locator('[data-pay-status="overdue"]').count() === 1 && (await p.locator('tr[data-invoice-row]').first().innerText()).includes('1,000.00'), 'payment recorded from the list; still overdue (balance left)')
  await p.getByRole('button', { name: /^Actions for / }).first().click(); await p.getByRole('menuitem', { name: 'Open' }).click(); await p.waitForURL(`**/invoices/${iid}`); await settle()
  ok(await pay() === 'overdue', 'Open goes to the invoice')
  await p.locator('[data-invoice-actions]').getByRole('button', { name: 'Mark as viewed' }).click(); await settle(1000)
  ok(await docSt() === 'viewed', 'Mark as viewed → document status "Viewed" (payment status unchanged)')

  console.log('\n[7] Cancel (an unpaid draft invoice)')
  const c2 = (await one(`insert into invoices(company_id,doc_type,number,status,total,subtotal,vat_amount,customer_id,customer_name,due_date) values ($1,'invoice','INV-PAY-CANCEL','sent',500,476.19,23.81,$2,'Gulf Towers LLC',current_date+30) returning id`, [co, cu])).id
  await db.query(`insert into invoice_items(company_id,invoice_id,position,description,quantity,unit,unit_price) values ($1,$2,0,'Small job',1,'L.S',476.19)`, [co, c2])
  await p.goto(`${BASE}/invoices/${c2}`); await settle()
  await p.locator('[data-invoice-actions]').getByRole('button', { name: 'Cancel invoice' }).click()
  await dlg().getByRole('button', { name: 'Cancel invoice' }).click(); await settle(1200)
  ok((await one(`select status from invoices where id=$1`, [c2])).status === 'cancelled' && await docSt() === 'cancelled' && !(await panel().locator('[data-pay-status]').count()), 'cancelled: "Cancelled", no payment status, no payment actions')

  console.log('\n[8] Customer profile and project')
  await p.goto(`${BASE}/parties/${cu}`); await settle()
  ok(await p.locator('main [data-doc-status]').count() >= 1 && await p.locator('main [data-pay-status="overdue"]').count() >= 1, 'customer profile: invoices show both statuses')

  console.log('\n[9] Phone (390 px)')
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }); const mp = await m.newPage()
  mp.on('pageerror', e => jsErrors.push(`${mp.url()}: ${e.message}`))
  await mp.goto(`${BASE}/login`); await mp.getByLabel('Email').fill(EMAIL); await mp.getByLabel('Password').fill('correct-horse-battery'); await mp.getByRole('button', { name: 'Sign in' }).click(); await mp.waitForURL(`${BASE}/`)
  await mp.goto(`${BASE}/invoices?tab=invoice`); await settle(600, mp)
  const invNo = (await one(`select number from invoices where id=$1`, [iid])).number
  const cardRow = mp.locator('li', { has: mp.locator('[data-invoice-card]') }).filter({ hasText: invNo }).first(), card = cardRow.locator('[data-invoice-card]')
  ok(await card.isVisible() && await card.locator('[data-doc-status]').isVisible() && await card.locator('[data-pay-status]').isVisible(), 'invoice card: amount, balance due and both statuses visible')
  await mp.screenshot({ path: `${OUT}/m-list.png`, fullPage: true })
  await cardRow.getByRole('button', { name: `Actions for ${invNo}` }).tap(); await mp.waitForTimeout(300)
  const mItems = mp.getByRole('menuitem'), box = await mItems.first().boundingBox()
  ok(await mItems.count() >= 7 && box && box.height >= 44, `card ⋯ menu: ${await mItems.count()} actions, ${Math.round(box?.height ?? 0)} px tall (tap size)`)
  await mp.keyboard.press('Escape')
  await mp.goto(`${BASE}/invoices/${iid}`); await settle(600, mp)
  ok(await mp.locator('[data-pay-jump]').isVisible(), 'invoice on a phone: "Payment" button in the bottom bar')
  await mp.locator('[data-pay-jump]').tap(); await mp.waitForTimeout(600)
  const acts = mp.locator('[data-invoice-actions]')
  ok(await acts.getByRole('button', { name: 'Record payment' }).isVisible() && await acts.getByRole('button', { name: 'Mark as paid' }).isVisible(), 'payment actions are on screen after the jump')
  const bb = await acts.getByRole('button', { name: 'Record payment' }).boundingBox()
  ok(bb && bb.height >= 44, `payment buttons are thumb-sized (${Math.round(bb?.height ?? 0)} px)`)
  await acts.getByRole('button', { name: 'Mark as paid' }).tap()
  await dlg(mp).getByRole('button', { name: /and mark as paid/ }).tap(); await settle(1200, mp)
  ok(await pay(mp) === 'paid', 'Mark as paid on the phone → Paid')
  await mp.screenshot({ path: `${OUT}/m-invoice.png`, fullPage: true })
  for (const w of [360, 390]) {
    await mp.setViewportSize({ width: w, height: 800 })
    for (const u of ['/invoices?tab=invoice', `/invoices/${iid}`]) { await mp.goto(BASE + u); await settle(400, mp); ok(await mp.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${w}px ${u}: no horizontal overflow`) }
  }
  await m.close()

  ok(!jsErrors.length, `no JavaScript errors${jsErrors.length ? ': ' + jsErrors.slice(0, 3).join(' | ') : ''}`)
} catch (e) {
  ok(false, `suite aborted: ${(e).message.split('\n')[0]}`); console.log(e)
  await p.screenshot({ path: `${OUT}/abort.png`, fullPage: true }).catch(() => {})
} finally {
  await browser.close(); await db.end()
  const failed = results.filter(r => !r[0])
  console.log(`\nPayments & status suite: ${results.length - failed.length}/${results.length} passed`)
  if (failed.length) { console.log('FAILED:\n' + failed.map(f => ' - ' + f[1]).join('\n')); process.exitCode = 1 }
}
