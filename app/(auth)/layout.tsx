import { supabaseConfigured } from '@/lib/env'
import { SetupRequired } from '@/components/layout/setup-required'
import { AveriqoLogo, AveriqoMark } from '@/components/brand/logo'
import { BusinessArt } from '@/components/brand/business-art'

const POINTS = [
  ['Quotations to payments', 'Your letterhead, stamp and terms. Convert, invoice, collect and follow ageing.'],
  ['Documents and renewals', 'Licences, visas, Mulkiya and insurance, with reminders before anything lapses.'],
  ['Projects and resources', 'Progress, costs and profit per job, plus vehicles, equipment and maintenance.'],
]

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  if (!supabaseConfigured()) return <SetupRequired />
  return <main className="grid min-h-[100dvh] bg-bg lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
    <section aria-label="About Averiqo" className="relative hidden overflow-hidden bg-sb text-sb-fg lg:block">
      <BusinessArt variant="hero" id="auth" className="opacity-90" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_top,hsl(var(--sb))_8%,hsl(var(--sb)/.55)_50%,hsl(var(--sb)/.1))]" />
      <div className="relative flex h-full flex-col justify-between p-10 xl:p-14">
        <div className="flex flex-col items-start gap-1.5"><AveriqoLogo height={40} tone="dark" />
          <div className="text-xs tracking-wide text-sb-muted">Business OS</div></div>
        <div className="max-w-md">
          <h2 className="text-[28px] font-semibold leading-[1.15] tracking-[-0.02em]">Sales, people, documents and assets in one system.</h2>
          <dl className="mt-8 divide-y divide-white/10 border-y border-white/10">{POINTS.map(([t, d]) => <div key={t} className="py-3.5">
            <dt className="text-sm font-medium">{t}</dt><dd className="mt-0.5 text-[13px] leading-relaxed text-sb-muted">{d}</dd></div>)}</dl>
        </div>
      </div>
    </section>
    <div className="flex flex-col lg:grid lg:place-items-center lg:px-8 lg:py-10">
      {/* phones and tablets: a dark welcome panel above the form */}
      <section aria-label="Averiqo" className="relative overflow-hidden bg-[linear-gradient(160deg,hsl(var(--sb))_0%,hsl(223_55%_18%)_60%,hsl(217_70%_28%)_100%)] px-6 pb-16 pt-10 text-white lg:hidden">
        <BusinessArt variant="hero" id="auth-m" className="opacity-35" />
        <div className="relative">
          <div className="flex items-center gap-3"><AveriqoMark size={44} /><span className="leading-tight"><span className="block text-[28px] font-bold tracking-[-0.02em]">Averiqo</span><span className="block text-xs text-white/70">Business Operating System</span></span></div>
          <h2 className="mt-14 text-[32px] font-bold leading-[1.12] tracking-[-0.025em]">Manage your business smarter</h2>
          <p className="mt-3 max-w-xs text-[15px] leading-relaxed text-white/80">Projects, sales, documents, team and more. All in one place.</p>
        </div>
      </section>
      <div className="relative -mt-8 flex-1 rounded-t-3xl bg-bg px-4 pb-10 pt-6 sm:px-8 lg:mt-0 lg:w-full lg:max-w-sm lg:flex-none lg:rounded-none lg:bg-transparent lg:p-0">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-8 hidden flex-col items-start gap-1.5 lg:flex"><AveriqoLogo height={32} />
            <div className="text-xs tracking-wide text-muted">Business OS</div></div>
          {children}
          <p className="mt-8 text-center text-xs leading-relaxed text-muted lg:text-start">Files stay in your company’s private, encrypted storage. Two-step verification is available.</p>
        </div></div></div></main>
}
