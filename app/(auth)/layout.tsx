import { FileCheck2, HardHat, Receipt, ScanText } from 'lucide-react'
import { supabaseConfigured } from '@/lib/env'
import { SetupRequired } from '@/components/layout/setup-required'
import { SteelHero } from '@/components/auth/steel-hero'

const POINTS = [
  { icon: ScanText, t: 'Smart Inbox', d: 'Drop in licences, IDs and visas — read, matched and filed for you to confirm.' },
  { icon: Receipt, t: 'Quotations to payments', d: 'Your letterhead, stamp and terms. Convert, invoice, collect, track ageing.' },
  { icon: HardHat, t: 'Projects', d: 'Fabrication and site progress, milestones, costs and profit per job.' },
  { icon: FileCheck2, t: 'Never miss a renewal', d: 'Expiry reminders by WhatsApp, email and in-app.' },
]

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  if (!supabaseConfigured()) return <SetupRequired />
  return <main className="grid min-h-screen bg-bg lg:grid-cols-[1.05fr_1fr]">
    <section aria-label="About SaqrFlow" className="relative hidden overflow-hidden bg-[radial-gradient(120%_90%_at_30%_20%,#1e3a8a_0%,#0b1430_55%,#060a18_100%)] text-white lg:block">
      <SteelHero />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_top,rgba(6,10,24,.92),rgba(6,10,24,.15)_55%,transparent)]" />
      <div className="relative flex h-full flex-col justify-between p-10 xl:p-14">
        <div className="flex items-center gap-2.5"><div className="grid h-9 w-9 place-items-center rounded-lg bg-white/10 text-lg font-bold ring-1 ring-white/20 backdrop-blur">S</div>
          <div><div className="font-semibold leading-tight">SaqrFlow</div><div className="text-xs text-white/60">Smart Business Manager</div></div></div>
        <div className="max-w-lg">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight xl:text-4xl">Run the workshop, the paperwork and the payments — in one place.</h2>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2">{POINTS.map(p => <li key={p.t} className="rounded-xl bg-white/[.06] p-4 ring-1 ring-white/10 backdrop-blur-sm">
            <p.icon size={18} className="mb-2 text-sky-300" aria-hidden /><div className="text-sm font-medium">{p.t}</div><div className="mt-1 text-xs leading-relaxed text-white/65">{p.d}</div></li>)}</ul>
        </div>
      </div>
    </section>
    <div className="grid place-items-center p-4 sm:p-8">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2.5 lg:hidden"><div className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-lg font-bold text-primary-fg">S</div>
          <div><div className="font-semibold leading-tight">SaqrFlow</div><div className="text-xs text-muted">Smart Business Manager</div></div></div>
        {children}
        <p className="mt-6 text-center text-xs text-muted">Private by design: files stay in your company’s encrypted storage. Two-step verification available.</p>
      </div></div></main>
}
