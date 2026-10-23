'use client'
// GSAP for popovers (account menu, tab menus, quick create). GSAP is fetched the first time a trigger is hovered,
// focused or pressed, so no page carries it on load. Once it is here, a menu animates in before its first paint
// (call from useLayoutEffect); before that, or with reduced motion, the menu simply appears.
import type { gsap as Gsap } from 'gsap'

let g: typeof Gsap | null = null, loading: Promise<typeof Gsap> | null = null
export function preloadGsap() {
  if (g || loading || typeof window === 'undefined') return
  loading = import('gsap').then(m => (g = m.gsap)).catch(() => { loading = null; return null as never })
}
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches

/** Panel drops in (fade, 6 px, slight scale from its anchor); its items follow 15 ms apart. */
export function popIn(panel: HTMLElement | null, opts: { from?: 'top' | 'start'; items?: string } = {}) {
  if (!panel || !g || reduced()) return
  const x = opts.from === 'start' ? -8 : 0, y = opts.from === 'start' ? 0 : -6
  g.killTweensOf(panel)
  g.fromTo(panel, { autoAlpha: 0, x, y, scale: 0.97 }, { autoAlpha: 1, x: 0, y: 0, scale: 1, duration: 0.2, ease: 'power3.out', clearProps: 'transform,opacity,visibility' })
  const items = panel.querySelectorAll(opts.items ?? '[role^=menuitem]')
  if (items.length) g.fromTo(items, { autoAlpha: 0, y: -3 }, { autoAlpha: 1, y: 0, duration: 0.16, ease: 'power2.out', stagger: 0.015, delay: 0.03, clearProps: 'transform,opacity,visibility' })
}

/** Handlers for the element that opens a popover: start fetching GSAP as soon as the person heads for it. */
export const warmGsap = { onPointerEnter: preloadGsap, onFocus: preloadGsap, onTouchStart: preloadGsap }
