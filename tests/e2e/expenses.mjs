// Expenses: manual entry with supplier linking and duplicate-bill check, receipt scanning (camera / upload → OCR + AI →
// review → save only after confirming), the Tally export (validation report, ledger mapping, XML batch, locking, undo),
// review sheets, permissions and the phone layout. Also the invoice editor's "Show payment terms" switch.
// Real Next build + PostgREST + Postgres RLS + Chromium. Run via scripts/e2e.sh
import { chromium } from 'playwright-core'
import crypto from 'node:crypto'
import fs from 'node:fs'
import pg from 'pg'
import { createRequire } from 'node:module'
const sharp = createRequire(import.meta.url)('sharp')

const BASE = process.env.E2E_BASE, GW = process.env.E2E_GATEWAY
const OUT = 'tests/e2e/shots/expenses'; fs.mkdirSync(OUT, { recursive: true })
const results = []
const ok = (cond, msg) => { results.push([!!cond, msg]); console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`) }
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
const exe = fs.readdirSync('/opt/pw-browsers').filter(d => d.startsWith('chromium-')).map(d => `/opt/pw-browsers/${d}/chrome-linux/chrome`).find(p => fs.existsSync(p))
const browser = await chromium.launch({ executablePath: exe })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true }); const p = await ctx.newPage()
const jsErrors = []; p.on('pageerror', e => jsErrors.push(`${p.url()}: ${e.message}`)); p.on('dialog', d => d.accept())
const settle = async (ms = 600, page = p) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(ms) }
const dlg = (page = p) => page.locator('dialog[open]')
const toasts = () => p.locator('[role=status], [role=alert]').allInnerTexts().then(t => t.join(' | '))
const fixtures = o => fetch(`${GW}/mock/fixtures`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(o) })
const calls = async () => (await fetch(`${GW}/mock/calls`)).json()
const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
const png = tag => Buffer.concat([PNG1, Buffer.from(`averiqo-${tag}-${Date.now()}`)])   // same image, different bytes → its own OCR fixture
const sha = b => crypto.createHash('sha256').update(b).digest('hex')
const EMAIL = `exp-${Date.now()}@alsaqr.test`, yr = new Date().getFullYear()

const RECEIPT = `AL FAHIM BUILDING MATERIALS L.L.C
P.O. Box 1234, Musaffah, Abu Dhabi
TRN: 100234567800003
TAX INVOICE
Invoice No: INV-55821
Invoice Date: 03/10/${yr}
1. MS Hollow Section 100x50x3 40 pcs 80.00 3,200.00
2. Welding rods E6013 2.5mm 5 box 64.00 320.00
Subtotal 3,520.00
VAT 5% 176.00
Grand Total AED 3,696.00`

try {
  console.log('\n[0] Setup')
  await p.goto(`${BASE}/signup`); await p.getByLabel('Work email').fill(EMAIL); await p.getByLabel('Password').fill('correct-horse-battery'); await p.getByRole('button', { name: 'Create account' }).click()
  await p.waitForURL('**/onboarding'); await p.getByLabel('Company name').fill('Al Saqr Expenses Test'); await p.getByLabel('Your full name').fill('Owner'); await p.getByRole('button', { name: 'Create company' }).click(); await p.waitForURL(`${BASE}/`)
  const co = (await one(`select p.company_id from profiles p join auth.users u on u.id=p.id where u.email=$1`, [EMAIL])).company_id
  const legacy = (await one(`insert into project_expenses(company_id,category,description,amount,vat_amount,supplier_name,spent_on) values ($1,'fuel','Diesel (entered last year)',100,5,'ADNOC',$2) returning id`, [co, `${yr}-01-05`])).id

  console.log('\n[1] Manual entry: supplier saved and linked, unpaid bill, VAT from the rate')
  await p.goto(`${BASE}/expenses?new=expense`); await settle()
  await dlg().locator('input[name=supplier_name]').fill('Gulf Steel Trading LLC'); await dlg().getByLabel('Supplier TRN').fill('100 3456 7890 0003')
  await dlg().getByLabel('Invoice / receipt no.').fill('GST-1001'); await dlg().getByLabel('Description *').fill('Steel plates 6mm')
  await dlg().getByLabel('Amount excl. VAT (AED) *').fill('1000')
  ok((await dlg().locator('[data-total]').innerText()).includes('1,050.00'), 'VAT 5% worked out from the amount: total AED 1,050.00 shown live')
  await dlg().getByText('Unpaid (owed to supplier)').click()
  await dlg().getByRole('button', { name: 'Save expense' }).click(); await settle(1200)
  const e1 = await one(`select e.*, s.name sname, s.trn strn from project_expenses e left join suppliers s on s.id=e.supplier_id where e.company_id=$1 and e.reference='GST-1001'`, [co])
  ok(e1 && e1.sname === 'Gulf Steel Trading LLC' && e1.strn === '100345678900003' && e1.supplier_trn === '100345678900003', 'new supplier saved with its TRN and linked to the expense')
  ok(e1 && Number(e1.vat_amount) === 50 && Number(e1.vat_rate) === 5 && e1.payment_status === 'unpaid' && e1.payment_method === 'credit' && e1.paid_from_bank_id === null, 'unpaid bill: VAT 50.00 at 5%, booked on credit, no bank account touched')
  ok(e1 && e1.verified_at && e1.source === 'manual', 'saved by hand = checked by the person who saved it')

  console.log('\n[2] Duplicate bill: same supplier, same number written differently')
  await p.goto(`${BASE}/expenses?new=expense`); await settle()
  await dlg().locator('input[name=supplier_name]').fill('GULF STEEL TRADING L.L.C'); await dlg().getByLabel('Invoice / receipt no.').fill('gst 1001'); await dlg().getByLabel('Description *').fill('Steel plates again')
  await dlg().getByLabel('Amount excl. VAT (AED) *').fill('1000'); await dlg().getByRole('button', { name: 'Save expense' }).click(); await settle(1000)
  ok(/already saved/.test(await dlg().innerText()) && (await one(`select count(*)::int n from project_expenses where company_id=$1 and lower(reference) like '%1001'`, [co])).n === 1, 'refused: “Gulf Steel Trading LLC bill GST-1001 is already saved”')
  ok(await dlg().getByText('This is a different bill with the same number: save anyway').isVisible(), '“save anyway” appears for a genuinely different bill')
  ok((await one(`select count(*)::int n from suppliers where company_id=$1`, [co])).n === 1, 'the same supplier was matched (no second “L.L.C” supplier)')
  await p.keyboard.press('Escape'); await settle(300)

  console.log('\n[3] Scan a receipt the OCR misread: Google AI checks the photo, nothing saved until confirmed')
  const img = png('receipt'), geminiBefore = (await calls()).gemini.length
  await fixtures({ ocr: { [sha(img)]: RECEIPT.replace('Grand Total AED 3,696.00', 'Grand Total AED 3,896.00') }, gemini: [{ needle: 'INV-55821', response: { supplier: 'Al Fahim Building Materials LLC', trn: '100234567800003', invoice_no: 'INV-55821', date: `${yr}-10-03`, subtotal: 3520, vat: 176, total: 3696, lines: [{ description: 'MS Hollow Section 100x50x3', quantity: 40, unit_price: 80, amount: 3200 }, { description: 'Welding rods E6013 2.5mm', quantity: 5, unit_price: 64, amount: 320 }] } }] })
  await p.goto(`${BASE}/expenses`); await settle()
  await p.locator('input[data-scan-upload]').setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: img })
  await dlg().locator('[data-scan-done]').waitFor({ timeout: 20000 }); await settle(300)
  const d = dlg(); await d.screenshot({ path: `${OUT}/scan-review.png` })
  ok(await d.locator('input[name=supplier_name]').inputValue() === 'AL FAHIM BUILDING MATERIALS L.L.C' && await d.getByLabel('Supplier TRN').inputValue() === '100234567800003', 'supplier and TRN read from the receipt')
  ok(await d.getByLabel('Invoice / receipt no.').inputValue() === 'INV-55821' && await d.getByLabel('Date *').inputValue() === `${yr}-10-03`, 'invoice number and date read')
  ok(await d.getByLabel('Amount excl. VAT (AED) *').inputValue() === '3520.00' && await d.getByLabel(/^VAT \(AED\)/).inputValue() === '176.00' && (await d.locator('[data-total]').innerText()).includes('3,696.00'), 'subtotal 3,520.00 + VAT 176.00 = total 3,696.00')
  ok(await d.getByLabel('Item 2 description').inputValue() === 'Welding rods E6013 2.5mm' && await d.getByLabel('Item 1 amount').inputValue() === '3200.00', 'line items read (2 lines)')
  ok(/OCR\.Space \+ Google AI \(photo\)/.test(await d.locator('[data-scan-summary]').innerText()), 'the summary says how it was read (OCR.Space + Google AI with the photo) and asks for a check')
  const gcall = (await calls()).gemini.slice(geminiBefore)
  ok(gcall.length === 1 && gcall[0].image === 'image/png', 'Google AI was asked once, with the photo, because the OCR total did not add up')
  const before = (await one(`select count(*)::int n from project_expenses where company_id=$1`, [co])).n
  await d.getByRole('button', { name: 'Save expense' }).click(); await settle(600)
  ok((await one(`select count(*)::int n from project_expenses where company_id=$1`, [co])).n === before, 'not saved without ticking “I checked these details against the receipt”')
  await d.getByLabel(/I checked these details against the receipt/).check(); await d.getByRole('button', { name: 'Save expense' }).click(); await settle(1500)
  const e2 = await one(`select * from project_expenses where company_id=$1 and reference='INV-55821'`, [co])
  ok(e2 && e2.source === 'scan' && e2.verified_at && e2.ocr_suggested?.total === 3696 && e2.ocr_suggested?.engine === 'rules+gemini', 'saved as scanned + verified, with what the scan suggested kept for the record')
  ok(e2 && e2.receipt_document_id && (await one(`select count(*)::int n from document_versions where document_id=$1`, [e2.receipt_document_id])).n === 1, 'the original receipt is attached to the expense')
  ok(e2 && Array.isArray(e2.items) && e2.items.length === 2 && e2.items[1].amount === 320, 'line items saved with the expense')
  const sj = await (await ctx.request.post(`${BASE}/api/expenses/scan`, { multipart: { file: { name: 'again.png', mimeType: 'image/png', buffer: Buffer.concat([img, Buffer.from('x')]) } } })).json().catch(() => ({}))
  ok(sj.error || sj.duplicate === null, 'an unreadable photo returns a clear message')
  await fixtures({ ocr: { [sha(Buffer.concat([img, Buffer.from('y')]))]: RECEIPT } })
  const sj2 = await (await ctx.request.post(`${BASE}/api/expenses/scan`, { multipart: { file: { name: 'dup.png', mimeType: 'image/png', buffer: Buffer.concat([img, Buffer.from('y')]) } } })).json()
  ok(sj2.duplicate?.reference === 'INV-55821' && sj2.supplier?.name === 'AL FAHIM BUILDING MATERIALS L.L.C', 'scanning the same bill again warns: already saved, matched to the saved supplier')
  ok(sj2.engine === 'rules' && sj2.provider === 'ocrspace' && !sj2.aiNote, 'a clean OCR reading that adds up is used as it is: Google AI is not asked (no cost)')

  console.log('\n[3b] A receipt photo read on this server with PaddleOCR: free, no cloud OCR, no AI')
  const lines = ['GULF HARDWARE TRADING LLC', 'TRN: 100456789100003', 'TAX INVOICE', 'Invoice No: GH-7781', `Date: 12/10/${yr}`, 'Cutting disc 4in      10 x 6.00     60.00', 'Grinding disc         5 x 8.00      40.00', 'Subtotal                         100.00', 'VAT 5%                             5.00', 'TOTAL AED                        105.00']
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="620" height="${70 + lines.length * 32}"><rect width="100%" height="100%" fill="#f6f3ea"/>${lines.map((l, i) => `<text x="26" y="${48 + i * 32}" font-family="DejaVu Sans Mono, monospace" font-size="19" fill="#333" xml:space="preserve">${l}</text>`).join('')}</svg>`
  const photo = await sharp(await sharp(Buffer.from(svg)).png().toBuffer()).rotate(2, { background: '#d9d4c7' }).blur(0.8).jpeg({ quality: 60 }).toBuffer()
  const c0 = await calls(), t0 = Date.now()
  const sj3 = await (await ctx.request.post(`${BASE}/api/expenses/scan`, { multipart: { file: { name: 'photo.jpg', mimeType: 'image/jpeg', buffer: photo } } })).json()
  const c1 = await calls()
  ok(sj3.provider === 'paddleocr' && sj3.engine === 'rules', `read by PaddleOCR on the server (${Date.now() - t0} ms)`)
  ok(sj3.read?.supplier === 'GULF HARDWARE TRADING LLC' && sj3.read?.trn === '100456789100003' && sj3.read?.invoice_no === 'GH-7781' && sj3.read?.date === `${yr}-10-12`, 'supplier, TRN, invoice number and date read from the photo')
  ok(sj3.read?.subtotal === 100 && sj3.read?.vat === 5 && sj3.read?.total === 105 && sj3.read?.lines?.length === 2, 'subtotal 100.00 + VAT 5.00 = total 105.00, two line items')
  ok(c1.ocrspace.length === c0.ocrspace.length && c1.gemini.length === c0.gemini.length, 'no paid OCR and no Google AI call for a photo the server could read')

  console.log('\n[3b+] Instant feel: streamed reading and rescans')
  const misread = png('stream'), geminiAt = (await calls()).gemini.length
  await fixtures({ ocr: { [sha(misread)]: RECEIPT.replace('Grand Total AED 3,696.00', 'Grand Total AED 3,896.00').replace('INV-55821', 'INV-77001') }, gemini: [{ needle: 'INV-77001', response: { supplier: 'Al Fahim Building Materials LLC', trn: '100234567800003', invoice_no: 'INV-77001', date: `${yr}-10-03`, subtotal: 3520, vat: 176, total: 3696, lines: [] } }] })
  const ndjson = async buf => (await (await ctx.request.post(`${BASE}/api/expenses/scan`, { headers: { accept: 'application/x-ndjson' }, multipart: { file: { name: 'r.png', mimeType: 'image/png', buffer: buf } } })).text()).trim().split('\n').map(l => JSON.parse(l))
  const ev = await ndjson(misread), kinds = ev.map(e => e.type === 'stage' ? `stage:${e.stage}` : e.type)
  const part = ev.find(e => e.type === 'partial'), fin = ev.find(e => e.type === 'final')
  ok(kinds.join(' ') === 'stage:local stage:cloud partial stage:ai final', `streamed in order: ${kinds.join(' → ')}`)
  ok(part?.read?.total === 3896 && part?.engine === 'rules' && fin?.read?.total === 3696 && fin?.engine === 'rules+gemini', 'the OCR reading arrives first (form fills at once), then Google AI corrects the total')
  const t2 = Date.now(), rescan = await ndjson(misread), took2 = Date.now() - t2
  ok(rescan.length === 1 && rescan[0].type === 'final' && rescan[0].cached === true && rescan[0].read.total === 3696 && (await calls()).gemini.length === geminiAt + 1, `the same photo scanned again comes back at once from the cache (${took2} ms, no second Google AI call)`)

  console.log('\n[3c] Turbo: a full-size 12 MP phone photo through the Scan button')
  const warm = await (await ctx.request.get(`${BASE}/api/expenses/scan`)).json().catch(() => ({}))
  ok(warm.ready === true, 'tapping Scan receipt warms the OCR models on the server')
  const sheet = await sharp(await sharp(Buffer.from(svg)).png().toBuffer()).resize({ width: 2800, height: 3700, fit: 'inside' }).rotate(1.5, { background: '#6b5d4f' }).png().toBuffer()
  const sm = await sharp(sheet).metadata()
  const big = await sharp({ create: { width: 3024, height: 4032, channels: 3, background: '#6b5d4f' } }).composite([{ input: sheet, left: Math.max(0, (3024 - sm.width) >> 1), top: Math.max(0, (4032 - sm.height) >> 1) }])
    .blur(1).jpeg({ quality: 92 }).toBuffer()
  await p.goto(`${BASE}/expenses`); await settle()
  const t1 = Date.now()
  await p.locator('input[data-scan-upload]').setInputFiles({ name: 'IMG_4032.jpg', mimeType: 'image/jpeg', buffer: big })
  await dlg().locator('[data-scan-done]').waitFor({ timeout: 30000 }); const took = Date.now() - t1
  const sent = Number(await dlg().locator('[data-scan-done]').getAttribute('data-scan-bytes')) || 0
  ok(sent > 0 && sent < big.length / 2, `the phone sends a smaller copy (${Math.round(big.length / 1024)} KB photo → ${Math.round(sent / 1024)} KB)`)
  ok(/PaddleOCR on this server, free/.test(await dlg().locator('[data-scan-summary]').innerText()) && await dlg().getByLabel('Invoice / receipt no.').inputValue() === 'GH-7781', `read by turbo PaddleOCR in ${took} ms (photo picked → fields filled)`)
  await p.keyboard.press('Escape'); await settle(300)
  const bad = await ctx.request.post(`${BASE}/api/expenses/scan`, { multipart: { file: { name: 'x.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') } } })
  ok(bad.status() === 400, 'a text file is refused (only photos or PDF)')

  console.log('\n[4] History: search by invoice number, filter by supplier and unpaid')
  await p.goto(`${BASE}/expenses?q=INV-55821`); await settle()
  ok((await p.locator('main').innerText()).includes('AL FAHIM BUILDING MATERIALS L.L.C') && !(await p.locator('main').innerText()).includes('Steel plates 6mm'), 'search by invoice number finds the bill')
  await p.goto(`${BASE}/expenses?paid=unpaid`); await settle()
  ok((await p.locator('main').innerText()).includes('Gulf Steel Trading LLC') && !(await p.locator('tbody').innerText()).includes('AL FAHIM'), 'unpaid filter: only bills owed')
  await p.goto(`${BASE}/expenses?tab=suppliers`); await settle()
  ok(await p.locator('tr[data-supplier="Gulf Steel Trading LLC"]').count() === 1 && (await p.locator('tr[data-supplier="Gulf Steel Trading LLC"]').innerText()).includes('1,050.00'), 'suppliers tab: totals and what is unpaid per supplier')

  console.log('\n[5] Tally export: validation report first')
  await p.goto(`${BASE}/expenses?tab=tally`); await settle()
  const rep = await p.locator('[data-validation]').innerText()
  ok(/No input VAT ledger/.test(rep) && /No Tally ledger for the "Materials" category/.test(rep), 'missing ledger mappings are named before any file can be made')
  ok(/1 not verified yet/.test(rep), 'the older unchecked expense is left out and said so')
  ok(await p.locator('[data-create-export]').isDisabled(), 'Create Tally XML is disabled while mappings are missing')
  ok(/Not yet tested with your Tally/.test(await p.locator('[data-tally-status]').innerText()), 'compatibility is not claimed before a test import is recorded')
  await p.getByLabel('Tally company name').fill('Al Saqr Expenses Test LLC'); await p.getByLabel('Input VAT ledger').fill('Input VAT 5%')
  await p.getByLabel('Materials', { exact: true }).fill('Purchase - Materials'); await p.getByLabel('Fuel', { exact: true }).fill('Fuel Expenses'); await p.getByLabel('Cash', { exact: true }).fill('Cash')
  await p.getByRole('button', { name: 'Save mapping' }).click(); await settle(1200)
  ok(/Every expense has its ledgers mapped/.test(await p.locator('[data-validation]').innerText()), 'after mapping: ready, no problems')
  const [dl] = await Promise.all([p.waitForEvent('download'), p.locator('[data-create-export]').click()])
  const xml = fs.readFileSync(await dl.path(), 'utf8'); await settle(1200)
  const parsed = await p.evaluate(x => { const doc = new DOMParser().parseFromString(x, 'application/xml'); const err = doc.querySelector('parsererror'); const vs = [...doc.querySelectorAll('VOUCHER')]
    return { err: !!err, n: vs.length, types: vs.map(v => v.getAttribute('VCHTYPE')), sums: vs.map(v => [...v.querySelectorAll('AMOUNT')].reduce((s, a) => s + Number(a.textContent), 0)) } }, xml)
  ok(!parsed.err && parsed.n === 2 && parsed.types.sort().join() === 'Payment,Purchase' && parsed.sums.every(s => Math.abs(s) < 0.001), 'the XML is well-formed: 2 vouchers (Purchase for the unpaid bill, Payment for the paid one), each balanced')
  ok(xml.includes('<TALLYREQUEST>Import Data</TALLYREQUEST>') && xml.includes('<SVCURRENTCOMPANY>Al Saqr Expenses Test LLC</SVCURRENTCOMPANY>') && xml.includes('<LEDGERNAME>Input VAT 5%</LEDGERNAME>') && xml.includes('<LEDGERNAME>Gulf Steel Trading LLC</LEDGERNAME>'), 'Import Data envelope, company, VAT and supplier ledgers in the file')
  const batch = await one(`select * from expense_exports where company_id=$1`, [co])
  ok(batch && batch.ref === `EXP-${yr}-0001` && batch.expense_count === 2 && Number(batch.total) === 1050 + 3696 && dl.suggestedFilename() === `averiqo-tally-EXP-${yr}-0001.xml`, `batch ${batch?.ref}: 2 expenses, AED 4,746.00, file named after it`)
  ok((await one(`select count(*)::int n from project_expenses where company_id=$1 and export_batch_id=$2`, [co, batch.id])).n === 2, 'both expenses marked with the export reference')
  ok((await p.locator(`tr[data-batch="${batch.ref}"]`).innerText()).includes('Exported'), 'export history lists it')
  ok(await p.locator('[data-create-export]').isDisabled(), 'nothing left to export: no second file for the same expenses')
  const again = await (await ctx.request.get(`${BASE}/api/expenses/tally/${batch.id}`)).text()
  ok(again === xml, 're-downloading gives the identical file')

  console.log('\n[6] Exported expenses are locked; undo releases them')
  await p.goto(`${BASE}/expenses?q=GST-1001`); await settle()
  ok(!(await p.locator('tbody tr').first().getByRole('button', { name: 'Delete' }).count()), 'no delete button on an exported expense')
  await p.locator('tbody tr').first().getByRole('button', { name: 'Edit' }).click(); await settle(400)
  ok(/is in Tally export EXP-/.test(await dlg().innerText()), 'the edit form says it is exported and what is locked')
  await dlg().getByLabel('Amount excl. VAT (AED) *').fill('900'); await dlg().getByRole('button', { name: 'Save' }).click(); await settle(1000)
  ok(/exported to Tally \(EXP-/.test(await dlg().innerText() + await toasts()) && Number((await one(`select amount from project_expenses where reference='GST-1001' and company_id=$1`, [co])).amount) === 1000, 'changing the amount is refused by the database')
  await p.keyboard.press('Escape')
  const rv = await ctx.request.get(`${BASE}/api/expenses/tally/review?format=xlsx&status=all`), rb = await rv.body()
  ok(rv.ok() && rb.subarray(0, 2).toString() === 'PK', 'review Excel (expenses, ledger lines, validation) downloads')
  const csv = await (await ctx.request.get(`${BASE}/api/expenses/tally/review?format=csv&status=all`)).text()
  ok(csv.includes('Export status') && csv.includes('Not exported: Already exported') && csv.includes('Not exported: Not verified yet'), 'review CSV shows each expense with its export status')
  await p.goto(`${BASE}/expenses?tab=tally&status=all`); await settle()
  await p.locator(`tr[data-batch="${batch.ref}"]`).getByRole('button', { name: 'Undo' }).click(); await settle(300)
  await dlg().getByLabel('Reason *').fill('Imported into the wrong Tally company'); await dlg().getByRole('button', { name: 'Undo export' }).click(); await settle(1200)
  ok((await one(`select count(*)::int n from project_expenses where company_id=$1 and export_batch_id is not null`, [co])).n === 0 && (await one(`select release_reason from expense_exports where id=$1`, [batch.id])).release_reason === 'Imported into the wrong Tally company', 'undo: expenses unlocked, the reason recorded')
  ok((await one(`select count(*)::int n from audit_logs where table_name='expense_exports' and record_id=$1`, [batch.id])).n >= 2, 'audit log: export created and undone')
  await p.getByRole('button', { name: /A test import into TallyPrime worked/ }).click(); await settle(1000)
  ok(/Test import confirmed with TallyPrime/.test(await p.locator('[data-tally-status]').innerText()), 'after a recorded test import, the version it was tested with is shown')

  console.log('\n[7] Permissions')
  await one(`select 1`)
  const pmEmail = `pm-${Date.now()}@alsaqr.test`
  const pmId = (await (await fetch(`${GW}/auth/v1/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: pmEmail, password: 'correct-horse-battery' }) })).json()).user?.id
    ?? (await one(`select id from auth.users where email=$1`, [pmEmail])).id
  await db.query(`insert into profiles(id,company_id,full_name,role) values ($1,$2,'PM','accountant')`, [pmId, co])
  const acc = await browser.newContext(); const ap = await acc.newPage()
  await ap.goto(`${BASE}/login`); await ap.getByLabel('Email').fill(pmEmail); await ap.getByLabel('Password').fill('correct-horse-battery'); await ap.getByRole('button', { name: 'Sign in', exact: true }).click(); await ap.waitForURL(`${BASE}/`)
  ok((await acc.request.get(`${BASE}/api/expenses/tally/${batch.id}`)).ok(), 'an accountant (finance + export) can download Tally files')
  await db.query(`update profiles set role='project_manager' where id=$1`, [pmId])
  ok((await acc.request.get(`${BASE}/api/expenses/tally/${batch.id}`)).status() === 403 && (await acc.request.get(`${BASE}/api/expenses/tally/review?format=csv`)).status() === 403, 'a project manager cannot download Tally files or review sheets (403)')
  await acc.close()

  console.log('\n[8] Invoice: payment terms can be switched off')
  const inv = (await one(`insert into invoices(company_id,doc_type,number,status,issue_date,customer_name,payment_terms) values ($1,'invoice','INV-T1','draft',current_date,'Test customer',array['50% advance','50% on delivery']) returning id`, [co])).id
  await p.goto(`${BASE}/invoices/${inv}`); await settle(1000)
  if (!(await p.getByLabel('Show payment terms on this tax invoice').isVisible())) { await p.locator('summary', { hasText: /^Terms/ }).click(); await settle(300) }
  const sw = p.getByLabel('Show payment terms on this tax invoice')
  ok(await sw.isChecked(), 'the switch is on when the invoice has payment terms')
  await sw.uncheck(); await settle(200)
  ok(!(await p.getByLabel('Payment terms', { exact: true }).count()), 'switching it off hides the payment terms')
  await p.getByRole('button', { name: 'Save', exact: true }).first().click(); await settle(1500)
  ok((await one(`select coalesce(array_length(payment_terms,1),0) n from invoices where id=$1`, [inv])).n === 0, 'saved: the invoice has no payment terms')

  console.log('\n[9] Phone')
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: await ctx.storageState(), isMobile: true, hasTouch: true }), mp = await m.newPage()
  mp.on('pageerror', e => jsErrors.push(`${mp.url()}: ${e.message}`))
  for (const u of ['/expenses', '/expenses?tab=suppliers', '/expenses?tab=tally']) {
    await mp.goto(BASE + u); await settle(500, mp)
    ok(await mp.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `390px ${u}: no horizontal overflow`)
  }
  await mp.goto(`${BASE}/expenses`); await settle(500, mp)
  ok(await mp.getByRole('button', { name: 'Scan receipt' }).isVisible(), 'phone: “Scan receipt” opens the camera')
  await mp.screenshot({ path: `${OUT}/m-expenses.png`, fullPage: true })
  await m.close()
  await p.goto(`${BASE}/expenses?tab=tally&status=all`); await settle(); await p.screenshot({ path: `${OUT}/tally.png`, fullPage: true })

  ok(!jsErrors.length, `no JavaScript errors${jsErrors.length ? ': ' + jsErrors.slice(0, 3).join(' | ') : ''}`)
  void legacy
} catch (e) {
  ok(false, `suite aborted: ${(e).message.split('\n')[0]}`); console.log(e)
  await p.screenshot({ path: `${OUT}/abort.png`, fullPage: true }).catch(() => {})
} finally {
  await browser.close(); await db.end()
  const failed = results.filter(r => !r[0])
  console.log(`\nExpenses suite: ${results.length - failed.length}/${results.length} passed`)
  if (failed.length) { console.log('FAILED:\n' + failed.map(f => ' - ' + f[1]).join('\n')); process.exitCode = 1 }
}
