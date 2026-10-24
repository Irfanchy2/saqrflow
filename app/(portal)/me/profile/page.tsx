import { getMe } from '@/lib/me'
import { daysBetween, formatShortDate } from '@/lib/time'
import { Badge, EmptyState } from '@/components/ui/primitives'
import { FileText, LogOut, UserRound } from '@/components/icons'
import { PortalCard } from '@/components/portal/stat'
import { signOut } from '@/app/actions/auth'

export const metadata = { title: 'My profile' }

/** The employee's own record and documents (passport, visa, Emirates ID…) with their expiry dates. Read-only. */
export default async function MyProfile() {
  const { c, emp } = await getMe()
  if (!emp) return null
  const { data: docs } = await c.supabase.from('documents').select('id,name,reference_no,expiry_date,current_version_id').eq('owner_type', 'employee').eq('owner_id', emp.id).is('deleted_at', null).order('expiry_date', { ascending: true, nullsFirst: false })
  const rows: [string, string | null][] = [['Employee no.', emp.employee_no], ['Designation', emp.designation], ['Department', emp.department], ['Work location', emp.work_location],
    ['Joined', emp.joining_date ? formatShortDate(emp.joining_date) : null], ['Nationality', emp.nationality], ['Phone', emp.phone], ['Email', c.email ?? null]]
  return <div className="space-y-4">
    <section className="flex items-center gap-4 rounded-2xl border border-border/80 bg-surface p-5 shadow-card">
      {emp.photo_path ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={`/api/employees/${emp.id}/photo?w=160`} alt="" className="h-16 w-16 shrink-0 rounded-2xl object-cover" />
        : <span className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-surface-2 text-muted" aria-hidden><UserRound size={28} /></span>}
      <div className="min-w-0"><h1 className="text-[22px] font-semibold leading-tight tracking-[-0.025em] [overflow-wrap:anywhere]">{emp.full_name}</h1>
        <p className="mt-0.5 text-[13.5px] text-muted">{[emp.designation, c.company.name].filter(Boolean).join(' · ')}</p>
        <Badge tone={emp.status === 'active' ? 'green' : 'neutral'} className="mt-2">{emp.status.replace('_', ' ').replace(/^./, s => s.toUpperCase())}</Badge></div>
    </section>

    <PortalCard title="My details" sub="To change anything here, ask HR.">
      <dl className="divide-y divide-border/70 px-4 pb-2 sm:px-5" data-profile>{rows.filter(([, v]) => v).map(([k, v]) => <div key={k} className="flex items-baseline justify-between gap-4 py-2.5 text-[14px]"><dt className="text-muted">{k}</dt><dd className="min-w-0 text-end font-medium [overflow-wrap:anywhere]">{v}</dd></div>)}</dl>
    </PortalCard>

    <PortalCard title="My documents">
      {(docs ?? []).length ? <ul className="divide-y divide-border/70" data-my-documents>{docs!.map(d => { const left = d.expiry_date ? daysBetween(c.today, d.expiry_date) : null
        return <li key={d.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-surface-2 text-muted" aria-hidden><FileText size={18} /></span>
          <div className="min-w-0 flex-1"><div className="truncate text-[15px] font-medium">{d.name}</div>
            <div className="text-[13px] text-muted">{d.expiry_date ? `Expires ${formatShortDate(d.expiry_date)}` : 'No expiry date'}</div></div>
          {left !== null && <Badge tone={left < 0 ? 'red' : left <= 30 ? 'amber' : 'green'}>{left < 0 ? 'Expired' : left <= 30 ? `${left} days left` : 'Valid'}</Badge>}
          {d.current_version_id && <a href={`/api/documents/${d.id}/download?mode=preview`} target="_blank" rel="noopener noreferrer" className="text-[13px] font-medium text-primary">Open</a>}</li> })}</ul>
        : <EmptyState compact icon={FileText} title="No documents yet" body="HR adds your passport, visa and ID here." />}
    </PortalCard>

    <form action={signOut}><button className="flex h-14 w-full cursor-pointer items-center justify-center gap-2 rounded-2xl border border-border bg-surface text-[15px] font-semibold text-danger shadow-key hover:bg-surface-2"><LogOut size={18} aria-hidden />Sign out</button></form>
  </div>
}
