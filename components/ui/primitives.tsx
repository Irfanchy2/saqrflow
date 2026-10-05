import { cva, type VariantProps } from 'class-variance-authority'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import type { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Inbox } from 'lucide-react'

const button = cva('inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-all disabled:opacity-50 disabled:pointer-events-none active:scale-[.98] whitespace-nowrap', {
  variants: {
    variant: {
      primary: 'bg-primary text-primary-fg shadow-sm hover:brightness-110',
      secondary: 'bg-surface border border-border hover:bg-surface-2',
      ghost: 'hover:bg-surface-2 text-muted hover:text-fg',
      danger: 'bg-danger text-white hover:brightness-110',
    },
    size: { sm: 'h-8 px-3', md: 'h-9 px-4', icon: 'h-9 w-9' },
  },
  defaultVariants: { variant: 'primary', size: 'md' },
})
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof button>
export const Button = ({ className, variant, size, ...p }: BtnProps) => <button className={cn(button({ variant, size }), className)} {...p} />
export const LinkButton = ({ href, className, variant, size, children }: { href: string; className?: string; children: ReactNode } & VariantProps<typeof button>) =>
  <Link href={href} className={cn(button({ variant, size }), className)}>{children}</Link>

const field = 'w-full rounded-md border border-border bg-surface px-3 text-sm placeholder:text-muted/70 transition-colors hover:border-muted/50 disabled:opacity-60'
export const Input = ({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) => <input className={cn(field, 'h-9', className)} {...p} />
export const Select = ({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => <select className={cn(field, 'h-9 pr-8', className)} {...p} />
export const Textarea = ({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea className={cn(field, 'py-2 min-h-[72px]', className)} {...p} />
export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return <label className={cn('flex flex-col gap-1.5 text-sm', className)}><span className="font-medium">{label}</span>{children}{hint && <span className="text-xs text-muted">{hint}</span>}</label>
}

export const Card = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn('rounded-lg border border-border bg-surface shadow-card', className)} {...p} />
export const CardHeader = ({ title, action, sub }: { title: string; action?: ReactNode; sub?: string }) =>
  <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3"><div><h3 className="text-sm font-semibold">{title}</h3>{sub && <p className="text-xs text-muted">{sub}</p>}</div>{action}</div>

const tone = {
  neutral: 'bg-surface-2 text-muted', blue: 'bg-primary-soft text-primary', green: 'bg-success/10 text-success',
  amber: 'bg-warning/15 text-warning', red: 'bg-danger/10 text-danger',
}
export type Tone = keyof typeof tone
export const Badge = ({ tone: t = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) =>
  <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', tone[t], className)}>{children}</span>

export function StatCard({ label, value, hint, icon: Icon, href, tone: t = 'neutral' }: { label: string; value: ReactNode; hint?: string; icon?: LucideIcon; href?: string; tone?: Tone }) {
  const inner = <Card className={cn('p-4 transition-all', href && 'hover:border-primary/40 hover:shadow-md')}>
    <div className="flex items-center justify-between"><span className="text-xs font-medium text-muted">{label}</span>
      {Icon && <span className={cn('rounded-md p-1.5', tone[t])}><Icon size={15} /></span>}</div>
    <div className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
    {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
  </Card>
  return href ? <Link href={href}>{inner}</Link> : inner
}

export function EmptyState({ title, body, action, icon: Icon = Inbox }: { title: string; body?: string; action?: ReactNode; icon?: LucideIcon }) {
  return <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
    <span className="rounded-full bg-surface-2 p-3 text-muted"><Icon size={22} /></span>
    <p className="font-medium">{title}</p>{body && <p className="max-w-sm text-sm text-muted">{body}</p>}{action && <div className="mt-2">{action}</div>}
  </div>
}
export const PageHeader = ({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) =>
  <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
    <div><h1 className="text-xl font-semibold tracking-tight">{title}</h1>{sub && <p className="mt-0.5 text-sm text-muted">{sub}</p>}</div>
    <div className="flex flex-wrap items-center gap-2">{actions}</div></div>

export const Alert = ({ tone: t = 'blue', children }: { tone?: Tone; children: ReactNode }) =>
  <div className={cn('rounded-md border px-3 py-2 text-sm', t === 'red' ? 'border-danger/30 bg-danger/5 text-danger' : t === 'amber' ? 'border-warning/30 bg-warning/10' : t === 'green' ? 'border-success/30 bg-success/5' : 'border-primary/20 bg-primary-soft')}>{children}</div>

export const Th = ({ children, className }: { children?: ReactNode; className?: string }) => <th className={cn('whitespace-nowrap px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-muted', className)}>{children}</th>
export const Td = ({ children, className, title }: { children?: ReactNode; className?: string; title?: string }) => <td title={title} className={cn('px-4 py-3 align-middle', className)}>{children}</td>
export const TableWrap = ({ children }: { children: ReactNode }) => <div className="overflow-x-auto"><table className="w-full text-sm">{children}</table></div>

/** Sortable column header: links to the same page with ?sort=&dir= preserved. */
export function SortTh({ label, col, params, base }: { label: string; col: string; params: Record<string, string | undefined>; base: string }) {
  const active = params.sort === col, dir = active && params.dir === 'asc' ? 'desc' : 'asc'
  const qs = new URLSearchParams(Object.entries({ ...params, sort: col, dir, page: '1' }).filter(([, v]) => v) as [string, string][]).toString()
  return <Th><Link href={`${base}?${qs}`} className="inline-flex items-center gap-1 hover:text-fg">{label}<span className={active ? 'text-primary' : 'opacity-30'}>{active ? (params.dir === 'asc' ? '↑' : '↓') : '↕'}</span></Link></Th>
}
export function Pagination({ page, pageSize, total, params, base }: { page: number; pageSize: number; total: number; params: Record<string, string | undefined>; base: string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize)); if (total <= pageSize) return <div className="border-t border-border px-4 py-2 text-xs text-muted">{total} record{total === 1 ? '' : 's'}</div>
  const href = (p: number) => `${base}?${new URLSearchParams(Object.entries({ ...params, page: String(p) }).filter(([, v]) => v) as [string, string][])}`
  return <div className="flex items-center justify-between border-t border-border px-4 py-2 text-xs text-muted">
    <span>{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}</span>
    <div className="flex gap-1">{page > 1 && <LinkButton href={href(page - 1)} variant="secondary" size="sm">Previous</LinkButton>}
      <span className="px-2 py-1">Page {page}/{pages}</span>{page < pages && <LinkButton href={href(page + 1)} variant="secondary" size="sm">Next</LinkButton>}</div></div>
}
