// Previous invoices: tax invoices issued before Averiqo, entered with their ORIGINAL number (form and Excel/CSV upload).
// They appear in Tax invoices, receivables, the customer ledger and the unpaid statement; the automatic numbering is
// not used or changed; duplicates and bad rows are refused with a reason; a mistaken entry can be removed.
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import pg from 'pg'

const BASE = process.env.E2E_BASE
const OUT = 'tests/e2e/shots/previous'; fs.mkdirSync(OUT, { recursive: true })
const results = []
const ok = (cond, msg) => { results.push([!!cond, msg]); console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`) }
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
const exe = fs.readdirSync('/opt/pw-browsers').filter(d => d.startsWith('chromium-')).map(d => `/opt/pw-browsers/${d}/chrome-linux/chrome`).find(p => fs.existsSync(p))
const browser = await chromium.launch({ executablePath: exe })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const p = await ctx.newPage()
const jsErrors = []; const watch = pg_ => { pg_.on('pageerror', e => jsErrors.push(`${pg_.url()}: ${e.message}`)); return pg_ }; watch(p)
const settle = async (pg_ = p, ms = 400) => { await pg_.waitForLoadState('networkidle').catch(() => {}); await pg_.waitForTimeout(ms) }
const waitFor = async (fn, ms = 12000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn().catch(() => null); if (v) return v; await new Promise(r => setTimeout(r, 300)) } return null }
const EMAIL = `prev-${Date.now()}@alsaqr.test`
const form = () => p.locator('#add')

try {
  console.log('\n[0] Setup')
  await p.goto(`${BASE}/signup`); await p.getByLabel('Work email').fill(EMAIL); await p.getByLabel('Password').fill('correct-horse-battery'); await p.getByRole('button', { name: 'Create account' }).click()
  await p.waitForURL('**/onboarding'); await p.getByLabel('Company name').fill('Al Saqr Previous Test'); await p.getByLabel('Your full name').fill('Prev Owner'); await p.getByRole('button', { name: 'Create company' }).click(); await p.waitForURL(`${BASE}/`)
  const co = (await one(`select p.company_id from profiles p join auth.users u on u.id=p.id where u.email=$1`, [EMAIL])).company_id
  const gtsc = (await one(`insert into customers(company_id,name) values ($1,'Gulf Technical Safety Training Centre-GTSC') returning id`, [co])).id
  await one(`insert into customers(company_id,name) values ($1,'Falcon Towers LLC') returning id`, [co])
  // one normal Averiqo invoice so the numbering is in use
  await p.goto(`${BASE}/invoices?tab=invoice`); await settle()
  const fmtBefore = JSON.stringify((await db.query(`select doc_type,next_seq,last_year from document_number_formats where company_id=$1 order by doc_type`, [co])).rows)

  console.log('\n[1] Add one previous invoice with its own number')
  ok(await p.getByRole('link', { name: 'Previous invoices' }).isVisible(), '“Previous invoices” on Sales & invoices')
  await p.getByRole('link', { name: 'Previous invoices' }).click(); await p.waitForURL('**/invoices/previous'); await settle()
  await form().getByLabel('Customer *').selectOption(gtsc)
  await form().getByLabel('Invoice number *').fill('ASR-2024-0153'); await form().getByLabel('LPO / reference').fill('LPO-900')
  await form().getByLabel('Invoice date *').fill('2024-03-15'); await form().getByLabel('Amount (AED) *').fill('10500'); await form().getByLabel('Already paid (AED)').fill('4000')
  await form().getByRole('button', { name: 'Save previous invoice' }).click()
  ok(await waitFor(async () => (await form().innerText()).includes('Saved ASR-2024-0153')), 'saved with a clear message')
  const inv = await one(`select id,number,status,total,subtotal,vat_amount,issue_date::text d,due_date::text due,lpo_ref,external_provider from invoices where company_id=$1 and number='ASR-2024-0153'`, [co])
  ok(inv?.number === 'ASR-2024-0153' && inv.external_provider === 'previous' && Number(inv.total) === 10500 && Number(inv.subtotal) === 10000 && Number(inv.vat_amount) === 500, 'kept its own number; 10,000 + VAT 500 = 10,500')
  ok(inv.status === 'partially_paid' && inv.d === '2024-03-15' && !!inv.due && inv.lpo_ref === 'LPO-900', 'issued (partly paid), original date, due date filled in, LPO kept')
  const pay = await one(`select amount,reference,paid_on::text d from payments where invoice_id=$1`, [inv.id])
  ok(Number(pay?.amount) === 4000 && pay.reference === 'Before Averiqo' && pay.d === '2024-03-15', 'the amount already paid is recorded (AED 4,000, “Before Averiqo”)')
  await form().getByLabel('Customer *').selectOption(gtsc); await form().getByLabel('Invoice number *').fill('ASR-2024-0153')
  await form().getByLabel('Invoice date *').fill('2024-04-01'); await form().getByLabel('Amount (AED) *').fill('100'); await form().getByRole('button', { name: 'Save previous invoice' }).click()
  ok(await waitFor(async () => (await form().innerText()).includes('ASR-2024-0153 already exists')), 'the same number twice is refused')
  await form().getByLabel('Customer *').selectOption(gtsc); await form().getByLabel('Invoice number *').fill('ASR-2024-0201')
  await form().getByLabel('Invoice date *').fill('2024-05-02'); await form().getByLabel('Amount (AED) *').fill('2000'); await form().getByLabel('The amount is').selectOption('net')
  await form().getByRole('button', { name: 'Save previous invoice' }).click()
  ok(await waitFor(async () => Number((await one(`select total from invoices where company_id=$1 and number='ASR-2024-0201'`, [co]))?.total) === 2100), 'amount “before VAT” 2,000 → total 2,100')

  console.log('\n[2] Upload from Excel (CSV)')
  const csv = ['Customer,Invoice No,Date,Due date,LPO,Total,Received',
    'gulf technical safety training centre - gtsc,ASR-2023-0090,10/11/2023,,LPO-11,"AED 3,150",0',
    'Falcon Towers LLC,FT-77,2024-01-20,2024-02-19,,5250,5250',
    'Unknown Builders,UB-1,2024-01-01,,,100,0',
    'Falcon Towers LLC,FT-78,not a date,,,100,0',
    'Gulf Technical Safety Training Centre-GTSC,ASR-2024-0153,2024-03-15,,,10500,0',
    'Falcon Towers LLC,FT-79,2024-02-01,,,1200,1500'].join('\n')
  const file = { name: 'old-invoices.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) }
  const up = p.locator('[data-previous-upload]')
  await up.getByLabel('Excel or CSV file of previous invoices').setInputFiles(file)
  await up.getByRole('button', { name: 'Check file' }).click()
  ok(await waitFor(async () => (await up.locator('[data-upload-result="check"]').innerText()).includes('2 of 6 rows ready')), 'check: 2 of 6 rows ready, nothing saved yet')
  const rt = await up.locator('[data-upload-result]').innerText()
  ok(rt.includes('Customer “Unknown Builders” is not in Averiqo') && rt.includes('Invoice date “not a date”') && rt.includes('more than the amount') && rt.includes('ASR-2024-0153'), 'each problem row says why (unknown customer, bad date, paid > amount, number already used)')
  ok(!(await one(`select 1 x from invoices where company_id=$1 and number='FT-77'`, [co])), 'checking saves nothing')
  await up.getByRole('button', { name: 'Save 2 invoices' }).click()
  ok(await waitFor(async () => (await up.locator('[data-upload-result="import"]').innerText()).includes('2 previous invoices saved')), 'upload: 2 previous invoices saved')
  const imp = (await db.query(`select number,status,total,customer_name from invoices where company_id=$1 and number in ('ASR-2023-0090','FT-77') order by number`, [co])).rows
  ok(imp.length === 2 && imp[0].customer_name === 'Gulf Technical Safety Training Centre-GTSC' && Number(imp[0].total) === 3150 && imp[1].status === 'paid', 'GTSC matched by name (any case/spacing); the fully paid one is marked paid')
  await settle(); await p.reload(); await settle()
  ok((await p.locator('[data-previous-list]').innerText()).includes('ASR-2023-0090'), 'listed under “Previous invoices entered”')
  await p.screenshot({ path: `${OUT}/previous-page.png`, fullPage: true })

  console.log('\n[3] Numbering untouched; shows everywhere')
  ok(JSON.stringify((await db.query(`select doc_type,next_seq,last_year from document_number_formats where company_id=$1 order by doc_type`, [co])).rows) === fmtBefore, 'automatic numbering not used or changed')
  await p.goto(`${BASE}/invoices?tab=invoice&q=ASR-2024`); await settle(p, 700)
  ok((await p.locator('main').innerText()).includes('ASR-2024-0153'), 'appears in Tax invoices (searchable)')
  await p.goto(`${BASE}/print/statement/${gtsc}?type=unpaid`); await settle()
  const st = await p.locator('[data-doc="statement-unpaid"]').innerText()
  ok(['ASR-2024-0153', 'ASR-2024-0201', 'ASR-2023-0090', 'LPO-900', '6,500.00'].every(x => st.includes(x)) && /Total due:\s*AED 11,750\.00/.test(st), 'on GTSC’s unpaid statement: 6,500 + 2,100 + 3,150 = AED 11,750.00')
  await p.goto(`${BASE}/invoices/${inv.id}`); await settle(p, 800)
  ok(await p.locator('[data-previous-note]').isVisible(), 'the invoice page says it is a previous invoice')
  await p.goto(`${BASE}/parties/${gtsc}`); await settle()
  ok((await p.getByRole('link', { name: 'Add previous invoice' }).getAttribute('href')) === `/invoices/previous?customer=${gtsc}#add`, 'customer page: Add previous invoice (customer pre-chosen)')

  console.log('\n[4] Remove a mistaken entry')
  await p.goto(`${BASE}/invoices/previous`); await settle()
  p.once('dialog', d => d.accept())
  await p.locator('[data-previous-list] tr', { hasText: 'ASR-2024-0201' }).getByRole('button', { name: /Remove/ }).click()
  ok(await waitFor(async () => !(await one(`select 1 x from invoices where company_id=$1 and number='ASR-2024-0201' and deleted_at is null`, [co]))), 'removed (to the Trash)')
  await form().getByLabel('Customer *').selectOption(gtsc); await form().getByLabel('Invoice number *').fill('ASR-2024-0201')
  await form().getByLabel('Invoice date *').fill('2024-05-02'); await form().getByLabel('Amount (AED) *').fill('2100'); await form().getByRole('button', { name: 'Save previous invoice' }).click()
  ok(await waitFor(async () => !!(await one(`select 1 x from invoices where company_id=$1 and number='ASR-2024-0201' and deleted_at is null`, [co]))), 'its number can be entered again, correctly')

  console.log('\n[5] Phone')
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, storageState: await ctx.storageState() }); const mp = watch(await m.newPage())
  await mp.goto(`${BASE}/invoices/previous`); await settle(mp)
  ok(await mp.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1) && await mp.locator('#add').getByRole('button', { name: 'Save previous invoice' }).isVisible(), 'phone: the page fits, form usable')
  await mp.screenshot({ path: `${OUT}/phone.png`, fullPage: true }); await m.close()
} catch (e) {
  ok(false, `aborted: ${e.message.split('\n').slice(0, 8).join(' | ')}`); await p.screenshot({ path: `${OUT}/abort.png`, fullPage: true }).catch(() => {})
}
for (const e of jsErrors) ok(false, `JS error ${e}`)
const failed = results.filter(r => !r[0]).length
console.log(`\nprevious invoices: ${results.length - failed}/${results.length} passed`)
await browser.close(); await db.end()
process.exit(failed ? 1 : 0)
