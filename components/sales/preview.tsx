'use client'
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

/** Scales the fixed-width (794px) A4 paper to fit its column while keeping text crisp and layout identical to print. */
export function FitPaper({ children, max = 1 }: { children: ReactNode; max?: number }) {
  const outer = useRef<HTMLDivElement>(null), inner = useRef<HTMLDivElement>(null)
  const [s, setS] = useState({ scale: 0.6, h: 700 })
  useLayoutEffect(() => {
    const o = outer.current, i = inner.current; if (!o || !i) return
    const fit = () => { const scale = Math.min(max, o.clientWidth / 794); setS({ scale, h: i.offsetHeight * scale }) }
    fit()
    const ro = new ResizeObserver(fit); ro.observe(o); ro.observe(i)
    return () => ro.disconnect()
  }, [max])
  return <div ref={outer} className="w-full" style={{ height: s.h }}>
    <div ref={inner} style={{ width: 794, transform: `scale(${s.scale})`, transformOrigin: 'top left' }}
      className="overflow-hidden rounded-sm shadow-[0_2px_6px_rgba(15,23,42,.08),0_12px_32px_-8px_rgba(15,23,42,.18)] ring-1 ring-black/5">{children}</div>
  </div>
}
