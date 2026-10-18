import { cva, type VariantProps } from 'class-variance-authority'
import Link from 'next/link'
import { Children, cloneElement, isValidElement, type Ref } from 'react'
import { cn } from '@/lib/utils'
import { formatAed } from '@/lib/time'
import type { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import type { LucideIcon } from '@/components/icons'
import { EmptyArt } from './empty-art'
import { Inbox, AlertTriangle, Wallet, Banknote, Target, HardHat, ListTodo, CalendarClock, Users, FileText, Truck, Landmark, TrendingUp, BarChart3, Receipt, Clock, CheckCircle2, ShieldCheck, Package, Wrench, MapPinned, ArrowUp, ArrowDown } from '@/components/icons'

/*
 * Averiqo design system primitives.
 * Sizes: controls 36 px (sm 32 px) · table rows ~40 px · radius md (6 px) for controls, lg (8 px) for containers, sm (4 px) for badges.
 * Surfaces are separated by a 1 px border; shadows are reserved for floating layers (menus, dialogs, toasts).
 */
// Buttons are tactile: filled ones carry a top highlight, a hairline in their own colour and a soft coloured shadow
// that deepens on hover; outlined ones read as a key (hairline, faint bottom edge). Every button presses in by 2%.
const button = cva('relative inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-lg text-[13.5px] font-medium tracking-[-0.006em] select-none transition-[background-color,border-color,color,box-shadow,transform,opacity] duration-150 ease-out active:scale-[.98] disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0', {
  variants: {
    variant: {
      primary: 'bg-ink bg-[linear-gradient(180deg,hsl(0_0%_100%/.09),hsl(0_0%_100%/0))] text-ink-fg shadow-solid [--b:var(--ink)] hover:bg-ink/[.93] hover:shadow-solid-hover',
      secondary: 'border border-border bg-surface text-fg shadow-key hover:border-border-strong hover:bg-surface-2/60 active:bg-surface-2',
      blue: 'bg-primary bg-[linear-gradient(180deg,hsl(0_0%_100%/.12),hsl(0_0%_100%/0))] text-primary-fg shadow-solid [--b:var(--primary)] hover:bg-primary/[.93] hover:shadow-solid-hover',
      ghost: 'text-muted hover:bg-fg/[.05] hover:text-fg active:bg-fg/[.08]',
      danger: 'bg-danger bg-[linear-gradient(180deg,hsl(0_0%_100%/.1),hsl(0_0%_100%/0))] text-white shadow-solid [--b:var(--danger)] hover:bg-danger/[.93] hover:shadow-solid-hover',
    },
    // one icon size per button size, whatever size the caller passed (14 px small, 16 px regular, 18 px icon-only)
    size: { sm: 'h-10 gap-1.5 px-3 text-[13px] sm:h-8 sm:px-2.5 [&>svg]:h-3.5 [&>svg]:w-3.5', md: 'h-11 px-4 sm:h-10 sm:px-4 [&>svg]:h-4 [&>svg]:w-4', icon: 'h-11 w-11 sm:h-10 sm:w-10 [&>svg]:h-[18px] [&>svg]:w-[18px]' },
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

// fields: a recessed well (faint inner shadow), a hairline that darkens on hover, a soft blue halo on focus
const field = 'w-full rounded-lg border border-border bg-surface px-3 text-sm text-fg shadow-field placeholder:text-muted/60 transition-[border-color,box-shadow,background-color] duration-150 hover:border-border-strong focus:border-primary/70 focus:shadow-focus focus-visible:ring-0 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:bg-surface-2 disabled:opacity-70'
// dir="auto" + unicode-bidi:plaintext: typed text takes its own direction per line (an English name stays left-aligned inside the
// Arabic UI, an Arabic address line aligns right inside the English UI) instead of inheriting the page direction.
const TEXTUAL = new Set([undefined, 'text', 'search', 'email', 'tel', 'url', 'password'])
export const Input = ({ className, dir, type, ...p }: InputHTMLAttributes<HTMLInputElement>) =>
  <input type={type} dir={dir ?? (TEXTUAL.has(type) ? 'auto' : undefined)} className={cn(field, 'h-11 text-start sm:h-10', className)} {...p} />
export const Select = ({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement> & { ref?: Ref<HTMLSelectElement> }) => <select className={cn(field, 'field-select h-11 cursor-pointer pe-9 sm:h-10', className)} {...p} />
export const Textarea = ({ className, dir, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement> & { ref?: Ref<HTMLTextAreaElement> }) =>
  <textarea dir={dir ?? 'auto'} className={cn(field, 'min-h-[84px] resize-y px-3 py-2 text-start leading-[1.55] [overflow-wrap:anywhere] [unicode-bidi:plaintext] whitespace-pre-wrap', className)} {...p} />

/** Label above the control, hint below. A trailing " *" in the label renders as a required marker. */
export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  const req = label.endsWith(' *'), text = req ? label.slice(0, -2) : label
  return <label className={cn('flex min-w-0 flex-col gap-1.5 text-sm', className)}>
    <span className="text-[13px] font-medium tracking-[-0.005em] text-fg/90">{text}{req && <span className="text-danger"> *</span>}</span>
    {children}{hint && <span className="text-xs leading-snug text-muted">{hint}</span>}</label>
}
/** Groups related fields inside a form without another box: a heading, an optional line of help, then the fields. */
export function FormSection({ title, sub, children, className }: { title: string; sub?: string; children: ReactNode; className?: string }) {
  return <fieldset className={cn('min-w-0 border-t border-border pt-4 first:border-t-0 first:pt-0', className)}>
    <legend className="float-left mb-3 w-full"><span className="block text-sm font-semibold">{title}</span>{sub && <span className="block text-xs text-muted">{sub}</span>}</legend>
    <div className="clear-left">{children}</div></fieldset>
}

export const Card = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn('rounded-xl border border-border/80 bg-surface shadow-card', className)} {...p} />
/** Segmented control (view switchers): a recessed track with a raised thumb on the current option. */
export const SEG = 'inline-flex items-center gap-0.5 rounded-[10px] bg-surface-2 p-[3px] shadow-[inset_0_0_0_1px_hsl(var(--border)/.7)]'
export const segItem = (on: boolean) => cn('inline-flex h-8 items-center gap-1.5 rounded-[8px] px-3 text-[13px] font-medium transition-[color,background-color,box-shadow] duration-150 sm:h-7', on ? 'bg-surface text-fg shadow-key ring-1 ring-border/70' : 'text-muted hover:text-fg')
/** Card title row: 15 px title, optional line of help, an action (usually a "View all" link) on the right. No divider: content follows directly. */
export const CardHeader = ({ title, action, sub }: { title: string; action?: ReactNode; sub?: string }) =>
  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-5 pb-3 pt-[18px]"><div className="min-w-0 flex-1 basis-48"><h3 className="text-[15px] font-semibold leading-tight tracking-[-0.015em]">{title}</h3>{sub && <p className="mt-1 text-[12.5px] leading-snug text-muted">{sub}</p>}</div>{action}</div>
/** The "View all" link used in card headers. */
export const CardLink = ({ href, children = 'View all' }: { href: string; children?: ReactNode }) => <Link href={href} className="card-link -my-2 inline-flex min-h-10 shrink-0 items-center text-[13px] font-medium text-primary">{children}</Link>

// one status palette for the whole product: subtle tint + readable text, never a saturated fill
// a status reads as tint + inset hairline + (for plain text) a leading dot in the same colour
const tone = {
  neutral: 'bg-surface-2 text-muted ring-border', blue: 'bg-primary-soft text-primary ring-primary/15', green: 'bg-success/[.08] text-success ring-success/20',
  amber: 'bg-warning/[.08] text-warning ring-warning/20', red: 'bg-danger/[.07] text-danger ring-danger/20',
}
export type Tone = keyof typeof tone
export const Badge = ({ tone: t = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) => {
  const dot = t !== 'neutral' && (typeof children === 'string' || typeof children === 'number')
  return <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-px text-xs font-medium leading-5 ring-1 ring-inset', tone[t], className)}>
    {dot && <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-80" />}{children}</span>
}

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
// semantic tile colours: the same kind of figure always gets the same colour (index into TILES / BARS); anything else rotates
const TONE_RULES: [RegExp, number][] = [[/collect|received|paid|payment|profit|margin|won|done|complete/i, 2], [/receivable|outstanding|balance|owed|due|pending/i, 5],
  [/cost|spend|expense|labour|material|fuel|transport/i, 1], [/quot|pipeline|lead|opportunit|approval/i, 3], [/sales|invoice|revenue|billed|contract|value/i, 0]]
const toneIndex = (label: string, i: number) => TONE_RULES.find(([r]) => r.test(label))?.[1] ?? i
/** "AED 1,284,567.50" with a small, quiet currency so the figure itself carries the weight; never wraps. */
export function Money({ value, className, currency = true }: { value: number | string; className?: string; currency?: boolean }) {
  const s = formatAed(value), neg = s.startsWith('-'), num = s.replace(/^-?AED /, '')
  // plain inline text (not flex), so the copied / read text stays "AED 1,250.00"
  return <span className={cn('whitespace-nowrap tabular-nums', className)}>{currency && <><span className="text-[0.72em] font-medium tracking-normal opacity-60">AED</span>{' '}</>}{neg ? '-' : ''}{num}</span>
}
/** A KPI value: "AED …" strings get the quiet currency; the length drives the fluid size (globals.css .kpi-value). */
function kpiValue(v: ReactNode) {
  if (typeof v !== 'string') return v
  const m = /^(-?)AED (.+)$/.exec(v)
  return m ? <><span className="kpi-cur">AED</span>{' '}{m[1]}{m[2]}</> : v
}

/** Small bar series for a KPI card (e.g. last 8 months). Server-rendered, decorative: the card's text carries the numbers. */
export function MiniBars({ values, className }: { values: number[]; className?: string }) {
  const max = Math.max(...values, 0)
  if (!values.length || max <= 0) return null
  return <span aria-hidden className="flex h-8 shrink-0 items-end gap-[3px]">{values.map((v, i) => <span key={i} className={cn('w-[5px] rounded-sm', className, i === values.length - 1 ? 'opacity-100' : 'opacity-35')} style={{ height: `${Math.max(10, (v / max) * 100)}%`, '--b': i } as React.CSSProperties} />)}</span>
}

const valueTone: Partial<Record<Tone, string>> = { red: 'text-danger' }
export function StatCard({ label, value, hint, href, tone: t = 'neutral', icon, change, bars, index = 0 }: { label: string; value: ReactNode; hint?: ReactNode; icon?: LucideIcon; href?: string; tone?: Tone; change?: number | null; bars?: number[]; index?: number }) {
  const Icon = icon ?? iconFor(label), ti = toneIndex(label, index), tile = t === 'red' ? RED_TILE : TILES[ti % TILES.length]
  const len = typeof value === 'string' ? value.replace(/^-?AED /, '').length + (value.includes('AED') ? 2.4 : 0) : 0
  const showChange = change !== undefined && change !== null
  // layout is CSS (globals.css .kpi): stacked on narrow cards, icon tile on the left with bars bottom-right once the card is wide enough
  // resting: hairline + soft shadow; a card that links somewhere lifts 1 px with a deeper shadow on hover
  const inner = <div className={cn('stat kpi-in h-full min-w-0 rounded-xl border border-border/80 bg-surface p-3.5 shadow-card sm:p-[18px]', href && 'transition-[border-color,box-shadow,transform] duration-200 ease-out hover:-translate-y-px hover:border-border-strong/80 hover:shadow-lift')}>
    <span className={cn('kpi-tile grid h-9 w-9 shrink-0 place-items-center rounded-lg shadow-[inset_0_0_0_1px_hsl(var(--fg)/.04)] sm:h-11 sm:w-11 sm:rounded-xl', tile)} aria-hidden><Icon size={19} strokeWidth={1.9} /></span>
    <span className="kpi-label min-w-0 text-[12.5px] font-medium leading-snug text-muted sm:text-[13px]">{label}</span>
    <div className={cn('kpi-value font-semibold leading-tight tabular-nums tracking-[-0.03em]', len ? 'kpi-fit' : 'text-[19px] [overflow-wrap:anywhere] sm:text-[23px]', valueTone[t])} style={len ? { '--len': len } as React.CSSProperties : undefined} title={typeof value === 'string' ? value : undefined}>{kpiValue(value)}</div>
    {(showChange || hint) && <div className="kpi-hint flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-muted">
      {showChange && <span className={cn('inline-flex shrink-0 items-center gap-0.5 font-semibold tabular-nums', change >= 0 ? 'text-success' : 'text-danger')}>{change >= 0 ? <ArrowUp size={12} strokeWidth={2.5} aria-hidden /> : <ArrowDown size={12} strokeWidth={2.5} aria-hidden />}{Math.abs(change)}%</span>}
      {hint && <span className="min-w-0">{hint}</span>}</div>}
    {bars && <span className="kpi-bars"><MiniBars values={bars} className={t === 'red' ? 'bg-rose-500' : BARS[ti % BARS.length]} /></span>}
  </div>
  return href ? <Link href={href} className="kpi block h-full rounded-xl focus-visible:ring-offset-0">{inner}</Link> : <div className="kpi h-full">{inner}</div>
}
/** A row of KPI cards. Columns follow the number of cards; each card gets the next tile colour. */
export function Metrics({ children, className, cols }: { children: ReactNode; className?: string; cols?: 2 | 3 | 4 | 5 | 6 }) {
  const kids = Children.toArray(children).filter(Boolean)
  const n = cols ?? (Math.min(6, Math.max(2, kids.length)) as 2 | 3 | 4 | 5 | 6)
  const lg = { 2: 'lg:grid-cols-2', 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4', 5: 'lg:grid-cols-3 xl:grid-cols-5', 6: 'lg:grid-cols-3 2xl:grid-cols-6' }[n]
  // tablets: three columns only when the cards fill the rows (3, 6, 9…) or leave a pair (5); 4 or 8 cards read better 2-up
  const md3 = n >= 3 && (kids.length % 3 === 0 || kids.length === 5)
  let i = 0
  // phones: one swipeable strip of compact cards, so the list below starts near the top of the screen
  return <div className={cn('metrics tabstrip -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-4 sm:overflow-visible sm:px-0 sm:pb-0 [&>*]:w-[46%] [&>*]:min-w-[158px] [&>*]:shrink-0 [&>*]:snap-start sm:[&>*]:w-auto sm:[&>*]:min-w-0', md3 && 'md:grid-cols-3', lg, className)}>
    {kids.map(k => isValidElement(k) && k.type === StatCard ? cloneElement(k as React.ReactElement<{ index?: number }>, { index: (k.props as { index?: number }).index ?? i++ }) : k)}</div>
}

/** Nothing here yet: a small illustration for the kind of data (the icon on a floating card), then a title, one line of help and the next step. */
/** `compact`: inside a dashboard widget or a short panel (smaller tile, tighter spacing, no rings). */
export function EmptyState({ title, body, action, icon: Icon = Inbox, compact }: { title: string; body?: string; action?: ReactNode; icon?: LucideIcon; compact?: boolean }) {
  return <div className={cn('empty-in flex flex-col items-center justify-center text-center', compact ? 'px-5 py-7' : 'px-6 py-10 sm:py-14')}>
    {compact ? <span className="relative mb-3 grid h-10 w-10 place-items-center rounded-[11px] border border-border/80 bg-surface text-primary shadow-lift" aria-hidden><Icon size={18} strokeWidth={1.75} /></span>
      : <EmptyArt icon={Icon} className="mb-4" />}
    <p className={cn('font-semibold tracking-[-0.012em]', compact ? 'text-[14px]' : 'text-[15px]')}>{title}</p>{body && <p className={cn('mt-1.5 max-w-sm leading-relaxed text-muted', compact ? 'text-[13px]' : 'text-[13.5px]')}>{body}</p>}{action && <div className={compact ? 'mt-4' : 'mt-5'}>{action}</div>}
  </div>
}
/** Page title row: optional breadcrumb trail, 24 px title, one line of context, actions on the right. */
export const PageHeader = ({ title, sub, actions, crumbs }: { title: string; sub?: string; actions?: ReactNode; crumbs?: { label: string; href?: string }[] }) =>
  <div className="mb-6 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
    <div className="min-w-0">
      {crumbs && crumbs.length > 0 && <nav aria-label="Breadcrumb" className="mb-1.5 hidden flex-wrap sm:flex items-center gap-1.5 text-[13px] text-muted">{crumbs.map((c, i) => <span key={i} className="inline-flex items-center gap-1.5">{i > 0 && <span aria-hidden className="text-muted/60">›</span>}{c.href ? <Link href={c.href} className="hover:text-fg">{c.label}</Link> : <span className="text-fg">{c.label}</span>}</span>)}</nav>}
      <h1 className="text-[24px] font-bold leading-[1.15] tracking-[-0.028em] sm:text-[26px] sm:font-semibold sm:tracking-[-0.032em]">{title}</h1>{sub && <p className="mt-1.5 hidden max-w-[72ch] text-[13.5px] text-muted sm:block">{sub}</p>}</div>
    {/* actions wrap onto a second line on phones rather than scrolling, so none is ever off-screen */}
    {actions && <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto [&>*]:shrink-0">{actions}</div>}</div>

export const Alert = ({ tone: t = 'blue', children }: { tone?: Tone; children: ReactNode }) =>
  <div role={t === 'red' ? 'alert' : undefined} className={cn('rounded-md border px-3 py-2 text-sm', t === 'red' ? 'border-danger/25 bg-danger/5 text-danger' : t === 'amber' ? 'border-warning/25 bg-warning/5' : t === 'green' ? 'border-success/25 bg-success/5' : t === 'neutral' ? 'border-border bg-surface-2' : 'border-primary/20 bg-primary-soft')}>{children}</div>

export const Th = ({ children, className }: { children?: ReactNode; className?: string }) => <th scope="col" className={cn('th', className)}>{children}</th>
/** `badge`: on phone cards this cell (a status) sits at the top right, beside the record's title, instead of on its own line. */
export const Td = ({ children, className, title, colSpan, badge }: { children?: ReactNode; className?: string; title?: string; colSpan?: number; badge?: boolean }) => <td title={title} colSpan={colSpan} data-card={badge ? 'badge' : undefined} className={cn('td', className)}>{children}</td>
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
