import Link from 'next/link'
import { Alert, Card, Field, Input } from '@/components/ui/primitives'
import { ActionForm } from '@/components/ui/action-form'
import { resetPassword } from '@/app/actions/auth'
import { createClient } from '@/lib/supabase/server'
export const metadata = { title: 'Choose a new password' }
/** Reached from the reset email (via /auth/callback, which signs the user in for this one step). */
export default async function Reset() {
  const { data: { user } } = await (await createClient()).auth.getUser()
  if (!user) return <Card className="p-6"><h1 className="mb-3 text-xl font-bold tracking-[-0.02em]">Link expired</h1>
    <Alert tone="amber">This reset link has expired or was already used.</Alert>
    <Link href="/login/forgot" className="mt-5 block text-center text-sm font-medium text-primary hover:underline">Request a new link</Link></Card>
  return <Card className="p-6"><h1 className="mb-1 text-xl font-bold tracking-[-0.02em]">Choose a new password</h1>
    <p className="mb-5 text-sm text-muted">For {user.email}. Every other device is signed out once it is saved.</p>
    <ActionForm action={resetPassword} submit="Save new password" resetOnSuccess={false} variant="blue" block>
      <Field label="New password" hint="10+ characters, mixing letters with numbers or symbols (or 14+ characters)."><Input name="password" type="password" autoComplete="new-password" minLength={10} maxLength={128} required autoFocus /></Field>
      <Field label="Repeat new password"><Input name="confirm" type="password" autoComplete="new-password" required /></Field>
    </ActionForm></Card>
}
