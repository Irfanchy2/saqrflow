'use client'
import { useEffect } from 'react'

/**
 * Every horizontally scrolling row marked `.tabstrip` (tabs, filters, KPI strips) gets the same phone behaviour, wherever
 * it was rendered: its edges fade while more items are hidden that way, and the current tab is scrolled into view
 * so it never sits cut off at the edge. One listener for the whole app; rows added by navigation are picked up too.
 */
export function StripEdges() {
  useEffect(() => {
    const centred = new WeakMap<Element, Element | null>()
    const edges = (el: HTMLElement) => {
      const max = el.scrollWidth - el.clientWidth, x = Math.abs(el.scrollLeft)
      const s = String(max > 1 && x > 1), e = String(max > 1 && x < max - 1)
      if (el.dataset.fadeStart !== s) el.dataset.fadeStart = s
      if (el.dataset.fadeEnd !== e) el.dataset.fadeEnd = e
    }
    const centre = (el: HTMLElement) => {
      const cur = el.querySelector<HTMLElement>('[aria-current="page"],[aria-selected="true"]')
      if (centred.get(el) === cur || el.scrollWidth <= el.clientWidth) return
      centred.set(el, cur); if (!cur) return
      const r = cur.getBoundingClientRect(), box = el.getBoundingClientRect()
      if (r.left < box.left + 8 || r.right > box.right - 8) el.scrollLeft += r.left - box.left - (box.width - r.width) / 2
    }
    let raf = 0
    const scan = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => document.querySelectorAll<HTMLElement>('.tabstrip').forEach(el => { centre(el); edges(el) })) }
    const onScroll = (e: Event) => { const t = e.target; if (t instanceof HTMLElement && t.classList.contains('tabstrip')) edges(t) }
    scan()
    const mo = new MutationObserver(scan); mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-current', 'aria-selected'] })
    document.addEventListener('scroll', onScroll, { capture: true, passive: true }); addEventListener('resize', scan)
    return () => { mo.disconnect(); cancelAnimationFrame(raf); document.removeEventListener('scroll', onScroll, { capture: true }); removeEventListener('resize', scan) }
  }, [])
  return null
}
