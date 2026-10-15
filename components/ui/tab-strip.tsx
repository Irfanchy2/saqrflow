'use client'
import { useEffect, useRef, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Horizontal tab row that scrolls on narrow screens: the active tab (aria-current) is brought into view on load,
 * and the edges fade when more tabs are hidden on that side, so people can tell the row scrolls.
 */
export function TabStrip({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    const el = ref.current; if (!el) return
    const edges = () => {
      const max = el.scrollWidth - el.clientWidth, x = Math.abs(el.scrollLeft)
      el.dataset.fadeStart = String(max > 1 && x > 1); el.dataset.fadeEnd = String(max > 1 && x < max - 1)
    }
    const cur = el.querySelector<HTMLElement>('[aria-current="page"]')
    if (cur && el.scrollWidth > el.clientWidth) {
      const r = cur.getBoundingClientRect(), box = el.getBoundingClientRect()
      if (r.left < box.left || r.right > box.right) el.scrollLeft += r.left - box.left - (box.width - r.width) / 2
    }
    edges(); el.addEventListener('scroll', edges, { passive: true }); addEventListener('resize', edges)
    return () => { el.removeEventListener('scroll', edges); removeEventListener('resize', edges) }
  }, [])
  return <nav ref={ref} aria-label={label} className={cn('tabstrip flex gap-1 overflow-x-auto border-b border-border', className)}>{children}</nav>
}
