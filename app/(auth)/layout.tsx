import { supabaseConfigured } from '@/lib/env'
import { SetupRequired } from '@/components/layout/setup-required'
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  if (!supabaseConfigured()) return <SetupRequired />
  return <main className="grid min-h-screen place-items-center bg-bg p-4">
    <div className="w-full max-w-sm">
      <div className="mb-6 flex items-center gap-2.5"><div className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-lg font-bold text-primary-fg">S</div>
        <div><div className="font-semibold leading-tight">SaqrFlow</div><div className="text-xs text-muted">Smart Business Manager</div></div></div>
      {children}</div></main>
}
