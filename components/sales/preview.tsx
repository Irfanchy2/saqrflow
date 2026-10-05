'use client'
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

const A4_PX = 793.7   // 210 mm at 96 dpi

/**
 * Fits the fixed-width A4 paper into its column. Uses CSS `zoom` (re-lays out text at the target size → sharp text and
 * logos) instead of a transform (which rasterises and blurs), and never changes the paper's own layout.
 */
export function FitPaper({ children, max = 1 }: { children: ReactNode; max?: number }) {
  const outer = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.6)
  useLayoutEffect(() => {
    const o = outer.current; if (!o) return
    const fit = () => setScale(Math.min(max, o.clientWidth / A4_PX))
    fit()
    const ro = new ResizeObserver(fit); ro.observe(o)
    return () => ro.disconnect()
  }, [max])
  return <div ref={outer} className="w-full">
    <div style={{ width: A4_PX, zoom: scale }} className="overflow-hidden rounded-sm shadow-[0_2px_6px_rgba(15,23,42,.08),0_12px_32px_-8px_rgba(15,23,42,.18)] ring-1 ring-black/5">{children}</div>
  </div>
}
