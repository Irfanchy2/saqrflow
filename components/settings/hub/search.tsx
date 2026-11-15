'use client'
import Link from 'next/link'
import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowUpRight, ChevronRight, Search, SearchX, X } from '@/components/icons'
import { searchSettings, type SearchItem } from '@/lib/settings/catalog'

/**
 * Settings search: filters an index of the settings this user may open (built on the server). While the box is empty the
 * category cards (children) show; while typing, the matches replace them. "/" focuses the box on a keyboard.
 */
export function SettingsSearch({ items, children }: { items: SearchItem[]; children: ReactNode }) {
  const [q, setQ] = useState(''), dq = useDeferredValue(q), ref = useRef<HTMLInputElement>(null)
  const hits = useMemo(() => searchSettings(items, dq), [items, dq])
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === '/' && !(e.target as HTMLElement)?.closest('input,textarea,select,[contenteditable]')) { e.preventDefault(); ref.current?.focus() } }
    addEventListener('keydown', k); return () => removeEventListener('keydown', k)
  }, [])
  const active = q.trim().length > 0
  return <>
    <div className="relative mb-6 max-w-2xl" role="search">
      <Search size={17} className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
      <input ref={ref} type="search" value={q} onChange={e => setQ(e.target.value)} autoComplete="off" enterKeyHint="search" aria-label="Search settings" aria-controls="settings-results"
        placeholder="Search settings" data-settings-search
        onKeyDown={e => { if (e.key === 'Escape') setQ(''); if (e.key === 'Enter' && hits[0]) (document.querySelector('[data-settings-hit]') as HTMLAnchorElement | null)?.click() }}
        className="h-12 w-full rounded-xl border border-border bg-surface ps-10 pe-10 text-[15px] shadow-sm outline-none transition-colors placeholder:text-muted/80 focus:border-primary/50 focus:ring-4 focus:ring-primary/10 [&::-webkit-search-cancel-button]:hidden" />
      {active && <button type="button" onClick={() => { setQ(''); ref.current?.focus() }} aria-label="Clear search" className="absolute end-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg"><X size={16} /></button>}
    </div>
    <div id="settings-results" aria-live="polite">
      {!active ? children : hits.length === 0
        ? <div className="flex flex-col items-center rounded-xl border border-dashed border-border px-6 py-12 text-center" data-settings-empty>
            <SearchX size={28} className="text-muted" aria-hidden />
            <p className="mt-3 font-medium">No settings match “{q.trim()}”</p>
            <p className="mt-1 max-w-sm text-sm text-muted">Try a shorter word such as “logo”, “terms”, “reminder” or “backup”, or open a category below.</p>
            <button type="button" onClick={() => setQ('')} className="mt-4 text-sm font-medium text-primary hover:underline">Show all categories</button>
          </div>
        : <ul className="max-w-2xl divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface" data-settings-hits>
            {hits.map(h => <li key={h.href + h.title}><Link href={h.href} data-settings-hit className="flex min-h-14 items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-medium">{h.title}</div>
                <div className="truncate text-xs text-muted">{h.kind === 'category' ? 'Category' : h.category}{h.hit ? <> · <span className="text-fg/70">{h.hit}</span></> : null}</div>
              </div>
              {h.kind === 'link' ? <ArrowUpRight size={16} className="shrink-0 text-muted" aria-hidden /> : <ChevronRight size={16} className="shrink-0 text-muted rtl:rotate-180" aria-hidden />}
            </Link></li>)}
          </ul>}
    </div>
  </>
}
