import Link from 'next/link'
import { Alert, Card, Field, Input } from '@/components/ui/primitives'
import { ActionForm } from '@/components/ui/action-form'
import { signIn } from '@/app/actions/auth'
export const metadata = { title: 'Sign in' }
export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string; m?: string }> }) {
  const { next, m } = await searchParams
  return <Card className="p-6"><h1 className="mb-1 text-lg font-semibold">Sign in</h1><p className="mb-5 text-sm text-muted">Welcome back.</p>
    {m === 'revoked' && <div className="mb-4"><Alert tone="amber">This device was signed out from another device or by your administrator. Sign in again to continue.</Alert></div>}
    <ActionForm action={signIn} submit="Sign in" resetOnSuccess={false}>
      <input type="hidden" name="next" value={next ?? ''} />
      <Field label="Email"><Input name="email" type="email" autoComplete="email" required autoFocus /></Field>
      <Field label="Password"><Input name="password" type="password" autoComplete="current-password" required /></Field>
    </ActionForm>
    <p className="mt-4 text-center text-sm text-muted">New here? <Link className="text-primary hover:underline" href="/signup">Create an account</Link></p></Card>
}
