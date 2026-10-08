'use client'
import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'

/**
 * Thin bar at the top while the next page loads, so a tap on a link answers immediately.
 * (A route-level loading.tsx would do the same but interferes with server-action transitions in production.)
 */
export function NavProgress() {
  const path = usePathname(), sp = useSearchParams()
  const [on, setOn] = useState(false)
  useEffect(() => setOn(false), [path, sp])
  useEffect(() => {
    const click = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = (e.target as HTMLElement).closest('a'); if (!a || a.target || a.hasAttribute('download')) return
      const u = new URL(a.href, location.href)
      if (u.origin !== location.origin || u.pathname.startsWith('/api/') || (u.pathname === location.pathname && u.search === location.search)) return
      setOn(true)
    }
    addEventListener('click', click)
    return () => removeEventListener('click', click)
  }, [])
  useEffect(() => { if (!on) return; const t = setTimeout(() => setOn(false), 15000); return () => clearTimeout(t) }, [on])
  return <div aria-hidden className={`no-print pointer-events-none fixed inset-x-0 top-0 z-toast h-0.5 overflow-hidden transition-opacity duration-200 ${on ? 'opacity-100' : 'opacity-0'}`}>
    <div className="h-full w-1/3 bg-primary motion-safe:animate-[navbar_1.1s_ease-in-out_infinite]" /></div>
}
