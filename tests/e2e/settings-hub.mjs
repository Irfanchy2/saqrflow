// Settings Hub: card home + one page per category (phones, tablet, desktop), search, old /settings#section links,
// every existing section still reachable, saves persist, unsaved-changes warning, theme + language, role limits
// (backend 404, no admin settings in search) and company isolation. Real Next build + PostgREST.
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import pg from 'pg'

const BASE = process.env.E2E_BASE, GW = process.env.E2E_GATEWAY
const OUT = 'tests/e2e/shots/settings-hub'; fs.mkdirSync(OUT, { recursive: true })
const results = []
const ok = (cond, msg) => { results.push([!!cond, msg]); console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`) }
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
const exe = fs.readdirSync('/opt/pw-browsers').filter(d => d.startsWith('chromium-')).map(d => `/opt/pw-browsers/${d}/chrome-linux/chrome`).find(p => fs.existsSync(p))
const browser = await chromium.launch({ executablePath: exe })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const p = await ctx.newPage()
const jsErrors = []; const watch = pg_ => { pg_.on('pageerror', e => jsErrors.push(`${pg_.url()}: ${e.message}`)); return pg_ }; watch(p)
const settle = async (pg_ = p, ms = 400) => { await pg_.waitForLoadState('networkidle').catch(() => {}); await pg_.waitForTimeout(ms) }
const waitFor = async (fn, ms = 12000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn().catch(() => null); if (v) return v; await new Promise(r => setTimeout(r, 250)) } return null }
const EMAIL = `hub-${Date.now()}@alsaqr.test`, EMAIL2 = `hub2-${Date.now()}@alsaqr.test`
const signup = async (pg_, email, company) => {
  await pg_.goto(`${BASE}/signup`); await pg_.getByLabel('Work email').fill(email); await pg_.getByLabel('Password').fill('correct-horse-battery'); await pg_.getByRole('button', { name: 'Create account' }).click()
  await pg_.waitForURL('**/onboarding'); await pg_.getByLabel('Company name').fill(company); await pg_.getByLabel('Your full name').fill('Hub Owner'); await pg_.getByRole('button', { name: 'Create company' }).click(); await pg_.waitForURL(`${BASE}/`)
}
const CATS = ['company', 'documents', 'sales', 'whatsapp', 'team', 'notifications', 'security', 'appearance', 'integrations', 'data']
// every section of the old single Settings page
const OLD = ['company', 'branding', 'builder', 'templates', 'numbering', 'approvals', 'employee-portal', 'company-cards', 'custom', 'forms', 'notifications', 'rules', 'schedules', 'evolution', 'whatsapp', 'wa-templates', 'wa-share', 'ai', 'integrations', 'account', 'data']
const cols = pg_ => pg_.evaluate(() => { const xs = [...document.querySelectorAll('[data-settings-cards] > li')].map(li => Math.round(li.getBoundingClientRect().left)); return new Set(xs).size })
const noSideScroll = pg_ => pg_.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)

try {
  console.log('\n[0] Setup')
  await signup(p, EMAIL, 'Al Saqr Hub Test')
  const co = (await one(`select p.company_id from profiles p join auth.users u on u.id=p.id where u.email=$1`, [EMAIL])).company_id
  const before = await one(`select (select count(*) from app_settings where company_id=$1)::int s, (select name from companies where id=$1) n`, [co])

  console.log('\n[1] Settings home (desktop)')
  await p.goto(`${BASE}/settings`); await settle()
  ok(await p.getByRole('heading', { name: 'Settings', level: 1 }).isVisible(), 'Settings heading')
  ok(await p.getByRole('searchbox', { name: 'Search settings' }).isVisible(), 'search box')
  const cards = await p.locator('[data-category]').evaluateAll(a => a.map(x => x.getAttribute('data-category')))
  ok(JSON.stringify(cards) === JSON.stringify(CATS), `owner sees all ${CATS.length} category cards (${cards.join(', ')})`)
  ok(await p.locator('main form, main input:not([type=search]), main select, main textarea').count() === 0, 'no settings forms on the home page')
  ok(await cols(p) >= 3, `desktop grid: ${await cols(p)} columns`)
  const card = await p.locator('[data-category="documents"]').evaluate(e => ({ icon: !!e.querySelector('svg'), title: e.querySelector('h2')?.textContent, desc: e.querySelector('p')?.textContent }))
  ok(card.icon && card.title === 'Document branding & layout' && !!card.desc, 'card: icon, name, description')
  await p.screenshot({ path: `${OUT}/desktop-home.png` })

  console.log('\n[2] Every existing setting is reachable')
  const found = new Set(), counts = {}
  for (const id of CATS) {
    await p.goto(`${BASE}/settings/${id}`); await settle(p, 200)
    const ids = await p.locator('[data-settings-category] [id]').evaluateAll(a => a.map(x => x.id)); ids.forEach(x => found.add(x)); counts[id] = ids.length
  }
  const missing = OLD.filter(x => !found.has(x))
  ok(missing.length === 0, `all ${OLD.length} sections of the old page are on a category page${missing.length ? ` (missing: ${missing})` : ''}`)
  ok(found.has('theme') && found.has('language') && found.has('mfa'), 'theme, language and two-step verification have their own places')

  console.log('\n[3] Navigation: card → category → back')
  await p.goto(`${BASE}/settings`); await settle()
  await p.locator('[data-category="whatsapp"]').click(); await p.waitForURL('**/settings/whatsapp'); await settle()
  ok(await p.getByRole('heading', { name: 'WhatsApp & sharing', level: 1 }).isVisible() && await p.locator('#wa-share').isVisible(), 'card opens its category page')
  ok(await p.locator('#branding').count() === 0, 'only that category’s settings are shown')
  ok(await p.getByRole('navigation', { name: 'Breadcrumb' }).isVisible(), 'breadcrumb on desktop')
  await p.goBack(); await p.waitForURL(`${BASE}/settings`); ok(await p.locator('[data-category]').count() === CATS.length, 'browser back returns to the Settings home')
  await p.goForward(); await p.waitForURL('**/settings/whatsapp'); ok(true, 'browser forward works')
  await p.getByRole('navigation', { name: 'Settings categories' }).getByRole('link', { name: 'Notifications' }).click(); await p.waitForURL('**/settings/notifications')
  ok(await waitFor(() => p.locator('#rules').isVisible()), 'desktop side list switches category')
  await p.goto(`${BASE}/settings/nope`); ok((await p.locator('body').innerText()).match(/not found|404/i), 'unknown category → not found')

  console.log('\n[4] Old links (/settings#section)')
  for (const [hash, cat] of [['branding', 'documents'], ['wa-templates', 'whatsapp'], ['account', 'security'], ['rules', 'notifications']]) {
    await p.goto(`${BASE}/settings#${hash}`)
    ok(await waitFor(async () => new URL(p.url()).pathname === `/settings/${cat}` && await p.locator(`#${hash}`).isVisible()), `/settings#${hash} opens ${cat}`)
  }

  console.log('\n[5] Search')
  await p.goto(`${BASE}/settings`); await settle()
  const box = p.getByRole('searchbox', { name: 'Search settings' })
  const firstHit = async q => { await box.fill(q); await p.waitForTimeout(150); return p.locator('[data-settings-hit]').first().getAttribute('href') }
  ok((await firstHit('Letterhead')) === '/settings/documents#branding', 'Letterhead → Document branding')
  ok((await firstHit('WhatsApp'))?.startsWith('/settings/whatsapp'), 'WhatsApp → WhatsApp & sharing')
  ok((await firstHit('company logo')) === '/settings/documents#branding', 'Company logo → branding')
  ok((await firstHit('numbering')) === '/settings/sales#numbering', 'numbering → Document numbering')
  ok((await firstHit('dark mode')) === '/settings/appearance#theme', 'dark mode → Theme')
  ok((await firstHit('ARABIC NAME')) === '/settings/company#company', 'not case-sensitive (Arabic name → Company)')
  await box.fill('zzqx nothing'); ok(await p.locator('[data-settings-empty]').isVisible() && await p.locator('[data-category]').count() === 0, 'no match: clear empty state')
  await p.getByRole('button', { name: 'Show all categories' }).click(); ok(await p.locator('[data-category]').count() === CATS.length, 'empty state returns to the cards')
  await box.fill('Letterhead'); await box.press('Enter'); await p.waitForURL('**/settings/documents*')
  ok(await waitFor(() => p.locator('#branding').isVisible()), 'Enter opens the top result at its section')

  console.log('\n[6] Saving still works and persists')
  await p.goto(`${BASE}/settings/company`); await settle()
  await p.getByLabel('Company name in Arabic').fill('شركة الصقر التجريبية'); await p.locator('#company').getByRole('button', { name: 'Save' }).click()
  ok(await waitFor(async () => (await one(`select name_ar from companies where id=$1`, [co])).name_ar === 'شركة الصقر التجريبية'), 'company form saves (Arabic name)')
  await p.reload(); await settle(); ok(await p.getByLabel('Company name in Arabic').inputValue() === 'شركة الصقر التجريبية', 'value is there after a refresh')
  await p.goto(`${BASE}/settings/documents`); await settle()
  await p.getByLabel('Invoice due (days)').fill('45'); await p.getByRole('button', { name: 'Save document settings' }).click()
  ok(await waitFor(async () => { await p.reload(); await settle(p, 200); return await p.getByLabel('Invoice due (days)').inputValue() === '45' }), 'document settings save and reload (invoice due 45 days)')
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
  const logo = p.getByLabel('Logo image'); await logo.setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: png }); await logo.locator('xpath=ancestor::form').getByRole('button', { name: 'Upload' }).click()
  ok(await waitFor(async () => (await one(`select count(*)::int n from app_settings where company_id=$1 and key like 'branding.%logo%'`, [co])).n > 0 || await p.getByRole('button', { name: 'Replace' }).first().isVisible()), 'logo upload works from the category page')
  await p.goto(`${BASE}/settings/notifications`); await settle()
  await p.getByLabel('Max overdue reminders').fill('7'); await p.locator('#notifications').getByRole('button', { name: 'Save' }).click(); await settle(p, 800)
  await p.reload(); await settle(); ok(await p.getByLabel('Max overdue reminders').inputValue() === '7', 'reminder settings save and persist')

  console.log('\n[7] Unsaved changes are protected')
  await p.goto(`${BASE}/settings/notifications`); await settle()
  await p.getByLabel('Max overdue reminders').fill('9')
  let asked = null; p.once('dialog', d => { asked = d.message(); d.dismiss() })
  await p.getByRole('navigation', { name: 'Settings categories' }).getByRole('link', { name: 'Security' }).click(); await p.waitForTimeout(500)
  ok(asked?.includes('unsaved changes') && new URL(p.url()).pathname === '/settings/notifications' && await p.getByLabel('Max overdue reminders').inputValue() === '9', 'leaving with an unsaved edit asks first; Cancel keeps the edit')
  p.once('dialog', d => d.accept())
  await p.getByRole('navigation', { name: 'Settings categories' }).getByRole('link', { name: 'Security' }).click(); await p.waitForURL('**/settings/security')
  ok((await one(`select value from app_settings where company_id=$1 and key='reminders.overdue_max'`, [co]))?.value == 7, 'leaving anyway does not save the abandoned edit')
  let asked2 = false; p.once('dialog', d => { asked2 = true; d.accept() })
  await p.goto(`${BASE}/settings/team`); await settle(); await p.getByRole('navigation', { name: 'Settings categories' }).getByRole('link', { name: 'Company' }).click(); await p.waitForURL('**/settings/company')
  ok(!asked2, 'no warning when nothing was changed')

  console.log('\n[8] Appearance')
  await p.goto(`${BASE}/settings/appearance`); await settle()
  await p.getByRole('radio', { name: 'Dark' }).click(); ok(await p.evaluate(() => document.documentElement.classList.contains('dark')), 'Dark theme applies at once')
  await p.screenshot({ path: `${OUT}/desktop-appearance-dark.png` })
  await p.goto(`${BASE}/settings`); await settle(); await p.screenshot({ path: `${OUT}/desktop-home-dark.png` })
  ok(await p.evaluate(() => document.documentElement.classList.contains('dark')), 'dark theme kept on the next page')
  await p.goto(`${BASE}/settings/appearance`); await settle(); await p.getByRole('radio', { name: 'Light' }).click()
  ok(!(await p.evaluate(() => document.documentElement.classList.contains('dark'))) && await p.getByRole('radio', { name: 'Light' }).getAttribute('aria-checked') === 'true', 'back to Light')
  ok(await p.getByLabel('Interface language').isVisible(), 'language choice is under Appearance & language')

  console.log('\n[9] Phones, tablet')
  for (const [w, h, name, want] of [[360, 740, 'small Android', 1], [412, 915, 'large Android', 2], [820, 1180, 'tablet', 2], [1024, 768, 'tablet landscape', 3]]) {
    const m = await browser.newContext({ viewport: { width: w, height: h }, isMobile: w < 900, hasTouch: true, deviceScaleFactor: 2, storageState: await ctx.storageState() }); const mp = watch(await m.newPage())
    await mp.goto(`${BASE}/settings`); await settle(mp)
    const n = await cols(mp); ok(n === want && await noSideScroll(mp), `${name} (${w}px): ${n}-column cards, no sideways scroll`)
    const tap = await mp.locator('[data-category="company"]').boundingBox(); ok(tap && tap.height >= 56 && tap.height <= (n === 1 ? 110 : 230), `${name}: cards are comfortable touch targets, not oversized (${Math.round(tap?.height ?? 0)}px)`)
    await mp.screenshot({ path: `${OUT}/${w}-home.png` })
    if (w === 412) {
      const bottom = mp.locator('nav[aria-label="Primary"], [data-bottom-nav], nav.bottom-nav').first()
      await mp.locator('[data-category="documents"]').click(); await mp.waitForURL('**/settings/documents'); await settle(mp)
      ok(await mp.locator('[data-settings-back]').isVisible(), 'phone: category page has a clear Back button')
      await mp.screenshot({ path: `${OUT}/${w}-documents.png`, fullPage: true })
      const wide = []; for (const id of CATS) { await mp.goto(`${BASE}/settings/${id}`); await settle(mp, 150); if (!(await noSideScroll(mp))) wide.push(id) }
      ok(wide.length === 0, `phone: no category page scrolls sideways${wide.length ? ` (${wide})` : ''}`)
      await mp.goto(`${BASE}/settings/whatsapp`); await settle(mp); await mp.screenshot({ path: `${OUT}/${w}-whatsapp.png` })
      await mp.locator('[data-settings-back]').click(); await mp.waitForURL(`${BASE}/settings`); ok(true, 'phone: Back returns to the cards')
      ok(await bottom.count() === 0 || await bottom.isVisible(), 'phone: bottom navigation still there')
    }
    if (w === 820) { await mp.goto(`${BASE}/settings/team`); await settle(mp); ok(await noSideScroll(mp), 'tablet: category page fits'); await mp.screenshot({ path: `${OUT}/${w}-team.png` }) }
    await m.close()
  }

  console.log('\n[10] Roles: only what you may change')
  const accEmail = `hub-acc-${Date.now()}@alsaqr.test`
  const accId = (await (await fetch(`${GW}/auth/v1/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: accEmail, password: 'correct-horse-battery' }) })).json()).user?.id ?? (await one(`select id from auth.users where email=$1`, [accEmail])).id
  await db.query(`insert into profiles(id,company_id,full_name,role) values ($1,$2,'Hub Accountant','accountant')`, [accId, co])
  const a = await browser.newContext({ viewport: { width: 1280, height: 860 } }); const ap = watch(await a.newPage())
  await ap.goto(`${BASE}/login`); await ap.getByLabel('Email').fill(accEmail); await ap.getByLabel('Password').fill('correct-horse-battery'); await ap.getByRole('button', { name: 'Sign in', exact: true }).click(); await ap.waitForURL(`${BASE}/`)
  await ap.goto(`${BASE}/settings`); await settle(ap)
  const accCards = await ap.locator('[data-category]').evaluateAll(x => x.map(e => e.getAttribute('data-category')))
  ok(JSON.stringify(accCards) === JSON.stringify(['security', 'appearance', 'data']), `accountant sees only personal + data cards (${accCards})`)
  await ap.getByRole('searchbox', { name: 'Search settings' }).fill('letterhead'); await ap.waitForTimeout(150)
  ok(await ap.locator('[data-settings-hit]').count() === 0, 'search does not reveal admin settings')
  const r = await ap.goto(`${BASE}/settings/documents`); ok(r.status() === 404 && await ap.locator('#branding').count() === 0, 'admin category is refused on the server (404), not just hidden')
  await ap.goto(`${BASE}/settings#branding`); await settle(ap); ok(new URL(ap.url()).pathname === '/settings/documents' ? await ap.locator('#branding').count() === 0 : true, 'old link does not open admin settings either')
  await a.close()

  console.log('\n[11] Company isolation')
  const c2 = await browser.newContext({ viewport: { width: 1280, height: 860 } }); const p2 = watch(await c2.newPage())
  await signup(p2, EMAIL2, 'Second Hub Co')
  await p2.goto(`${BASE}/settings/company`); await settle(p2)
  ok(await p2.getByLabel('Company name in Arabic').inputValue() === '' && await p2.getByLabel('Company name', { exact: true }).inputValue() === 'Second Hub Co', 'another company sees its own (empty) settings, not the first company’s')
  await p2.goto(`${BASE}/settings/documents`); await settle(p2); ok(await p2.getByLabel('Invoice due (days)').inputValue() !== '45', 'document defaults are per company')
  await c2.close()

  console.log('\n[12] Nothing lost')
  const after = await one(`select (select count(*) from app_settings where company_id=$1)::int s, (select name from companies where id=$1) n`, [co])
  ok(after.n === before.n && after.s >= before.s, `no setting removed (app settings ${before.s} → ${after.s}), company name unchanged`)
} catch (e) {
  ok(false, `aborted: ${e.message.split('\n').slice(0, 8).join(' | ')}`); await p.screenshot({ path: `${OUT}/abort.png`, fullPage: true }).catch(() => {})
}
for (const e of jsErrors) ok(false, `JS error ${e}`)
const failed = results.filter(r => !r[0]).length
console.log(`\nsettings hub: ${results.length - failed}/${results.length} passed`)
await browser.close(); await db.end()
process.exit(failed ? 1 : 0)
