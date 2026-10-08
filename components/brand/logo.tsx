/* Plain <img>: pre-sized static assets in /public/brand; next/image would add an optimizer round-trip for a 2 KB file */
import { cn } from '@/lib/utils'

// Averiqo is the software brand only. These assets never appear on quotations, invoices or other company documents.
const RATIO = 2035 / 542 // wordmark master (trimmed), width / height

/** Averiqo app icon (rounded tile). */
export function AveriqoMark({ size = 28, className }: { size?: number; className?: string }) {
  return <img src="/brand/averiqo-icon-64.webp" srcSet="/brand/averiqo-icon-64.webp 64w, /brand/averiqo-icon-128.webp 128w" sizes={`${size}px`}
    width={size} height={size} alt="" aria-hidden draggable={false} decoding="async" className={cn('shrink-0 select-none', className)} />
}

/** Averiqo logo (mark + name). `tone="auto"` follows the theme; use "dark" on surfaces that are always dark. */
export function AveriqoLogo({ height = 24, tone = 'auto', className }: { height?: number; tone?: 'auto' | 'light' | 'dark'; className?: string }) {
  const width = Math.round(height * RATIO)
  const img = (v: 'light' | 'dark', cls?: string) => <img key={v} src={`/brand/averiqo-logo-${v}-480.webp`}
    srcSet={`/brand/averiqo-logo-${v}-480.webp 480w, /brand/averiqo-logo-${v}-960.webp 960w`} sizes={`${width}px`}
    width={width} height={height} alt="Averiqo" draggable={false} decoding="async"
    className={cn('block h-auto max-w-full select-none object-contain', cls)} style={{ width }} />
  return <span className={cn('inline-flex min-w-0 shrink', className)}>
    {tone === 'auto' ? [img('light', 'dark:hidden'), img('dark', 'hidden dark:block')] : img(tone)}
  </span>
}

/** Software brand lock-up for the sidebar. `sub` is the company using Averiqo (never replaces the company's legal identity). */
export function AveriqoWordmark({ sub, className }: { sub?: string; className?: string }) {
  return <div className={cn('flex min-w-0 flex-col justify-center gap-1 leading-tight', className)}>
    <AveriqoLogo height={22} />
    {sub && <div className="truncate text-2xs text-muted" title={sub}>{sub}</div>}
  </div>
}
