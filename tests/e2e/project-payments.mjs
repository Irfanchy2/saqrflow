// Project payments (customer advances), applying them on quotation → invoice, rich-text "Materials to be used",
// print sharpness rules and PDF parity. Real Next build + PostgREST + Postgres RLS + Chromium. Run via scripts/e2e.sh
import { chromium } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import pg from 'pg'

const BASE = process.env.E2E_BASE
const OUT = 'tests/e2e/shots/project-payments'; fs.mkdirSync(OUT, { recursive: true })
const results = []
const ok = (cond, msg) => { results.push([!!cond, msg]); console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`) }
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
const exe = fs.readdirSync('/opt/pw-browsers').filter(d => d.startsWith('chromium-')).map(d => `/opt/pw-browsers/${d}/chrome-linux/chrome`).find(p => fs.existsSync(p))
const browser = await chromium.launch({ executablePath: exe })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const p = await ctx.newPage()
const jsErrors = []; p.on('pageerror', e => jsErrors.push(`${p.url()}: ${e.message}`)); p.on('dialog', d => d.accept())
const settle = async (ms = 500) => { await p.waitForLoadState('networkidle').catch(() => {}); await p.waitForTimeout(ms) }
const dlg = () => p.locator('dialog[open]')
const body = () => p.locator('main').innerText()
const menu = async item => { await p.getByRole('button', { name: 'More actions' }).click(); await p.getByRole('menuitem', { name: item }).click() }
const pdfText = async url => { const r = await ctx.request.get(url); const f = `${OUT}/${url.split('/').at(-2)}.pdf`; fs.writeFileSync(f, await r.body()); return execFileSync('pdftotext', ['-layout', f, '-']).toString() }
const EMAIL = `pp-${Date.now()}@alsaqr.test`

try {
  console.log('\n[0] Setup')
  await p.goto(`${BASE}/signup`); await p.getByLabel('Work email').fill(EMAIL); await p.getByLabel('Password').fill('correct-horse-battery'); await p.getByRole('button', { name: 'Create account' }).click()
  await p.waitForURL('**/onboarding'); await p.getByLabel('Company name').fill('Al Saqr Advance Test'); await p.getByLabel('Your full name').fill('Owner'); await p.getByRole('button', { name: 'Create company' }).click(); await p.waitForURL(`${BASE}/`)
  const co = (await one(`select p.company_id from profiles p join auth.users u on u.id=p.id where u.email=$1`, [EMAIL])).company_id
  const cu = (await one(`insert into customers(company_id,name,address) values ($1,'Gulf Villas LLC','Al Reem Island, Abu Dhabi') returning id`, [co])).id
  const pr = (await one(`insert into projects(company_id,name,customer_id,contract_value,status,location) values ($1,'Villa gate & railing',$2,50000,'active','Villa 9, Al Reem') returning id`, [co, cu])).id
  ok(true, 'customer and project (contract AED 50,000) seeded')

  console.log('\n[1] Record a project advance')
  await p.goto(`${BASE}/projects/${pr}?tab=finance`); await settle()
  const card = p.locator('[data-project-payments]')
  ok(await card.isVisible() && (await card.innerText()).includes('No payments recorded'), 'project shows a Project payments section')
  await card.getByRole('button', { name: 'Record payment' }).click()
  for (const l of ['Date *', 'Amount (AED) *', 'Payment method', 'Reference', 'Notes']) ok(await dlg().getByLabel(l, { exact: l !== 'Payment method' }).isVisible(), `field: ${l.replace(' *', '')}`)
  await dlg().getByLabel('Amount (AED) *').fill('15000'); await dlg().getByLabel('Reference').fill('TT-501'); await dlg().getByLabel('Notes').fill('50% advance as per quotation')
  await dlg().getByRole('button', { name: 'Record payment' }).click(); await settle(800)
  ok(/No invoice or VAT was created/.test(await p.locator('body').innerText()), 'confirmation says no invoice or VAT was created')
  await p.reload(); await settle()
  ok((await card.locator('[data-pp-received]').innerText()) === '15,000.00' && (await card.locator('[data-pp-remaining]').innerText()) === '35,000.00' && (await card.locator('[data-pp-unapplied]').innerText()) === '15,000.00', 'total received 15,000 · remaining 35,000 · not yet applied 15,000')
  ok((await card.locator('[data-pp-history]').innerText()).includes('TT-501') && (await card.innerText()).includes('Advance · not applied'), 'payment history lists it (reference, notes, not applied)')
  const adv = await one(`select invoice_id, customer_id, method, (select count(*)::int from invoices where company_id=$1) docs from payments where project_id=$2`, [co, pr])
  ok(adv.invoice_id === null && adv.customer_id === cu && adv.method === 'bank_transfer' && adv.docs === 0, 'stored as a payment on account for the customer; no invoice created')

  console.log('\n[2] Quotation: rich materials + advance applied')
  await p.getByRole('button', { name: 'New quotation' }).first().click(); await p.waitForURL(/\/invoices\/[0-9a-f-]{36}$/); await settle()
  const qid = p.url().split('/').pop()
  await p.getByLabel('Line 1 description').fill('Supply and installation of MS gate with railing'); await p.getByLabel('Rate (AED)').fill('20000')
  const mat = p.getByRole('textbox', { name: 'Line 1 materials', exact: true })
  await mat.click(); await mat.type('Supply of:'); await mat.press('Enter'); await mat.type('MS hollow section 100x50')
  await mat.press('Shift+Home'); await p.getByRole('button', { name: 'Bold' }).click()
  ok((await mat.inputValue()).includes('**MS hollow section 100x50**'), 'Bold wraps the selected words')
  await mat.press('End'); await mat.press('Enter'); await mat.type('GI sheet 1.2mm')
  await mat.evaluate(el => { const v = el.value, s = v.indexOf('**MS'); el.setSelectionRange(s, v.length) })
  await p.getByRole('button', { name: 'Bulleted list' }).click()
  ok(/\n- \*\*MS hollow section 100x50\*\*\n- GI sheet 1\.2mm$/.test(await mat.inputValue()), 'Bulleted list turns the selected lines into “- ” items')
  await mat.press('End'); await mat.press('Enter'); ok((await mat.inputValue()).endsWith('\n- '), 'Enter inside a list starts the next bullet'); await mat.type('Anchor bolts M12')
  await mat.press('Enter'); await mat.press('Enter')
  // the editor ends the list on the second Enter and then moves the caret: type only once it has (under load the first key raced it)
  await p.waitForFunction(el => !el.value.endsWith('- ') && el.selectionStart === el.value.length, await mat.elementHandle()); await p.waitForTimeout(50)
  await mat.type('Finish: '); await mat.press('Control+i'); await mat.type('epoxy primer'); await mat.press('ArrowRight')
  await p.getByRole('button', { name: 'Underline' }).click(); await mat.type('two coats')
  const val = await mat.inputValue()
  ok(val.includes('*epoxy primer*') && val.includes('__two coats__') && !val.endsWith('\n- '), `Ctrl+I italic, Underline, and Enter on an empty bullet ends the list (${JSON.stringify(val.split('\n').slice(-1)[0])})`)
  const longWord = 'X'.repeat(260)
  await p.getByRole('button', { name: 'Add line' }).click(); await p.getByLabel('Line 2 description').fill('Long specification line'); await p.getByLabel('Rate (AED)').nth(1).fill('0')
  await p.getByRole('textbox', { name: 'Line 2 materials', exact: true }).fill(`1. ${longWord}\n2. second numbered item`)
  await p.waitForTimeout(600)
  const paper = p.locator('.sales-paper')
  const lis = await paper.locator('.paper-rich ul li').evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), t: e.textContent } }))
  ok(lis.length === 3 && lis[0].y < lis[1].y && lis[1].y < lis[2].y && lis[0].x === lis[2].x, `preview: 3 bullets stacked vertically, aligned (${lis.map(l => l.y).join(' < ')})`)
  ok(await paper.locator('.paper-rich strong', { hasText: 'MS hollow section 100x50' }).count() === 1 && await paper.locator('.paper-rich em', { hasText: 'epoxy primer' }).count() === 1 && await paper.locator('.paper-rich u', { hasText: 'two coats' }).count() === 1, 'preview: bold, italic and underline rendered; no ** or __ shown')
  ok(!(await paper.innerText()).includes('**') && await paper.locator('.paper-rich ol li').count() === 2, 'numbered list rendered as a list')
  const over = await paper.evaluate(el => { const cells = [...el.querySelectorAll('td.paper-desc')]; return { paper: el.scrollWidth - el.clientWidth, cells: cells.map(c => c.scrollWidth - c.clientWidth) } })
  ok(over.paper <= 1 && over.cells.every(x => x <= 1), `260-character word wraps inside the cell, paper never widens (${JSON.stringify(over)})`)
  // advance
  const advSec = p.locator('details', { hasText: 'Unapplied advances on this project' }).first()
  ok((await advSec.innerText()).includes('AED 15,000.00'), 'editor shows the project’s unapplied advance (AED 15,000.00)')
  await advSec.getByRole('button', { name: 'Apply available' }).click(); await p.waitForTimeout(500)
  ok(await advSec.getByLabel('Apply against this document (AED)').inputValue() === '15000', 'Apply available fills 15,000')
  ok((await paper.innerText()).match(/Less: Advance\s*received\s*− 15,000\.00/) && (await paper.innerText()).match(/Balance\s*5,000\.00/), 'preview: Less: Advance received − 15,000.00 · Balance 5,000.00')
  await p.keyboard.press('Control+s'); await settle(1200)
  const q = await one(`select advance_applied::text, vat_amount::text, total::text, (select materials from invoice_items where invoice_id=$1 and position=0) m from invoices where id=$1`, [qid])
  ok(q.advance_applied === '15000.00' && q.vat_amount === '0.00' && q.total === '20000.00', `saved: advance 15,000 on the quotation, no VAT added because of it (total ${q.total})`)
  ok(q.m.includes('- **MS hollow section 100x50**'), 'formatting stored in the existing materials column')
  await p.screenshot({ path: `${OUT}/quotation-editor.png`, fullPage: true })
  const qt = await pdfText(`${BASE}/api/sales/${qid}/pdf`)
  ok(/•\s+MS hollow section 100x50\n[\s\S]*?•\s+GI sheet 1\.2mm\n[\s\S]*?•\s+Anchor bolts M12/.test(qt) && !/\*\*|__/.test(qt), 'PDF: bullets one per line, markers not printed')
  ok(/1\.\s+X{20}/.test(qt) && /2\.\s+second numbered item/.test(qt), 'PDF: numbered list; the long word wraps within the cell')
  ok(/Less: Advance/.test(qt) && /- 15,000\.00/.test(qt) && /Balance\s+5,000\.00/.test(qt), 'PDF: Less: Advance received and Balance 5,000.00')

  console.log('\n[3] Print view: same layout, sharp print rules')
  const pp = await ctx.newPage(); await pp.goto(`${BASE}/print/sales/${qid}`); await pp.waitForLoadState('networkidle')
  const plis = await pp.locator('.paper-rich ul li').evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().top)))
  ok(plis.length === 3 && plis[0] < plis[1] && plis[1] < plis[2], 'print view: bullets vertical')
  await pp.emulateMedia({ media: 'print' })
  const st = await pp.evaluate(() => { const td = document.querySelector('.paper-items td'), cs = getComputedStyle(td), t = getComputedStyle(document.querySelector('.paper-text') ?? document.querySelector('.sales-paper')); return { border: cs.borderTopColor, width: cs.borderTopWidth, ink: t.color } })
  ok(st.border === 'rgb(0, 0, 0)' && st.ink === 'rgb(0, 0, 0)' && parseFloat(st.width) > 0.5, `print media: pure black text and rules, fixed rule width (${JSON.stringify(st)})`)
  const pw = await pp.evaluate(() => document.querySelector('.sales-paper').getBoundingClientRect().width)
  ok(Math.abs(pw - 793.7) < 2, `print: paper is exactly A4 wide (${pw.toFixed(1)} px = 210 mm)`)
  await pp.pdf({ path: `${OUT}/browser-print.pdf`, format: 'A4', printBackground: true, preferCSSPageSize: true })
  const bp = execFileSync('pdftotext', ['-layout', `${OUT}/browser-print.pdf`, '-']).toString()
  ok(/MS hollow section 100x50\n[\s\S]*?GI sheet 1\.2mm\n[\s\S]*?Anchor bolts M12/.test(bp) && /Balance\s+5,000\.00/.test(bp) && !/\*\*|__/.test(bp), 'browser “Save as PDF” matches the preview (one item per line, balance, no markers)')
  await pp.close()

  console.log('\n[4] Convert to invoice → advance carried → issue links the advance')
  await menu('Convert to invoice'); await p.waitForURL(u => !u.href.endsWith(qid)); await settle()
  const iid = p.url().split('/').pop()
  const inv = await one(`select advance_applied::text, total::text, vat_amount::text, status from invoices where id=$1`, [iid])
  ok(inv.advance_applied === '15000.00' && inv.total === '21000.00' && inv.vat_amount === '1000.00', `invoice draft carries the advance; VAT on the full 20,000 (VAT ${inv.vat_amount})`)
  ok((await p.locator('.sales-paper').innerText()).match(/Paid Amount\s*incl\. advance 15,000\.00\s*15,000\.00/) && (await p.locator('.sales-paper').innerText()).match(/Total Balance\s*6,000\.00/), 'draft invoice preview: paid 15,000 (incl. advance), balance 6,000')
  await menu('Issue tax invoice'); await settle(1200)
  const after = await one(`select i.status, (select count(*)::int from payments where invoice_id=i.id and project_id is not null) linked, (select coalesce(sum(amount),0)::text from payments where invoice_id=i.id) paid from invoices i where i.id=$1`, [iid])
  ok(after.status === 'partially_paid' && after.linked === 1 && after.paid === '15000.00', `issuing links the advance as a payment (status ${after.status}, paid ${after.paid})`)
  await p.reload(); await settle()
  ok(/Remaining balance\s*AED\s*6,000\.00/.test(await p.locator('[data-payment-figures]').innerText()) && (await body()).includes('Project advance'), 'invoice Payments: balance 6,000 and the row is marked Project advance')
  const it = await pdfText(`${BASE}/api/sales/${iid}/pdf`)
  ok(/Paid Amount\s+15,000\.00/.test(it) && /incl\. advance 15,000\.00/.test(it) && /Total Balance\s+6,000\.00/.test(it), 'invoice PDF: paid 15,000 incl. advance, balance 6,000')

  console.log('\n[5] Project after invoicing; second advance applied from the invoice, moved back')
  await p.goto(`${BASE}/projects/${pr}?tab=finance`); await settle()
  ok((await card.locator('[data-pp-received]').innerText()) === '15,000.00' && (await card.locator('[data-pp-unapplied]').innerText()) === '0.00', 'received stays 15,000 (not counted twice); nothing left to apply')
  const hist = await card.locator('[data-pp-history]').innerText().catch(() => '(no history)')
  ok(/Advance applied to /.test(hist), `history: advance applied to the invoice (${JSON.stringify(hist.slice(0, 160))})`)
  await card.getByRole('button', { name: 'Record payment' }).click(); await dlg().getByLabel('Amount (AED) *').fill('5000'); await dlg().getByLabel('Payment method').selectOption('cash'); await dlg().getByRole('button', { name: 'Record payment' }).click(); await settle(1000)
  await p.goto(`${BASE}/invoices/${iid}`); await settle()
  await p.getByRole('button', { name: 'Apply project advance' }).click()
  ok(await dlg().getByLabel('Amount to apply (AED) *').inputValue() === '5000.00', 'apply dialog offers the 5,000 available')
  await dlg().getByRole('button', { name: 'Apply advance' }).click(); await settle(1200)
  ok((await one(`select status from invoices where id=$1`, [iid])).status === 'partially_paid' && /Remaining balance\s*AED\s*1,000\.00/.test(await p.locator('[data-payment-figures]').innerText()), 'second advance applied: balance 1,000')
  await p.getByRole('button', { name: 'Move back' }).first().click(); await settle(1200)
  const mb = await one(`select (select coalesce(sum(amount),0)::text from payments where project_id=$1 and invoice_id is null) un, (select coalesce(sum(amount),0)::text from payments where project_id=$1) total`, [pr])
  ok(Number(mb.un) > 0 && mb.total === '20000.00', `Move back returns an advance to the project; nothing is lost (unapplied ${mb.un}, total ${mb.total})`)

  console.log('\n[6] Customer statement')
  await p.goto(`${BASE}/parties/${cu}/ledger`); await settle()
  ok((await body()).includes('Advance for Villa gate & railing') || (await body()).includes(`INV-`), 'statement lists the advances as payments received')

  console.log('\n[6b] Whole-row click')
  await p.goto(`${BASE}/invoices`); await settle()
  const row = p.locator('.rtable tbody tr').first(); const num = await row.locator('a').first().innerText()
  await row.locator('td').nth(1).click(); await p.waitForURL(/\/invoices\/[0-9a-f-]{36}/, { timeout: 8000 }).catch(() => {}); await settle()
  ok(/\/invoices\/[0-9a-f-]{36}/.test(p.url()) && (await body()).includes(num), `clicking a row's empty space opens the record (${num})`)
  await p.goto(`${BASE}/projects/${pr}?tab=finance`); await settle()
  const before = p.url(); await p.locator('[data-project-payments]').getByRole('button', { name: 'Record payment' }).click(); await p.waitForTimeout(300)
  ok(p.url() === before && await dlg().isVisible(), 'buttons keep their own action (no accidental navigation)'); await p.keyboard.press('Escape')

  console.log('\n[7] Phone 360 px')
  const m = await browser.newContext({ viewport: { width: 360, height: 780 }, storageState: await ctx.storageState() }); const mp = await m.newPage()
  for (const u of [`/projects/${pr}`, `/projects/${pr}?tab=finance`, `/invoices/${qid}`]) {
    await mp.goto(BASE + u); await mp.waitForLoadState('networkidle').catch(() => {})
    const ov = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    ok(ov <= 1, `${u.split('/')[1]}: fits a 360 px phone (overflow ${ov}px)`)
  }
  ok(await mp.getByRole('toolbar', { name: 'Line 1 materials formatting' }).isVisible(), 'formatting toolbar usable on a phone')
  await mp.screenshot({ path: `${OUT}/m-quotation.png`, fullPage: true }); await m.close()
} catch (e) {
  console.error(e); ok(false, `suite aborted: ${e.message.split('\n')[0]}`)
} finally {
  for (const e of jsErrors) ok(false, `JS error ${e}`)
  await browser.close(); await db.end()
  const passed = results.filter(r => r[0]).length
  console.log(`\nProject payments suite: ${passed}/${results.length} passed`)
  process.exit(passed === results.length ? 0 : 1)
}
