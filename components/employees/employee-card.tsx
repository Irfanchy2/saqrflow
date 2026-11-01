import Link from 'next/link'
import { ArrowRight, Banknote, CalendarDays, HardHat, MapPin, MessageCircle, Phone, ShieldCheck, Truck, UserRound } from '@/components/icons'
import { Badge, type Tone } from '@/components/ui/primitives'
import { formatShortDate } from '@/lib/time'
import { fmtMoney } from '@/lib/sales/money'
import type { ChecklistState } from '@/lib/compliance'
import { cn } from '@/lib/utils'

export interface EmpCardData {
  id: string; employee_no: string; full_name: string; nationality: string | null; department: string | null; designation: string | null
  phone: string | null; status: string; work_location: string | null; joining_date: string | null; photo_path: string | null
  emergency_contact_name?: string | null; emergency_contact_phone?: string | null; accommodation?: string | null
}
export interface EmpCardExtra {
  checklist?: { items: { name: string; state: ChecklistState; expiry: string | null }[]; score: number; issues: number }
  salary?: number | null; leave?: { type: string; until: string } | null; assets?: string[]; jobs?: string[]
}

const DOT: Record<ChecklistState, string> = { valid: 'bg-success', no_expiry: 'bg-success', expiring_soon: 'bg-warning', renewal_in_progress: 'bg-primary', expired: 'bg-danger', missing: 'bg-border-strong', cancelled: 'bg-border-strong' }
const STATE: Record<ChecklistState, string> = { valid: 'Valid', no_expiry: 'Valid', expiring_soon: 'Expiring', renewal_in_progress: 'Renewing', expired: 'Expired', missing: 'Missing', cancelled: 'Cancelled' }
const statusTone = (s: string): Tone => s === 'active' ? 'green' : s === 'archived' || s === 'terminated' || s === 'resigned' ? 'neutral' : 'amber'
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('')
function tenure(from: string | null, today: string) {
  if (!from) return null
  const a = new Date(from + 'T00:00:00Z'), b = new Date(today + 'T00:00:00Z'), m = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth() - (b.getUTCDate() < a.getUTCDate() ? 1 : 0)
  return m < 1 ? 'new' : m < 12 ? `${m} mo` : `${Math.floor(m / 12)} y${m % 12 ? ` ${m % 12} mo` : ''}`
}
const wa = (p: string) => `https://wa.me/${p.replace(/[^\d]/g, '').replace(/^0+/, '')}`

/** One person on one card: who they are, how to reach them, their documents and what they are on today. */
export function EmployeeCard({ e, x, today, sensitive, upload, action }: { e: EmpCardData; x: EmpCardExtra; today: string; sensitive: boolean; /** room for the card's Add document button */ upload?: boolean; /** e.g. Log in as employee */ action?: React.ReactNode }) {
  const cl = x.checklist, t = tenure(e.joining_date, today)
  const row = (I: typeof Phone, label: string, value: React.ReactNode) => <div className="flex min-w-0 items-start gap-2.5"><I size={15} className="mt-0.5 shrink-0 text-muted" aria-hidden /><div className="min-w-0"><dt className="sr-only">{label}</dt><dd className="truncate">{value}</dd></div></div>
  return <div className="flex h-full flex-col">
    <header className={cn('flex items-start gap-3.5', upload && 'pe-28')}>
      <span className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-2xl bg-[hsl(185_30%_88%)] text-[16px] font-semibold text-[hsl(190_30%_22%)] dark:bg-[hsl(185_20%_22%)] dark:text-[hsl(185_30%_86%)]">
        {e.photo_path ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={`/api/employees/${e.id}/photo?w=120`} alt="" loading="lazy" className="h-full w-full object-cover" /> : initials(e.full_name) || <UserRound size={24} />}</span>
      <div className="min-w-0">
        <h3 className="truncate text-[16px] font-semibold leading-tight tracking-[-0.01em]"><Link href={`/employees/${e.id}`} className="hover:text-primary">{e.full_name}</Link></h3>
        <p className="mt-0.5 truncate text-[13px] text-muted">{[e.designation, e.department].filter(Boolean).join(' · ') || 'No designation'}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5"><Badge tone={statusTone(e.status)}>{e.status.replace(/_/g, ' ')}</Badge><span className="font-mono text-[11.5px] text-muted">{e.employee_no}</span>{e.nationality && <span className="text-[12px] text-muted">· {e.nationality}</span>}</div>
      </div>
    </header>

    {(x.leave || x.jobs?.length || x.assets?.length) ? <ul className="mt-3.5 flex flex-wrap gap-1.5 text-[12px]" aria-label="Today">
      {x.leave && <li className="inline-flex items-center gap-1.5 rounded-full bg-warning/10 px-2.5 py-1 font-medium text-warning"><CalendarDays size={13} aria-hidden />On {x.leave.type} leave until {formatShortDate(x.leave.until)}</li>}
      {x.jobs?.slice(0, 2).map(j => <li key={j} className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1"><HardHat size={13} className="shrink-0 text-muted" aria-hidden /><span className="truncate">{j}</span></li>)}
      {x.assets?.slice(0, 2).map(a => <li key={a} className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1"><Truck size={13} className="shrink-0 text-muted" aria-hidden /><span className="truncate">{a}</span></li>)}
    </ul> : null}

    <dl className="mt-4 grid grid-cols-1 gap-x-4 gap-y-2.5 text-[13px] sm:grid-cols-2">
      {row(Phone, 'Phone', e.phone ? <span className="inline-flex items-center gap-2"><a href={`tel:${e.phone}`} className="hover:text-primary">{e.phone}</a><a href={wa(e.phone)} target="_blank" rel="noopener noreferrer" aria-label={`WhatsApp ${e.full_name}`} className="text-success hover:opacity-80"><MessageCircle size={14} aria-hidden /></a></span> : <span className="text-muted">No phone</span>)}
      {row(MapPin, 'Work location', e.work_location ?? <span className="text-muted">No location</span>)}
      {row(CalendarDays, 'Joined', e.joining_date ? <>{formatShortDate(e.joining_date)}{t && <span className="text-muted"> · {t}</span>}</> : <span className="text-muted">Joining date not set</span>)}
      {x.salary !== undefined && row(Banknote, 'Monthly salary', x.salary != null ? <>AED {fmtMoney(x.salary)}<span className="text-muted"> / month</span></> : <span className="text-muted">Salary not set</span>)}
      {sensitive && row(Phone, 'Emergency contact', e.emergency_contact_name ? <>{e.emergency_contact_name}{e.emergency_contact_phone && <span className="text-muted"> · {e.emergency_contact_phone}</span>}</> : <span className="text-muted">No emergency contact</span>)}
      {sensitive && row(MapPin, 'Accommodation', e.accommodation ?? <span className="text-muted">No accommodation</span>)}
    </dl>

    {cl && <section className="mt-4 rounded-xl bg-surface-2/60 p-3" aria-label="Documents">
      <div className="flex items-center justify-between gap-2 text-[12.5px]"><span className="inline-flex items-center gap-1.5 font-semibold"><ShieldCheck size={14} aria-hidden />Documents</span>
        <span className={cn('font-semibold tabular-nums', cl.issues ? 'text-danger' : cl.score === 100 ? 'text-success' : 'text-warning')}>{cl.score}%{cl.issues ? ` · ${cl.issues} to fix` : ''}</span></div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border/60"><div className={cn('h-full rounded-full', cl.issues ? 'bg-danger' : cl.score === 100 ? 'bg-success' : 'bg-warning')} style={{ width: `${Math.max(cl.score, 3)}%` }} /></div>
      <ul className="mt-2.5 grid grid-cols-1 gap-x-4 gap-y-1.5 text-[12.5px] sm:grid-cols-2">{cl.items.map(i => <li key={i.name} className="flex min-w-0 items-center gap-2">
        <span className={cn('h-2 w-2 shrink-0 rounded-full', DOT[i.state])} aria-hidden /><span className="min-w-0 flex-1 truncate">{i.name}</span>
        <span className={cn('shrink-0 tabular-nums', i.state === 'expired' ? 'font-medium text-danger' : i.state === 'expiring_soon' ? 'font-medium text-warning' : 'text-muted')}>{i.expiry && i.state !== 'missing' ? formatShortDate(i.expiry) : STATE[i.state]}</span></li>)}</ul>
    </section>}

    <footer className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 pt-4 text-[13px] font-medium">
      <Link href={`/employees/${e.id}`} className="inline-flex items-center gap-1 text-primary hover:underline">Open profile<ArrowRight size={13} className="rtl:rotate-180" aria-hidden /></Link>
      {sensitive && <Link href={`/employees/${e.id}?tab=documents`} className="text-muted hover:text-fg">Documents</Link>}
      {x.salary !== undefined && <Link href={`/employees/${e.id}?tab=salary`} className="text-muted hover:text-fg">Salary</Link>}
      {sensitive && <Link href={`/employees/${e.id}?tab=leave`} className="text-muted hover:text-fg">Leave</Link>}
      {action && <span className="ms-auto">{action}</span>}
    </footer>
  </div>
}
