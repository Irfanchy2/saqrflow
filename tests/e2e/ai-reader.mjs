// End-to-end: AI document reader — OCR.Space + Gemini provider code against API stand-ins, classification of the
// spec's document types, privacy (ID numbers never reach the AI), hallucination guard, matching, review, filing,
// duplicates/cache, failures + retry, settings, AI search and permissions. Run via scripts/e2e.sh
import { chromium } from 'playwright-core'
import crypto from 'node:crypto'
import fs from 'node:fs'
import pg from 'pg'

const BASE = process.env.E2E_BASE, GW = process.env.E2E_GATEWAY
const results = []
const ok = (cond, msg) => { results.push([!!cond, msg]); console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`) }
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
const exe = fs.readdirSync('/opt/pw-browsers').filter(d => d.startsWith('chromium-')).map(d => `/opt/pw-browsers/${d}/chrome-linux/chrome`).find(p => fs.existsSync(p))
const browser = await chromium.launch({ executablePath: exe })
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } }); const p = await ctx.newPage()
p.on('pageerror', e => ok(false, `JS error on ${p.url()}: ${e.message}`)); p.on('dialog', d => d.accept())
const settle = async (ms = 700) => { await p.waitForLoadState('networkidle').catch(() => {}); await p.waitForTimeout(ms) }
const body = () => p.locator('body').innerText()
const dlg = () => p.locator('dialog[open]')
const shot = n => p.screenshot({ path: `tests/e2e/shots/${n}.png`, fullPage: true })
const sha = b => crypto.createHash('sha256').update(b).digest('hex')
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
const img = name => { const buffer = Buffer.concat([PNG, crypto.randomBytes(16)]); return { name, mimeType: 'image/png', buffer } }   // unique bytes per file (trailing data after IEND)
const fixtures = o => fetch(`${GW}/mock/fixtures`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(o) })
const calls = async () => (await fetch(`${GW}/mock/calls`)).json()
const G = (o) => ({ category: 'other', document_owner_type: 'unknown', company_name: null, employee_name: null, document_number: null, issue_date: null, expiry_date: null, issuing_authority: null, confidence: 0.95, fields: [], requires_manual_review: false, ...o })

// ── documents: OCR text the "scanner" returns + what "Gemini" answers ──
const DOCS = {
  'trade-license.png': { text: 'GOVERNMENT OF FUJAIRAH\nDEPARTMENT OF INDUSTRY AND ECONOMY\nCOMMERCIAL LICENSE\nLicense No: 7788123\nTrade Name: AL SAQR AL AHMAR WELDING AND BLACKSMITH LLC\nIssue Date: 20/05/2026\nExpiry Date: 19/05/2027',
    ai: G({ document_type: 'trade_license', category: 'company_document', document_owner_type: 'company', company_name: 'AL SAQR AL AHMAR WELDING AND BLACKSMITH LLC', document_number: '7788123', issue_date: '2026-05-20', expiry_date: '2027-05-19', issuing_authority: 'Fujairah', confidence: 0.96 }), needle: '7788123' },
  'tenancy.png': { text: 'TENANCY CONTRACT\nContract No: TC-2026-0991\nLandlord Name: Gulf Properties LLC\nTenant Name: AL SAQR AL AHMAR WELDING AND BLACKSMITH LLC\nProperty: Warehouse 7, Fujairah Industrial Area\nStart Date: 01/04/2026\nEnd Date: 31/03/2027\nAnnual Rent: AED 92,000',
    ai: G({ document_type: 'tenancy_contract', category: 'company_document', document_owner_type: 'company', company_name: 'AL SAQR AL AHMAR WELDING AND BLACKSMITH LLC', document_number: 'TC-2026-0991', issue_date: '2026-04-01', expiry_date: '2027-03-31', confidence: 0.93, fields: [{ key: 'landlord', value: 'Gulf Properties LLC', confidence: 0.9 }, { key: 'amount', value: '92,000', confidence: 0.9 }] }), needle: 'TC-2026-0991' },
  'passport.png': { text: 'REPUBLIC OF BANGLADESH\nPASSPORT\nPassport No: BX1234567\nSurname: AYUB\nGiven Names: MOHAMMED\nName: Mohammed Ayub\nNationality: Bangladeshi\nDate of Birth: 14/02/1990\nDate of Issue: 10/01/2022\nDate of Expiry: 09/01/2032\nP<BGDAYUB<<MOHAMMED<<<<<<<<<<<<<<<<<<<<<<<<<\nBX12345674BGD9002141M3201097<<<<<<<<<<<<<<02',
    ai: G({ document_type: 'passport', category: 'employee_document', document_owner_type: 'employee', employee_name: 'Mohammed Ayub', document_number: null, issue_date: '2022-01-10', expiry_date: '2032-01-09', confidence: 0.94, fields: [{ key: 'nationality', value: 'Bangladeshi', confidence: 0.9 }, { key: 'date_of_birth', value: '1990-02-14', confidence: 0.9 }] }), needle: 'Given Names: MOHAMMED' },
  'emirates-id.png': { text: 'United Arab Emirates\nFederal Authority for Identity, Citizenship, Customs & Port Security\nRESIDENT IDENTITY CARD\nID Number: 784-1990-1234567-6\nName: Mohammed Ayub\nNationality: Bangladesh\nDate of Birth: 14/02/1990\nIssuing Date: 10/01/2025\nExpiry Date: 09/01/2027',
    ai: G({ document_type: 'emirates_id', category: 'employee_document', document_owner_type: 'employee', employee_name: 'Mohammed Ayub', document_number: null, issue_date: '2025-01-10', expiry_date: '2027-01-09', confidence: 0.95 }), needle: 'RESIDENT IDENTITY CARD' },
  'visa-rashid.png': { text: 'UNITED ARAB EMIRATES\nRESIDENCE VISA\nFile No: 201/2026/5544332\nName: RASHID KHAN\nProfession: Steel Fixer\nSponsor: AL SAQR AL AHMAR WELDING AND BLACKSMITH LLC\nIssue Date: 02/02/2026\nExpiry Date: 01/02/2028',
    ai: G({ document_type: 'residence_visa', category: 'employee_document', document_owner_type: 'employee', employee_name: 'RASHID KHAN', document_number: '201/2026/5544332', issue_date: '2026-02-02', expiry_date: '2028-02-01', confidence: 0.93 }), needle: '5544332' },
  'invoice-abc.png': { text: 'TAX INVOICE\nInvoice No: SUP-INV-4410\nInvoice Date: 20/09/2026\nBill To: ABC Contracting LLC\nTRN: 100123456700003\nGrand Total: AED 26,250',
    ai: G({ document_type: 'tax_invoice', category: 'finance_document', document_owner_type: 'customer', document_number: 'SUP-INV-4410', issue_date: '2026-09-20', confidence: 0.95, fields: [{ key: 'customer_name', value: 'ABC Contracting LLC', confidence: 0.95 }, { key: 'trn', value: '100123456700003', confidence: 0.95 }, { key: 'amount', value: '26250', confidence: 0.9 }] }), needle: 'SUP-INV-4410' },
  'quotation-abc.png': { text: 'QUOTATION\nQuotation No: Q-7781\nDate: 01/09/2026\nCustomer: ABC Contracting LLC\nSupply of steel staircase\nTotal: AED 25,000',
    ai: G({ document_type: 'quotation', category: 'finance_document', document_owner_type: 'customer', document_number: 'Q-7781', issue_date: '2026-09-01', confidence: 0.92, fields: [{ key: 'customer_name', value: 'ABC Contracting LLC', confidence: 0.92 }] }), needle: 'Q-7781' },
  'delivery-note-abc.png': { text: 'DELIVERY NOTE\nDN No: DN-5512\nDate: 22/09/2026\nDelivered To: ABC Contracting LLC\nReceived By: Site Engineer',
    ai: G({ document_type: 'delivery_note', category: 'finance_document', document_owner_type: 'customer', document_number: 'DN-5512', issue_date: '2026-09-22', confidence: 0.92, fields: [{ key: 'customer_name', value: 'ABC Contracting LLC', confidence: 0.92 }] }), needle: 'DN-5512' },
  'mulkiya.png': { text: 'Roads and Transport Authority\nVEHICLE REGISTRATION CARD\nTraffic Plate No: Dubai K 45821\nOwner: AL SAQR AL AHMAR WELDING AND BLACKSMITH LLC\nRegistration Date: 05/06/2026\nExpiry Date: 04/06/2027',
    ai: G({ document_type: 'vehicle_registration', category: 'vehicle_document', document_owner_type: 'vehicle', company_name: 'AL SAQR AL AHMAR WELDING AND BLACKSMITH LLC', issue_date: '2026-06-05', expiry_date: '2027-06-04', confidence: 0.93, fields: [{ key: 'plate_number', value: 'Dubai K 45821', confidence: 0.92 }] }), needle: 'Dubai K 45821' },
  'insurance-hallucinated.png': { text: 'WORKMEN COMPENSATION INSURANCE POLICY\nPolicy No: WC/2026/1200\nInsured: AL SAQR AL AHMAR WELDING AND BLACKSMITH LLC\nPeriod of Insurance\nStart Date: 01/02/2026',
    ai: G({ document_type: 'company_insurance', category: 'company_document', document_owner_type: 'company', company_name: 'AL SAQR AL AHMAR WELDING AND BLACKSMITH LLC', document_number: 'WC/2026/1200', issue_date: '2026-02-01', expiry_date: '2028-01-31', confidence: 0.9 }), needle: 'WC/2026/1200' },
  'gemini-down.png': { text: 'MUNICIPALITY APPROVAL\nApproval No: MA-88\nFujairah Municipality\nIssue Date: 01/03/2026\nExpiry Date: 28/02/2027\nGEMINI-DOWN', ai: '__DOWN__', needle: 'GEMINI-DOWN' },
  'unreadable.png': { text: '__FAIL__' },
  'rate-limited.png': { text: '__RATE__' },
}
const files = Object.fromEntries(Object.keys(DOCS).map(n => [n, img(n)]))

try {
  console.log('\n[A1] Setup')
  await p.goto(`${BASE}/signup`); await p.getByLabel('Work email').fill('ai-owner@alsaqr.test'); await p.getByLabel('Password').fill('correct-horse-battery'); await p.getByRole('button', { name: 'Create account' }).click()
  await p.waitForURL('**/onboarding'); await p.getByLabel('Company name').fill('Al Saqr Al Ahmar Welding and Blacksmith LLC'); await p.getByLabel('Your full name').fill('AI Owner'); await p.getByRole('button', { name: 'Create company' }).click(); await p.waitForURL(`${BASE}/`)
  const co = (await one(`select p.company_id from profiles p join auth.users u on u.id=p.id where u.email='ai-owner@alsaqr.test'`)).company_id
  const ayub = (await one(`insert into employees(company_id,employee_no,full_name) values ($1,'EMP-004','Mohammed Ayub') returning id`, [co])).id
  await one(`insert into employees(company_id,employee_no,full_name) values ($1,'EMP-005','Mohammed Rafiq') returning id`, [co])
  const abc = (await one(`insert into customers(company_id,name,trn) values ($1,'ABC Contracting LLC','100123456700003') returning id`, [co])).id
  const truck = (await one(`insert into assets(company_id,kind,name,plate_or_serial) values ($1,'vehicle','Nissan Pickup','Dubai K 45821') returning id`, [co])).id
  const testImg = Buffer.from(/Buffer\.from\('([A-Za-z0-9+/=]+)', 'base64'\)/.exec(fs.readFileSync('lib/ai/ocr/types.ts', 'utf8'))[1], 'base64')
  await fixtures({
    ocr: { ...Object.fromEntries(Object.entries(DOCS).map(([n, d]) => [sha(files[n].buffer), d.text])), [sha(testImg)]: 'SAQRFLOW OCR TEST' },
    gemini: [...Object.values(DOCS).filter(d => d.ai).map(d => ({ needle: d.needle, response: d.ai })),
      { needle: 'SAMPLE TRADING LLC', response: G({ document_type: 'trade_license', company_name: 'SAMPLE TRADING LLC', document_number: '123456', issue_date: '2026-05-13', expiry_date: '2027-05-12' }) }],
  })

  console.log('\n[A2] Settings → AI & Automation')
  await p.goto(`${BASE}/settings`); await settle()
  const st = await p.locator('#ai').innerText()
  ok(st.includes('AI & Automation') && /OCR\.Space\s*Configured/.test(st) && /Google Gemini[^\n]*\n?[^\n]*Configured/.test(st) && /Google Cloud Vision\s*Not configured/.test(st), 'shows OCR.Space + Gemini configured, Google Vision not configured')
  ok(st.includes('••••••••-key') && !st.includes('test-ocr-key') && !st.includes('test-gemini-key'), 'API keys are masked (••••••••-key), never displayed')
  ok(!(await p.content()).includes('test-gemini-key'), 'no secret anywhere in the page HTML')
  await p.locator('#ai li', { hasText: 'OCR.Space' }).getByRole('button', { name: 'Test connection' }).click(); await settle(1500)
  ok(/OCR\.Space: Connected\. Test image read correctly/.test(await body()), 'Test connection: real request through the OCR.Space client succeeds')
  await p.locator('#ai li', { hasText: 'Google Gemini' }).getByRole('button', { name: 'Test AI' }).click(); await settle(1500)
  ok(/[Ss]ample trade licence classified correctly/.test(await body()), 'Test AI: Gemini structured output validated')
  await shot('40-settings-ai')

  console.log('\n[A3] Upload 13 documents (progress, OCR, Gemini)')
  await p.goto(`${BASE}/inbox`); await p.getByRole('button', { name: 'Upload documents' }).click()
  await dlg().locator('input[type=file]').setInputFiles(Object.values(files))
  await dlg().getByRole('button', { name: 'Upload & analyse' }).click()
  await p.waitForSelector('text=/Reading documents|Uploading/', { timeout: 15000 }).then(() => ok(true, 'live progress shown while uploading / reading')).catch(() => ok(false, 'live progress shown'))
  await p.waitForURL(/\/inbox\?batch=/, { timeout: 120000 }); await settle(1200)
  ok((await body()).includes('13 documents processed'), 'batch summary: 13 documents processed')
  await shot('41-inbox-batch')
  const rows = (await db.query(`select id,file_name,status,doc_type,confidence,review_reasons,suggestion,ocr_provider,ai_provider,error from document_inbox where company_id=$1`, [co])).rows
  const by = n => rows.find(r => r.file_name === n)
  const expect = { 'trade-license.png': 'trade_license', 'tenancy.png': 'tenancy_contract', 'passport.png': 'passport', 'emirates-id.png': 'emirates_id', 'visa-rashid.png': 'residence_visa', 'invoice-abc.png': 'tax_invoice', 'quotation-abc.png': 'quotation', 'delivery-note-abc.png': 'delivery_note', 'mulkiya.png': 'vehicle_registration' }
  for (const [n, t] of Object.entries(expect)) ok(by(n)?.doc_type === t && by(n)?.ocr_provider === 'ocrspace' && by(n)?.ai_provider === 'gemini', `${n} → ${t} (OCR.Space → Gemini)`)
  const c1 = await calls()
  ok(c1.ocrspace.every(x => x.engine === '2' && x.language === 'auto' && x.filetype === 'PNG'), 'OCR.Space called server-side with engine 2 / auto language / filetype')
  ok(c1.gemini.every(x => x.schema && x.mime === 'application/json' && x.model === 'gemini-2.5-flash:generateContent'), 'Gemini called with a JSON response schema (strict structured output)')
  const prompts = c1.gemini.map(x => x.prompt).join('\n')
  ok(!/784-?1990-?1234567-?6/.test(prompts) && !prompts.includes('BX1234567') && !prompts.includes('<<<') && prompts.includes('[REDACTED-ID]'), 'privacy: Emirates ID, passport number and MRZ never sent to Gemini')
  const ex = async n => (await one(`select fields from document_extractions where inbox_id=$1 order by created_at desc limit 1`, [by(n).id])).fields
  ok((await ex('emirates-id.png')).document_number?.value === '784-1990-1234567-6', 'EID number read locally (check digit verified) despite redaction')
  ok((await ex('passport.png')).document_number?.value === 'BX1234567', 'passport number read locally from the text/MRZ')
  ok(['ready'].includes(by('trade-license.png').status) && Number(by('trade-license.png').confidence) >= 0.9, `trade licence: ready, high confidence (${by('trade-license.png').confidence})`)
  ok(by('passport.png').suggestion.owner?.id === ayub && by('emirates-id.png').suggestion.owner?.id === ayub, 'passport + EID matched to existing employee Mohammed Ayub (not Mohammed Rafiq)')
  ok(by('visa-rashid.png').status === 'needs_review' && by('visa-rashid.png').review_reasons.join().includes('No matching employee'), 'unknown employee → needs review (no employee auto-created)')
  ok(by('invoice-abc.png').suggestion.owner?.id === abc && /TRN/.test(by('invoice-abc.png').suggestion.owner?.reason ?? ''), 'invoice matched to ABC Contracting by TRN')
  ok(by('mulkiya.png').suggestion.owner?.id === truck, 'Mulkiya matched to the vehicle by plate number')
  const hall = by('insurance-hallucinated.png'), hx = await ex('insurance-hallucinated.png')
  ok(!hx.expiry_date && hall.suggestion.warnings.some(w => /2028-01-31 does not appear in the document/.test(w)) && hall.status === 'needs_review', 'hallucination guard: AI expiry date not in the document is rejected → needs review')
  const gd = by('gemini-down.png')
  ok(gd.status === 'needs_review' && gd.doc_type === 'municipality_approval' && gd.review_reasons.some(r => /AI classification failed/.test(r)), 'Gemini failure → kept in Needs Review, local rules still classified it')
  const un = by('unreadable.png'), rl = by('rate-limited.png')
  ok(un.status === 'failed' && /OCR\.Space/.test(un.error ?? ''), `OCR failure → Failed with provider error (${(un.error ?? '').slice(0, 60)}…)`)
  ok(rl.status === 'failed' && /rate limit/i.test(rl.error ?? ''), 'OCR.Space rate limit → Failed with a clear message')
  const logs = await one(`select (select count(*)::int from ocr_logs where company_id=$1 and provider='ocrspace') o, (select count(*)::int from ocr_logs where company_id=$1 and not ok) f, (select count(*)::int from ai_processing_logs where company_id=$1 and purpose='classify') a, (select count(*)::int from ai_processing_logs where company_id=$1 and redacted) r`, [co])
  ok(logs.o >= 13 && logs.f >= 3 && logs.a >= 11 && logs.r >= 2, `OCR / AI logs recorded (ocr ${logs.o}, failures ${logs.f}, ai ${logs.a}, redacted ${logs.r})`)

  console.log('\n[A4] Review screen, confirm & file, new employee')
  await p.goto(`${BASE}/inbox/${by('trade-license.png').id}`); await settle()
  const rv = await body()
  ok(rv.includes('Document detected') && rv.includes('Trade License') && rv.includes('High confidence') && rv.includes('19 May 2027') && /OCR\.Space → Gemini/.test(rv), 'review: detected type, high-confidence band, dates, OCR → Gemini')
  ok(rv.includes('Company') && rv.includes('Company Documents') && rv.includes('Reprocess') && rv.includes('Delete upload'), 'review: destination path, Reprocess and Delete upload')
  await shot('42-review')
  await p.getByRole('button', { name: 'Confirm & File' }).click(); await p.waitForURL(/\/documents\//, { timeout: 20000 })
  const tl = await one(`select d.id,d.expiry_date::text e,d.reference_no,d.reminders_active,(select count(*)::int from document_relationships r where r.document_id=d.id and r.related_type='company') rel from documents d where d.source_inbox_id=$1`, [by('trade-license.png').id])
  ok(tl.e === '2027-05-19' && tl.reference_no === '7788123' && tl.reminders_active && tl.rel === 1, 'filed: expiry 2027-05-19, licence no., reminders on, linked to the company')
  ok((await one(`select count(*)::int n from reminder_sources where source_id=$1`, [tl.id])).n === 1, 'one reminder schedule for the trade licence (no duplicates)')
  await p.goto(`${BASE}/inbox/${by('visa-rashid.png').id}`); await settle()
  ok((await body()).includes('Create new employee'), 'unknown employee: “Create new employee” offered')
  await p.locator('select[name=owner_id]').selectOption('__new__'); await p.getByLabel('New employee name').fill('Rashid Khan')
  await p.getByRole('button', { name: 'Confirm & File' }).click(); await p.waitForURL(/\/documents\//, { timeout: 20000 })
  const rk = await one(`select e.id,e.employee_no,(select count(*)::int from documents d where d.owner_id=e.id) docs from employees e where e.company_id=$1 and e.full_name='Rashid Khan'`, [co])
  ok(rk && /^EMP-\d{3}$/.test(rk.employee_no) && rk.docs === 1, `new employee created only on explicit choice (${rk?.employee_no}) and the visa filed to them`)
  await p.goto(`${BASE}/inbox/${by('emirates-id.png').id}`); await settle()
  ok(/Possible match/.test(await body()) && /Mohammed Ayub · EMP-004 · 9\d%/.test(await p.locator('select[name=owner_id]').innerText()), 'existing employee shown as “Possible match — Mohammed Ayub · EMP-004 · 9x%”')
  await p.getByRole('button', { name: 'Confirm & File' }).click(); await p.waitForURL(/\/documents\//, { timeout: 20000 })
  await p.goto(`${BASE}/inbox/${by('mulkiya.png').id}`); await settle(); await p.getByRole('button', { name: 'Confirm & File' }).click(); await p.waitForURL(/\/documents\//, { timeout: 20000 })
  ok((await one(`select owner_type,owner_id from documents where source_inbox_id=$1`, [by('mulkiya.png').id])).owner_id === truck, 'Mulkiya filed under the vehicle (Vehicles → Nissan Pickup → Registration)')

  console.log('\n[A5] Duplicate + cache, retry with another provider')
  const before = (await calls()).ocrspace.length, beforeAi = (await calls()).gemini.length
  await p.goto(`${BASE}/inbox`); await p.getByRole('button', { name: 'Upload documents' }).click()
  await dlg().locator('input[type=file]').setInputFiles([files['trade-license.png']]); await dlg().getByRole('button', { name: 'Upload & analyse' }).click()
  await p.waitForURL(/\/inbox\?batch=/, { timeout: 60000 }); await settle()
  const dup = await one(`select id,status,suggestion from document_inbox where company_id=$1 and file_name='trade-license.png' order by created_at desc limit 1`, [co])
  ok(dup.status === 'duplicate' && dup.suggestion.duplicates.some(d => d.kind === 'same_file'), 'same file again → POSSIBLE DUPLICATE DETECTED')
  ok((await calls()).ocrspace.length === before && (await calls()).gemini.length === beforeAi, 'cached: no second OCR.Space or Gemini call for the identical file (cost control)')
  await p.goto(`${BASE}/inbox/${dup.id}`); await settle()
  ok((await body()).includes('Possible duplicate detected') && (await body()).includes('View existing') && (await body()).includes('Replace metadata'), 'duplicate options: View existing / New version / Replace metadata / Delete upload')
  await fixtures({ ocr: { [sha(files['unreadable.png'].buffer)]: 'WORKMEN COMPENSATION INSURANCE POLICY\nPolicy No: WC/2026/7777\nInsured: AL SAQR AL AHMAR WELDING AND BLACKSMITH LLC\nStart Date: 01/02/2026\nExpiry Date: 31/01/2027' } })
  await p.goto(`${BASE}/inbox/${un.id}`); await settle()
  ok((await body()).includes('Processing failed') && (await body()).includes('manually'), 'failed item explains retry / manual entry')
  await p.locator('select[name=ocr]').selectOption('ocrspace'); await p.getByRole('button', { name: 'Reprocess' }).click(); await settle(2500)
  const re = await one(`select status,doc_type,attempts from document_inbox where id=$1`, [un.id])
  ok(re.status !== 'failed' && re.doc_type === 'company_insurance' && re.attempts >= 2, `Reprocess with OCR.Space → ${re.status} (${re.doc_type}), attempt ${re.attempts}`)

  console.log('\n[A6] Inbox tabs & today')
  await p.goto(`${BASE}/inbox`); await settle()
  const ib = await body()
  ok(['All', 'Processing', 'Ready for review', 'Successfully filed', 'Needs review', 'Duplicates', 'Failed'].every(t => ib.includes(t)), 'tabs: All / Processing / Ready for review / Successfully filed / Needs review / Duplicates / Failed')
  ok(/Documents uploaded\s*14/.test(ib.replace(/\n+/g, ' ')), 'Today: documents uploaded 14')
  await p.goto(`${BASE}/inbox?tab=failed`); await settle()
  ok((await body()).includes('rate-limited.png') && !(await body()).includes('tenancy.png'), 'Failed tab lists only failed uploads')

  console.log('\n[A7] AI search + permissions')
  await fixtures({ gemini: [{ needle: 'expire within 400 days', response: { entity: 'documents', doc_type: null, person: null, customer: null, expiring_within_days: 400, expired: false, latest: false } }] })
  await p.goto(`${BASE}/assistant?q=${encodeURIComponent('Which documents expire within 400 days?')}`); await settle(2500)
  const s1 = await body()
  ok(/Understood by Gemini/.test(s1) && s1.includes('Trade License') && s1.includes('Emirates ID'), 'AI search (Gemini intent) lists trade licence + Emirates ID')
  await p.getByLabel('Ask a question about your documents').fill("Find Mohammed Ayub's Emirates ID"); await p.getByRole('button', { name: 'Search' }).click(); await settle(2000)
  ok(/1 emirates id for Mohammed Ayub/i.test(await body()), "“Find Mohammed Ayub's Emirates ID” → exactly his EID")
  await p.getByLabel('Ask a question about your documents').fill('Show invoices for ABC Contracting'); await p.getByRole('button', { name: 'Search' }).click(); await settle(2000)
  ok(/invoices for “ABC Contracting”/i.test(await body()), 'invoices for a customer understood')
  const v = await browser.newContext(); const vp = await v.newPage()
  await vp.goto(`${BASE}/signup`); await vp.getByLabel('Work email').fill('ai-viewer@alsaqr.test'); await vp.getByLabel('Password').fill('correct-horse-battery'); await vp.getByRole('button', { name: 'Create account' }).click(); await vp.waitForURL('**/onboarding')
  const vid = (await one(`select id from auth.users where email='ai-viewer@alsaqr.test'`)).id
  await db.query(`insert into profiles(id,company_id,full_name,role) values ($1,$2,'Viewer','viewer')`, [vid, co])
  await vp.goto(`${BASE}/assistant?q=${encodeURIComponent("Find Mohammed Ayub's Emirates ID")}`); await vp.waitForTimeout(2500)
  const vs = await vp.locator('body').innerText()
  ok(!/1 emirates id for Mohammed Ayub/i.test(vs) && !vs.includes('Emirates ID – Mohammed'), 'viewer: AI search cannot reveal employee identity documents (RLS)')
  ok((await vp.goto(`${BASE}/inbox/${by('passport.png').id}`)).status() === 404 || vp.url().endsWith('/'), 'viewer cannot open an unfiled passport upload')
  const r403 = await v.request.post(`${BASE}/api/inbox/${by('passport.png').id}/process`)
  ok([403, 404].includes(r403.status()), `viewer cannot trigger processing (${r403.status()})`)
  const anon = await browser.newContext()
  ok(!(await (await anon.request.post(`${BASE}/api/inbox/upload`, { maxRedirects: 0 })).text()).includes('"items"'), 'logged-out upload API refused')
  await shot('43-ai-search')
} catch (e) { ok(false, `aborted: ${e.stack || e}`) }
finally {
  await browser.close(); await db.end()
  const failed = results.filter(r => !r[0]).length
  console.log(`\nAI reader e2e: ${results.length - failed}/${results.length} passed`)
  process.exit(failed ? 1 : 0)
}
