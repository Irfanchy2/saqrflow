// End-to-end: Smart Document Inbox against the real app + PostgREST + Postgres RLS. Run via scripts/e2e.sh
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import pg from 'pg'
import { makePdf } from '../fixtures/make-pdf.mjs'
import { SAMPLES } from '../fixtures/samples.mjs'

const BASE = process.env.E2E_BASE, GW = process.env.E2E_GATEWAY
const results = []
const ok = (cond, msg) => { results.push([!!cond, msg]); console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`) }
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const file = n => ({ name: n, mimeType: 'application/pdf', buffer: makePdf(SAMPLES[n]) })
const browser = await chromium.launch({ executablePath: fs.readdirSync('/opt/pw-browsers').filter(d => d.startsWith('chromium-')).map(d => `/opt/pw-browsers/${d}/chrome-linux/chrome`).find(p => fs.existsSync(p)) })
const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } }); const p = await ctx.newPage()
p.on('pageerror', e => ok(false, `JS error on ${p.url()}: ${e.message}`)); p.on('dialog', d => d.accept())
const settle = async (ms = 700) => { await p.waitForLoadState('networkidle').catch(() => {}); await p.waitForTimeout(ms) }
const body = () => p.locator('body').innerText()
const dlg = () => p.locator('dialog[open]')
const shot = n => p.screenshot({ path: `tests/e2e/shots/${n}.png`, fullPage: true })
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]

try {
  console.log('\n[I1] Setup: company with employees Mohammed Ayub & Rahim Uddin and customer ABC Contracting')
  await p.goto(`${BASE}/signup`); await p.getByLabel('Work email').fill('inbox-owner@alsaqr.test'); await p.getByLabel('Password').fill('correct-horse-battery'); await p.getByRole('button', { name: 'Create account' }).click()
  await p.waitForURL('**/onboarding'); await p.getByLabel('Company name').fill('Al Saqr Steels'); await p.getByLabel('Your full name').fill('Inbox Owner'); await p.getByRole('button', { name: 'Create company' }).click(); await p.waitForURL(`${BASE}/`)
  const co = (await one(`select p.company_id from profiles p join auth.users u on u.id=p.id where u.email='inbox-owner@alsaqr.test'`)).company_id
  const mo = (await one(`insert into employees(company_id,employee_no,full_name) values ($1,'S-101','Mohammed Ayub') returning id`, [co])).id
  const ra = (await one(`insert into employees(company_id,employee_no,full_name) values ($1,'S-102','Rahim Uddin') returning id`, [co])).id
  await one(`insert into employees(company_id,employee_no,full_name) values ($1,'S-103','Mohammed Rafiq') returning id`, [co])
  const abc = (await one(`insert into customers(company_id,name) values ($1,'ABC Contracting LLC') returning id`, [co])).id
  // this suite covers the private, local-only path (the AI / OCR.Space path is covered by ai-reader.mjs)
  await db.query(`insert into app_settings(company_id,key,value) values ($1,'ai.provider','"rules"'),($1,'ocr.provider','"tesseract"')`, [co])
  ok(await p.getByRole('link', { name: 'Smart Inbox' }).first().isVisible(), 'sidebar shows “Smart Inbox”')
  ok((await body()).includes('Smart Inbox') && (await body()).includes('Waiting for your review'), 'dashboard shows the Smart Inbox panel')

  console.log('\n[I2] Upload 10 documents at once')
  const ten = ['trade-license.pdf', 'emirates-id-mohammed.pdf', 'emirates-id-rahim.pdf', 'visa-mohammed.pdf', 'visa-rahim.pdf', 'tenancy-contract.pdf', 'insurance.pdf', 'invoice-abc.pdf', 'delivery-note-abc.pdf', 'vehicle-registration.pdf']
  await p.goto(`${BASE}/inbox`); ok((await body()).includes('Local reading mode'), 'inbox states that local (non-AI) reading is active')
  await p.getByRole('button', { name: 'Upload documents' }).click(); await dlg().locator('input[type=file]').setInputFiles(ten.map(file))
  await dlg().getByRole('button', { name: 'Upload & analyse' }).click(); await p.waitForURL(/\/inbox\?batch=/, { timeout: 60000 }); await settle(1200)
  const t = await body()
  ok(t.includes('10 documents processed'), 'summary: “10 documents processed”')
  const rows = (await db.query(`select file_name,status,doc_type,confidence,suggestion from document_inbox where company_id=$1 order by file_name`, [co])).rows
  const by = n => rows.find(r => r.file_name === n)
  ok(rows.length === 10, `10 inbox rows (${rows.length})`)
  ok(rows.every(r => r.status === 'ready'), `all 10 classified with high confidence → ready (${rows.filter(r => r.status !== 'ready').map(r => r.file_name + ':' + r.status).join(', ') || 'ok'})`)
  ok(by('trade-license.pdf').suggestion.path.join(' → ') === 'Company → Al Saqr Steels → Company Documents → Trade License', 'Trade License → Al Saqr → Company Documents')
  ok(by('emirates-id-mohammed.pdf').suggestion.owner?.id === mo && by('emirates-id-mohammed.pdf').suggestion.path.join('/') === 'Employees/Mohammed Ayub/Documents/Emirates ID', 'Mohammed EID → Employees → Mohammed Ayub → Emirates ID')
  ok(by('emirates-id-rahim.pdf').suggestion.owner?.id === ra, 'Rahim EID → Rahim Uddin')
  ok(by('visa-mohammed.pdf').suggestion.owner?.id === mo && by('visa-rahim.pdf').suggestion.owner?.id === ra, 'both visas matched to the right employee (not confused with “Mohammed Rafiq”)')
  ok(by('tenancy-contract.pdf').suggestion.path.at(-1) === 'Tenancy Contract' && by('insurance.pdf').suggestion.path.at(-1) === 'Insurance', 'tenancy + insurance → Company Documents')
  ok(by('invoice-abc.pdf').suggestion.owner?.id === abc && by('invoice-abc.pdf').suggestion.path.join('/') === 'Customers/ABC Contracting LLC/Invoices', 'invoice → ABC Contracting → Invoices')
  ok(by('delivery-note-abc.pdf').suggestion.path.at(-1) === 'Delivery Notes', 'delivery note → ABC Contracting → Delivery Notes')
  ok(by('vehicle-registration.pdf').suggestion.path.join('/') === 'Vehicles/Plate Dubai K 45821/Registration', 'vehicle registration → Vehicles → plate → Registration')
  ok(rows.every(r => Number(r.confidence) >= 0.8), 'confidence ≥ 80% on all ten')
  ok((await one(`select count(*)::int n from documents where company_id=$1`, [co])).n === 0, 'NOTHING filed before the user confirms')
  await shot('20-inbox-batch')

  console.log('\n[I3] Review screen & confirm one item manually')
  await p.goto(`${BASE}/inbox?tab=ready`); await p.locator('tr', { hasText: 'emirates-id-mohammed.pdf' }).getByRole('link', { name: 'Confirm' }).click(); await settle()
  const rv = await body()
  ok(rv.includes('Document detected') && rv.includes('Mohammed Ayub') && rv.includes('97%'), 'review screen shows detection with confidence (Mohammed Ayub · 97%)')
  ok(rv.includes('784-1990-1234567-6') && rv.includes('9 January 2027'), 'extracted ID number + expiry shown for verification')
  ok(await p.locator('iframe[title="Uploaded document"]').isVisible(), 'document preview shown next to the form')
  ok(rv.includes('90d →') && rv.includes('on expiry →'), 'reminder schedule preview (90d … on expiry)')
  await shot('21-inbox-review')
  await p.getByRole('button', { name: 'Confirm & File' }).click(); await p.waitForURL(/\/documents\/[0-9a-f-]{36}/, { timeout: 20000 }); await settle()
  const eid = await one(`select d.id,d.owner_type,d.owner_id,d.reference_no,d.expiry_date::text,d.reminders_active,c.name cat from documents d join document_categories c on c.id=d.category_id where d.company_id=$1`, [co])
  ok(eid.owner_type === 'employee' && eid.owner_id === mo && eid.cat === 'Emirates ID' && eid.expiry_date === '2027-01-09' && eid.reminders_active, 'filed: Mohammed Ayub → Emirates ID, expiry 2027-01-09, reminders on')

  console.log('\n[I4] Confirm all suggested')
  await p.goto(`${BASE}/inbox`); await p.getByRole('button', { name: /Confirm all suggested/ }).click(); await settle(3000)
  ok((await one(`select count(*)::int n from document_inbox where company_id=$1 and status='filed'`, [co])).n === 10, 'all 10 filed')
  const docs = (await db.query(`select d.name,d.owner_type,d.owner_id,d.folder,d.expiry_date::text e,c.name cat from documents d join document_categories c on c.id=d.category_id where d.company_id=$1`, [co])).rows
  ok(docs.length === 10, `10 documents created (${docs.length})`)
  ok(docs.filter(d => d.owner_id === ra).map(d => d.cat).sort().join() === 'Emirates ID,Residence Visa', 'Rahim has Emirates ID + Residence Visa')
  ok(docs.find(d => d.cat === 'Vehicle Registration (Mulkiya)')?.folder === 'Vehicles/Dubai K 45821', 'vehicle category created on the fly + filed under Vehicles/plate')
  ok(docs.find(d => d.cat === 'Customer Invoice')?.folder === 'Customers/ABC Contracting LLC/Invoices', 'invoice filed under Customers → ABC Contracting LLC → Invoices')
  ok((await one(`select count(*)::int n from document_relationships where company_id=$1 and related_type='customer' and related_id=$2`, [co, abc])).n === 2, 'invoice + delivery note linked to ABC Contracting (relationship, no copy)')
  const objs = (await (await fetch(`${GW}/__objects`)).json()).filter(k => k.includes(co))
  const vers = (await db.query(`select storage_path from document_versions where company_id=$1`, [co])).rows
  ok(objs.length === 10 && vers.every(v => objs.includes('vault/' + v.storage_path)), `one stored file per document — versions reference the inbox file, nothing copied (${objs.length} objects)`)
  const rs = (await one(`select count(*)::int n from reminder_sources where company_id=$1 and source_type='document'`, [co])).n
  ok(rs === 8, `expiry reminders active for the 8 documents that have an expiry (${rs})`)

  console.log('\n[I5] Renewal, duplicate, unknown, scanned image')
  const jpg = { name: 'photo-of-id.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]) }
  await p.goto(`${BASE}/inbox`); await p.getByRole('button', { name: 'Upload documents' }).click()
  await dlg().locator('input[type=file]').setInputFiles([file('renewed-trade-license.pdf'), file('trade-license.pdf'), file('unknown-letter.pdf'), jpg])
  await dlg().getByRole('button', { name: 'Upload & analyse' }).click(); await p.waitForURL(/\/inbox\?batch=/, { timeout: 60000 }); await settle(1000)
  const st = async n => (await one(`select status,review_reasons,suggestion from document_inbox where company_id=$1 and file_name=$2 order by created_at desc limit 1`, [co, n]))
  const ren = await st('renewed-trade-license.pdf'), dup = await st('trade-license.pdf'), unk = await st('unknown-letter.pdf'), img = await st('photo-of-id.jpg')
  ok(ren.suggestion.duplicates.some(d => d.kind === 'renewal'), 'renewed licence recognised as a renewal of the existing Trade License')
  ok(dup.status === 'duplicate' && dup.suggestion.duplicates[0].kind === 'same_file', 're-uploading the same file → “Possible duplicate detected”')
  ok(unk.status === 'needs_review' && unk.review_reasons.includes('Document type not recognised'), 'unrelated letter → manual review (not guessed)')
  ok(img.status === 'failed' && /OCR failed/.test(img.review_reasons.join()), 'unreadable photo → Failed with the OCR error (file kept, retry / manual entry offered)')
  await shot('22-inbox-second-batch')
  // renewal → new version of existing
  const renId = (await one(`select id from document_inbox where company_id=$1 and file_name='renewed-trade-license.pdf'`, [co])).id
  await p.goto(`${BASE}/inbox/${renId}`); await settle()
  ok(await p.locator('input[name=mode][value=version]').isChecked(), 'review defaults to “New version of existing” for a renewal')
  await p.getByRole('button', { name: 'Confirm & File' }).click(); await p.waitForURL(/\/documents\//, { timeout: 20000 }); await settle()
  const tl = await one(`select d.id,d.expiry_date::text e,(select count(*)::int from document_versions v where v.document_id=d.id) v,(select count(*)::int from document_renewals r where r.document_id=d.id) r from documents d join document_categories c on c.id=d.category_id where d.company_id=$1 and c.name='Trade License'`, [co])
  ok(tl.e === '2028-05-12' && tl.v === 2 && tl.r === 1, `renewal: expiry → 2028-05-12, 2 versions (old kept), renewal history recorded`)
  ok((await one(`select count(*)::int n from documents d join document_categories c on c.id=d.category_id where d.company_id=$1 and c.name='Trade License'`, [co])).n === 1, 'still ONE Trade License document (one reminder schedule, no duplicate reminders)')
  ok((await body()).includes('v2') && (await body()).includes('Renewal (Smart Inbox)'), 'document page shows version history with the renewal')
  // manual correction of the scanned image + learning
  const imgId = (await one(`select id from document_inbox where company_id=$1 and file_name='photo-of-id.jpg'`, [co])).id
  await p.goto(`${BASE}/inbox/${imgId}`); await settle()
  ok((await body()).includes('Could not read this document') && (await body()).includes('Reprocess'), 'review screen offers retry (Reprocess) and manual entry')
  await p.locator('select[name=doc_type]').selectOption('training_certificate')
  const otherCat = (await one(`select id from document_categories where company_id=$1 and name='Other Certificate'`, [co])).id
  await p.locator('select[name=category_id]').selectOption(otherCat); await p.locator('select[name=owner_id]').selectOption(ra)
  await p.getByLabel('Document name *').fill('Welding certificate – Rahim'); await p.getByLabel('Expiry date').fill('2027-08-01')
  await p.getByRole('button', { name: 'Confirm & File' }).click(); await p.waitForURL(/\/documents\//, { timeout: 20000 })
  ok((await one(`select owner_id from documents where name='Welding certificate – Rahim'`)).owner_id === ra, 'human-corrected scan filed to Rahim')
  ok((await one(`select count(*)::int n from document_type_mappings where company_id=$1 and doc_type='training_certificate' and category_id=$2`, [co, otherCat])).n === 1, 'correction learned locally (doc type → chosen category)')
  // reject the unknown letter
  const unkId = (await one(`select id from document_inbox where company_id=$1 and file_name='unknown-letter.pdf'`, [co])).id
  await p.goto(`${BASE}/inbox/${unkId}`); await p.getByRole('button', { name: 'Delete upload' }).click(); await settle(1200)
  ok((await one(`select status from document_inbox where id=$1`, [unkId])).status === 'rejected', 'unknown document rejected (kept for audit, not deleted)')
  // re-analyse
  const dupId = (await one(`select id from document_inbox where company_id=$1 and status='duplicate'`, [co])).id
  await p.goto(`${BASE}/inbox/${dupId}`); await p.getByRole('button', { name: 'Reprocess' }).click(); await settle(2000)
  ok((await one(`select count(*)::int n from document_extractions where inbox_id=$1`, [dupId])).n === 2, '“Reprocess” re-reads the stored private file')

  console.log('\n[I6] Timeline, statuses, dashboard, security')
  await p.goto(`${BASE}/employees/${mo}?tab=history`); await settle()
  ok((await body()).includes('Document timeline') && (await body()).includes('Emirates ID – Mohammed Ayub uploaded'), 'employee timeline lists uploaded documents')
  await p.goto(`${BASE}/documents?view=timeline`); await settle()
  ok((await body()).includes('renewed') && (await body()).includes('2027-05-12 → 2028-05-12'), 'company timeline shows the renewal')
  await p.goto(`${BASE}/`); await settle(); await shot('23-dashboard-smart-center')
  ok(/Uploaded today\s*14/.test((await body()).replace(/\n+/g, ' ')), 'dashboard widget counts today’s uploads (14)')
  const anon = await browser.newContext(); const r1 = await anon.request.get(`${BASE}/api/inbox/${imgId}/file`); ok(r1.url().includes('/login') && !(await r1.body()).toString().startsWith('%PDF') && !(await r1.body()).subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])), 'logged-out request gets the login page, never the file')
  const rival = await browser.newPage()
  await rival.goto(`${BASE}/signup`); await rival.getByLabel('Work email').fill('rival2@x.test'); await rival.getByLabel('Password').fill('correct-horse-battery'); await rival.getByRole('button', { name: 'Create account' }).click()
  await rival.waitForURL('**/onboarding'); await rival.getByLabel('Company name').fill('Rival Co'); await rival.getByLabel('Your full name').fill('Rival'); await rival.getByRole('button', { name: 'Create company' }).click(); await rival.waitForURL(`${BASE}/`)
  ok((await rival.context().request.get(`${BASE}/api/inbox/${imgId}/file`)).status() === 404, "another company cannot open this company's inbox file")
  ok((await rival.goto(`${BASE}/inbox/${imgId}`)).status() === 404, "another company cannot open this company's review page")
  const aud = (await one(`select count(*)::int n from audit_logs where company_id=$1 and table_name='document_inbox'`, [co])).n
  ok(aud >= 28, `audit log records uploads and filing (${aud} inbox events)`)
} catch (e) { ok(false, `aborted: ${e.stack || e}`) }
finally { await browser.close(); await db.end() }
const failed = results.filter(r => !r[0]); console.log(`\n${results.length - failed.length}/${results.length} inbox checks passed`); if (failed.length) console.log('FAILED:\n' + failed.map(f => ' - ' + f[1]).join('\n'))
process.exit(failed.length ? 1 : 0)
