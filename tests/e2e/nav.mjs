// Shared helper for the desktop navigation: top tabs whose page lists open on hover (built only while open).

/** Every page label in the main navigation: each tab's label (upper-cased) followed by its hover menu. */
export async function navText(p) {
  const main = p.locator('nav[aria-label="Main"]'), tabs = main.locator('[data-top]'), out = []
  for (let i = 0; i < await tabs.count(); i++) {
    const tab = tabs.nth(i); await tab.hover(); await p.waitForTimeout(260)
    const menu = main.locator('[role=menu]')
    out.push(`${(await tab.innerText()).replace(/\d+\+?$/, '').trim().toUpperCase()}\n${await menu.count() ? await menu.innerText() : await tab.innerText()}`)
  }
  await p.mouse.move(2, 600); await p.waitForTimeout(200)
  return out.join('\n')
}

/** The section pills under the top bar for the current page's group. */
export const sectionText = p => p.locator('nav[aria-label="Section"]').innerText().catch(() => '')
