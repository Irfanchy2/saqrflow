// Stock (items, receipts, issues to jobs, reorder levels, adjustments) and bank accounts (balances from payments,
// expenses, transfers and manual entries), end to end on desktop and a phone.
// Real Next build + PostgREST + Postgres RLS + Chromium. Run via scripts/e2e.sh
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import pg from 'pg'
import { navText } from './nav.mjs'

const BASE = process.env.E2E_BASE
const OUT = 'tests/e2e/shots/stock-bank'; fs.mkdirSync(OUT, { recursive: true })
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
const save = async name => { await dlg().getByRole('button', { name, exact: true }).click(); await settle(900) }
const toast = () => p.locator('[role=status], [role=alert]').allInnerTexts().then(t => t.join(' | '))
const main = () => p.locator('main').innerText()
const EMAIL = `stock-${Date.now()}@alsaqr.test`

try {
  console.log('\n[0] Setup')
  await p.goto(`${BASE}/signup`); await p.getByLabel('Work email').fill(EMAIL); await p.getByLabel('Password').fill('correct-horse-battery'); await p.getByRole('button', { name: 'Create account' }).click()
  await p.waitForURL('**/onboarding'); await p.getByLabel('Company name').fill('Al Saqr Stock Test'); await p.getByLabel('Your full name').fill('Owner'); await p.getByRole('button', { name: 'Create company' }).click(); await p.waitForURL(`${BASE}/`)
  const co = (await one(`select p.company_id from profiles p join auth.users u on u.id=p.id where u.email=$1`, [EMAIL])).company_id
  const cu = (await one(`insert into customers(company_id,name) values ($1,'Gulf Towers LLC') returning id`, [co])).id
  const proj = (await one(`insert into projects(company_id,name,customer_id,status) values ($1,'Villa 12 staircase',$2,'active') returning id`, [co, cu])).id
  const sup = (await one(`insert into suppliers(company_id,name) values ($1,'Emirates Steel Trading') returning id`, [co])).id
  // a bank name taken from a customer's cheque before accounts existed: must not turn into an account
  await one(`insert into banks(company_id,name,account_display_name) values ($1,'ADCB','') returning id`, [co])
  const nav = await navText(p)
  ok(/STOCK[\s\S]*Stock movements/.test(nav) && nav.includes('Bank accounts'), 'navigation: Stock tab (items, movements) and Bank accounts under Finance')

  console.log('\n[1] Stock items and movements')
  await p.goto(`${BASE}/stock`); await settle()
  ok((await main()).includes('No stock items yet'), 'empty stock explains what to add')
  await p.goto(`${BASE}/stock?new=stock_item`); await settle()
  await dlg().getByLabel('Item name *').fill('MS Plate 6mm 1250×2500'); await dlg().getByLabel('Code / SKU').fill('MSP-06'); await dlg().getByLabel('Category').fill('Plates')
  await dlg().getByLabel('Unit *').fill('Sheet'); await dlg().getByLabel('Reorder level').fill('8'); await dlg().getByLabel('Opening quantity').fill('20'); await dlg().getByLabel('Cost per unit (AED)').fill('100')
  await save('Add item')
  const item = await one(`select * from stock_items where company_id=$1 and name like 'MS Plate%'`, [co])
  ok(item && Number(item.on_hand) === 20 && Number(item.avg_cost) === 100, `item added with opening stock 20 @ AED 100 (on hand ${item?.on_hand})`)
  await p.goto(`${BASE}/stock?new=stock_item`); await settle()
  await dlg().getByLabel('Item name *').fill('MS Plate 6mm 1250×2500'); await save('Add item')
  ok((await dlg().innerText().catch(() => '') + await toast()).includes('already in stock'), 'a duplicate item name is refused with a clear message')
  await p.keyboard.press('Escape')

  await p.goto(`${BASE}/stock`); await settle()
  await p.getByRole('button', { name: 'Receive stock' }).click(); await settle(300)
  await dlg().getByLabel('Item *').selectOption(item.id); await dlg().getByLabel('Quantity *').fill('10'); await dlg().getByLabel('Cost per unit (AED)').fill('130')
  await dlg().locator('select[name=supplier_id]').selectOption(sup); await dlg().getByLabel('Supplier invoice / DN / PO no.').fill('EST-5541')
  await save('Receive')
  let it = await one(`select on_hand, avg_cost from stock_items where id=$1`, [item.id])
  ok(Number(it.on_hand) === 30 && Number(it.avg_cost) === 110, `receipt: 30 on hand, weighted average cost AED 110 (${it.avg_cost})`)
  const rec = await one(`select * from stock_movements where item_id=$1 and kind='receipt'`, [item.id])
  ok(rec?.supplier_name === 'Emirates Steel Trading' && rec.reference === 'EST-5541', 'receipt keeps the supplier and their invoice number')

  await p.getByRole('button', { name: 'Issue to job' }).click(); await settle(300)
  await dlg().getByLabel('Item *').selectOption(item.id); await dlg().getByLabel('Quantity *').fill('25'); await dlg().getByLabel('Project').selectOption(proj)
  await save('Issue')
  it = await one(`select on_hand from stock_items where id=$1`, [item.id])
  const iss = await one(`select * from stock_movements where item_id=$1 and kind='issue'`, [item.id])
  ok(Number(it.on_hand) === 5 && Number(iss?.qty) === -25 && iss.project_id === proj && Number(iss.unit_cost) === 110, 'issue to the project: 5 left, costed at the average (AED 110)')
  await settle(300)
  ok(/Running low\s*1/.test(await main()) && (await main()).includes('5 Sheet · low'), 'at or below the reorder level the item shows as running low')

  await p.getByRole('button', { name: 'Issue to job' }).click(); await settle(300)
  await dlg().getByLabel('Item *').selectOption(item.id); await dlg().getByLabel('Quantity *').fill('9'); await save('Issue')
  ok((await dlg().innerText().catch(() => '') + await toast()).includes('Not enough stock: 5 Sheet on hand'), 'issuing more than on hand is refused (5 Sheet on hand)')
  ok(Number((await one(`select on_hand from stock_items where id=$1`, [item.id])).on_hand) === 5, 'the refused issue changed nothing')
  await p.keyboard.press('Escape')

  await p.getByRole('button', { name: /Adjust count of MS Plate/ }).click(); await settle(300)
  await dlg().getByLabel('Direction *').selectOption('out'); await dlg().getByLabel('Quantity *').fill('1'); await dlg().getByLabel('Reason *').fill('Stock take: 1 sheet damaged')
  await save('Save adjustment')
  ok(Number((await one(`select on_hand from stock_items where id=$1`, [item.id])).on_hand) === 4, 'adjustment after a count: 4 on hand')

  await p.goto(`${BASE}/stock?tab=movements&item=${item.id}`); await settle()
  const mv = await main()
  ok(['Opening', 'Received', 'Issued', 'Adjusted', 'Villa 12 staircase', 'EST-5541'].every(s => mv.includes(s)), 'movements list every step, with the job and the supplier reference')
  ok(await p.locator('nav[aria-label="Section"] a[aria-current="page"]').innerText() === 'Stock movements', 'section tab: Stock movements is current')
  await p.screenshot({ path: `${OUT}/movements.png`, fullPage: true })

  console.log('\n[2] Bank accounts')
  await p.goto(`${BASE}/parties/${cu}/ledger`); await settle()
  await p.getByRole('button', { name: 'Payment on account' }).click(); await settle(500)
  ok(!(await dlg().getByLabel('Deposited to').count()), 'without accounts, payment forms are unchanged (no “Deposited to”)')
  await p.keyboard.press('Escape')

  await p.goto(`${BASE}/banking`); await settle()
  ok((await main()).includes('No accounts yet'), 'empty banking explains how balances work')
  await p.goto(`${BASE}/banking?new=bank_account`); await settle()
  await dlg().getByLabel('Bank *').fill('Emirates NBD'); await dlg().getByLabel('Label').fill('Current ••4417'); await dlg().getByLabel('Opening balance (AED)').fill('10000')
  await dlg().getByLabel('Default account for new payments').check(); await save('Add account')
  await p.goto(`${BASE}/banking?new=bank_account`); await settle()
  await dlg().getByLabel('Bank *').fill('Petty cash'); await dlg().getByLabel('Type *').selectOption('cash'); await dlg().getByLabel('Opening balance (AED)').fill('500'); await save('Add account')
  await p.goto(`${BASE}/banking?new=bank_account`); await settle()
  await dlg().getByLabel('Bank *').fill('Mashreq'); await dlg().getByLabel('Label').fill('Current 0123456789012'); await save('Add account')
  ok((await dlg().innerText().catch(() => '') + await toast()).includes('Never store full account numbers'), 'a full account number in the label is refused')
  await p.keyboard.press('Escape')
  const enbd = await one(`select * from banks where company_id=$1 and name='Emirates NBD'`, [co]), cash = await one(`select * from banks where company_id=$1 and name='Petty cash'`, [co])
  ok(enbd?.is_account && enbd.is_default && cash?.account_type === 'cash', 'accounts saved: ENBD (default) and petty cash')
  ok(!(await one(`select is_account from banks where company_id=$1 and name='ADCB'`, [co])).is_account, 'the cheque bank name stays a plain bank name')

  await p.goto(`${BASE}/parties/${cu}/ledger`); await settle()
  await p.getByRole('button', { name: 'Payment on account' }).click(); await settle(800)
  ok(await dlg().getByLabel('Deposited to').inputValue() === enbd.id, '“Deposited to” offers the accounts and starts on the default one')
  await dlg().getByLabel('Amount (AED) *').fill('2500'); await dlg().getByLabel('Reference').fill('TT-8812'); await save('Save payment')

  await p.goto(`${BASE}/expenses?new=expense`); await settle(800)
  await dlg().getByLabel('Category *').selectOption('fuel'); await dlg().getByLabel('Description *').fill('Diesel for pickup'); await dlg().getByLabel('Amount excl. VAT (AED) *').fill('150')
  await dlg().getByLabel('Paid from').selectOption(cash.id); await save('Save expense')

  await p.goto(`${BASE}/banking`); await settle()
  await p.getByRole('button', { name: 'Transfer' }).click(); await settle(300)
  await dlg().getByLabel('From *').selectOption(enbd.id); await dlg().getByLabel('To *').selectOption(cash.id); await dlg().getByLabel('Amount (AED) *').fill('1000'); await save('Transfer')
  await p.getByRole('button', { name: 'Record entry' }).click(); await settle(300)
  await dlg().getByLabel('Type *').selectOption('fee'); await dlg().getByLabel('Amount (AED) *').fill('26.25'); await dlg().getByLabel('Description').fill('Monthly account fee'); await save('Save entry')
  const bal = async id => Number((await one(`select balance from bank_balances where id=$1`, [id])).balance)
  ok(await bal(enbd.id) === 10000 + 2500 - 1000 - 26.25, `ENBD: 10,000 + 2,500 payment − 1,000 transfer − 26.25 fee = ${await bal(enbd.id)}`)
  ok(await bal(cash.id) === 500 - 150 + 1000, `petty cash: 500 − 150 diesel + 1,000 transfer = ${await bal(cash.id)}`)
  await settle(200); await p.reload(); await settle()
  const bk = await main()
  ok(bk.includes('Cash on hand') && bk.includes('12,823.75'), 'Cash on hand shows the total of all accounts (AED 12,823.75)')
  ok(['Payment received', 'Expense', 'Transfer out', 'Transfer in', 'Bank fee', 'TT-8812'].every(s => bk.includes(s)), 'the ledger lists payment, expense, both transfer legs and the fee')
  await p.screenshot({ path: `${OUT}/banking.png`, fullPage: true })

  const pay = await one(`select id from payments where company_id=$1 and reference='TT-8812'`, [co])
  await db.query(`update payments set amount=3000 where id=$1`, [pay.id])
  ok(await bal(enbd.id) === 11973.75, 'changing the payment amount moves the balance with it')
  await p.locator('tr', { hasText: 'Transfer to Petty cash' }).getByRole('button', { name: 'Remove entry' }).click(); await settle(900)
  ok(await bal(enbd.id) === 12973.75 && await bal(cash.id) === 350, `removing a transfer removes both legs (ENBD ${await bal(enbd.id)}, petty cash ${await bal(cash.id)})`)
  ok(!(await p.locator('tr', { hasText: 'TT-8812' }).getByRole('button', { name: 'Remove entry' }).count()), 'entries from payments cannot be removed here (changed at the payment)')

  console.log('\n[3] Phone')
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: await ctx.storageState(), isMobile: true, hasTouch: true }), mp = await m.newPage()
  mp.on('pageerror', e => jsErrors.push(`${mp.url()}: ${e.message}`))
  for (const u of ['/stock', '/stock?tab=movements', '/banking']) {
    await mp.goto(BASE + u); await settle(500, mp)
    ok(await mp.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `390px ${u}: no horizontal overflow`)
  }
  await mp.screenshot({ path: `${OUT}/m-banking.png`, fullPage: true })
  await m.close()

  ok(!jsErrors.length, `no JavaScript errors${jsErrors.length ? ': ' + jsErrors.slice(0, 3).join(' | ') : ''}`)
} catch (e) {
  ok(false, `suite aborted: ${(e).message.split('\n')[0]}`); console.log(e)
  await p.screenshot({ path: `${OUT}/abort.png`, fullPage: true }).catch(() => {})
} finally {
  await browser.close(); await db.end()
  const failed = results.filter(r => !r[0])
  console.log(`\nStock & bank suite: ${results.length - failed.length}/${results.length} passed`)
  if (failed.length) { console.log('FAILED:\n' + failed.map(f => ' - ' + f[1]).join('\n')); process.exitCode = 1 }
}
