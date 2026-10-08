import { supabaseConfigured } from '@/lib/env'
import { SetupRequired } from '@/components/layout/setup-required'
import { SteelHero } from '@/components/auth/steel-hero'
import { AveriqoLogo } from '@/components/brand/logo'

const POINTS = [
  ['Quotations to payments', 'Your letterhead, stamp and terms. Convert, invoice, collect and follow ageing.'],
  ['Documents and renewals', 'Licences, visas, Mulkiya and insurance, with reminders before anything lapses.'],
  ['Projects and resources', 'Progress, costs and profit per job, plus vehicles, equipment and maintenance.'],
]

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  if (!supabaseConfigured()) return <SetupRequired />
  return <main className="grid min-h-[100dvh] bg-bg lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
    <section aria-label="About Averiqo" className="relative hidden overflow-hidden bg-[#12151b] text-[#e8ebf0] lg:block">
      <SteelHero />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_top,#12151b_8%,rgba(18,21,27,.55)_50%,rgba(18,21,27,.1))]" />
      <div className="relative flex h-full flex-col justify-between p-10 xl:p-14">
        <div className="flex flex-col items-start gap-1.5"><AveriqoLogo height={40} tone="dark" />
          <div className="text-xs tracking-wide text-[#9aa3b2]">Business OS</div></div>
        <div className="max-w-md">
          <h2 className="text-[28px] font-semibold leading-[1.15] tracking-[-0.02em]">Sales, people, documents and assets in one system.</h2>
          <dl className="mt-8 divide-y divide-white/10 border-y border-white/10">{POINTS.map(([t, d]) => <div key={t} className="py-3.5">
            <dt className="text-sm font-medium">{t}</dt><dd className="mt-0.5 text-[13px] leading-relaxed text-[#9aa3b2]">{d}</dd></div>)}</dl>
        </div>
      </div>
    </section>
    <div className="grid place-items-center px-4 py-10 sm:px-8">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-start gap-1.5 lg:hidden"><AveriqoLogo height={32} />
          <div className="text-xs tracking-wide text-muted">Business OS</div></div>
        {children}
        <p className="mt-8 text-xs leading-relaxed text-muted">Files stay in your company’s private, encrypted storage. Two-step verification is available.</p>
      </div></div></main>
}
