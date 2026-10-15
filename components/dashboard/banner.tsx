import Link from 'next/link'
import { ArrowRight } from '@/components/icons'

/** Steel-frame line drawing (columns, beams, a truss) used as background art (dashboard banner, phone sign-in). */
export function SteelFrameArt() {
  const cols = [560, 680, 800, 920, 1040]
  return <svg viewBox="0 0 1100 220" preserveAspectRatio="xMaxYMid slice" className="absolute inset-0 h-full w-full" aria-hidden>
    <defs><linearGradient id="bn-fade" x1="0" x2="1"><stop offset="0.35" stopColor="#fff" stopOpacity="0" /><stop offset="1" stopColor="#fff" stopOpacity=".55" /></linearGradient></defs>
    <g stroke="url(#bn-fade)" strokeWidth="2" fill="none">
      {cols.map(x => <path key={x} d={`M${x} 220V70`} />)}
      <path d="M520 70H1100M520 140H1100M520 200H1100" />
      {cols.slice(0, -1).map((x, i) => <path key={i} d={`M${x} 70L${x + 120} 140M${x + 120} 70L${x} 140M${x} 140L${x + 60} 200L${x + 120} 140`} strokeOpacity=".7" />)}
      <path d="M540 70L700 18L860 70L1020 18L1100 44" strokeWidth="2.5" />
      {[620, 780, 940].map(x => <path key={x} d={`M${x} 44V70`} />)}
    </g>
    <g fill="#fff" fillOpacity=".5">{cols.map(x => <rect key={x} x={x - 6} y={64} width={12} height={12} rx={2} />)}</g>
  </svg>
}

/** Company banner: name, today's workload in plain numbers, the two places people go next. */
export function DashboardBanner({ company, stats }: { company: string; stats: { label: string; value: number; href: string }[] }) {
  return <section aria-label="Today at a glance" className="relative mb-5 overflow-hidden rounded-xl bg-[linear-gradient(110deg,hsl(var(--sb))_0%,hsl(223_55%_20%)_55%,hsl(217_70%_32%)_100%)] text-white shadow-card">
    <SteelFrameArt />
    <div className="relative flex flex-col gap-5 p-6 sm:p-7 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0 max-w-xl">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/70">{company}</div>
        <h2 className="mt-2 text-[24px] font-bold leading-tight tracking-[-0.02em] sm:text-[28px]">Today at a glance</h2>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/projects" className="inline-flex h-9 items-center gap-2 rounded-lg bg-white px-3.5 text-[13px] font-semibold text-[hsl(var(--sb))] transition-colors hover:bg-white/90">View projects<ArrowRight size={14} className="rtl:rotate-180" aria-hidden /></Link>
          <Link href="/brief" className="inline-flex h-9 items-center rounded-lg bg-white/10 px-3.5 text-[13px] font-medium text-white ring-1 ring-inset ring-white/20 transition-colors hover:bg-white/15">Open daily brief</Link>
        </div>
      </div>
      {stats.length > 0 && <dl className="grid grid-cols-3 gap-2 sm:flex sm:gap-3">{stats.map(s => <Link key={s.label} href={s.href}
        className="min-w-0 rounded-lg bg-white/10 px-3.5 py-2.5 ring-1 ring-inset ring-white/15 backdrop-blur-sm transition-colors hover:bg-white/15 sm:min-w-[120px]">
        <dt className="truncate text-[11.5px] text-white/75">{s.label}</dt><dd className="text-[22px] font-bold tabular-nums leading-tight">{s.value}</dd></Link>)}</dl>}
    </div>
  </section>
}
