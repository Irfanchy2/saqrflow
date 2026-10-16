'use client'
import { useEffect } from 'react'

/**
 * Every horizontally scrolling row marked `.tabstrip` (tabs, filters, KPI strips) keeps its current tab in view, so it never
 * sits cut off at the edge. It only sets scrollLeft (never an attribute), so it cannot disturb hydration of server HTML;
 * the edge fades are CSS (globals.css). One observer for the whole app; rows added by navigation are picked up too.
 */
export function StripEdges() {
  useEffect(() => {
    const centred = new WeakMap<Element, Element | null>()
    const centre = (el: HTMLElement) => {
      const cur = el.querySelector<HTMLElement>('[aria-current="page"],[aria-selected="true"]')
      if (centred.get(el) === cur || el.scrollWidth <= el.clientWidth) return
      centred.set(el, cur); if (!cur) return
      const r = cur.getBoundingClientRect(), box = el.getBoundingClientRect()
      if (r.left < box.left + 8 || r.right > box.right - 8) el.scrollLeft += r.left - box.left - (box.width - r.width) / 2
    }
    let raf = 0
    const scan = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => document.querySelectorAll<HTMLElement>('.tabstrip').forEach(centre)) }
    scan()
    const mo = new MutationObserver(scan); mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-current', 'aria-selected'] })
    addEventListener('resize', scan)
    return () => { mo.disconnect(); cancelAnimationFrame(raf); removeEventListener('resize', scan) }
  }, [])
  return null
}
