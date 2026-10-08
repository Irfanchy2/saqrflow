import { cva, type VariantProps } from 'class-variance-authority'
import Link from 'next/link'
import { Children } from 'react'
import { cn } from '@/lib/utils'
import type { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Inbox } from 'lucide-react'

/*
 * Averiqo design system primitives.
 * Sizes: controls 36 px (sm 32 px) · table rows ~40 px · radius md (6 px) for controls, lg (8 px) for containers, sm (4 px) for badges.
 * Surfaces are separated by a 1 px border; shadows are reserved for floating layers (menus, dialogs, toasts).
 */
const button = cva('inline-flex cursor-pointer items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50 active:translate-y-px whitespace-nowrap select-none', {
  variants: {
    variant: {
      primary: 'bg-primary text-primary-fg hover:bg-primary/90',
      secondary: 'border border-border bg-surface text-fg hover:border-border-strong hover:bg-surface-2',
      ghost: 'text-muted hover:bg-surface-2 hover:text-fg',
      danger: 'bg-danger text-white hover:bg-danger/90',
    },
    size: { sm: 'h-10 px-3 sm:h-8', md: 'h-11 px-4 sm:h-9 sm:px-3.5', icon: 'h-11 w-11 sm:h-9 sm:w-9' },
  },
  defaultVariants: { variant: 'primary', size: 'md' },
})
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof button>
export const Button = ({ className, variant, size, ...p }: BtnProps) => <button className={cn(button({ variant, size }), className)} {...p} />
// API links (exports, PDFs) are plain anchors: <Link> would prefetch them, i.e. silently run the export (and audit-log it) on page view
export const LinkButton = ({ href, className, variant, size, children, target }: { href: string; className?: string; children: ReactNode; target?: '_blank' } & VariantProps<typeof button>) =>
  href.startsWith('/api/')
    ? <a href={href} className={cn(button({ variant, size }), className)} target={target} rel={target ? 'noopener noreferrer' : undefined}>{children}</a>
    : <Link href={href} className={cn(button({ variant, size }), className)} target={target} rel={target ? 'noopener noreferrer' : undefined}>{children}</Link>

const field = 'w-full rounded-md border border-border bg-surface px-3 text-sm text-fg placeholder:text-muted/55 transition-colors hover:border-border-strong focus:border-primary/60 disabled:cursor-not-allowed disabled:bg-surface-2 disabled:opacity-70'
// dir="auto" + unicode-bidi:plaintext: typed text takes its own direction per line (an English name stays left-aligned inside the
// Arabic UI, an Arabic address line aligns right inside the English UI) instead of inheriting the page direction.
const TEXTUAL = new Set([undefined, 'text', 'search', 'email', 'tel', 'url', 'password'])
export const Input = ({ className, dir, type, ...p }: InputHTMLAttributes<HTMLInputElement>) =>
  <input type={type} dir={dir ?? (TEXTUAL.has(type) ? 'auto' : undefined)} className={cn(field, 'h-11 text-start sm:h-9', className)} {...p} />
export const Select = ({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => <select className={cn(field, 'h-11 cursor-pointer pe-8 sm:h-9', className)} {...p} />
export const Textarea = ({ className, dir, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) =>
  <textarea dir={dir ?? 'auto'} className={cn(field, 'min-h-[84px] resize-y px-3 py-2 text-start leading-[1.55] [overflow-wrap:anywhere] [unicode-bidi:plaintext] whitespace-pre-wrap', className)} {...p} />

/** Label above the control, hint below. A trailing " *" in the label renders as a required marker. */
export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  const req = label.endsWith(' *'), text = req ? label.slice(0, -2) : label
  return <label className={cn('flex min-w-0 flex-col gap-1.5 text-sm', className)}>
    <span className="text-[13px] font-medium text-fg">{text}{req && <span className="text-danger"> *</span>}</span>
    {children}{hint && <span className="text-xs leading-snug text-muted">{hint}</span>}</label>
}
/** Groups related fields inside a form without another box: a heading, an optional line of help, then the fields. */
export function FormSection({ title, sub, children, className }: { title: string; sub?: string; children: ReactNode; className?: string }) {
  return <fieldset className={cn('min-w-0 border-t border-border pt-4 first:border-t-0 first:pt-0', className)}>
    <legend className="float-left mb-3 w-full"><span className="block text-sm font-semibold">{title}</span>{sub && <span className="block text-xs text-muted">{sub}</span>}</legend>
    <div className="clear-left">{children}</div></fieldset>
}

export const Card = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn('rounded-lg border border-border bg-surface', className)} {...p} />
export const CardHeader = ({ title, action, sub }: { title: string; action?: ReactNode; sub?: string }) =>
  <div className="flex min-h-[48px] flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border px-4 py-2.5"><div className="min-w-0 flex-1 basis-48"><h3 className="text-sm font-semibold">{title}</h3>{sub && <p className="text-xs text-muted">{sub}</p>}</div>{action}</div>

// one status palette for the whole product: subtle tint + readable text, never a saturated fill
const tone = {
  neutral: 'bg-surface-2 text-muted ring-border', blue: 'bg-primary-soft text-primary ring-primary/15', green: 'bg-success/10 text-success ring-success/15',
  amber: 'bg-warning/10 text-warning ring-warning/20', red: 'bg-danger/10 text-danger ring-danger/15',
}
export type Tone = keyof typeof tone
export const Badge = ({ tone: t = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) =>
  <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-sm px-1.5 py-px text-xs font-medium ring-1 ring-inset', tone[t], className)}>{children}</span>

// only a problem colours a number; other tones are informational and stay neutral so colour keeps its meaning
const valueTone: Partial<Record<Tone, string>> = { red: 'text-danger' }
/**
 * A single metric. `tone` only colours the value when it signals a problem (red); icons are accepted for
 * compatibility but not drawn: a label already says what the number is. Place several inside <Metrics> for a ruled strip.
 */
export function StatCard({ label, value, hint, href, tone: t = 'neutral' }: { label: string; value: ReactNode; hint?: string; icon?: LucideIcon; href?: string; tone?: Tone }) {
  const inner = <div className={cn('stat h-full rounded-lg border border-border bg-surface px-3.5 py-3 sm:px-4 sm:py-3.5', href && 'transition-colors hover:border-border-strong hover:bg-surface-2/40')}>
    <div className="text-xs font-medium text-muted">{label}</div>
    <div className={cn('mt-1 break-words text-lg font-semibold leading-tight tabular-nums tracking-[-0.01em] sm:text-xl', valueTone[t])}>{value}</div>
    {hint && <div className="mt-0.5 truncate text-xs text-muted" title={hint}>{hint}</div>}
  </div>
  return href ? <Link href={href} className="block h-full rounded-lg focus-visible:ring-offset-0">{inner}</Link> : inner
}
/** Ruled strip of metrics in one container (instead of a field of floating cards). Columns follow the number of metrics. */
export function Metrics({ children, className, cols }: { children: ReactNode; className?: string; cols?: 2 | 3 | 4 | 5 | 6 }) {
  const n = cols ?? (Math.min(6, Math.max(2, Children.toArray(children).filter(Boolean).length)) as 2 | 3 | 4 | 5 | 6)
  const lg = { 2: 'lg:grid-cols-2', 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4', 5: 'lg:grid-cols-5', 6: 'lg:grid-cols-6' }[n]
  return <div className={cn('metrics overflow-hidden rounded-lg border border-border bg-surface', className)}>
    <div className={cn('-mb-px -me-px grid grid-cols-2', n >= 3 && 'md:grid-cols-3', lg)}>{children}</div></div>
}

export function EmptyState({ title, body, action, icon: Icon = Inbox }: { title: string; body?: string; action?: ReactNode; icon?: LucideIcon }) {
  return <div className="flex flex-col items-center justify-center gap-1.5 px-6 py-12 text-center">
    <Icon size={20} className="mb-1 text-muted/70" aria-hidden />
    <p className="text-sm font-medium">{title}</p>{body && <p className="max-w-sm text-sm text-muted">{body}</p>}{action && <div className="mt-3">{action}</div>}
  </div>
}
export const PageHeader = ({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) =>
  <div className="mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
    <div className="min-w-0"><h1 className="text-lg font-semibold tracking-[-0.015em]">{title}</h1>{sub && <p className="mt-0.5 max-w-[72ch] text-sm text-muted">{sub}</p>}</div>
    <div className="flex flex-wrap items-center gap-2">{actions}</div></div>

export const Alert = ({ tone: t = 'blue', children }: { tone?: Tone; children: ReactNode }) =>
  <div role={t === 'red' ? 'alert' : undefined} className={cn('rounded-md border px-3 py-2 text-sm', t === 'red' ? 'border-danger/25 bg-danger/5 text-danger' : t === 'amber' ? 'border-warning/25 bg-warning/5' : t === 'green' ? 'border-success/25 bg-success/5' : t === 'neutral' ? 'border-border bg-surface-2' : 'border-primary/20 bg-primary-soft')}>{children}</div>

export const Th = ({ children, className }: { children?: ReactNode; className?: string }) => <th scope="col" className={cn('whitespace-nowrap border-b border-border bg-surface-2/60 px-3 py-2 text-start text-xs font-medium text-muted first:ps-4 last:pe-4', className)}>{children}</th>
export const Td = ({ children, className, title, colSpan }: { children?: ReactNode; className?: string; title?: string; colSpan?: number }) => <td title={title} colSpan={colSpan} className={cn('px-3 py-2.5 align-middle first:ps-4 last:pe-4', className)}>{children}</td>
// relative: the scroll box is the containing block, so absolutely positioned children (sr-only labels) cannot widen the page
export { TableWrap } from './table-wrap'

/** Sortable column header: links to the same page with ?sort=&dir= preserved. */
export function SortTh({ label, col, params, base }: { label: string; col: string; params: Record<string, string | undefined>; base: string }) {
  const active = params.sort === col, dir = active && params.dir === 'asc' ? 'desc' : 'asc'
  const qs = new URLSearchParams(Object.entries({ ...params, sort: col, dir, page: '1' }).filter(([, v]) => v) as [string, string][]).toString()
  return <Th><Link href={`${base}?${qs}`} aria-sort={active ? (params.dir === 'asc' ? 'ascending' : 'descending') : undefined} className="inline-flex items-center gap-1 hover:text-fg">{label}<span aria-hidden className={active ? 'text-primary' : 'opacity-30'}>{active ? (params.dir === 'asc' ? '↑' : '↓') : '↕'}</span></Link></Th>
}
export function Pagination({ page, pageSize, total, params, base }: { page: number; pageSize: number; total: number; params: Record<string, string | undefined>; base: string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize)); if (total <= pageSize) return <div className="border-t border-border px-4 py-2 text-xs text-muted">{total} record{total === 1 ? '' : 's'}</div>
  const href = (p: number) => `${base}?${new URLSearchParams(Object.entries({ ...params, page: String(p) }).filter(([, v]) => v) as [string, string][])}`
  return <nav aria-label="Pagination" className="flex items-center justify-between border-t border-border px-4 py-2 text-xs text-muted">
    <span className="tabular-nums">{(page - 1) * pageSize + 1}-{Math.min(page * pageSize, total)} of {total}</span>
    <div className="flex items-center gap-1">{page > 1 && <LinkButton href={href(page - 1)} variant="secondary" size="sm">Previous</LinkButton>}
      <span className="px-2 py-1 tabular-nums">Page {page} of {pages}</span>{page < pages && <LinkButton href={href(page + 1)} variant="secondary" size="sm">Next</LinkButton>}</div></nav>
}
