import { cn } from '@/lib/utils'

/** Averiqo mark: an open "A" (two strokes, offset crossbar) on a rounded tile. Drawn on a 32-unit grid so it stays crisp at 16 px. */
export function AveriqoMark({ size = 28, className }: { size?: number; className?: string }) {
  return <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className={cn('shrink-0', className)}>
    <rect width="32" height="32" rx="7" className="fill-fg" />
    <path d="M9.5 23.5 16 8.5l6.5 15" fill="none" className="stroke-bg" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M13.2 18.6h7.1" fill="none" stroke="hsl(var(--primary))" strokeWidth="2.6" strokeLinecap="round" />
  </svg>
}

/** Software brand lock-up. `sub` is the company using Averiqo (never replaces the company's legal identity). */
export function AveriqoWordmark({ sub, className }: { sub?: string; className?: string }) {
  return <div className={cn('flex min-w-0 items-center gap-2.5', className)}>
    <AveriqoMark />
    <div className="min-w-0 leading-tight"><div className="text-[15px] font-semibold tracking-[-0.01em]">Averiqo</div>
      {sub && <div className="truncate text-2xs text-muted" title={sub}>{sub}</div>}</div>
  </div>
}
