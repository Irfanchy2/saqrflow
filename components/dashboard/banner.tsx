import Link from 'next/link'
import { ArrowRight } from '@/components/icons'
import { BusinessArt } from '@/components/brand/business-art'

/** Company banner: name, today's workload in plain numbers, the two places people go next. */
export function DashboardBanner({ company, stats }: { company: string; stats: { label: string; value: number; href: string }[] }) {
  return <section aria-label="Today at a glance" className="relative mb-5 overflow-hidden rounded-xl bg-[linear-gradient(110deg,hsl(var(--sb))_0%,hsl(223_55%_20%)_55%,hsl(217_70%_32%)_100%)] text-white shadow-card">
    <BusinessArt variant="banner" id="dash" className="max-lg:opacity-40" />
    <div className="relative flex flex-col gap-5 p-6 sm:p-7 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0 max-w-xl">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/70">{company}</div>
        <h2 className="mt-2 text-[24px] font-bold leading-tight tracking-[-0.02em] sm:text-[28px]">Today at a glance</h2>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/projects" className="group/cta inline-flex h-10 items-center gap-2.5 rounded-full bg-white pe-1.5 ps-4 text-[13px] font-semibold text-[hsl(var(--sb))] shadow-[inset_0_-1px_0_hsl(var(--sb)/.08),0_6px_16px_-8px_hsl(0_0%_0%/.6)] transition-[background-color,transform] duration-150 ease-out hover:bg-white/95 active:scale-[.98]">View projects<span aria-hidden className="grid h-7 w-7 place-items-center rounded-full bg-[hsl(var(--sb))] text-white transition-transform duration-200 ease-out group-hover/cta:translate-x-0.5 rtl:group-hover/cta:-translate-x-0.5"><ArrowRight size={13} className="rtl:rotate-180" /></span></Link>
          <Link href="/brief" className="inline-flex h-10 items-center rounded-full bg-white/[.08] px-4 text-[13px] font-medium text-white ring-1 ring-inset ring-white/20 transition-[background-color,transform] duration-150 ease-out hover:bg-white/[.14] active:scale-[.98]">Open daily brief</Link>
        </div>
      </div>
      {stats.length > 0 && <dl className="grid grid-cols-3 gap-2 sm:flex sm:gap-3">{stats.map(s => <Link key={s.label} href={s.href}
        className="min-w-0 rounded-xl bg-white/[.07] px-3.5 py-2.5 shadow-[inset_0_1px_0_hsl(0_0%_100%/.08)] ring-1 ring-inset ring-white/[.12] transition-[background-color,transform] duration-200 ease-out hover:-translate-y-px hover:bg-white/[.12] sm:min-w-[124px]">
        <dt className="truncate text-[11.5px] text-white/75">{s.label}</dt><dd className="mt-0.5 text-[22px] font-semibold tabular-nums leading-tight tracking-[-0.02em]">{s.value}</dd></Link>)}</dl>}
    </div>
  </section>
}
