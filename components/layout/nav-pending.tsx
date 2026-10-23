'use client'
import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { DetailSkeleton, EditorSkeleton, ListSkeleton } from '@/components/ui/skeleton'

type Kind = 'list' | 'detail' | 'editor'
const UUID = /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\/|$)/i
const kindOf = (path: string): Kind => /^\/invoices\/[0-9a-f-]{36}$/i.test(path) ? 'editor' : UUID.test(path) ? 'detail' : 'list'

/**
 * Instant answer to a tap: the moment a link to another page is clicked (or a table row, through RowNavigator), the content
 * area shows the skeleton of what is coming (list, record or document builder) until the new page has arrived complete.
 * This is done in the browser on purpose: route-level loading.tsx streams pages in pieces, and a later piece arriving after
 * the user has moved on breaks React's streaming insert. Tabs and filters inside a page (`.tabstrip`) keep the page
 * on screen and only show the top progress bar.
 */
export function NavPending() {
  const path = usePathname(), sp = useSearchParams()
  const [kind, setKind] = useState<Kind | null>(null)
  useEffect(() => setKind(null), [path, sp])
  // entering the app from sign-in keeps the login page's scroll (a phone scrolls down to the form): start at the top,
  // except on a reload or back/forward, where the browser's restored position is the right one
  useEffect(() => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    if (nav?.type !== 'reload' && nav?.type !== 'back_forward' && !location.hash) scrollTo(0, 0)
  }, [])
  useEffect(() => {
    const click = (e: MouseEvent) => {
      // Next's <Link> always calls preventDefault (it navigates itself), so that flag cannot tell us anything; a handler that
      // really cancels a navigation (the builder's unsaved-changes prompt) stops propagation, so this listener never runs.
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = (e.target as HTMLElement).closest('a'); if (!a || a.target || a.hasAttribute('download') || a.closest('.tabstrip, [data-no-pending]')) return
      const u = new URL(a.href, location.href)
      if (u.origin !== location.origin || u.pathname.startsWith('/api/') || u.pathname.startsWith('/print/') || u.pathname === location.pathname) return
      setKind(kindOf(u.pathname))
    }
    addEventListener('click', click)
    return () => removeEventListener('click', click)
  }, [])
  useEffect(() => { if (!kind) return; const t = setTimeout(() => setKind(null), 15000); return () => clearTimeout(t) }, [kind])
  if (!kind) return null
  return <div className="absolute inset-0 z-[5] overflow-hidden bg-bg px-4 pb-24 pt-5 sm:px-6 sm:pt-6 lg:px-8">
    {kind === 'editor' ? <EditorSkeleton /> : kind === 'detail' ? <DetailSkeleton /> : <ListSkeleton />}</div>
}
