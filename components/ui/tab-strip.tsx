import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Horizontal tab row that scrolls on narrow screens. The current tab (aria-current) is brought into view and the edges
 * fade while more tabs are hidden that way (components/layout/strip-edges handles every `.tabstrip`).
 */
export function TabStrip({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return <nav aria-label={label} className={cn('tabstrip flex gap-1 overflow-x-auto border-b border-border', className)}>{children}</nav>
}
