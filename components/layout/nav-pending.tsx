'use client'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

const internal = (a: HTMLAnchorElement | null) => {
  if (!a || a.target || a.hasAttribute('download') || a.closest('[data-no-prefetch]')) return null
  const u = new URL(a.href, location.href)
  if (u.origin !== location.origin || u.pathname.startsWith('/api/') || u.pathname.startsWith('/print/')) return null
  if (u.pathname === location.pathname && u.search === location.search) return null
  return u.pathname + u.search
}

/**
 * Pages open without a loading screen: the current page stays until the next one is ready (the thin top bar shows it is
 * on its way), and the next one is fetched the moment a finger or pointer lands on a link, so by the time the tap ends it
 * is usually there already. Visited pages are kept for a few minutes (staleTimes in next.config), so going back is instant.
 */
export function NavPending() {
  const router = useRouter()
  // entering the app from sign-in keeps the login page's scroll (a phone scrolls down to the form): start at the top,
  // except on a reload or back/forward, where the browser's restored position is the right one
  useEffect(() => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    if (nav?.type !== 'reload' && nav?.type !== 'back_forward' && !location.hash) scrollTo(0, 0)
  }, [])
  useEffect(() => {
    const done = new Set<string>()
    const warm = (href: string | null) => { if (!href || done.has(href)) return; done.add(href); router.prefetch(href) }
    // a table row opens its record from anywhere in the row (RowNavigator): warm that record too
    const linkOf = (t: EventTarget | null) => {
      const el = t as Element | null; if (!el?.closest) return null
      const a = el.closest('a'); if (a) return a as HTMLAnchorElement
      const row = el.closest('.rtable tbody tr, [data-row-link]')
      return row?.querySelector<HTMLAnchorElement>('a[data-row-primary], a[href]') ?? null
    }
    const press = (e: Event) => warm(internal(linkOf(e.target)))
    let dwell = 0
    const over = (e: MouseEvent) => { clearTimeout(dwell); const a = linkOf(e.target); if (a) dwell = window.setTimeout(() => warm(internal(a)), 60) }
    addEventListener('pointerdown', press, { passive: true, capture: true })
    addEventListener('touchstart', press, { passive: true, capture: true })
    addEventListener('focusin', press)
    addEventListener('mouseover', over, { passive: true })
    return () => { removeEventListener('pointerdown', press, true); removeEventListener('touchstart', press, true); removeEventListener('focusin', press); removeEventListener('mouseover', over); clearTimeout(dwell) }
  }, [router])
  return null
}
