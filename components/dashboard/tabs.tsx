'use client'
import { useState, type ReactNode } from 'react'
import { AnimatePresence, m } from 'framer-motion'
import { cn } from '@/lib/utils'
import { T } from '@/components/motion'

/** Underline tabs inside a card header; each panel is server-rendered and only shown when its tab is active. */
export function CardTabs({ tabs, action, id }: { tabs: { key: string; label: string; count?: number; panel: ReactNode }[]; action?: ReactNode; id: string }) {
  const [on, setOn] = useState(tabs[0]?.key)
  const cur = tabs.find(t => t.key === on) ?? tabs[0]
  if (!cur) return null
  return <div>
    <div className="flex min-h-[54px] items-end justify-between gap-3 border-b border-border px-5">
      <div role="tablist" className="tabstrip -mb-px flex min-w-0 gap-6 overflow-x-auto">
        {tabs.map(t => <button key={t.key} role="tab" type="button" aria-selected={t.key === cur.key} aria-controls={`${id}-${t.key}`} onClick={() => setOn(t.key)}
          className={cn('relative shrink-0 cursor-pointer whitespace-nowrap pb-3 pt-4 text-[14px] font-medium transition-colors', t.key === cur.key ? 'font-semibold text-primary' : 'text-muted hover:text-fg')}>
          {t.label}{t.count ? <span className="ms-1.5 rounded bg-surface-2 px-1 text-[11px] tabular-nums text-muted">{t.count}</span> : null}
          {t.key === cur.key && <m.span layoutId={`${id}-ul`} transition={T.base} className="absolute inset-x-0 -bottom-px h-[2px] rounded-full bg-primary" aria-hidden />}
        </button>)}
      </div>
      {action && <div className="shrink-0 pb-3">{action}</div>}
    </div>
    <AnimatePresence mode="wait" initial={false}>
      <m.div key={cur.key} id={`${id}-${cur.key}`} role="tabpanel" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={T.fast}>{cur.panel}</m.div>
    </AnimatePresence>
  </div>
}
