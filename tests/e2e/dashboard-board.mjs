// Dashboard: nothing cut off or pushed beside the screen at phone, tablet, laptop and wide widths (section tabs and card
// tabs wrap, key figures are a 2-column grid on phones, the documents table fits); cards move by dragging their grip
// (desktop hover, Arrange on phones), between the left and right columns too, and with the arrow keys; every move is
// saved to the user's own layout; while arranging, the cards' links do nothing. Real build + PostgREST + Chromium.
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import pg from 'pg'

const BASE = process.env.E2E_BASE
const OUT = 'tests/e2e/shots/dashboard-board'; fs.mkdirSync(OUT, { recursive: true })
const results = []
const ok = (cond, msg) => { results.push([!!cond, msg]); console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`) }
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
const exe = fs.readdirSync('/opt/pw-browsers').filter(d => d.startsWith('chromium-')).map(d => `/opt/pw-browsers/${d}/chrome-linux/chrome`).find(p => fs.existsSync(p))
const browser = await chromium.launch({ executablePath: exe })
const jsErrors = []
const watch = page => { page.on('pageerror', e => jsErrors.push(`${page.url()}: ${e.message}`)); return page }
const settle = async (page, ms = 600) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(ms) }
const KEYS = ['banner', 'finance', 'trend', 'funnel', 'floor', 'road', 'quick', 'recent', 'activity', 'projects', 'inbox', 'team', 'lowstock', 'mytasks', 'attention', 'calendar', 'operations', 'approvals']
const LEFT = ['trend', 'funnel', 'floor', 'road', 'quick', 'recent', 'activity', 'projects', 'inbox']
const layout = async uid => (await one(`select value from user_preferences where user_id=$1 and key='dashboard.layout'`, [uid]))?.value?.items ?? []
const order = (items, col) => items.filter(i => i.col === col && !i.hidden).map(i => i.key)
const login = async page => { await page.goto(`${BASE}/login`); await page.getByLabel('Email').fill('demo@admin.com'); await page.getByLabel('Password').fill('admin123'); await page.getByRole('button', { name: 'Sign in' }).click(); await page.waitForURL(`${BASE}/`, { timeout: 20000 }).catch(() => {}); await settle(page, 1200) }
/** drags a card's grip to the middle (or top/bottom part) of another card, in small steps like a hand would */
async function dragTo(page, from, to, where = 'top') {
  const grip = page.locator(`[data-widget="${from}"] [data-grip]`)
  // like a person: the card to drop on is in view, away from the screen edges (which scroll the page while dragging)
  await page.locator(`[data-widget="${to}"]`).evaluate(e => { e.scrollIntoView({ block: 'start' }); window.scrollBy(0, -160) }); await page.waitForTimeout(200)
  await page.locator(`[data-widget="${from}"]`).hover()
  const g = await grip.boundingBox(), t = await page.locator(`[data-widget="${to}"]`).boundingBox()
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2); await page.mouse.down()
  // follows the target as cards reflow during the drag, as a person watching the screen would
  const aim = async () => { const b = await page.locator(`[data-widget="${to}"]`).boundingBox(); return [b.x + b.width / 2, where === 'top' ? b.y + Math.min(30, b.height / 4) : b.y + b.height - Math.min(30, b.height / 4)] }
  let [tx, ty] = [t.x + t.width / 2, t.y + Math.min(30, t.height / 4)], x = g.x + g.width / 2, y = g.y + g.height / 2
  for (let i = 1; i <= 16; i++) { [tx, ty] = await aim(); x += (tx - x) / (17 - i); y += (ty - y) / (17 - i); await page.mouse.move(x, y); await page.waitForTimeout(25) }
  for (let i = 0; i < 3; i++) { [tx, ty] = await aim(); await page.mouse.move(tx, ty); await page.waitForTimeout(60) }
  await page.waitForTimeout(150); await page.mouse.up(); await page.waitForTimeout(900)
}

try {
  console.log('\n[0] Demo company, every card on')
  await fetch(`${process.env.E2E_GATEWAY}/auth/v1/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'demo@admin.com', password: 'admin123' }) })
  const uid = (await one(`select id from auth.users where email='demo@admin.com'`)).id
  // the demo suite may have set the demo company up already in this run
  if (!(await one(`select company_id from profiles where id=$1`, [uid]))?.company_id) await db.query(`select demo_provision($1)`, [uid])
  const all = { items: KEYS.map(k => ({ key: k, col: ['banner', 'finance'].includes(k) ? 'top' : LEFT.includes(k) ? 'left' : 'right', hidden: false })) }
  await db.query(`insert into user_preferences(user_id,key,value) values ($1,'dashboard.layout',$2) on conflict (user_id,key) do update set value=excluded.value`, [uid, JSON.stringify(all)])

  const co = (await one(`select company_id from profiles where id=$1`, [uid])).company_id
  await db.query(`insert into in_app_notifications(company_id,user_id,title,body,link,severity,dedupe_key) values ($1,$2,'Invoice INV-612 is overdue (AED 66,937.50)','12 days late · Gulf Horizon Contracting','/invoices','warning',$3)`, [co, uid, `bell-${Date.now()}`])
  /** opens the bell; the panel must sit inside the screen, readable, and close on a tap outside */
  const bell = async (page, label) => {
    await page.locator('[data-bell]').first().click(); await page.waitForTimeout(300)
    const panel = page.locator('[data-notifications]')
    const b = await panel.boundingBox(), vw = page.viewportSize().width
    ok(b && b.x >= 0 && b.x + b.width <= vw && b.width >= Math.min(352, vw - 16) - 1, `${label}: notifications panel opens at full size inside the screen (${b ? Math.round(b.width) : 0}px of ${vw}px)`)
    ok((await panel.innerText()).includes('Invoice INV-612 is overdue'), `${label}: notifications are readable`)
    await page.mouse.click(5, page.viewportSize().height / 2); await page.waitForTimeout(300)
    ok(await panel.count() === 0, `${label}: a tap outside closes it`)
  }

  console.log('\n[1] Nothing cut off or beside the screen')
  for (const [w, h] of [[360, 780], [390, 844], [768, 1024], [1024, 768], [1280, 800], [1440, 900], [1920, 1080]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: w < 800, hasTouch: w < 800 }); const p = watch(await ctx.newPage())
    await login(p)
    const r = await p.evaluate(() => {
      const vw = document.documentElement.clientWidth, bad = []
      const scroller = el => { for (let s = el.parentElement; s && s !== document.body; s = s.parentElement) if (/(auto|scroll)/.test(getComputedStyle(s).overflowX)) return s; return null }
      for (const el of document.querySelectorAll('main *')) {
        const b = el.getBoundingClientRect(); if (!b.width || !b.height || el.closest('.sr-only')) continue
        if (!scroller(el) && (b.right > vw + 1 || b.left < -1)) bad.push(`${el.tagName}.${String(el.className).slice(0, 40)}`)
      }
      const sub = document.querySelector('nav[aria-label="Section"]'), tabs = document.querySelector('[data-widget="recent"] [role="tablist"]')
      const tbl = document.querySelector('[data-widget="recent"] .overflow-x-auto'), metrics = document.querySelector('[data-widget="finance"] .metrics')
      return { pageOver: document.documentElement.scrollWidth - vw, bad: bad.slice(0, 5),
        sub: sub ? sub.scrollWidth - sub.clientWidth : 0, tabs: tabs ? tabs.scrollWidth - tabs.clientWidth : 0,
        tbl: tbl && innerWidth >= 640 ? tbl.scrollWidth - tbl.clientWidth : 0, metrics: metrics ? metrics.scrollWidth - metrics.clientWidth : 0 }
    })
    ok(r.pageOver <= 0 && !r.bad.length, `${w}px: page fits the screen, nothing sticks out (${r.pageOver}px${r.bad.length ? '; ' + r.bad.join(', ') : ''})`)
    ok(r.sub <= 1 && r.tabs <= 1, `${w}px: section tabs and document tabs all visible (hidden ${r.sub}px / ${r.tabs}px)`)
    ok(r.tbl <= 1, `${w}px: latest documents table fits its card (${r.tbl}px)`)
    ok(r.metrics <= 1, `${w}px: every key figure card visible (${r.metrics}px hidden)`)
    await p.screenshot({ path: `${OUT}/${w}.png`, fullPage: w <= 1024 })
    if (w === 390 || w === 1440) { await bell(p, `${w}px`); if (w === 390) { await p.locator('[data-bell]').first().click(); await p.waitForTimeout(300); await p.screenshot({ path: `${OUT}/m-bell.png` }) } }
    await ctx.close()
  }

  console.log('\n[2] Drag cards on a desktop')
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 2600 } }); const p = watch(await ctx.newPage())
  await login(p)
  ok(await p.locator('[data-widget] [data-grip]').count() >= 10, 'every card has a grip')
  const before = order(await layout(uid), 'right')
  const firstRight = before[0]
  await dragTo(p, 'operations', firstRight, 'top')
  let after = await layout(uid)
  ok(order(after, 'right')[0] === 'operations', `dragged "Operations" onto the first card of the right column (${order(after, 'right').slice(0, 3).join(', ')})`)
  ok(order(after, 'right').length === before.length, 'no card lost or duplicated')
  await dragTo(p, 'attention', 'trend', 'top')
  after = await layout(uid)
  ok(after.find(i => i.key === 'attention')?.col === 'left' && order(after, 'left').indexOf('attention') < order(after, 'left').indexOf('trend'), 'dragged "Needs attention" across into the left column, above the chart')
  await p.reload(); await settle(p, 1000)
  const domLeft = await p.locator('[data-zone-box="left"] > [data-widget]').evaluateAll(n => n.map(x => x.dataset.widget))
  ok(domLeft.indexOf('attention') === 0, 'after reloading, the order is kept')
  await dragTo(p, 'finance', 'trend', 'top')
  ok((await layout(uid)).find(i => i.key === 'finance')?.col === 'top', 'top cards (key figures) stay in the top area')
  console.log('   keyboard')
  const grip = p.locator('[data-widget="mytasks"] [data-grip]')
  const r0 = order(await layout(uid), 'right'), i0 = r0.indexOf('mytasks')
  await grip.focus(); await p.keyboard.press('ArrowUp'); await p.waitForTimeout(1000)
  const r1 = order(await layout(uid), 'right')
  ok(r1.indexOf('mytasks') === i0 - 1, `arrow key moves "My tasks" up one place (${i0} → ${r1.indexOf('mytasks')})`)
  ok(await p.evaluate(() => document.activeElement?.closest('[data-widget]')?.dataset.widget) === 'mytasks', 'focus stays on the moved card')
  await p.screenshot({ path: `${OUT}/desk-after.png` })
  await ctx.close()

  console.log('\n[3] Phone: Arrange')
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); const m = watch(await mctx.newPage())
  await login(m)
  ok(!(await m.locator('[data-widget="team"] [data-grip]').isVisible()), 'phone: no grips until Arrange')
  await m.locator('[data-arrange]').first().click(); await m.waitForTimeout(300)
  ok(await m.locator('[data-arrange-bar]').isVisible() && await m.locator('[data-widget="team"] [data-grip]').isVisible(), 'Arrange shows the bar and a grip on each card')
  const href = m.url(); await m.locator('[data-widget="team"] a').first().click({ force: true }).catch(() => {}); await m.waitForTimeout(500)
  ok(m.url() === href, 'while arranging, tapping a card does not open it')
  const rm0 = order(await layout(uid), 'right'), from = rm0[1], to = rm0[0]   // the second card of the column onto the first
  await dragTo(m, from, to, 'top')
  ok(order(await layout(uid), 'right')[0] === from, `phone: dragging the grip moves the card (saved: ${order(await layout(uid), 'right').slice(0, 2).join(', ')})`)
  await m.screenshot({ path: `${OUT}/m-arrange.png` })
  await m.locator('[data-arrange-bar]').getByRole('button', { name: 'Done' }).click(); await m.waitForTimeout(300)
  ok(!(await m.locator('[data-arrange-bar]').isVisible()), 'Done ends arranging')
  await mctx.close()
  await db.query(`delete from user_preferences where user_id=$1 and key='dashboard.layout'`, [uid])
} catch (e) {
  ok(false, `aborted: ${e.message.split('\n').slice(0, 12).join(' | ')}`)
}
for (const e of jsErrors) ok(false, `JS error ${e}`)
const failed = results.filter(r => !r[0]).length
console.log(`\ndashboard-board: ${results.length - failed}/${results.length} passed`)
await browser.close(); await db.end()
process.exit(failed ? 1 : 0)
