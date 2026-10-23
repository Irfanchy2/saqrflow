// Theme preference (browser only): light, dark or "match system". Stored as localStorage 'sf-theme' ('light' | 'dark',
// absent = system), read before paint by the script in app/layout.tsx. Every switch in the app goes through here, and a
// 'sf-theme' window event keeps the others (dock, menu, phone toggle) in step.

export type ThemePref = 'light' | 'dark' | 'system'
const KEY = 'sf-theme'
const mq = () => matchMedia('(prefers-color-scheme: dark)')

export function getThemePref(): ThemePref {
  try { const t = localStorage.getItem(KEY); return t === 'light' || t === 'dark' ? t : 'system' } catch { return 'system' }
}
export const isDarkNow = () => document.documentElement.classList.contains('dark')

let follow: ((e: MediaQueryListEvent) => void) | null = null
/** Applies a preference now; "system" follows the OS setting until another choice is made. */
export function setThemePref(p: ThemePref) {
  try { if (p === 'system') localStorage.removeItem(KEY); else localStorage.setItem(KEY, p) } catch {}
  if (follow) { mq().removeEventListener('change', follow); follow = null }
  const dark = p === 'dark' || (p === 'system' && mq().matches)
  document.documentElement.classList.toggle('dark', dark)
  if (p === 'system') { follow = e => { document.documentElement.classList.toggle('dark', e.matches); dispatchEvent(new Event('sf-theme')) }; mq().addEventListener('change', follow) }
  dispatchEvent(new Event('sf-theme'))
}
/** Light ↔ dark from whatever is showing now (the one-tap switches in the dock and the phone top bar). */
export const toggleTheme = () => setThemePref(isDarkNow() ? 'light' : 'dark')
