import Link from 'next/link'
import { Alert, Card, Field, Input } from '@/components/ui/primitives'
import { ActionForm } from '@/components/ui/action-form'
import { signIn, signInDemo } from '@/app/actions/auth'
import { DEMO_EMAIL, DEMO_PASSWORD } from '@/lib/demo-account'
export const metadata = { title: 'Sign in' }
export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string; m?: string }> }) {
  const { next, m } = await searchParams
  return <Card className="p-6"><h1 className="mb-1 text-xl font-bold tracking-[-0.02em]">Sign in</h1><p className="mb-5 text-sm text-muted">Welcome back.</p>
    {m === 'revoked' && <div className="mb-4"><Alert tone="amber">This device was signed out from another device or by your administrator, or after 24 hours without activity. Sign in again to continue.</Alert></div>}
    <ActionForm action={signIn} submit="Sign in" resetOnSuccess={false} variant="blue" block>
      <input type="hidden" name="next" value={next ?? ''} />
      <Field label="Email"><Input name="email" type="email" autoComplete="email" required autoFocus /></Field>
      <Field label="Password"><Input name="password" type="password" autoComplete="current-password" required /></Field>
    </ActionForm>
    <Link href="/login/forgot" className="mt-3 block text-center text-sm font-medium text-primary hover:underline">Forgot password?</Link>
    <div className="mt-5 flex items-center gap-3 text-xs text-muted"><span className="h-px flex-1 bg-border" />New here?<span className="h-px flex-1 bg-border" /></div>
    <Link href="/signup" className="mt-4 flex h-11 w-full items-center justify-center rounded-lg border-[1.5px] border-ink text-sm font-semibold text-ink transition-colors hover:bg-ink hover:text-ink-fg">Create account</Link>
    <section aria-labelledby="demo-h" className="mt-5 rounded-xl border border-dashed border-primary/30 bg-primary-soft/40 p-4" data-demo-panel>
      <h2 id="demo-h" className="text-sm font-semibold">Just looking? Try the demo</h2>
      <p className="mt-1 text-[13px] leading-relaxed text-muted">A sample steel fabrication company with quotations, invoices, projects and staff. Shared by everyone and reset every day. Messages are never really sent.</p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 font-mono text-[12.5px]"><dt className="text-muted">Email</dt><dd className="select-all">{DEMO_EMAIL}</dd><dt className="text-muted">Password</dt><dd className="select-all">{DEMO_PASSWORD}</dd></dl>
      <div className="mt-3"><ActionForm action={signInDemo} submit="Open the demo" resetOnSuccess={false} variant="secondary" block><span hidden /></ActionForm></div>
    </section></Card>
}
