import { cva, type VariantProps } from 'class-variance-authority'
import Link from 'next/link'
import { Children, cloneElement, isValidElement, type Ref } from 'react'
import { cn } from '@/lib/utils'
import type { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import type { LucideIcon } from '@/components/icons'
import { Inbox, AlertTriangle, Wallet, Banknote, Target, HardHat, ListTodo, CalendarClock, Users, FileText, Truck, Landmark, TrendingUp, BarChart3, Receipt, Clock, CheckCircle2, ShieldCheck, Package, Wrench, MapPinned, ArrowUp, ArrowDown } from '@/components/icons'

/*
 * Averiqo design system primitives.
 * Sizes: controls 36 px (sm 32 px) · table rows ~40 px · radius md (6 px) for controls, lg (8 px) for containers, sm (4 px) for badges.
 * Surfaces are separated by a 1 px border; shadows are reserved for floating layers (menus, dialogs, toasts).
 */
const button = cva('inline-flex cursor-pointer items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50 active:translate-y-px whitespace-nowrap select-none', {
  variants: {
    variant: {
      primary: 'bg-ink text-ink-fg shadow-btn hover:bg-ink/90',
      secondary: 'border border-border bg-surface text-fg shadow-sm hover:border-border-strong hover:bg-surface-2/70',
      blue: 'bg-primary text-primary-fg shadow-btn hover:bg-primary/90',
      ghost: 'text-muted hover:bg-surface-2 hover:text-fg',
      danger: 'bg-danger text-white shadow-btn hover:bg-danger/90',
    },
    size: { sm: 'h-10 px-3 sm:h-8', md: 'h-11 px-4 sm:h-10 sm:px-4', icon: 'h-11 w-11 sm:h-10 sm:w-10' },
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

const field = 'w-full rounded-md border border-border bg-surface px-3 text-sm text-fg shadow-sm placeholder:text-muted/55 transition-[border-color,box-shadow] hover:border-border-strong focus:border-primary focus-visible:ring-4 focus-visible:ring-primary/[.12] focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:bg-surface-2 disabled:opacity-70'
// dir="auto" + unicode-bidi:plaintext: typed text takes its own direction per line (an English name stays left-aligned inside the
// Arabic UI, an Arabic address line aligns right inside the English UI) instead of inheriting the page direction.
const TEXTUAL = new Set([undefined, 'text', 'search', 'email', 'tel', 'url', 'password'])
export const Input = ({ className, dir, type, ...p }: InputHTMLAttributes<HTMLInputElement>) =>
  <input type={type} dir={dir ?? (TEXTUAL.has(type) ? 'auto' : undefined)} className={cn(field, 'h-11 text-start sm:h-10', className)} {...p} />
export const Select = ({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => <select className={cn(field, 'h-11 cursor-pointer pe-8 sm:h-10', className)} {...p} />
export const Textarea = ({ className, dir, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement> & { ref?: Ref<HTMLTextAreaElement> }) =>
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

export const Card = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn('rounded-xl border border-border bg-surface shadow-card', className)} {...p} />
/** Card title row: 15 px title, optional line of help, an action (usually a "View all" link) on the right. No divider: content follows directly. */
export const CardHeader = ({ title, action, sub }: { title: string; action?: ReactNode; sub?: string }) =>
  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-5 pb-3 pt-4"><div className="min-w-0 flex-1 basis-48"><h3 className="text-[15px] font-semibold tracking-[-0.012em]">{title}</h3>{sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}</div>{action}</div>
/** The "View all" link used in card headers. */
export const CardLink = ({ href, children = 'View all' }: { href: string; children?: ReactNode }) => <Link href={href} className="shrink-0 text-[13px] font-medium text-primary hover:underline">{children}</Link>

// one status palette for the whole product: subtle tint + readable text, never a saturated fill
const tone = {
  neutral: 'bg-surface-2 text-muted', blue: 'bg-primary-soft text-primary', green: 'bg-success/10 text-success',
  amber: 'bg-warning/10 text-warning', red: 'bg-danger/10 text-danger',
}
export type Tone = keyof typeof tone
export const Badge = ({ tone: t = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) =>
  <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium leading-5', tone[t], className)}>{children}</span>

// KPI cards: a tinted icon tile (colour rotates along the row, red when the card signals a problem), label, value,
// optional change vs the previous period and an optional mini bar series. The whole card opens the list behind it.
const TILES = ['bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300', 'bg-orange-50 text-orange-600 dark:bg-orange-500/15 dark:text-orange-300',
  'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300', 'bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300',
  'bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300', 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300']
const BARS = ['bg-blue-500', 'bg-orange-400', 'bg-emerald-500', 'bg-violet-500', 'bg-sky-500', 'bg-amber-500']
const RED_TILE = 'bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300'
// a sensible icon from the label when the caller passes none
const ICON_RULES: [RegExp, LucideIcon][] = [[/overdue|late|expired|risk|blocked/i, AlertTriangle], [/expir|renewal|due/i, CalendarClock], [/collect|paid|payment|received/i, Banknote],
  [/receivable|outstanding|balance|owed|cost|spend|expense|budget/i, Wallet], [/invoice|sales|revenue|billed|quot/i, Receipt], [/lead|pipeline|opportunit/i, Target], [/project|job/i, HardHat],
  [/task|to.?do/i, ListTodo], [/employee|staff|people|user|team|member/i, Users], [/document|file|record|page/i, FileText], [/vehicle|asset|fleet|equipment/i, Truck],
  [/cheque|bank/i, Landmark], [/rate|%|margin|growth|conversion|win/i, TrendingUp], [/hour|time|day|week/i, Clock], [/done|complete|closed|approved|resolved|won/i, CheckCircle2],
  [/compliance|permit|licen|warranty/i, ShieldCheck], [/item|catalog|stock|product/i, Package], [/ticket|service|repair|maint/i, Wrench], [/visit|site|location/i, MapPinned]]
const iconFor = (label: string) => ICON_RULES.find(([r]) => r.test(label))?.[1] ?? BarChart3

/** Small bar series for a KPI card (e.g. last 8 months). Server-rendered, decorative: the card's text carries the numbers. */
export function MiniBars({ values, className }: { values: number[]; className?: string }) {
  const max = Math.max(...values, 0)
  if (!values.length || max <= 0) return null
  return <span aria-hidden className="flex h-8 shrink-0 items-end gap-[3px]">{values.map((v, i) => <span key={i} className={cn('w-[5px] rounded-sm', className, i === values.length - 1 ? 'opacity-100' : 'opacity-35')} style={{ height: `${Math.max(10, (v / max) * 100)}%` }} />)}</span>
}

const valueTone: Partial<Record<Tone, string>> = { red: 'text-danger' }
export function StatCard({ label, value, hint, href, tone: t = 'neutral', icon, change, bars, index = 0 }: { label: string; value: ReactNode; hint?: ReactNode; icon?: LucideIcon; href?: string; tone?: Tone; change?: number | null; bars?: number[]; index?: number }) {
  const Icon = icon ?? iconFor(label), tile = t === 'red' ? RED_TILE : TILES[index % TILES.length]
  const showChange = change !== undefined && change !== null
  // layout is CSS (globals.css .kpi): stacked on narrow cards, icon tile on the left with bars bottom-right once the card is wide enough
  const inner = <div className={cn('stat kpi-in h-full min-w-0 rounded-xl border border-border bg-surface p-3.5 shadow-card sm:p-[18px]', href && 'transition-[border-color,box-shadow] hover:border-border-strong hover:shadow-md')}>
    <span className={cn('kpi-tile grid h-9 w-9 shrink-0 place-items-center rounded-xl sm:h-11 sm:w-11', tile)} aria-hidden><Icon size={19} strokeWidth={1.9} /></span>
    <span className="kpi-label min-w-0 text-[12.5px] font-medium leading-snug text-muted sm:text-[13px]">{label}</span>
    <div className={cn('kpi-value text-[19px] font-bold leading-tight tabular-nums tracking-[-0.025em] [overflow-wrap:anywhere] sm:text-[22px]', valueTone[t])}>{value}</div>
    {(showChange || hint) && <div className="kpi-hint flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-muted">
      {showChange && <span className={cn('inline-flex shrink-0 items-center gap-0.5 font-semibold tabular-nums', change >= 0 ? 'text-success' : 'text-danger')}>{change >= 0 ? <ArrowUp size={12} strokeWidth={2.5} aria-hidden /> : <ArrowDown size={12} strokeWidth={2.5} aria-hidden />}{Math.abs(change)}%</span>}
      {hint && <span className="min-w-0">{hint}</span>}</div>}
    {bars && <span className="kpi-bars"><MiniBars values={bars} className={t === 'red' ? 'bg-rose-500' : BARS[index % BARS.length]} /></span>}
  </div>
  return href ? <Link href={href} className="kpi block h-full rounded-xl focus-visible:ring-offset-0">{inner}</Link> : <div className="kpi h-full">{inner}</div>
}
/** A row of KPI cards. Columns follow the number of cards; each card gets the next tile colour. */
export function Metrics({ children, className, cols }: { children: ReactNode; className?: string; cols?: 2 | 3 | 4 | 5 | 6 }) {
  const kids = Children.toArray(children).filter(Boolean)
  const n = cols ?? (Math.min(6, Math.max(2, kids.length)) as 2 | 3 | 4 | 5 | 6)
  const lg = { 2: 'lg:grid-cols-2', 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4', 5: 'lg:grid-cols-3 xl:grid-cols-5', 6: 'lg:grid-cols-3 2xl:grid-cols-6' }[n]
  let i = 0
  // phones: one swipeable strip of compact cards, so the list below starts near the top of the screen
  return <div className={cn('metrics tabstrip -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-4 sm:overflow-visible sm:px-0 sm:pb-0 [&>*]:w-[46%] [&>*]:min-w-[158px] [&>*]:shrink-0 [&>*]:snap-start sm:[&>*]:w-auto sm:[&>*]:min-w-0', n >= 3 && 'md:grid-cols-3', lg, className)}>
    {kids.map(k => isValidElement(k) && k.type === StatCard ? cloneElement(k as React.ReactElement<{ index?: number }>, { index: (k.props as { index?: number }).index ?? i++ }) : k)}</div>
}

export function EmptyState({ title, body, action, icon: Icon = Inbox }: { title: string; body?: string; action?: ReactNode; icon?: LucideIcon }) {
  return <div className="flex flex-col items-center justify-center gap-1.5 px-6 py-12 text-center">
    <span className="mb-2 grid h-11 w-11 place-items-center rounded-xl bg-primary-soft text-primary" aria-hidden><Icon size={20} strokeWidth={1.75} /></span>
    <p className="text-sm font-semibold">{title}</p>{body && <p className="max-w-sm text-sm text-muted">{body}</p>}{action && <div className="mt-3">{action}</div>}
  </div>
}
/** Page title row: optional breadcrumb trail, 24 px title, one line of context, actions on the right. */
export const PageHeader = ({ title, sub, actions, crumbs }: { title: string; sub?: string; actions?: ReactNode; crumbs?: { label: string; href?: string }[] }) =>
  <div className="mb-6 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
    <div className="min-w-0">
      {crumbs && crumbs.length > 0 && <nav aria-label="Breadcrumb" className="mb-1.5 hidden flex-wrap sm:flex items-center gap-1.5 text-[13px] text-muted">{crumbs.map((c, i) => <span key={i} className="inline-flex items-center gap-1.5">{i > 0 && <span aria-hidden className="text-muted/60">›</span>}{c.href ? <Link href={c.href} className="hover:text-fg">{c.label}</Link> : <span className="text-fg">{c.label}</span>}</span>)}</nav>}
      <h1 className="text-[24px] font-bold leading-tight tracking-[-0.025em]">{title}</h1>{sub && <p className="mt-1 hidden max-w-[72ch] text-sm text-muted sm:block">{sub}</p>}</div>
    {actions && <div className="tabstrip -mx-4 flex w-[calc(100%+2rem)] items-center gap-2 overflow-x-auto px-4 sm:mx-0 sm:w-auto sm:flex-wrap sm:overflow-visible sm:px-0 [&>*]:shrink-0">{actions}</div>}</div>

export const Alert = ({ tone: t = 'blue', children }: { tone?: Tone; children: ReactNode }) =>
  <div role={t === 'red' ? 'alert' : undefined} className={cn('rounded-md border px-3 py-2 text-sm', t === 'red' ? 'border-danger/25 bg-danger/5 text-danger' : t === 'amber' ? 'border-warning/25 bg-warning/5' : t === 'green' ? 'border-success/25 bg-success/5' : t === 'neutral' ? 'border-border bg-surface-2' : 'border-primary/20 bg-primary-soft')}>{children}</div>

export const Th = ({ children, className }: { children?: ReactNode; className?: string }) => <th scope="col" className={cn('h-11 whitespace-nowrap border-b border-border bg-surface-2/60 px-3 text-start text-[12.5px] font-medium text-muted first:ps-5 last:pe-5', className)}>{children}</th>
/** `badge`: on phone cards this cell (a status) sits at the top right, beside the record's title, instead of on its own line. */
export const Td = ({ children, className, title, colSpan, badge }: { children?: ReactNode; className?: string; title?: string; colSpan?: number; badge?: boolean }) => <td title={title} colSpan={colSpan} data-card={badge ? 'badge' : undefined} className={cn('px-3 py-3 align-middle first:ps-5 last:pe-5', className)}>{children}</td>
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
